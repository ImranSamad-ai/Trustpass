import { PassportStore, type PolicySummary, type TrustPassport } from "./passport.js";

export * from "./passport.js";

/** Context PayBox passes to a tool call. Adjust to match the real plugin runtime. */
export interface ToolContext {
  grantId?: string;
}

export interface ToolDefinition<I = any> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: I, ctx?: ToolContext) => Promise<unknown> | unknown;
}

const DEFAULT_GRANT = "default-grant";

export function createPlugin(store: PassportStore = new PassportStore()) {
  const resolveGrant = (input: { grant_id?: string } | undefined, ctx?: ToolContext) =>
    ctx?.grantId ?? input?.grant_id ?? DEFAULT_GRANT;

  const get_trust_passport: ToolDefinition<{ grant_id?: string }> = {
    name: "get_trust_passport",
    description:
      "Return the current Trust Passport (score, tier, clean volume, successful spends, policy summary, status) for the active grant. Always succeeds; a brand-new agent returns score 0.",
    inputSchema: {
      type: "object",
      properties: {
        grant_id: {
          type: "string",
          description: "Optional. Defaults to the active grant from the PayBox context.",
        },
      },
      additionalProperties: false,
    },
    handler: (input, ctx): TrustPassport => store.get(resolveGrant(input, ctx)),
  };

  const record_successful_spend: ToolDefinition<{
    amount_usd: number;
    category?: string;
    max_amount_usd?: number;
    allowed_categories?: string[];
    time_window?: string;
    tx_hash?: string;
    payer?: string;
    grant_id?: string;
  }> = {
    name: "record_successful_spend",
    description:
      "Record a clean, policy-compliant spend against the active grant. Increments counters and recalculates the Trust Passport score. Returns the updated passport.",
    inputSchema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", exclusiveMinimum: 0, description: "USD value of the spend." },
        category: { type: "string", description: "Spend category, e.g. 'api-credits'." },
        max_amount_usd: { type: "number", description: "Policy: max amount per spend." },
        allowed_categories: { type: "array", items: { type: "string" }, description: "Policy: allowed categories." },
        time_window: { type: "string", description: "Policy: time window, e.g. '24h'." },
        payer: { type: "string", description: "Payer wallet read from the verified transaction, set by the server." },
        tx_hash: { type: "string", description: "Base transaction hash, already verified on-chain by the server." },
        grant_id: { type: "string" },
      },
      required: ["amount_usd"],
      additionalProperties: false,
    },
    handler: (input, ctx): TrustPassport => {
      const policy: PolicySummary = {};
      if (input.max_amount_usd !== undefined) policy.maxAmountUsd = input.max_amount_usd;
      if (input.allowed_categories) policy.categories = input.allowed_categories;
      if (input.time_window) policy.timeWindow = input.time_window;
      return store.recordSuccessfulSpend(resolveGrant(input, ctx), {
        amountUsd: input.amount_usd,
        category: input.category,
        txHash: input.tx_hash,
        payer: input.payer,
        policy: Object.keys(policy).length ? policy : undefined,
      });
    },
  };

  return { store, tools: [get_trust_passport, record_successful_spend] as ToolDefinition[] };
}

const plugin = createPlugin();
export const tools = plugin.tools;
export default plugin;
