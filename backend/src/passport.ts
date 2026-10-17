/**
 * Agent Trust Passport — core logic.
 *
 * MVP score formula (from the spec):
 *   score = min(100, successful_spends * 8 + clean_volume_usd * 2 + days_active * 1)
 * Any recorded violation sets the score to 0.
 *
 * State is in-memory and scoped per grant (a passport is never shared
 * across unrelated grants).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Tier = "New" | "Proven" | "Trusted" | "Elite";
export type Evidence = "self_reported" | "onchain_verified" | "mixed";
export type PassportStatus = "new" | "active" | "violated";

export interface PolicySummary {
  maxAmountUsd?: number;
  categories?: string[];
  timeWindow?: string;
}

export interface SpendRecord {
  amountUsd: number;
  category?: string;
  at: string; // ISO timestamp
}

export interface ViolationRecord {
  reason: string;
  at: string;
}

export interface TrustPassport {
  grantId: string;
  score: number;
  tier: Tier;
  status: PassportStatus;
  successfulSpends: number;
  cleanVolumeUsd: number;
  daysActive: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  policy: PolicySummary;
  violations: ViolationRecord[];
  recentSpends: SpendRecord[];
  /** Spends backed by a verified on-chain transaction. */
  verifiedSpends: number;
  verifiedVolumeUsd: number;
  evidence: Evidence;
  summary: string;
  generatedAt: string;
}

interface GrantState {
  successfulSpends: number;
  cleanVolumeUsd: number;
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  policy: PolicySummary;
  violations: ViolationRecord[];
  recentSpends: SpendRecord[];
  verifiedSpends: number;
  verifiedVolumeUsd: number;
  verifiedTxs: string[];
}

const RECENT_LIMIT = 10;

/** Pure score function — exported so it can be tested and reused. */
export function computeScore(input: {
  successfulSpends: number;
  cleanVolumeUsd: number;
  daysActive: number;
  violationCount: number;
}): number {
  if (input.violationCount > 0) return 0;
  const raw =
    input.successfulSpends * 8 + input.cleanVolumeUsd * 2 + input.daysActive * 1;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function tierForScore(score: number): Tier {
  if (score >= 80) return "Elite";
  if (score >= 50) return "Trusted";
  if (score >= 20) return "Proven";
  return "New";
}

function emptyState(): GrantState {
  return {
    successfulSpends: 0,
    cleanVolumeUsd: 0,
    firstActivityAt: null,
    lastActivityAt: null,
    policy: {},
    violations: [],
    recentSpends: [],
    verifiedSpends: 0,
    verifiedVolumeUsd: 0,
    verifiedTxs: [],
  };
}

export interface LeaderboardEntry {
  agentId: string;
  score: number;
  tier: Tier;
  status: PassportStatus;
  successfulSpends: number;
  cleanVolumeUsd: number;
  daysActive: number;
  evidence: Evidence;
}

export class PassportStore {
  private grants = new Map<string, GrantState>();
  /** tx hash -> grant that already counted it (replay protection). */
  private txIndex = new Map<string, string>();
  private now: () => number;
  private file?: string;

  /**
   * `file`: optional path of a JSON file used to persist state across
   * restarts. A corrupt file throws at startup instead of silently wiping
   * every passport.
   */
  constructor(opts: { now?: () => number; file?: string } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.file = opts.file;
    if (this.file && existsSync(this.file)) {
      const raw = readFileSync(this.file, "utf8");
      const data = raw.trim() ? JSON.parse(raw) : {};
      for (const [id, st] of Object.entries(data)) {
        const g = { ...emptyState(), ...(st as Partial<GrantState>) };
        this.grants.set(id, g);
        for (const tx of g.verifiedTxs) this.txIndex.set(tx, id);
      }
    }
  }

  /** Number of grants with stored state (unseen grants are never stored). */
  count(): number {
    return this.grants.size;
  }

  /** Aggregate-only rows for a public leaderboard, best score first. */
  list(limit = 10): LeaderboardEntry[] {
    return [...this.grants.keys()]
      .map((id) => this.get(id))
      .sort((a, b) => b.score - a.score || b.cleanVolumeUsd - a.cleanVolumeUsd || a.grantId.localeCompare(b.grantId))
      .slice(0, limit)
      .map((p) => ({
        agentId: p.grantId,
        score: p.score,
        tier: p.tier,
        status: p.status,
        successfulSpends: p.successfulSpends,
        cleanVolumeUsd: p.cleanVolumeUsd,
        daysActive: p.daysActive,
        evidence: p.evidence,
      }));
  }

  /** Seeds sample passports, only when the store is empty. Returns whether it seeded. */
  seedIfEmpty(entries: { id: string; spends: number; volumeUsd: number; daysAgo: number }[]): boolean {
    if (this.grants.size > 0) return false;
    const nowMs = this.now();
    for (const e of entries) {
      const first = nowMs - e.daysAgo * DAY_MS - 3_600_000;
      this.grants.set(e.id, {
        ...emptyState(),
        successfulSpends: e.spends,
        cleanVolumeUsd: e.volumeUsd,
        firstActivityAt: first,
        lastActivityAt: nowMs,
      });
    }
    this.persist();
    return true;
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.grants)));
    renameSync(tmp, this.file); // atomic replace
  }

  private state(grantId: string): GrantState {
    let s = this.grants.get(grantId);
    if (!s) {
      s = emptyState();
      this.grants.set(grantId, s);
    }
    return s;
  }

  /** Returns the current passport. Always succeeds, even for unseen grants. */
  get(grantId: string): TrustPassport {
    const s = this.grants.get(grantId) ?? emptyState();
    const nowMs = this.now();
    const daysActive =
      s.firstActivityAt === null
        ? 0
        : Math.max(0, Math.floor((nowMs - s.firstActivityAt) / DAY_MS));
    const score = computeScore({
      successfulSpends: s.successfulSpends,
      cleanVolumeUsd: s.cleanVolumeUsd,
      daysActive,
      violationCount: s.violations.length,
    });
    const status: PassportStatus =
      s.violations.length > 0
        ? "violated"
        : s.successfulSpends === 0
          ? "new"
          : "active";
    const tier = tierForScore(score);

    return {
      grantId,
      score,
      tier,
      status,
      successfulSpends: s.successfulSpends,
      cleanVolumeUsd: round2(s.cleanVolumeUsd),
      daysActive,
      firstActivityAt: s.firstActivityAt ? new Date(s.firstActivityAt).toISOString() : null,
      lastActivityAt: s.lastActivityAt ? new Date(s.lastActivityAt).toISOString() : null,
      policy: { ...s.policy },
      violations: [...s.violations],
      recentSpends: [...s.recentSpends],
      verifiedSpends: s.verifiedSpends,
      verifiedVolumeUsd: round2(s.verifiedVolumeUsd),
      evidence:
        s.verifiedSpends === 0 ? "self_reported" : s.verifiedSpends >= s.successfulSpends ? "onchain_verified" : "mixed",
      summary: buildSummary({ tier, score, status, spends: s.successfulSpends, volume: s.cleanVolumeUsd, violations: s.violations.length }),
      generatedAt: new Date(nowMs).toISOString(),
    };
  }

  /** Record a clean, policy-compliant spend and return the updated passport. */
  recordSuccessfulSpend(
    grantId: string,
    spend: { amountUsd: number; category?: string; policy?: PolicySummary; txHash?: string },
  ): TrustPassport {
    if (!Number.isFinite(spend.amountUsd) || spend.amountUsd <= 0) {
      throw new Error("amount_usd must be a positive number");
    }
    const tx = spend.txHash?.toLowerCase();
    if (tx && this.txIndex.has(tx)) throw new Error("this transaction has already been counted");
    const s = this.state(grantId);
    const nowMs = this.now();

    if (tx) {
      this.txIndex.set(tx, grantId);
      s.verifiedTxs.push(tx);
      s.verifiedSpends += 1;
      s.verifiedVolumeUsd += spend.amountUsd;
    }
    s.successfulSpends += 1;
    s.cleanVolumeUsd += spend.amountUsd;
    if (s.firstActivityAt === null) s.firstActivityAt = nowMs;
    s.lastActivityAt = nowMs;
    if (spend.policy) s.policy = { ...s.policy, ...spend.policy };

    s.recentSpends.push({
      amountUsd: spend.amountUsd,
      category: spend.category,
      at: new Date(nowMs).toISOString(),
    });
    if (s.recentSpends.length > RECENT_LIMIT) s.recentSpends.shift();

    this.persist();
    return this.get(grantId);
  }

  /**
   * Internal helper (NOT exposed as a tool in the MVP): a hard policy
   * violation drops the score to 0 until the passport is reset.
   */
  recordViolation(grantId: string, reason: string): TrustPassport {
    const s = this.state(grantId);
    const nowMs = this.now();
    s.violations.push({ reason, at: new Date(nowMs).toISOString() });
    s.lastActivityAt = nowMs;
    if (s.firstActivityAt === null) s.firstActivityAt = nowMs;
    this.persist();
    return this.get(grantId);
  }

  /** Revoking the underlying grant resets the passport. */
  reset(grantId: string): void {
    for (const tx of this.grants.get(grantId)?.verifiedTxs ?? []) this.txIndex.delete(tx);
    this.grants.delete(grantId);
    this.persist();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildSummary(p: {
  tier: Tier;
  score: number;
  status: PassportStatus;
  spends: number;
  volume: number;
  violations: number;
}): string {
  if (p.status === "violated") {
    return `Untrusted: ${p.violations} policy violation(s) recorded. Score reset to 0.`;
  }
  if (p.status === "new") {
    return "This agent is new and untrusted: no clean spends recorded yet.";
  }
  return `${p.tier} agent (score ${p.score}/100): ${p.spends} clean spend(s), $${round2(p.volume)} handled under policy with no violations.`;
}
