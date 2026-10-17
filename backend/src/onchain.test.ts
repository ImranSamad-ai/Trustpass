import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "./server.js";
import { VerifyError, USDC_BASE, verifyBaseUsdcPayment, type Rpc } from "./onchain.js";

const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => `0x${"0".repeat(24)}${a.slice(2)}`;
const PAYER = `0x${"a".repeat(40)}`;
const OTHER = `0x${"b".repeat(40)}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const usdc = (from: string, micro: bigint) => ({
  address: USDC_BASE,
  topics: [TOPIC, pad(from), pad(OTHER)],
  data: `0x${micro.toString(16).padStart(64, "0")}`,
});

function fakeRpc(receipts: Record<string, any>, latest = 110): Rpc {
  return async (method, params) => {
    if (method === "eth_blockNumber") return `0x${latest.toString(16)}`;
    if (method === "eth_getTransactionReceipt") return receipts[params[0] as string] ?? null;
    throw new Error("unexpected rpc");
  };
}
const receipt = (logs: any[], over: any = {}) => ({ status: "0x1", blockNumber: "0x64", from: PAYER, logs, ...over });

describe("verifyBaseUsdcPayment", () => {
  it("reads the USDC amount from the chain", async () => {
    const rpc = fakeRpc({ [hash(1)]: receipt([usdc(PAYER, 2_500_000n), usdc(PAYER, 1_250_000n), usdc(OTHER, 9_000_000n)]) });
    const p = await verifyBaseUsdcPayment(rpc, hash(1));
    expect(p.amountUsd).toBe(3.75);
    expect(p.payer).toBe(PAYER);
  });

  it("supports a facilitator-submitted payment via payer_address", async () => {
    const rpc = fakeRpc({ [hash(2)]: receipt([usdc(OTHER, 5_000_000n)], { from: PAYER }) });
    expect((await verifyBaseUsdcPayment(rpc, hash(2), OTHER)).amountUsd).toBe(5);
    await expect(verifyBaseUsdcPayment(rpc, hash(2))).rejects.toThrow(/no USDC transfer/);
  });

  it("rejects missing, failed, unconfirmed and non-USDC transactions", async () => {
    const rpc = fakeRpc(
      {
        [hash(3)]: receipt([usdc(PAYER, 1_000_000n)], { status: "0x0" }),
        [hash(4)]: receipt([{ ...usdc(PAYER, 1_000_000n), address: `0x${"c".repeat(40)}` }]),
        [hash(5)]: receipt([usdc(PAYER, 1_000_000n)], { blockNumber: "0x6e" }),
      },
      110,
    );
    await expect(verifyBaseUsdcPayment(rpc, hash(9))).rejects.toThrow(/not found/);
    await expect(verifyBaseUsdcPayment(rpc, hash(3))).rejects.toThrow(/failed/);
    await expect(verifyBaseUsdcPayment(rpc, hash(4))).rejects.toThrow(/no USDC transfer/);
    await expect(verifyBaseUsdcPayment(rpc, hash(5))).rejects.toBeInstanceOf(VerifyError);
  });
});

describe("POST spend with tx_hash", () => {
  const TOKEN = "t";
  const rpc = fakeRpc({ [hash(1)]: receipt([usdc(PAYER, 8_000_000n)]) });
  const server = createServer({ writeToken: TOKEN, rpc });
  let base = "";
  beforeAll(async () => {
    base = await new Promise<string>((r) => server.listen(0, () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  });
  afterAll(() => server.close());
  const post = (id: string, body: unknown) =>
    fetch(`${base}/passport/${id}/spend`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });

  it("ignores a claimed amount, records the chain amount, and marks evidence", async () => {
    const r = await post("agent-v", { tx_hash: hash(1), amount_usd: 9999 });
    expect(r.status).toBe(200);
    const p: any = await r.json();
    expect(p.cleanVolumeUsd).toBe(8);
    expect(p.verifiedSpends).toBe(1);
    expect(p.evidence).toBe("onchain_verified");
    expect(p.score).toBe(24);
  });

  it("refuses to count the same transaction twice, even for another agent", async () => {
    const r = await post("agent-w", { tx_hash: hash(1) });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatch(/already been counted/);
  });

  it("mixes evidence and validates inputs", async () => {
    const p: any = await (await post("agent-v", { amount_usd: 2 })).json();
    expect(p.evidence).toBe("mixed");
    expect((await post("agent-v", { tx_hash: "0x12" })).status).toBe(400);
    expect((await post("agent-v", { tx_hash: hash(7) })).status).toBe(422);
    expect((await post("agent-v", {})).status).toBe(400);
  });
});
