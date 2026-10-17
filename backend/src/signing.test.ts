import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "./server.js";
import { PassportStore } from "./passport.js";
import { Signer, canonicalize, verifySigned } from "./signing.js";

const store = new PassportStore();
for (const a of [5, 8, 4]) store.recordSuccessfulSpend("alpha", { amountUsd: a });
const signer = new Signer();
const server = createServer({ store, signer });
let base = "";
beforeAll(async () => {
  base = await new Promise<string>((r) => server.listen(0, () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
});
afterAll(() => server.close());

describe("signed passports", () => {
  it("verifies offline with only the public key", async () => {
    const doc: any = await (await fetch(`${base}/passport/alpha/signed`)).json();
    const key: any = await (await fetch(`${base}/.well-known/passport-key`)).json();
    expect(doc.passport).toMatchObject({ agentId: "alpha", score: 58, tier: "Trusted", v: 1 });
    expect(doc.kid).toBe(key.kid);
    expect(key.ephemeral).toBe(true);
    expect(verifySigned(doc, key.publicKey)).toEqual({ signatureValid: true, expired: false });
    expect(JSON.stringify(doc)).not.toContain("recentSpends");
  });

  it("detects tampering, a wrong key, and expiry", async () => {
    const doc: any = await (await fetch(`${base}/passport/alpha/signed`)).json();
    const key = signer.publicKey;
    expect(verifySigned({ ...doc, passport: { ...doc.passport, score: 100 } }, key).signatureValid).toBe(false);
    expect(verifySigned(doc, new Signer().publicKey).signatureValid).toBe(false);
    expect(verifySigned(doc, key, Date.now() + 25 * 3_600_000).expired).toBe(true);
  });

  it("honours ttl_hours within limits and rejects bad ids", async () => {
    const a: any = await (await fetch(`${base}/passport/alpha/signed?ttl_hours=1`)).json();
    expect(Date.parse(a.passport.expiresAt) - Date.parse(a.passport.issuedAt)).toBe(3_600_000);
    const b: any = await (await fetch(`${base}/passport/alpha/signed?ttl_hours=9999`)).json();
    expect(Date.parse(b.passport.expiresAt) - Date.parse(b.passport.issuedAt)).toBe(168 * 3_600_000);
    expect((await fetch(`${base}/passport/bad%20id/signed`)).status).toBe(400);
  });

  it("keeps a configured key stable and canonicalizes key order", () => {
    const { generateKeyPairSync } = require("node:crypto");
    const b64 = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const one = new Signer(b64);
    expect(one.ephemeral).toBe(false);
    expect(new Signer(b64).publicKey).toBe(one.publicKey);
    expect(() => new Signer("not-a-key")).toThrow(/PASSPORT_SIGNING_KEY/);
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
