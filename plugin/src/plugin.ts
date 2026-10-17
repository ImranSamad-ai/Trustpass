import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { x402OutputSchema } from "./paybox.js";
import {
  calculateInput,
  calculateOutput,
  checkInput,
  checkOutput,
  checkSpendAllowed,
  paymentInput,
  proposeTrustedPayment,
  calculateTrustScore,
  getInput,
  getSignedPassport,
  signedOutput,
  verifyInput,
  verifyOutput,
  verifySignedPassport,
  getTrustPassport,
  passportOutput,
  recordInput,
  recordSuccessfulSpend,
} from "./handlers.js";

const PROTOCOL_VERSION = "2026-07-28";

function createServer() {
  const server = new McpServer(
    { name: "agent-trust-passport", version: "0.4.0" },
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
    "propose_trusted_payment",
    {
      title: "Propose trusted payment",
      description:
        "Proposes a Base USDC x402 payment to a paid HTTPS endpoint, but only if the payee's Trust Passport meets a minimum tier (default Trusted), has no violations, and optionally has on-chain verified spends. If the payee fails the check, no proposal is returned. Nothing is signed or paid here: PayBox shows the proposal for user approval. max_amount_usdc is in USDC (e.g. \"0.05\"), not atomic units.",
      inputSchema: paymentInput,
      outputSchema: x402OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => proposeTrustedPayment(input),
  );

  server.registerTool(
    "get_signed_passport",
    {
      title: "Get signed passport",
      description:
        "Returns a Trust Passport signed with the issuer's Ed25519 key (valid for 24 hours). The signed passport is portable: anyone holding the issuer's public key can verify it offline with verify_signed_passport, without calling the passport service.",
      inputSchema: getInput,
      outputSchema: signedOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => getSignedPassport(input),
  );

  server.registerTool(
    "verify_signed_passport",
    {
      title: "Verify signed passport",
      description:
        "Offline check of a signed Trust Passport: Ed25519 signature, expiry, and optionally a minimum tier. Needs the issuer's public key (pin it from a trusted source). A valid signature proves the issuer said this at issuance time, not that it is still current; short expiries limit staleness.",
      inputSchema: verifyInput,
      outputSchema: verifyOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => verifySignedPassport(input),
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
