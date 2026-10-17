import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "./signing.js";
import { baseUrl, type Deps } from "./api.js";
import {
  calculateTrustScore,
  checkSpendAllowed,
  proposeTrustedPayment,
  getSignedPassport,
  verifySignedPassport,
  getTrustPassport,
  passportOutput,
  recordSuccessfulSpend,
} from "./handlers.js";

const BASE = "https://passport.example.com";

const backendBody = {
  grantId: "agent-1",
  score: 58,
  tier: "Trusted",
  status: "active",
  successfulSpends: 3,
  cleanVolumeUsd: 17,
  daysActive: 0,
  firstActivityAt: "2026-10-17T04:27:23.966Z",
  lastActivityAt: "2026-10-17T04:27:23.978Z",
  policy: { maxAmountUsd: 25 },
  violations: [{ reason: "secret detail", at: "2026-10-17T04:00:00Z" }],
  recentSpends: [{ amountUsd: 5, category: "api-credits", at: "2026-10-17T04:27:23.966Z" }],
  summary: "Trusted agent (score 58/100): 3 clean spend(s).",
  generatedAt: "2026-10-17T04:27:23.983Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mock(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const record = { url: String(url), init: init ?? {} };
    calls.push(record);
    return responder(record.url, record.init);
  }) as typeof fetch;
  const deps: Deps = { fetch: fn, env: { PASSPORT_API_URL: BASE } };
  return { deps, calls };
}

test("calculate_trust_score matches the MVP formula and works offline", async () => {
  const r = await calculateTrustScore({ successful_spends: 3, clean_volume_usd: 17, days_active: 0, violations: 0 });
  assert.equal(r.isError, undefined);
  assert.deepEqual(r.structuredContent?.score, 58);
  assert.deepEqual(r.structuredContent?.tier, "Trusted");

  const capped = await calculateTrustScore({ successful_spends: 50, clean_volume_usd: 500, days_active: 90, violations: 0 });
  assert.equal(capped.structuredContent?.score, 100);
  assert.equal(capped.structuredContent?.tier, "Elite");

  const violated = await calculateTrustScore({ successful_spends: 10, clean_volume_usd: 100, days_active: 10, violations: 1 });
  assert.equal(violated.structuredContent?.score, 0);
  assert.equal(violated.structuredContent?.tier, "New");
});

test("get_trust_passport reads the backend, sets no credentials, and strips private detail", async () => {
  const { deps, calls } = mock(() => json(backendBody));
  const r = await getTrustPassport({ agent_id: "agent-1" }, deps);
  assert.equal(r.isError, undefined);

  const call = calls[0]!;
  assert.equal(call.url, `${BASE}/passport/agent-1`);
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.redirect, "error");
  assert.ok(call.init.signal, "request must be bounded by a timeout signal");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("authorization"), null);

  const out = passportOutput.parse(r.structuredContent);
  assert.equal(out.agentId, "agent-1");
  assert.equal(out.score, 58);
  assert.equal(out.violationCount, 1);
  assert.equal(out.evidence, "self_reported");
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes("secret detail"), "violation reasons must not leak");
  assert.ok(!serialized.includes("recentSpends"), "individual spends must not leak");
  assert.ok(!serialized.includes("api-credits"), "individual spend categories must not leak");
});

test("record_successful_spend posts the spend without the agent id in the body", async () => {
  const { deps, calls } = mock(() => json(backendBody));
  const r = await recordSuccessfulSpend(
    { agent_id: "agent-1", amount_usd: 5, category: "api-credits", max_amount_usd: 25, time_window: "24h" },
    deps,
  );
  assert.equal(r.isError, undefined);
  const call = calls[0]!;
  assert.equal(call.url, `${BASE}/passport/agent-1/spend`);
  assert.equal(call.init.method, "POST");
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    amount_usd: 5,
    category: "api-credits",
    max_amount_usd: 25,
    time_window: "24h",
  });
});

test("agent ids are URL-encoded", async () => {
  const { deps, calls } = mock(() => json(backendBody));
  await getTrustPassport({ agent_id: "a:b.c_d-1" }, deps);
  assert.equal(calls[0]!.url, `${BASE}/passport/a%3Ab.c_d-1`);
});

test("missing or unsafe configuration is reported, not crashed on", async () => {
  const missing = await getTrustPassport({ agent_id: "a" }, { fetch: (() => assert.fail("no network")) as typeof fetch, env: {} });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0]!.text, /PASSPORT_API_URL/);

  for (const bad of ["http://evil.example.com", "not a url", "https://user:pw@passport.example.com"]) {
    const r = await getTrustPassport({ agent_id: "a" }, { fetch: (() => assert.fail("no network")) as typeof fetch, env: { PASSPORT_API_URL: bad } });
    assert.equal(r.isError, true, bad);
  }
  assert.equal(baseUrl({ PASSPORT_API_URL: "http://127.0.0.1:8787" }), "http://127.0.0.1:8787");
  assert.equal(baseUrl({ PASSPORT_API_URL: "https://x.example.com/api/" }), "https://x.example.com/api");
});

test("backend failures become isError results with a safe message", async () => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ["http 401", () => json({ error: "missing or invalid bearer token" }, 401)],
    ["http 500", () => new Response("boom", { status: 500 })],
    ["bad json", () => new Response("{not json", { status: 200 })],
    ["wrong shape", () => json({ hello: "world" })],
    ["empty body", () => new Response("", { status: 200 })],
    ["oversized", () => new Response("x".repeat(70_000), { status: 200 })],
    ["network error", () => { throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1"); }],
  ];
  for (const [name, responder] of cases) {
    const { deps } = mock(responder);
    const r = await getTrustPassport({ agent_id: "a" }, deps);
    assert.equal(r.isError, true, name);
    assert.equal(r.structuredContent, undefined, name);
    assert.ok(!r.content[0]!.text.includes("10.0.0.1"), `${name}: must not leak network details`);
  }
});

test("backend rejection message is surfaced when short and safe", async () => {
  const { deps } = mock(() => json({ error: "amount_usd must be a positive number" }, 400));
  const r = await recordSuccessfulSpend({ agent_id: "a", amount_usd: 1 }, deps);
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /HTTP 400.*amount_usd must be a positive number/);
});

test("record_successful_spend sends tx_hash and surfaces on-chain evidence", async () => {
  const verified = { ...backendBody, verifiedSpends: 3, verifiedVolumeUsd: 17, evidence: "onchain_verified" };
  const { deps, calls } = mock(() => json(verified));
  const hash = `0x${"ab".repeat(32)}`;
  const r = await recordSuccessfulSpend({ agent_id: "agent-1", tx_hash: hash }, deps);
  assert.equal(r.isError, undefined);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { tx_hash: hash });
  assert.equal(r.structuredContent?.evidence, "onchain_verified");
  assert.match(r.content[0]!.text, /verified on-chain/);

  const none = await recordSuccessfulSpend({ agent_id: "agent-1" }, deps);
  assert.equal(none.isError, true);
  assert.equal(calls.length, 1, "no request without tx_hash or amount_usd");
});

test("check_spend_allowed allows a trusted agent within policy", async () => {
  const { deps } = mock(() => json({ ...backendBody, violations: [] }));
  const r = await checkSpendAllowed({ agent_id: "agent-1", amount_usd: 10, min_tier: "Trusted", category: "api-credits" }, deps);
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent?.decision, "allow");
  assert.equal(r.structuredContent?.requiredMinScore, 50);
  assert.match(r.content[0]!.text, /^ALLOW/);
});

test("check_spend_allowed denies low tier, violations, and policy breaches", async () => {
  const low = mock(() => json({ ...backendBody, score: 18, tier: "New", violations: [] }));
  const a = await checkSpendAllowed({ agent_id: "a", amount_usd: 5, min_tier: "Proven" }, low.deps);
  assert.equal(a.structuredContent?.decision, "deny");
  assert.match(String((a.structuredContent?.reasons as string[])[0]), /below the required Proven/);

  const bad = mock(() => json(backendBody)); // has 1 violation and maxAmountUsd 25
  const b = await checkSpendAllowed({ agent_id: "a", amount_usd: 100, min_tier: "Proven" }, bad.deps);
  const reasons = (b.structuredContent?.reasons as string[]).join(" ");
  assert.match(reasons, /violation/);
  assert.match(reasons, /per-spend limit of \$25/);

  const cat = mock(() => json({ ...backendBody, violations: [], policy: { categories: ["api-credits"] } }));
  const c = await checkSpendAllowed({ agent_id: "a", amount_usd: 1, min_tier: "Proven", category: "gambling" }, cat.deps);
  assert.equal(c.structuredContent?.decision, "deny");
  assert.match(String((c.structuredContent?.reasons as string[])[0]), /not among/);
});

const PAY = { payee_id: "svc-1", endpoint: "https://api.example.com/paid", max_amount_usdc: "0.05", min_tier: "Trusted", require_onchain_evidence: false } as const;

test("propose_trusted_payment returns an x402 proposal for a trusted payee", async () => {
  const { deps } = mock(() => json({ ...backendBody, violations: [] }));
  const r = await proposeTrustedPayment(PAY, deps);
  assert.equal(r.isError, undefined);
  const p = (r.structuredContent as any)["io.paybox/transactionProposal"];
  assert.equal(p.kind, "x402");
  assert.equal(p.chain, "eip155:8453");
  assert.equal(p.payment.maxAmount, "50000");
  assert.equal(p.payment.asset, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(p.request.url, "https://api.example.com/paid");
  assert.match(r.content[0]!.text, /passed the trust check/);
});

test("propose_trusted_payment refuses untrusted, violating or unverified payees", async () => {
  const low = mock(() => json({ ...backendBody, score: 18, tier: "New", violations: [] }));
  const a = await proposeTrustedPayment(PAY, low.deps);
  assert.equal(a.isError, true);
  assert.equal(a.structuredContent, undefined, "no proposal when denied");
  assert.match(a.content[0]!.text, /below the required Trusted/);

  const viol = mock(() => json(backendBody)); // has 1 violation
  assert.match((await proposeTrustedPayment(PAY, viol.deps)).content[0]!.text, /violation/);

  const unverified = mock(() => json({ ...backendBody, violations: [] }));
  const u = await proposeTrustedPayment({ ...PAY, require_onchain_evidence: true }, unverified.deps);
  assert.equal(u.isError, true);
  assert.match(u.content[0]!.text, /on-chain verified/);
});

test("propose_trusted_payment rejects unsafe endpoints and zero amounts", async () => {
  const { deps } = mock(() => json({ ...backendBody, violations: [] }));
  for (const bad of [{ endpoint: "http://api.example.com/x" }, { endpoint: "https://api.example.com:8443/x" }, { max_amount_usdc: "0" }]) {
    const r = await proposeTrustedPayment({ ...PAY, ...bad }, deps);
    assert.equal(r.isError, true, JSON.stringify(bad));
    assert.equal(r.structuredContent, undefined);
  }
});

function makeSigned(overrides: Record<string, unknown> = {}, nowMs = Date.now()) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const passport = {
    v: 1 as const, agentId: "agent-1", score: 58, tier: "Trusted" as const, status: "active" as const,
    successfulSpends: 3, cleanVolumeUsd: 17, verifiedSpends: 0, evidence: "self_reported" as const,
    issuedAt: new Date(nowMs - 1000).toISOString(), expiresAt: new Date(nowMs + 3_600_000).toISOString(), ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalize(passport)), privateKey).toString("base64url");
  const pub = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64url");
  return { passport, signature, public_key: pub };
}

test("verify_signed_passport accepts a good signature, offline", async () => {
  const doc = makeSigned();
  const r = await verifySignedPassport({ ...doc, min_tier: "Trusted" });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent?.valid, true);
  assert.equal(r.structuredContent?.meetsMinTier, true);
  assert.match(r.content[0]!.text, /^VALID/);
});

test("verify_signed_passport rejects tampering, wrong key, expiry and low tier", async () => {
  const doc = makeSigned();
  const tampered = await verifySignedPassport({ ...doc, passport: { ...doc.passport, score: 100 } });
  assert.equal(tampered.structuredContent?.signatureValid, false);
  assert.equal(tampered.structuredContent?.valid, false);

  const wrongKey = await verifySignedPassport({ ...doc, public_key: makeSigned().public_key });
  assert.equal(wrongKey.structuredContent?.valid, false);

  const old = makeSigned({}, Date.now() - 7_200_000); // expired an hour ago
  const exp = await verifySignedPassport(old);
  assert.equal(exp.structuredContent?.signatureValid, true);
  assert.equal(exp.structuredContent?.expired, true);
  assert.equal(exp.structuredContent?.valid, false);

  const low = await verifySignedPassport({ ...doc, min_tier: "Elite" });
  assert.equal(low.structuredContent?.valid, false);
  assert.equal(low.structuredContent?.meetsMinTier, false);
});

test("get_signed_passport reads /signed and strips unknown fields", async () => {
  const doc = makeSigned();
  const { deps, calls } = mock(() => json({ passport: doc.passport, signature: doc.signature, alg: "Ed25519", kid: "abc", extra: "x" }, 200));
  const bad = await getSignedPassport({ agent_id: "agent-1" }, deps);
  assert.equal(bad.isError, true, "strict output schema rejects unexpected shapes");
  const ok = mock(() => json({ passport: doc.passport, signature: doc.signature, alg: "Ed25519", kid: "abc" }));
  const r = await getSignedPassport({ agent_id: "agent-1" }, ok.deps);
  assert.equal(r.isError, undefined);
  assert.equal(ok.calls[0]!.url, `${BASE}/passport/agent-1/signed`);
  assert.ok(calls.length === 1);
});
