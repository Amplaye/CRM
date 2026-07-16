// AEAT formatters (the spec's, not ours) — split from huella.ts so client
// components (receipt QR rendering) can import them without dragging the
// node:crypto hash code into the browser bundle (the crypto polyfill uses
// eval, which our CSP forbids). huella.ts re-exports everything here, so
// server code keeps importing from "./huella" unchanged.

/** A NIF as AEAT wants it everywhere: uppercase, no spaces, no dashes. */
export function normalizeNif(nif: string | null | undefined): string {
  return String(nif || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 2 decimals, dot separator, no thousands grouping, no currency. */
export function fiscalAmount(n: number | string | null | undefined): string {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toFixed(2);
}

/** DD-MM-AAAA from a YYYY-MM-DD business date (the format the whole app stores). */
export function fiscalDate(isoDate: string): string {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

/**
 * ISO-8601 instant WITH the venue's UTC offset — `2024-01-01T19:20:30+01:00`.
 *
 * Not `toISOString()`: that is always UTC ("Z"), and AEAT wants the offset of the
 * place the sale happened. A Canary till (+00:00/+01:00) and a Barcelona till
 * (+01:00/+02:00) must each declare their own huso, and DST moves it twice a year,
 * so the offset is READ from the zone at that instant rather than hardcoded.
 */
export function fiscalTimestamp(at: Date, timezone: string | null | undefined): string {
  const tz = timezone || "Europe/Madrid";
  const parts = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "longOffset",
      }).formatToParts(at);
    } catch {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "longOffset",
      }).formatToParts(at);
    }
  })();
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  // "GMT+01:00" → "+01:00"; "GMT" (UTC zones) → "+00:00".
  const raw = get("timeZoneName").replace("GMT", "").trim();
  const offset = raw === "" ? "+00:00" : raw.length === 3 ? `${raw}:00` : raw;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}${offset}`;
}
