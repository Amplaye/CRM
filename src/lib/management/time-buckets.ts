// Time bucketing for management charts — the same range/bucket helpers
// analytics/page.tsx grew (rangeBounds/bucketKey/bucketLabel/buildBuckets),
// extracted here so both the old analytics screen and the new P&L / food-cost
// screens share one implementation. Plus shiftOf, the single definition of
// "lunch vs dinner" used by P&L-by-band (and mirrored by the floor screen's
// getShift): a bill closed before 17:00 local is lunch, otherwise dinner.

export type TimeRange = "day" | "week" | "month" | "year" | "all";

const pad = (n: number) => String(n).padStart(2, "0");
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function rangeBounds(range: TimeRange): { startDate: string | null; endDate: string | null; days: number | null } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  if (range === "all") return { startDate: null, endDate: null, days: null };
  let days = 1;
  if (range === "day") days = 1;
  else if (range === "week") days = 7;
  else if (range === "month") days = 30;
  else if (range === "year") days = 365;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateStr(start), endDate: toDateStr(end), days };
}

export function bucketKey(range: TimeRange, dateStr: string, timeStr: string | null): string {
  if (range === "day") {
    if (!timeStr) return "00";
    return timeStr.slice(0, 2);
  }
  if (range === "week" || range === "month") return dateStr;
  return (dateStr || "").slice(0, 7);
}

export function bucketLabel(range: TimeRange, key: string): string {
  if (range === "day") return `${key}h`;
  if (range === "week" || range === "month") {
    const [, m, d] = key.split("-");
    return `${d}/${m}`;
  }
  const [y, m] = key.split("-");
  return `${m}/${y.slice(2)}`;
}

export function buildBuckets(range: TimeRange, allDates: string[]): string[] {
  if (range === "day") return Array.from({ length: 24 }, (_, h) => pad(h));
  if (range === "week" || range === "month") {
    const { days } = rangeBounds(range);
    const keys: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = (days || 1) - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      keys.push(toDateStr(d));
    }
    return keys;
  }
  // year / all → distinct yyyy-mm of the data, ascending
  return Array.from(new Set(allDates.map((d) => (d || "").slice(0, 7)))).sort();
}

export type Shift = "lunch" | "dinner";

/**
 * Lunch vs dinner for a bill, the single definition shared by P&L-by-band.
 * A bill closed before 17:00 local is lunch, otherwise dinner. `closedAt` is an
 * ISO timestamp; the hour is read in the given IANA timezone (default Europe/Rome)
 * so the split doesn't drift with the server's timezone.
 */
export function shiftOf(closedAt: string, tz = "Europe/Rome"): Shift {
  let hour: number;
  try {
    const h = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(new Date(closedAt));
    hour = parseInt(h, 10);
    if (Number.isNaN(hour)) hour = new Date(closedAt).getHours();
  } catch {
    hour = new Date(closedAt).getHours();
  }
  return hour < 17 ? "lunch" : "dinner";
}
