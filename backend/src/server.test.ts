import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "./server.js";

const TOKEN = "test-token";
let base = "";
let server: ReturnType<typeof createServer>;
let readOnlyBase = "";
let readOnlyServer: ReturnType<typeof createServer>;

const listen = (s: ReturnType<typeof createServer>) =>
  new Promise<string>((resolve) =>
    s.listen(0, () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)),
  );

beforeAll(async () => {
  server = createServer({ writeToken: TOKEN });
  readOnlyServer = createServer();
  base = await listen(server);
  readOnlyBase = await listen(readOnlyServer);
});
afterAll(() => {
  server.close();
  readOnlyServer.close();
});

const post = (url: string, body: unknown, token?: string) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("http service", () => {
  it("serves health", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
  });

  it("returns a zero passport for a new grant", async () => {
    const p: any = await (await fetch(`${base}/passport/grant-a`)).json();
    expect(p.score).toBe(0);
    expect(p.status).toBe("new");
  });

  it("raises the score after authenticated spends, scoped per grant", async () => {
    for (const amount of [5, 8, 4]) {
      const r = await post(`${base}/passport/grant-b/spend`, { amount_usd: amount, category: "api-credits" }, TOKEN);
      expect(r.status).toBe(200);
    }
    const b: any = await (await fetch(`${base}/passport/grant-b`)).json();
    expect(b.successfulSpends).toBe(3);
    expect(b.cleanVolumeUsd).toBe(17);
    expect(b.score).toBe(58);
    const other: any = await (await fetch(`${base}/passport/grant-c`)).json();
    expect(other.score).toBe(0);
  });

  it("hides individual spends from the public view but not from the token holder", async () => {
    await post(`${base}/passport/grant-priv/spend`, { amount_usd: 3, category: "secret-cat" }, TOKEN);
    const pub: any = await (await fetch(`${base}/passport/grant-priv`)).json();
    expect(pub.successfulSpends).toBe(1);
    expect(pub.recentSpends).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain("secret-cat");
    const priv: any = await (
      await fetch(`${base}/passport/grant-priv`, { headers: { authorization: `Bearer ${TOKEN}` } })
    ).json();
    expect(priv.recentSpends).toHaveLength(1);
  });

  it("rejects writes without or with a wrong token", async () => {
    expect((await post(`${base}/passport/g/spend`, { amount_usd: 1 })).status).toBe(401);
    expect((await post(`${base}/passport/g/spend`, { amount_usd: 1 }, "nope")).status).toBe(401);
  });

  it("disables writes when no token is configured", async () => {
    expect((await post(`${readOnlyBase}/passport/g/spend`, { amount_usd: 1 }, "x")).status).toBe(503);
    expect((await fetch(`${readOnlyBase}/passport/g`)).status).toBe(200);
  });

  it("validates input", async () => {
    expect((await post(`${base}/passport/g/spend`, { amount_usd: -1 }, TOKEN)).status).toBe(400);
    expect((await post(`${base}/passport/g/spend`, { amount_usd: "5" }, TOKEN)).status).toBe(400);
    expect((await post(`${base}/passport/g/spend`, "{not json", TOKEN)).status).toBe(400);
    expect((await fetch(`${base}/passport/bad%20id!`)).status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("rejects oversized bodies", async () => {
    const r = await post(`${base}/passport/g/spend`, { amount_usd: 1, category: "x".repeat(20_000) }, TOKEN).catch(
      () => null,
    );
    // Either a 413 response or a reset connection is acceptable.
    expect(r === null || r.status === 413).toBe(true);
  });
});
