import * as z from "zod/v4";
import { AGENT_ID_PATTERN, ApiError, callApi, defaultDeps, type Deps } from "./api.js";
import { atomicAmount, proposeX402 } from "./paybox.js";
import { signatureMatches } from "./signing.js";
import { FORMULA, TIER_MIN_SCORE, TIER_ORDER, computeScore, tierForScore } from "./score.js";

const tier = z.enum(["New", "Proven", "Trusted", "Elite"]);
const evidence = z.enum(["self_reported", "onchain_verified", "mixed"]);
const agentId = z.string().regex(AGENT_ID_PATTERN).describe("Identifier of the agent / grant the passport belongs to.");

// ---- Input schemas ---------------------------------------------------------

export const getInput = z.object({ agent_id: agentId }).strict();

export const recordInput = z
  .object({
    agent_id: agentId,
    tx_hash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional()
      .describe("Base transaction hash of a USDC payment. If given, the amount is read from the chain and the spend counts as on-chain verified."),
    payer_address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional()
      .describe("Wallet that paid, when the transaction was submitted by someone else (e.g. an x402 facilitator). Defaults to the transaction sender."),
    amount_usd: z.number().positive().max(1_000_000_000).optional().describe("USD value of a self-reported spend. Ignored when tx_hash is given."),
    category: z.string().min(1).max(64).optional(),
    max_amount_usd: z.number().positive().max(1_000_000_000).optional().describe("Policy: max amount per spend."),
    allowed_categories: z.array(z.string().min(1).max(64)).max(32).optional().describe("Policy: allowed categories."),
    time_window: z.string().min(1).max(32).optional().describe("Policy: time window, e.g. 24h."),
  })
  .strict();

export const checkInput = z
  .object({
    agent_id: agentId,
    amount_usd: z.number().positive().max(1_000_000_000).describe("USD amount the agent wants to spend."),
    min_tier: z.enum(["Proven", "Trusted", "Elite"]).default("Trusted").describe("Minimum tier required to allow the spend."),
    category: z.string().min(1).max(64).optional().describe("Spend category, checked against the agent's declared categories."),
  })
  .strict();

export const paymentInput = z
  .object({
    payee_id: agentId.describe("Trust Passport ID of the agent or service being paid."),
    endpoint: z.url().max(2048).describe("HTTPS URL of the paid x402 endpoint (GET, port 443). Its host must be in the plugin's network list."),
    max_amount_usdc: z
      .string()
      .regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/)
      .describe("Maximum payment in USDC as a decimal string, e.g. \"0.05\" (not atomic units)."),
    min_tier: z.enum(["Proven", "Trusted", "Elite"]).default("Trusted").describe("Minimum payee tier required before a payment is proposed."),
    require_onchain_evidence: z.boolean().default(false).describe("If true, the payee must have at least one on-chain verified spend."),
  })
  .strict();

const claims = z
  .object({
    v: z.literal(1),
    agentId: z.string().regex(AGENT_ID_PATTERN),
    score: z.number().int().min(0).max(100),
    tier,
    status: z.enum(["new", "active", "violated"]),
    successfulSpends: z.number().int().min(0),
    cleanVolumeUsd: z.number().min(0),
    verifiedSpends: z.number().int().min(0),
    evidence,
    issuedAt: z.string().max(40),
    expiresAt: z.string().max(40),
  })
  .strict();

export const signedOutput = z
  .object({
    passport: claims,
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
    alg: z.literal("Ed25519"),
    kid: z.string().max(64),
  })
  .strict();

export const verifyInput = z
  .object({
    passport: claims.describe("The signed claims, exactly as returned by get_signed_passport."),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/).describe("base64url Ed25519 signature."),
    public_key: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .describe("The issuer's raw 32-byte public key, base64url. Pin it from a source you trust, not from the passport holder."),
    min_tier: z.enum(["Proven", "Trusted", "Elite"]).optional().describe("Optionally require at least this tier."),
  })
  .strict();

export const verifyOutput = z
  .object({
    valid: z.boolean(),
    signatureValid: z.boolean(),
    expired: z.boolean(),
    meetsMinTier: z.boolean().nullable(),
    agentId: z.string(),
    score: z.number().int(),
    tier,
    status: z.enum(["new", "active", "violated"]),
    evidence,
    issuedAt: z.string(),
    expiresAt: z.string(),
    reasons: z.array(z.string()).max(6),
  })
  .strict();

export const checkOutput = z
  .object({
    agentId: z.string(),
    decision: z.enum(["allow", "deny"]),
    allowed: z.boolean(),
    reasons: z.array(z.string()).max(8),
    score: z.number().int().min(0).max(100),
    tier,
    requiredTier: z.enum(["Proven", "Trusted", "Elite"]),
    requiredMinScore: z.number().int().min(0).max(100),
    evidence,
    checkedAt: z.string(),
  })
  .strict();

export const calculateInput = z
  .object({
    successful_spends: z.number().int().min(0).max(1_000_000),
    clean_volume_usd: z.number().min(0).max(1_000_000_000),
    days_active: z.number().int().min(0).max(36_500),
    violations: z.number().int().min(0).max(1_000).default(0),
  })
  .strict();

// ---- Output schemas --------------------------------------------------------

export const passportOutput = z
  .object({
    agentId: z.string(),
    score: z.number().int().min(0).max(100),
    tier,
    status: z.enum(["new", "active", "violated"]),
    successfulSpends: z.number().int().min(0),
    cleanVolumeUsd: z.number().min(0),
    daysActive: z.number().int().min(0),
    firstActivityAt: z.string().nullable(),
    lastActivityAt: z.string().nullable(),
    policy: z
      .object({
        maxAmountUsd: z.number().optional(),
        categories: z.array(z.string()).optional(),
        timeWindow: z.string().optional(),
      })
      .strict(),
    violationCount: z.number().int().min(0),
    summary: z.string(),
    generatedAt: z.string(),
    verifiedSpends: z.number().int().min(0),
    verifiedVolumeUsd: z.number().min(0),
    /** self_reported: no spend is backed by a chain transaction; mixed: some are. */
    evidence,
  })
  .strict();

export const calculateOutput = z
  .object({ score: z.number().int().min(0).max(100), tier, formula: z.string() })
  .strict();

// What the backend returns. Unknown fields (e.g. individual recent spends and
// violation reasons) are stripped so they never reach the caller.
const backendPassport = z.object({
  grantId: z.string(),
  score: z.number(),
  tier,
  status: z.enum(["new", "active", "violated"]),
  successfulSpends: z.number(),
  cleanVolumeUsd: z.number(),
  daysActive: z.number(),
  firstActivityAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  policy: z.object({
    maxAmountUsd: z.number().optional(),
    categories: z.array(z.string()).optional(),
    timeWindow: z.string().optional(),
  }),
  violations: z.array(z.unknown()),
  verifiedSpends: z.number().default(0),
  verifiedVolumeUsd: z.number().default(0),
  evidence: evidence.default("self_reported"),
  summary: z.string(),
  generatedAt: z.string(),
});

// ---- Results ---------------------------------------------------------------

// A `type` alias (not an interface) so it satisfies the SDK's index-signature result type.
export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) return fail(error.message);
    return fail("The passport service returned an unexpected response.");
  }
}

function toPassport(raw: unknown): z.infer<typeof passportOutput> {
  const p = backendPassport.parse(raw);
  return passportOutput.parse({
    agentId: p.grantId,
    score: p.score,
    tier: p.tier,
    status: p.status,
    successfulSpends: p.successfulSpends,
    cleanVolumeUsd: p.cleanVolumeUsd,
    daysActive: p.daysActive,
    firstActivityAt: p.firstActivityAt,
    lastActivityAt: p.lastActivityAt,
    policy: p.policy,
    violationCount: p.violations.length,
    summary: p.summary,
    generatedAt: p.generatedAt,
    verifiedSpends: p.verifiedSpends,
    verifiedVolumeUsd: p.verifiedVolumeUsd,
    evidence: p.evidence,
  });
}

function passportResult(passport: z.infer<typeof passportOutput>): ToolResult {
  const note =
    passport.evidence === "onchain_verified"
      ? "All spends verified on-chain (USDC on Base)."
      : passport.evidence === "mixed"
        ? `${passport.verifiedSpends} of ${passport.successfulSpends} spends verified on-chain; the rest are self-reported.`
        : "Self-reported, not independently verified.";
  return ok(`${passport.summary} (${note})`, passport);
}

// ---- Handlers --------------------------------------------------------------

export function getTrustPassport(input: z.infer<typeof getInput>, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return guard(async () => {
    const raw = await callApi("GET", `/passport/${encodeURIComponent(input.agent_id)}`, undefined, deps);
    return passportResult(toPassport(raw));
  });
}

export function recordSuccessfulSpend(
  input: z.infer<typeof recordInput>,
  deps: Deps = defaultDeps(),
): Promise<ToolResult> {
  return guard(async () => {
    if (input.tx_hash === undefined && input.amount_usd === undefined) {
      return fail("Provide tx_hash (verified on-chain) or amount_usd (self-reported).");
    }
    const { agent_id, ...body } = input;
    const raw = await callApi("POST", `/passport/${encodeURIComponent(agent_id)}/spend`, body, deps);
    return passportResult(toPassport(raw));
  });
}

/** Advisory allow/deny decision for a spend, based on the agent's current passport. */
export function checkSpendAllowed(input: z.infer<typeof checkInput>, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return guard(async () => {
    const p = toPassport(await callApi("GET", `/passport/${encodeURIComponent(input.agent_id)}`, undefined, deps));
    const need = input.min_tier;
    const minScore = TIER_MIN_SCORE[need];
    const deny: string[] = [];
    if (p.violationCount > 0) deny.push(`${p.violationCount} policy violation(s) are recorded for this agent.`);
    if (TIER_ORDER.indexOf(p.tier) < TIER_ORDER.indexOf(need)) {
      deny.push(`Score ${p.score} (${p.tier}) is below the required ${need} tier (${minScore}+).`);
    }
    const { maxAmountUsd, categories } = p.policy;
    if (maxAmountUsd !== undefined && input.amount_usd > maxAmountUsd) {
      deny.push(`$${input.amount_usd} exceeds the agent's declared per-spend limit of $${maxAmountUsd}.`);
    }
    if (input.category && categories?.length && !categories.includes(input.category)) {
      deny.push(`Category "${input.category}" is not among the agent's declared categories.`);
    }
    const allowed = deny.length === 0;
    const reasons = allowed
      ? [`Score ${p.score} (${p.tier}) meets the required ${need} tier (${minScore}+).`, "No violations; amount and category are within the declared policy."]
      : deny.slice(0, 8);
    const evidenceNote = p.evidence === "onchain_verified" ? "on-chain verified" : p.evidence === "mixed" ? "partly on-chain verified" : "self-reported";
    const out = checkOutput.parse({
      agentId: p.agentId,
      decision: allowed ? "allow" : "deny",
      allowed,
      reasons,
      score: p.score,
      tier: p.tier,
      requiredTier: need,
      requiredMinScore: minScore,
      evidence: p.evidence,
      checkedAt: new Date().toISOString(),
    });
    return ok(`${allowed ? "ALLOW" : "DENY"}: ${reasons.join(" ")} (Passport is ${evidenceNote}.)`, out);
  });
}

/** Offline: no backend needed. Useful for services choosing a minimum score. */
export async function calculateTrustScore(input: z.infer<typeof calculateInput>): Promise<ToolResult> {
  const score = computeScore({
    successfulSpends: input.successful_spends,
    cleanVolumeUsd: input.clean_volume_usd,
    daysActive: input.days_active,
    violations: input.violations,
  });
  const t = tierForScore(score);
  return ok(`Score ${score}/100 (${t}).`, calculateOutput.parse({ score, tier: t, formula: FORMULA }));
}

/**
 * Trust-gated x402 payment: proposes a Base USDC payment only if the payee's
 * Trust Passport clears the bar. Nothing is signed or paid here; PayBox shows
 * the proposal to the user for approval.
 */
export function proposeTrustedPayment(input: z.infer<typeof paymentInput>, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return guard(async () => {
    const p = toPassport(await callApi("GET", `/passport/${encodeURIComponent(input.payee_id)}`, undefined, deps));
    const need = input.min_tier;
    const deny: string[] = [];
    if (p.violationCount > 0) deny.push(`${p.violationCount} policy violation(s) are recorded for the payee.`);
    if (TIER_ORDER.indexOf(p.tier) < TIER_ORDER.indexOf(need)) {
      deny.push(`Payee score ${p.score} (${p.tier}) is below the required ${need} tier (${TIER_MIN_SCORE[need]}+).`);
    }
    if (input.require_onchain_evidence && p.verifiedSpends === 0) {
      deny.push("Payee has no on-chain verified spends, which this payment requires.");
    }
    if (deny.length > 0) return fail(`Payment not proposed. ${deny.join(" ")}`);

    let atomic: string;
    try {
      atomic = atomicAmount(input.max_amount_usdc, 6);
      if (atomic === "0") throw new Error("max_amount_usdc must be greater than zero.");
      const proposal = proposeX402({ chain: "eip155:8453", url: input.endpoint, maxAmount: atomic });
      const text = `Payee ${p.agentId} passed the trust check (score ${p.score}, ${p.tier}, evidence: ${p.evidence}). ${proposal.content[0]!.text}`;
      return { ...proposal, content: [{ type: "text", text }] };
    } catch (error) {
      return fail(error instanceof Error ? error.message.slice(0, 200) : "Could not build the payment proposal.");
    }
  });
}

/** Fetches a passport signed by the passport service. */
export function getSignedPassport(input: z.infer<typeof getInput>, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return guard(async () => {
    const raw = await callApi("GET", `/passport/${encodeURIComponent(input.agent_id)}/signed`, undefined, deps);
    const doc = signedOutput.parse(raw);
    return ok(
      `Signed passport for ${doc.passport.agentId}: ${doc.passport.tier}, score ${doc.passport.score}/100, valid until ${doc.passport.expiresAt}. Verify it offline with verify_signed_passport and the issuer's public key.`,
      doc,
    );
  });
}

/** Offline: checks signature, expiry and (optionally) tier. No backend call. */
export async function verifySignedPassport(input: z.infer<typeof verifyInput>, now = Date.now()): Promise<ToolResult> {
  const c = input.passport;
  const signatureValid = signatureMatches(c, input.signature, input.public_key);
  const expiresMs = Date.parse(c.expiresAt);
  const issuedMs = Date.parse(c.issuedAt);
  const expired = !(now <= expiresMs);
  const fromFuture = !(issuedMs <= now + 5 * 60_000);
  const meetsMinTier = input.min_tier ? TIER_ORDER.indexOf(c.tier) >= TIER_ORDER.indexOf(input.min_tier) : null;
  const reasons: string[] = [];
  if (!signatureValid) reasons.push("Signature does not match this passport and public key.");
  if (signatureValid && expired) reasons.push(`Passport expired at ${c.expiresAt}; fetch a fresh one.`);
  if (signatureValid && fromFuture) reasons.push("Passport claims to be issued in the future.");
  if (meetsMinTier === false) reasons.push(`Tier ${c.tier} is below the required ${input.min_tier}.`);
  const valid = signatureValid && !expired && !fromFuture && meetsMinTier !== false;
  if (valid) reasons.push("Signature verified and passport is within its validity window.");
  const out = verifyOutput.parse({
    valid,
    signatureValid,
    expired,
    meetsMinTier,
    agentId: c.agentId,
    score: c.score,
    tier: c.tier,
    status: c.status,
    evidence: c.evidence,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    reasons: reasons.slice(0, 6),
  });
  return ok(`${valid ? "VALID" : "INVALID"}: ${reasons.join(" ")}`, out);
}
