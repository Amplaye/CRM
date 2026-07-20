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
// Two things the owner controls:
//   • HOW LONG the food stays locked. This started life as a fixed constant
//     ("it should just work"), but kitchens differ — a pizzeria firing in 6
//     minutes and a fine-dining pass are not the same venue — so it is now a
//     per-tenant setting with the old constant as its default. 0 disables the
//     lock entirely (everything orderable on scan).
//   • What counts as a "drink" is the one thing the system CANNOT guess (menu
//     items carry no station on these venues — every `station` is null), so the
//     owner marks which menu CATEGORIES are drinks. Everything else is food.

import type { TenantSettings } from "@/lib/types/tenant-settings";

/** Default food lock, in minutes, for a tenant that never touched the setting.
 * Modest on purpose: enough to stagger a simultaneous rush, not so long that a
 * table that only wants food is left staring at a countdown. */
export const FOOD_COOLDOWN_MIN = 10;

/** Hard bounds for the owner-set value. 0 is meaningful (no lock at all); the
 * ceiling stops a typo like "120" from stranding a whole service behind a
 * two-hour timer — nothing about this feature makes sense past a sitting. */
export const MIN_COOLDOWN_MIN = 0;
export const MAX_COOLDOWN_MIN = 60;

/** Clamp any raw input (settings blob, form field, API body) to a usable whole
 * number of minutes. Anything non-numeric falls back to the default rather than
 * to 0 — a malformed setting must not silently switch the lock OFF. */
export function normalizeCooldownMin(raw: unknown): number {
  // Guard the empty string explicitly: Number("") is 0, not NaN, so a cleared
  // input box would otherwise read as a deliberate "disable the lock".
  if (typeof raw === "string" && raw.trim() === "") return FOOD_COOLDOWN_MIN;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return FOOD_COOLDOWN_MIN;
  return Math.min(MAX_COOLDOWN_MIN, Math.max(MIN_COOLDOWN_MIN, Math.round(n)));
}

export interface SelfOrderConfig {
  /** menu_categories.id values the owner flagged as drinks (phase 1, always
   * orderable). Empty → no category is a drink, so the whole menu is "food" and
   * the cooldown gates everything equally (still a valid, if blunt, setup). */
  drink_category_ids: string[];
  /** The food lock duration in minutes, as the owner set it (clamped). 0 means
   * no lock — callers must treat that as "food is always orderable". */
  cooldown_min: number;
}

/** Read settings.self_order, applying defaults and dropping anything malformed.
 * Never throws — a tenant that never opened the picker gets an empty drink list
 * and the standard cooldown. */
export function getSelfOrderConfig(settings: TenantSettings | null | undefined): SelfOrderConfig {
  const raw = (settings?.self_order || {}) as {
    drink_category_ids?: unknown;
    cooldown_min?: unknown;
  };
  const ids = Array.isArray(raw.drink_category_ids)
    ? raw.drink_category_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  return {
    // De-dup: the picker shouldn't ever store dupes, but a hand-edited settings
    // blob could, and it would only waste comparisons downstream.
    drink_category_ids: Array.from(new Set(ids)),
    // Absent (every tenant from before this was configurable) → the old constant,
    // so nobody's behaviour changes until they open the setting.
    cooldown_min:
      raw.cooldown_min === undefined || raw.cooldown_min === null
        ? FOOD_COOLDOWN_MIN
        : normalizeCooldownMin(raw.cooldown_min),
  };
}

/** When the food unlocks for a table, given when its bill was opened and the
 * tenant's cooldown. Pure so both the server (authoritative gate) and the client
 * (countdown) agree to the millisecond. `openedAtMs` is the table's open
 * cassa_order `opened_at`. */
export function foodUnlockAtMs(openedAtMs: number, cooldownMin: number): number {
  return openedAtMs + normalizeCooldownMin(cooldownMin) * 60_000;
}

/** True once a table whose bill opened at `openedAtMs` may order food at `nowMs`.
 * A zero cooldown is always unlocked. A table with no open bill yet has never
 * started its clock — its first order is necessarily its opening one, handled by
 * the caller. */
export function foodUnlocked(openedAtMs: number, nowMs: number, cooldownMin: number): boolean {
  return nowMs >= foodUnlockAtMs(openedAtMs, cooldownMin);
}
