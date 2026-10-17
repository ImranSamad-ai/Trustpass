import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  calculateInput,
  calculateOutput,
  checkInput,
  checkOutput,
  checkSpendAllowed,
  calculateTrustScore,
  getInput,
  getTrustPassport,
  passportOutput,
  recordInput,
  recordSuccessfulSpend,
} from "./handlers.js";

const PROTOCOL_VERSION = "2026-07-28";

function createServer() {
  const server = new McpServer(
    { name: "agent-trust-passport", version: "0.2.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "get_trust_passport",
    {
      title: "Get Trust Passport",
      description:
        "Returns an agent's Trust Passport: score (0-100), tier (New/Proven/Trusted/Elite), clean spend volume, number of successful constrained spends, policy summary and status. A brand-new agent returns score 0. The evidence field says whether spends are self_reported, onchain_verified (USDC on Base) or mixed.",
      inputSchema: getInput,
      outputSchema: passportOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => getTrustPassport(input),
  );

  server.registerTool(
    "record_successful_spend",
    {
      title: "Record successful spend",
      description:
        "Records one clean, policy-compliant spend against an agent's Trust Passport and returns the updated passport. Pass tx_hash (a Base USDC payment) to have the server verify it on-chain and read the amount from the chain; each transaction counts once. Or pass amount_usd (dollars) for a self-reported spend that is not independently verified.",
      inputSchema: recordInput,
      outputSchema: passportOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => recordSuccessfulSpend(input),
  );

  server.registerTool(
    "check_spend_allowed",
    {
      title: "Check spend allowed",
      description:
        "Advisory allow/deny decision before an agent spends: checks the agent's Trust Passport against a minimum tier (default Trusted), its violation record, and its declared per-spend limit and categories. Returns the decision with reasons and the passport evidence level.",
      inputSchema: checkInput,
      outputSchema: checkOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => checkSpendAllowed(input),
  );

  server.registerTool(
    "calculate_trust_score",
    {
      title: "Calculate Trust Score",
      description:
        "Computes the Trust Passport score and tier from counts, with no backend call. Use it to decide what minimum score to require, or to see what an agent needs to reach a tier.",
      inputSchema: calculateInput,
      outputSchema: calculateOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => calculateTrustScore(input),
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
