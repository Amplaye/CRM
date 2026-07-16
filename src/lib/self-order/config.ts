// Self-order (QR-at-the-table) config — pure logic, no supabase / no next, so
// both the public order endpoint and the client can share the same rules.
//
// The feature paces the KITCHEN: a guest can send DRINKS the moment they scan,
// but the FOOD (everything that isn't a drink) stays locked for the first few
// minutes of the table's visit. Each table's lock is independent — its clock
// starts when its bill is first opened — so when a wave of tables sits down at
// once their food orders land staggered instead of all together, and the pass
// never gets a burst it can't cook.
//
// Two deliberate choices, both from the owner's brief:
//   • The delay is a FIXED constant, not a per-tenant setting. The owner asked
//     for it to "just work", never to be dialed in by hand — so there is no
//     minutes field anywhere. Change it here if the default ever proves wrong.
//   • What counts as a "drink" is the one thing the system CANNOT guess (menu
//     items carry no station on these venues — every `station` is null), so the
//     owner marks which menu CATEGORIES are drinks. Everything else is food.

import type { TenantSettings } from "@/lib/types/tenant-settings";

/** How long the food stays locked after a table opens its bill, in minutes.
 * Fixed by design (see file header) — the owner never sets this. Kept modest so
 * a table that only wants food isn't left staring at a countdown for ages; it's
 * enough to break up a simultaneous rush across many tables. */
export const FOOD_COOLDOWN_MIN = 10;

export interface SelfOrderConfig {
  /** menu_categories.id values the owner flagged as drinks (phase 1, always
   * orderable). Empty → no category is a drink, so the whole menu is "food" and
   * the cooldown gates everything equally (still a valid, if blunt, setup). */
  drink_category_ids: string[];
  /** The food lock duration in minutes (the constant above, surfaced here so the
   * client can render the countdown without importing the bare constant). */
  cooldown_min: number;
}

/** Read settings.self_order, applying defaults and dropping anything malformed.
 * Never throws — a tenant that never opened the picker gets an empty drink list
 * and the standard cooldown. */
export function getSelfOrderConfig(settings: TenantSettings | null | undefined): SelfOrderConfig {
  const raw = (settings?.self_order || {}) as { drink_category_ids?: unknown };
  const ids = Array.isArray(raw.drink_category_ids)
    ? raw.drink_category_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  return {
    // De-dup: the picker shouldn't ever store dupes, but a hand-edited settings
    // blob could, and it would only waste comparisons downstream.
    drink_category_ids: Array.from(new Set(ids)),
    cooldown_min: FOOD_COOLDOWN_MIN,
  };
}

/** When the food unlocks for a table, given when its bill was opened. Pure so
 * both the server (authoritative gate) and the client (countdown) agree to the
 * millisecond. `openedAtMs` is the table's open cassa_order `opened_at`. */
export function foodUnlockAtMs(openedAtMs: number): number {
  return openedAtMs + FOOD_COOLDOWN_MIN * 60_000;
}

/** True once a table whose bill opened at `openedAtMs` may order food at `nowMs`.
 * A table with no open bill yet (openedAtMs null) has never started its clock —
 * its first order is necessarily its opening one, handled by the caller. */
export function foodUnlocked(openedAtMs: number, nowMs: number): boolean {
  return nowMs >= foodUnlockAtMs(openedAtMs);
}
