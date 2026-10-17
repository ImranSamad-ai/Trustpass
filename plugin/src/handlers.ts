import * as z from "zod/v4";
import { AGENT_ID_PATTERN, ApiError, callApi, defaultDeps, type Deps } from "./api.js";
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
