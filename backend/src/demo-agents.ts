/** Opt-in sample passports (SEED_DEMO_DATA=true) so every tier is visible on a fresh instance. */
export const DEMO_AGENTS = [
  { id: "demo-atlas", spends: 6, volumeUsd: 18, daysAgo: 9 }, // Elite (93)
  { id: "demo-nova", spends: 4, volumeUsd: 12, daysAgo: 3 }, // Trusted (59)
  { id: "demo-pixel", spends: 2, volumeUsd: 8, daysAgo: 1 }, // Proven (33)
  { id: "demo-newcomer", spends: 1, volumeUsd: 3, daysAgo: 0 }, // New (14)
];
