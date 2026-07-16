// Loyalty pure logic — config parsing with defaults. Pure module (no
// supabase, no next), unit-tested; server helpers live in accrue.ts.

import type { TenantSettings } from "@/lib/types/tenant-settings";

export interface LoyaltyConfig {
  /** Points earned when a reservation completes. */
  points_per_visit: number;
  /** Points needed to unlock the reward. */
  reward_points: number;
  /** What the guest gets (free text the owner writes, e.g. "Dessert offerto"). */
  reward_label: string;
}

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  points_per_visit: 10,
  reward_points: 100,
  reward_label: "",
};

/** Read settings.loyalty applying defaults and clamping nonsense (a 0/negative
 * config would make every visit worthless or the reward free). */
export function getLoyaltyConfig(settings: TenantSettings | null | undefined): LoyaltyConfig {
  const raw = (settings?.loyalty || {}) as Partial<LoyaltyConfig>;
  const ppv = Number(raw.points_per_visit);
  const rp = Number(raw.reward_points);
  return {
    points_per_visit:
      Number.isFinite(ppv) && ppv >= 1 ? Math.round(ppv) : DEFAULT_LOYALTY.points_per_visit,
    reward_points:
      Number.isFinite(rp) && rp >= 1 ? Math.round(rp) : DEFAULT_LOYALTY.reward_points,
    reward_label: typeof raw.reward_label === "string" ? raw.reward_label : "",
  };
}
