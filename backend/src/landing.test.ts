import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "./server.js";
import { PassportStore } from "./passport.js";

const store = new PassportStore();
store.recordSuccessfulSpend("beta", { amountUsd: 3, category: "secret-cat" });
for (const a of [5, 8, 4]) store.recordSuccessfulSpend("alpha", { amountUsd: a });
store.recordViolation("bad", "private reason");
const servers = [createServer({ store }), createServer({ store, hideLeaderboard: true })];
let urls: string[] = [];

beforeAll(async () => {
  urls = await Promise.all(
    servers.map((s) => new Promise<string>((r) => s.listen(0, () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)))),
  );
});
afterAll(() => servers.forEach((s) => s.close()));

describe("demo seeding", () => {
  it("seeds every tier only into an empty store", async () => {
    const { DEMO_AGENTS } = await import("./demo-agents.js");
    const fresh = new PassportStore();
    expect(fresh.seedIfEmpty(DEMO_AGENTS)).toBe(true);
    expect(fresh.list().map((a) => a.tier)).toEqual(["Elite", "Trusted", "Proven", "New"]);
    expect(fresh.seedIfEmpty(DEMO_AGENTS)).toBe(false);
    expect(store.seedIfEmpty(DEMO_AGENTS)).toBe(false);
  });
});

describe("landing, leaderboard and badges", () => {
  it("serves the landing page with a CSP", async () => {
    const r = await fetch(`${urls[0]}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await r.text()).toContain("Trust Passport");
  });

  it("ranks agents by score and exposes aggregate fields only", async () => {
    const d: any = await (await fetch(`${urls[0]}/leaderboard`)).json();
    expect(d.agents.map((a: any) => a.agentId)).toEqual(["alpha", "beta", "bad"]);
    expect(d.agents[0]).toMatchObject({ score: 58, tier: "Trusted" });
    const raw = JSON.stringify(d);
    expect(raw).not.toContain("secret-cat");
    expect(raw).not.toContain("private reason");
  });

  it("can hide the leaderboard", async () => {
    const d: any = await (await fetch(`${urls[1]}/leaderboard`)).json();
    expect(d).toMatchObject({ hidden: true, agents: [] });
  });

  it("serves badge and card SVGs and rejects bad ids", async () => {
    for (const kind of ["badge", "card"]) {
      const r = await fetch(`${urls[0]}/${kind}/alpha.svg`);
      expect(r.headers.get("content-type")).toContain("image/svg+xml");
      expect(await r.text()).toContain("Trusted");
    }
    expect((await fetch(`${urls[0]}/badge/bad%20id!.svg`)).status).toBe(400);
  });
});
