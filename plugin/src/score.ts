/**
 * Agent Trust Passport MVP score. Mirrors the backend formula so anyone can
 * work out offline what a passport needs to reach a given tier.
 *
 *   score = min(100, successful_spends * 8 + clean_volume_usd * 2 + days_active)
 *   any recorded violation sets the score to 0
 */

export type Tier = "New" | "Proven" | "Trusted" | "Elite";

export const FORMULA =
  "min(100, successful_spends * 8 + clean_volume_usd * 2 + days_active); any violation sets the score to 0";

export function computeScore(input: {
  successfulSpends: number;
  cleanVolumeUsd: number;
  daysActive: number;
  violations: number;
}): number {
  if (input.violations > 0) return 0;
  const raw = input.successfulSpends * 8 + input.cleanVolumeUsd * 2 + input.daysActive;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function tierForScore(score: number): Tier {
  if (score >= 80) return "Elite";
  if (score >= 50) return "Trusted";
  if (score >= 20) return "Proven";
  return "New";
}

/** Minimum score for each tier, and tiers ordered from lowest to highest. */
export const TIER_MIN_SCORE: Record<Tier, number> = { New: 0, Proven: 20, Trusted: 50, Elite: 80 };
export const TIER_ORDER: Tier[] = ["New", "Proven", "Trusted", "Elite"];
