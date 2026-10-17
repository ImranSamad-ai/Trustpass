import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUrl, type Deps } from "./api.js";
import {
  calculateTrustScore,
  checkSpendAllowed,
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
