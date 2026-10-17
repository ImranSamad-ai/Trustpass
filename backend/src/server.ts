import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PassportStore, type TrustPassport } from "./passport.js";
import { createPlugin } from "./index.js";
import { badgeSvg, cardSvg } from "./badge.js";
import { landingHtml } from "./landing.js";
import { DEMO_AGENTS } from "./demo-agents.js";
import { ADDRESS_RE, TX_RE, VerifyError, httpRpc, verifyBaseUsdcPayment, type Rpc } from "./onchain.js";

const GRANT_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_BODY_BYTES = 10_000;

export interface ServerOptions {
  store?: PassportStore;
  /**
   * Bearer token required for writes (POST .../spend). If omitted, writes are
   * disabled: anyone being able to record spends would make scores meaningless.
   * Reads are public (a passport only holds aggregate behavior).
   */
  writeToken?: string;
  /** Hide the public leaderboard (GET /leaderboard returns no agents). */
  hideLeaderboard?: boolean;
  /** JSON-RPC client for Base, used to verify tx_hash payments. Defaults to BASE_RPC_URL. */
  rpc?: Rpc;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(json);
}

const PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function sendText(res: http.ServerResponse, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(200, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
    ...extra,
  });
  res.end(body);
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const a = createHash("sha256").update(header.slice(7)).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(opts: ServerOptions = {}) {
  const store = opts.store ?? new PassportStore();
  const rpc = opts.rpc ?? httpRpc(process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
  const { tools } = createPlugin(store);
  const getTool = tools.find((t) => t.name === "get_trust_passport")!;
  const recordTool = tools.find((t) => t.name === "record_successful_spend")!;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, service: "agent-trust-passport" });
      }

      // Landing page
      if (req.method === "GET" && url.pathname === "/") {
        return sendText(res, "text/html; charset=utf-8", landingHtml(), {
          "content-security-policy": PAGE_CSP,
          "cache-control": "no-cache",
        });
      }

      // GET /leaderboard?limit=10 (aggregate fields only)
      if (req.method === "GET" && url.pathname === "/leaderboard") {
        const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 10));
        if (opts.hideLeaderboard) return send(res, 200, { hidden: true, total: 0, agents: [] });
        return send(res, 200, { hidden: false, total: store.count(), agents: store.list(limit) });
      }

      // GET /badge/:id.svg (compact) and /card/:id.svg (shareable card)
      if (req.method === "GET" && parts.length === 2 && (parts[0] === "badge" || parts[0] === "card") && parts[1].endsWith(".svg")) {
        const id = decodeURIComponent(parts[1].slice(0, -4));
        if (!GRANT_RE.test(id)) return send(res, 400, { error: "invalid grant id" });
        const p = store.get(id);
        return sendText(res, "image/svg+xml; charset=utf-8", parts[0] === "badge" ? badgeSvg(p) : cardSvg(p), {
          "cache-control": "public, max-age=300",
        });
      }

      // GET /passport/:grantId
      if (req.method === "GET" && parts.length === 2 && parts[0] === "passport") {
        const grantId = decodeURIComponent(parts[1]);
        if (!GRANT_RE.test(grantId)) return send(res, 400, { error: "invalid grant id" });
        const passport = (await getTool.handler({}, { grantId })) as TrustPassport;
        // Public view is aggregate only; individual spends need the write token.
        const privileged = !!opts.writeToken && tokenMatches(req.headers.authorization, opts.writeToken);
        if (!privileged) {
          const { recentSpends: _omit, ...publicView } = passport;
          return send(res, 200, publicView);
        }
        return send(res, 200, passport);
      }

      // POST /passport/:grantId/spend
      if (req.method === "POST" && parts.length === 3 && parts[0] === "passport" && parts[2] === "spend") {
        const grantId = decodeURIComponent(parts[1]);
        if (!GRANT_RE.test(grantId)) return send(res, 400, { error: "invalid grant id" });
        if (!opts.writeToken) {
          return send(res, 503, { error: "writes disabled: set PASSPORT_WRITE_TOKEN" });
        }
        if (!tokenMatches(req.headers.authorization, opts.writeToken)) {
          return send(res, 401, { error: "missing or invalid bearer token" });
        }
        let body = (await readJson(req)) as Record<string, unknown>;
        if (typeof body !== "object" || body === null) return send(res, 400, { error: "invalid body" });
        if (body.tx_hash !== undefined) {
          // On-chain path: the amount comes from the chain, not from the caller.
          if (typeof body.tx_hash !== "string" || !TX_RE.test(body.tx_hash)) {
            return send(res, 400, { error: "tx_hash must be a 0x-prefixed 32-byte hex string" });
          }
          const payer = body.payer_address;
          if (payer !== undefined && (typeof payer !== "string" || !ADDRESS_RE.test(payer))) {
            return send(res, 400, { error: "payer_address must be a 0x-prefixed 20-byte hex address" });
          }
          try {
            const pay = await verifyBaseUsdcPayment(rpc, body.tx_hash, payer as string | undefined);
            const { payer_address: _p, ...rest } = body;
            body = { ...rest, amount_usd: pay.amountUsd, tx_hash: pay.txHash };
          } catch (e) {
            if (e instanceof VerifyError) return send(res, e.status, { error: e.message });
            return send(res, 502, { error: "could not verify the transaction right now" });
          }
        } else if (typeof body.amount_usd !== "number") {
          return send(res, 400, { error: "amount_usd (number) or tx_hash is required" });
        }
        try {
          return send(res, 200, await recordTool.handler(body, { grantId }));
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
      }

      return send(res, 404, { error: "not found" });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return send(res, status, { error: status === 500 ? "internal error" : (e as Error).message });
    }
  });
}

// Run directly: `node dist/server.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  const writeToken = process.env.PASSPORT_WRITE_TOKEN;
  const store = new PassportStore({ file: process.env.DATA_FILE });
  if (process.env.SEED_DEMO_DATA === "true" && store.seedIfEmpty(DEMO_AGENTS)) console.log("Seeded demo agents (SEED_DEMO_DATA=true).");
  createServer({ writeToken, store, hideLeaderboard: process.env.PASSPORT_HIDE_LEADERBOARD === "1" }).listen(port, () => {
    console.log(`Agent Trust Passport listening on :${port}`);
    if (!writeToken) console.log("PASSPORT_WRITE_TOKEN not set: writes are disabled.");
    if (!process.env.DATA_FILE) console.log("DATA_FILE not set: state is in-memory and lost on restart.");
  });
}
