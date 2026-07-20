// Shelf-life → expiry derivation. An ingredient may carry `shelf_life_days`: the
// days it keeps once received. On every goods-in we set expiry_date = base + shelf
// life, so the owner sets the shelf life once instead of typing a date each time.
//
// expiry_date is a single per-ingredient field (no per-lot tracking), so a receipt
// always stamps the freshest batch's expiry — the honest best without lots.

/** Add `days` to an ISO/`Date` base and return the ISO date (yyyy-mm-dd). Anchored
 * at noon UTC so day arithmetic never flips across a timezone/DST boundary. */
export function addDaysIso(base: string | Date, days: number): string {
  let y: number, m: number, d: number;
  if (typeof base === "string") {
    const [ys, ms, ds] = base.slice(0, 10).split("-");
    y = Number(ys); m = Number(ms); d = Number(ds);
  } else {
    // Local calendar day of the given Date (so "today" is the owner's today).
    y = base.getFullYear(); m = base.getMonth() + 1; d = base.getDate();
  }
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Expiry for a goods-in, or null when the ingredient has no usable shelf life.
 * `base` is the delivery date (invoice date, or today for a manual receipt).
 */
export function deriveExpiry(base: string | Date, shelfLifeDays: number | null | undefined): string | null {
  const n = shelfLifeDays == null ? null : Number(shelfLifeDays);
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return addDaysIso(base, Math.round(n));
}
