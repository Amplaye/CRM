"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Lock, Unlock } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { fmtEur, type SessionSummary } from "@/lib/cassa/totals";
import type { CassaSessionRow } from "@/lib/cassa/types";
import { MonthCalendar, monthOf, shiftMonth } from "./MonthCalendar";

// Cash-day history: a month calendar with a dot per day that had a session
// (green = still open, bronze = closed) and, on tap, that day's closing report.
// Reads cassa_sessions directly under RLS like every other dashboard read.

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface SessionsCalendarProps {
  tenantId: string;
  /** Bump to refetch (e.g. after opening/closing the day). */
  refreshKey?: string | number;
}

export function SessionsCalendar({ tenantId, refreshKey }: SessionsCalendarProps) {
  const { t, language } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const today = localDay(new Date().toISOString());
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState<string | null>(today);
  const [sessions, setSessions] = useState<CassaSessionRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fetch a little around the visible month so a session opened late on the
      // 31st (local tz vs UTC) still lands on the right day.
      const from = `${shiftMonth(month, -1)}-25T00:00:00Z`;
      const to = `${shiftMonth(month, 1)}-06T23:59:59Z`;
      const { data } = await supabase
        .from("cassa_sessions")
        .select(
          "id, status, opened_at, opened_by_name, opening_float, closed_at, expected_cash, counted_cash, cash_difference, totals, notes, created_at",
        )
        .eq("tenant_id", tenantId)
        .gte("opened_at", from)
        .lte("opened_at", to)
        .order("opened_at", { ascending: true });
      if (!cancelled) setSessions((data || []) as CassaSessionRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId, month, refreshKey]);

  const byDay = useMemo(() => {
    const map: Record<string, CassaSessionRow[]> = {};
    for (const s of sessions) {
      const day = localDay(s.opened_at);
      (map[day] ||= []).push(s);
    }
    return map;
  }, [sessions]);

  const markers = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [day, list] of Object.entries(byDay)) {
      m[day] = list.some((s) => s.status === "open") ? "#059669" : "#c4956a";
    }
    return m;
  }, [byDay]);

  const daySessions = selected ? byDay[selected] || [] : [];

  return (
    <div className="space-y-3">
      <h2 className="font-bold text-black inline-flex items-center gap-2">
        <CalendarDays className="w-5 h-5" /> {t("cassa_sessions_calendar")}
      </h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: "#059669" }} />
          {t("cassa_session_open")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: "#c4956a" }} />
          {t("cassa_session_closed")}
        </span>
      </div>
      <MonthCalendar
        month={month}
        onMonth={setMonth}
        value={selected}
        onSelect={setSelected}
        markers={markers}
        locale={language}
      />

      {selected && (
        <div className="space-y-2">
          {daySessions.length === 0 ? (
            <p className="text-sm text-black">{t("cassa_cal_day_empty")}</p>
          ) : (
            daySessions.map((s) => {
              const totals = (s.totals || {}) as Partial<SessionSummary>;
              const open = s.status === "open";
              return (
                <div
                  key={s.id}
                  className="rounded-lg border-2 p-3 space-y-1.5 bg-white/60"
                  style={{ borderColor: open ? "#059669" : "#c4956a" }}
                >
                  <p className="text-sm font-bold text-black inline-flex items-center gap-1.5">
                    {open ? (
                      <Unlock className="w-4 h-4" style={{ color: "#059669" }} />
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                    {new Date(s.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" → "}
                    {s.closed_at
                      ? new Date(s.closed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : t("cassa_session_open")}
                    {s.opened_by_name ? ` · ${s.opened_by_name}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-black">
                    <span>
                      {t("cassa_opening_float")}: <b>{fmtEur(s.opening_float)}</b>
                    </span>
                    {!open && (
                      <>
                        <span>
                          {t("cassa_gross")}: <b>{fmtEur(Number(totals.gross) || 0)}</b>
                        </span>
                        <span>
                          {t("cassa_receipts")}: <b>{totals.receipts ?? 0}</b>
                        </span>
                        {s.counted_cash != null && (
                          <span>
                            {t("cassa_counted_cash")}: <b>{fmtEur(s.counted_cash)}</b>
                            {s.cash_difference != null && Math.abs(s.cash_difference) >= 0.005 ? (
                              <b style={{ color: s.cash_difference < 0 ? "#dc2626" : "#d97706" }}>
                                {" "}
                                ({s.cash_difference > 0 ? "+" : ""}
                                {fmtEur(s.cash_difference)})
                              </b>
                            ) : null}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {s.notes ? <p className="text-xs italic text-black">» {s.notes}</p> : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
