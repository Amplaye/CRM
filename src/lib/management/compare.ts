// Period comparison — the math behind the assistant's "ieri vs sabato scorso"
// revenue questions. resolveNamedDate turns a spoken period name into a concrete
// [from, to] business-date window relative to a given `now` (deterministic — the
// caller passes the clock, nothing reads Date.now() here so it's unit-testable).

import type { SaleRow } from "@/lib/management/types";
import { revenueOf } from "@/lib/management/pl";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface DateWindow {
  from: string; // yyyy-mm-dd inclusive
  to: string;   // yyyy-mm-dd inclusive
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  // italian / spanish spoken aliases the assistant may pass through
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

/** Most recent date strictly before `from` whose weekday is `dow`. */
function lastWeekday(from: Date, dow: number): Date {
  const d = new Date(from);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() !== dow);
  return d;
}

/** Monday of the ISO week containing `d`. */
function mondayOf(d: Date): Date {
  const m = new Date(d);
  const day = m.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  m.setDate(m.getDate() + diff);
  return m;
}

/**
 * Resolve a named period to a concrete date window relative to `now`.
 * Supports: today, yesterday, this_week, last_week, and last_<weekday>
 * (e.g. "last_saturday" / "sabato"). Unknown names default to today.
 */
export function resolveNamedDate(now: Date, name: string): DateWindow {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const key = name.trim().toLowerCase().replace(/^last[_\s]+/, "last_").replace(/\s+/g, "_");

  if (key === "today" || key === "oggi" || key === "hoy") {
    const s = toDateStr(today);
    return { from: s, to: s };
  }
  if (key === "yesterday" || key === "ieri" || key === "ayer") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const s = toDateStr(y);
    return { from: s, to: s };
  }
  if (key === "this_week" || key === "questa_settimana" || key === "esta_semana") {
    return { from: toDateStr(mondayOf(today)), to: toDateStr(today) };
  }
  if (key === "last_week" || key === "settimana_scorsa" || key === "semana_pasada") {
    const thisMon = mondayOf(today);
    const lastMon = new Date(thisMon);
    lastMon.setDate(lastMon.getDate() - 7);
    const lastSun = new Date(thisMon);
    lastSun.setDate(lastSun.getDate() - 1);
    return { from: toDateStr(lastMon), to: toDateStr(lastSun) };
  }

  // last_<weekday>
  const wd = key.replace(/^last_/, "");
  if (wd in WEEKDAYS) {
    const d = lastWeekday(today, WEEKDAYS[wd]);
    const s = toDateStr(d);
    return { from: s, to: s };
  }
  // bare weekday name → same as last_<weekday>
  if (key in WEEKDAYS) {
    const d = lastWeekday(today, WEEKDAYS[key]);
    const s = toDateStr(d);
    return { from: s, to: s };
  }

  const s = toDateStr(today);
  return { from: s, to: s };
}

/** Total revenue of sales whose business_date falls in [from, to]. */
export function revenueForWindow(sales: SaleRow[], window: DateWindow): number {
  const total = sales
    .filter((s) => s.businessDate >= window.from && s.businessDate <= window.to)
    .reduce((a, s) => a + revenueOf(s), 0);
  return Math.round(total * 100) / 100;
}
