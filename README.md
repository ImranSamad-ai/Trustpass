# Agent Trust Passport

**A portable reputation score for AI agents that spend money.**

Trust Passport gives every agent a 0-100 score and a tier (New → Proven → Trusted → Elite) built from its history of clean, policy-compliant spends. A service, wallet, or another agent can ask "how much should I trust this agent?" and get a simple, explainable answer before letting it transact.

Built as a [PayBox](https://developer.paybox.sh/) MCP plugin for the MoonPay / PayBox Hackathon (Chapter 1).

> **Evidence levels:** a spend recorded with a `tx_hash` is verified against Base (USDC payment, amount read from the chain). A spend recorded with only `amount_usd` is **self-reported and not independently verified**. Every passport carries an `evidence` field (`self_reported`, `onchain_verified` or `mixed`) and every tool response says which applies.

---

## How it works

```
 AI agent ──▶ PayBox ──▶ plugin.mjs (MCP server, sandboxed)
                              │  HTTPS, 4s timeout
                              ▼
                      Passport backend (Node)
                      stores per-agent history
```

PayBox plugins run in a fresh sandbox on every call and keep no state, so the plugin is stateless. Passport data lives in a small backend service that the plugin calls over HTTPS.

- Reads are public and return aggregate data only.
- Writes require a bearer token. PayBox injects it as a host-scoped brokered header, so the plugin never sees or stores the secret.

## Tools

| Tool | What it does | Inputs |
|---|---|---|
| `get_trust_passport` | Returns an agent's passport: score, tier, status, clean volume, successful spends, policy summary. A brand-new agent returns score 0. | `agent_id` |
| `record_successful_spend` | Records one clean, policy-compliant spend and returns the updated passport. With `tx_hash` the backend verifies the payment on Base and reads the amount from the chain. | `agent_id`, then `tx_hash` (verified) or `amount_usd` (self-reported); optional `payer_address`, `category`, `max_amount_usd`, `allowed_categories`, `time_window` |
| `check_spend_allowed` | Advisory allow/deny before an agent spends: checks tier, violations, the agent's declared per-spend limit and categories. Returns reasons. | `agent_id`, `amount_usd`, optional `min_tier` (default `Trusted`), `category` |
| `propose_trusted_payment` | Proposes a Base USDC [x402](https://developer.paybox.sh/requirements.md) payment to a paid endpoint, but only if the payee's passport clears a minimum tier, has no violations, and optionally has on-chain verified spends. Otherwise no proposal is returned. | `payee_id`, `endpoint`, `max_amount_usdc` (e.g. `"0.05"`), optional `min_tier` (default `Trusted`), `require_onchain_evidence` |
| `get_signed_passport` | Returns the passport signed with the issuer's Ed25519 key, valid for 24 hours, so it can be carried to other services. | `agent_id` |
| `verify_signed_passport` | Offline check of a signed passport: signature, expiry and optional minimum tier. No backend call. | `passport`, `signature`, `public_key`, optional `min_tier` |
| `calculate_trust_score` | Computes a score and tier from counts. Offline, no backend call. Useful for deciding what minimum score to require. | `successful_spends`, `clean_volume_usd`, `days_active`, optional `violations` |

`agent_id` must match `^[A-Za-z0-9_.:-]{1,128}$`.

### Example

Record a $5 self-reported spend for a new agent:

```json
{ "agent_id": "test-agent", "amount_usd": 5 }
```

Response summary:

```
New agent (score 18/100): 1 clean spend(s), $5 handled under policy with no violations.
(Self-reported, not independently verified.)
```

Record a spend verified on-chain (the amount comes from the transaction):

```json
{ "agent_id": "test-agent", "tx_hash": "0x..." }
```

Ask whether an agent may spend $20 (needs at least Trusted):

```json
{ "agent_id": "test-agent", "amount_usd": 20, "min_tier": "Trusted" }
```

Propose a trust-gated payment of up to 0.05 USDC:

```json
{ "payee_id": "weather-agent", "endpoint": "https://api.example.com/paid", "max_amount_usdc": "0.05", "min_tier": "Trusted" }
```

If the payee's passport is below Trusted, the tool refuses and returns no payment proposal. If it passes, PayBox receives an unsigned x402 proposal and the user approves it.

Work out what a passport needs offline:

```json
{ "successful_spends": 3, "clean_volume_usd": 17, "days_active": 0, "violations": 0 }
```

→ `score 58, tier Trusted`

## Scoring

```
score = min(100, successful_spends × 8 + clean_volume_usd × 2 + days_active)
any recorded violation sets the score to 0
```

| Score | Tier |
|---|---|
| 0-19 | New |
| 20-49 | Proven |
| 50-79 | Trusted |
| 80-100 | Elite |

## Trust-gated payments

`propose_trusted_payment` puts the score at the moment money moves. It looks up the payee's passport, applies the gate, and only then builds an unsigned x402 proposal (USDC on Base, GET, HTTPS port 443). The plugin never signs or pays: PayBox shows the proposal to the user, who approves it, and PayBox completes the payment.

Limits to be aware of: the gate applies only to payments proposed through this tool, and a passport describes how an agent *spends*, so it fits marketplaces where agents both buy and sell. The paid endpoint's hostname must be added to the plugin's network list in the PayBox portal.

## Signed passports

`get_signed_passport` returns the passport claims plus an Ed25519 signature. Any service holding the issuer's public key can verify it offline with `verify_signed_passport`, with no call to the passport service. A tampered score fails verification.

- **Signed claims:** `v`, `agentId`, `score`, `tier`, `status`, `successfulSpends`, `cleanVolumeUsd`, `verifiedSpends`, `evidence`, `issuedAt`, `expiresAt`.
- **Canonical form for other languages:** the claims object with keys sorted alphabetically, serialized as compact JSON (no whitespace) in UTF-8. The signature is Ed25519 over those bytes, base64url encoded. The public key is the raw 32 bytes, base64url, from `/.well-known/passport-key`.
- **Key setup:** run `node keygen.mjs` in `backend/`, then set the output as `PASSPORT_SIGNING_KEY` on your host. Keep it secret and out of git.

Limits to be aware of: a valid signature proves what the issuer said at issuance, not that it is still true, so a violation recorded afterwards is not reflected until the passport expires (24 hours by default). Pin the public key from a source you trust, not from the party presenting the passport. Anyone with the private key can forge passports.

## On-chain verification

When `record_successful_spend` receives a `tx_hash`, the backend checks the transaction on Base through a public JSON-RPC endpoint before counting it:

- the transaction is mined, succeeded, and has at least 2 confirmations;
- the amount is the sum of USDC `Transfer` logs sent by the payer (the transaction sender, or `payer_address` for facilitator-submitted payments such as x402), rounded down to whole cents;
- each transaction hash counts once across all agents (replay protection);
- wallet binding: the payer of an agent's first verified payment becomes its bound wallet. Later verified payments must come from the same wallet, and one wallet can back only one agent. The bound wallet shows on the landing page and the passport card.

Limits to be aware of: binding is first-claim-wins and does not prove the claimant controls the wallet, so someone could still bind their agent to a stranger's public payment. Proving control needs a wallet signature (see the roadmap). Only USDC on Base is supported. Spends without `tx_hash` stay self-reported.

## Repository layout

```
plugin/    PayBox MCP plugin (TypeScript). Builds to dist/plugin.mjs
backend/   Passport service (Node HTTP server, Dockerfile included)
```

## Plugin

Requirements: Node.js 24, pnpm 11.11.0, macOS or Linux (Windows: WSL2).

```bash
cd plugin
pnpm install --frozen-lockfile
pnpm test          # type-check + deterministic build + PayBox conformance
```

`pnpm build` produces `dist/plugin.mjs`, the only file you upload to the PayBox developer portal.

## Backend

### Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/` | Landing page: agent lookup, live leaderboard, shareable badge |
| GET | `/leaderboard?limit=10` | Top agents by score (aggregate fields only, max 25) |
| GET | `/badge/:agentId.svg` | Compact badge for READMEs: `![Trust Passport](https://host/badge/agent-id.svg)` |
| GET | `/card/:agentId.svg` | Shareable 600x315 passport card |
| GET | `/passport/:agentId/signed?ttl_hours=24` | Signed passport (Ed25519). `ttl_hours` 1 to 168. |
| GET | `/.well-known/passport-key` | Issuer public key (`kid`, raw `publicKey` base64url, PEM, and an `ephemeral` flag). |
| GET | `/passport/:agentId` | Public aggregate view. Individual spends are only shown with the write token. |
| POST | `/passport/:agentId/spend` | Requires `Authorization: Bearer <PASSPORT_WRITE_TOKEN>`. Body: `tx_hash` (verified) or `amount_usd` (self-reported), plus optional policy fields. |

### Environment variables

| Variable | Purpose |
|---|---|
| `PASSPORT_WRITE_TOKEN` | Bearer token required for writes. If unset, writes are disabled (HTTP 503). |
| `DATA_FILE` | Path to a JSON file for persistence (e.g. `/data/passports.json`). If unset, state is in memory and lost on restart. |
| `PORT` | Listen port (default `8787`). |
| `BASE_RPC_URL` | Base JSON-RPC endpoint used to verify `tx_hash` (default `https://mainnet.base.org`). |
| `SEED_DEMO_DATA` | Set to `true` to seed four labeled `demo-` agents (one per tier) when the store is empty at startup. |
| `PASSPORT_SIGNING_KEY` | Base64 PKCS8 Ed25519 private key for signed passports. Generate with `node keygen.mjs`. If unset, a temporary key is used and signatures stop verifying after a restart. |
| `PASSPORT_HIDE_LEADERBOARD` | Set to `1` to hide the public leaderboard. |

### Run locally

```bash
cd backend
pnpm install --frozen-lockfile
pnpm test
pnpm build
PASSPORT_WRITE_TOKEN=dev-token pnpm start
```

### Docker

```bash
cd backend
docker build -t agent-trust-passport .
docker run -p 8787:8787 -e PASSPORT_WRITE_TOKEN=change-me -v passport-data:/data agent-trust-passport
```

## Deploying

1. **Deploy the backend** to any Docker host (this project runs on Render). Set `PASSPORT_WRITE_TOKEN` to a long random string. For persistence, mount a volume at `/data` and set `DATA_FILE=/data/passports.json`.
2. **Upload** `plugin/dist/plugin.mjs` at https://developer.paybox.sh/.
3. **Configure the plugin** in the portal:
   - **Network access:** add your backend's hostname (hostname only, no `https://`).
   - **Environment variable:** `PASSPORT_API_URL` = `https://your-backend-host`
   - **Secret:** target host = your backend hostname, header `Authorization`, value `Bearer <PASSPORT_WRITE_TOKEN>`
4. **Test** in the portal: run `get_trust_passport`, then `record_successful_spend`, then `get_trust_passport` again.

> Free-tier hosts may sleep when idle. A cold start can exceed PayBox's 10-second call budget, so wake the service (`/health`) before demos and testing.

## Security notes

- The plugin never holds credentials. The write token is a PayBox brokered header scoped to one host.
- The plugin only accepts an `https` backend URL (plain `http` is allowed for localhost only), rejects URLs containing credentials, refuses redirects, and bounds every request to 7 seconds and 64 KiB.
- Backend write-token comparison is constant-time, and request bodies are capped at 10 KB.
- Public reads expose aggregate behavior only, not individual spend records.
- Spends without a `tx_hash` are self-reported, so a malicious reporter could inflate their own score. Prefer `onchain_verified` passports, and treat any passport as one signal, not proof.
- `check_spend_allowed` is advisory: it informs a decision but does not block a payment by itself.

## Roadmap

- Require a wallet signature to prove control when binding an agent to a wallet
- More chains and tokens for on-chain verification
- Violation reporting with reasons and appeal flow
- Per-service policy templates ("require Trusted or better for spends over $X")
- Signed passports that other services can verify offline

## Live demo

Backend health check: https://trustpass-6ep1.onrender.com/health

## License

Add a license file (for example MIT) before publishing.
