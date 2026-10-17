/**
 * On-chain verification of USDC payments on Base. The amount is read from the
 * chain (USDC Transfer logs), never from the caller.
 */

export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MIN_CONFIRMATIONS = 2;
const MAX_USD = 1_000_000_000;

export const TX_RE = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type Rpc = (method: string, params: unknown[]) => Promise<any>;

export interface VerifiedPayment {
  txHash: string;
  payer: string;
  amountUsd: number;
  blockNumber: number;
}

/** A verification failure with a message that is safe to show to the caller. */
export class VerifyError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export function httpRpc(url: string, timeoutMs = 2500): Rpc {
  let id = 0;
  return async (method, params) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new VerifyError("could not reach the Base RPC; try again shortly", 502);
    }
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) throw new VerifyError("the Base RPC returned an error; try again shortly", 502);
    return json.result;
  };
}

const topicAddress = (topic: string) => `0x${topic.slice(26)}`.toLowerCase();

/**
 * Verifies a mined, successful transaction on Base and returns the USDC the
 * payer sent in it. `payer` defaults to the transaction sender; pass it
 * explicitly for payments submitted by a facilitator (e.g. x402).
 */
export async function verifyBaseUsdcPayment(rpc: Rpc, txHash: string, payer?: string): Promise<VerifiedPayment> {
  const [receipt, latestHex] = await Promise.all([rpc("eth_getTransactionReceipt", [txHash]), rpc("eth_blockNumber", [])]);
  if (!receipt) throw new VerifyError("transaction not found on Base (it may not be mined yet)");
  if (receipt.status !== "0x1") throw new VerifyError("transaction failed on-chain, so it cannot count as a clean spend");

  const blockNumber = Number(BigInt(receipt.blockNumber));
  if (Number(BigInt(latestHex)) - blockNumber < MIN_CONFIRMATIONS - 1) {
    throw new VerifyError("transaction has too few confirmations yet; retry in a few seconds");
  }

  const from = (payer ?? receipt.from ?? "").toLowerCase();
  if (!ADDRESS_RE.test(from)) throw new VerifyError("could not determine the payer address");

  let sum = 0n;
  for (const log of receipt.logs ?? []) {
    if (
      String(log.address).toLowerCase() === USDC_BASE &&
      log.topics?.length === 3 &&
      log.topics[0] === TRANSFER_TOPIC &&
      topicAddress(log.topics[1]) === from
    ) {
      sum += BigInt(log.data);
    }
  }
  const amountUsd = Number(sum / 10_000n) / 100; // USDC has 6 decimals; keep whole cents
  if (amountUsd <= 0) throw new VerifyError("no USDC transfer from the payer was found in this transaction");
  if (amountUsd > MAX_USD) throw new VerifyError("amount is out of range");

  return { txHash: txHash.toLowerCase(), payer: from, amountUsd, blockNumber };
}
