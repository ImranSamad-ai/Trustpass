import { describe, expect, it } from "vitest";
import { DAY_MS, PassportStore, computeScore, tierForScore } from "./passport.js";
import { createPlugin } from "./index.js";

function clockedStore() {
  let t = 1_700_000_000_000;
  const store = new PassportStore({ now: () => t });
  return { store, advance: (ms: number) => (t += ms) };
}

describe("computeScore", () => {
  it("applies the MVP formula", () => {
    expect(computeScore({ successfulSpends: 3, cleanVolumeUsd: 10, daysActive: 2, violationCount: 0 })).toBe(
      3 * 8 + 10 * 2 + 2,
    );
  });
  it("caps at 100", () => {
    expect(computeScore({ successfulSpends: 50, cleanVolumeUsd: 500, daysActive: 90, violationCount: 0 })).toBe(100);
  });
  it("returns 0 on any violation", () => {
    expect(computeScore({ successfulSpends: 10, cleanVolumeUsd: 100, daysActive: 10, violationCount: 1 })).toBe(0);
  });
});

describe("tierForScore", () => {
  it("maps score to tiers", () => {
    expect(tierForScore(0)).toBe("New");
    expect(tierForScore(19)).toBe("New");
    expect(tierForScore(20)).toBe("Proven");
    expect(tierForScore(50)).toBe("Trusted");
    expect(tierForScore(80)).toBe("Elite");
  });
});

describe("PassportStore", () => {
  it("returns a zero passport for an unseen grant", () => {
    const { store } = clockedStore();
    const p = store.get("g1");
    expect(p.score).toBe(0);
    expect(p.tier).toBe("New");
    expect(p.status).toBe("new");
    expect(p.successfulSpends).toBe(0);
  });

  it("increases score and volume after clean spends", () => {
    const { store } = clockedStore();
    store.recordSuccessfulSpend("g1", { amountUsd: 5 });
    store.recordSuccessfulSpend("g1", { amountUsd: 5 });
    const p = store.recordSuccessfulSpend("g1", { amountUsd: 10 });
    expect(p.successfulSpends).toBe(3);
    expect(p.cleanVolumeUsd).toBe(20);
    expect(p.score).toBe(3 * 8 + 20 * 2); // 64
    expect(p.tier).toBe("Trusted");
    expect(p.status).toBe("active");
  });

  it("rewards consistency over time (days_active)", () => {
    const { store, advance } = clockedStore();
    store.recordSuccessfulSpend("g1", { amountUsd: 1 });
    const before = store.get("g1").score;
    advance(5 * DAY_MS);
    expect(store.get("g1").score).toBe(before + 5);
  });

  it("scopes passports per grant", () => {
    const { store } = clockedStore();
    store.recordSuccessfulSpend("g1", { amountUsd: 10 });
    expect(store.get("g2").score).toBe(0);
  });

  it("drops the score to 0 on violation and restores after reset", () => {
    const { store } = clockedStore();
    store.recordSuccessfulSpend("g1", { amountUsd: 10 });
    const p = store.recordViolation("g1", "exceeded max amount");
    expect(p.score).toBe(0);
    expect(p.status).toBe("violated");
    expect(p.violations).toHaveLength(1);
    store.reset("g1");
    expect(store.get("g1").status).toBe("new");
  });

  it("rejects invalid amounts", () => {
    const { store } = clockedStore();
    expect(() => store.recordSuccessfulSpend("g1", { amountUsd: 0 })).toThrow();
    expect(() => store.recordSuccessfulSpend("g1", { amountUsd: -3 })).toThrow();
    expect(() => store.recordSuccessfulSpend("g1", { amountUsd: NaN })).toThrow();
  });

  it("keeps only the 10 most recent spends and records policy", () => {
    const { store } = clockedStore();
    for (let i = 0; i < 12; i++) {
      store.recordSuccessfulSpend("g1", { amountUsd: 1, policy: { maxAmountUsd: 25 } });
    }
    const p = store.get("g1");
    expect(p.recentSpends).toHaveLength(10);
    expect(p.successfulSpends).toBe(12);
    expect(p.policy.maxAmountUsd).toBe(25);
  });
});

describe("plugin tools", () => {
  it("exposes exactly the two MVP tools", () => {
    const { tools } = createPlugin();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_trust_passport", "record_successful_spend"]);
  });

  it("runs the demo flow end to end", async () => {
    const { tools } = createPlugin();
    const get = tools.find((t) => t.name === "get_trust_passport")!;
    const record = tools.find((t) => t.name === "record_successful_spend")!;
    const ctx = { grantId: "grant-demo" };

    const before: any = await get.handler({}, ctx);
    expect(before.score).toBe(0);

    await record.handler({ amount_usd: 5, category: "api-credits", max_amount_usd: 25 }, ctx);
    await record.handler({ amount_usd: 8 }, ctx);
    await record.handler({ amount_usd: 4 }, ctx);

    const after: any = await get.handler({}, ctx);
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.cleanVolumeUsd).toBe(17);
    expect(after.successfulSpends).toBe(3);
  });
});

describe("persistence", () => {
  it("survives a restart and never stores unseen grants", async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "passport-")), "nested", "state.json");

    const a = new PassportStore({ file });
    a.recordSuccessfulSpend("g1", { amountUsd: 5 });
    a.recordSuccessfulSpend("g1", { amountUsd: 8 });
    a.get("never-seen-1");
    a.get("never-seen-2");
    expect(a.count()).toBe(1);

    const b = new PassportStore({ file });
    const p = b.get("g1");
    expect(p.successfulSpends).toBe(2);
    expect(p.cleanVolumeUsd).toBe(13);
    expect(b.get("never-seen-1").score).toBe(0);

    b.recordViolation("g1", "test");
    expect(new PassportStore({ file }).get("g1").status).toBe("violated");

    b.reset("g1");
    expect(new PassportStore({ file }).get("g1").status).toBe("new");

    writeFileSync(file, "{corrupt");
    expect(() => new PassportStore({ file })).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{corrupt"); // not overwritten
  });
});
