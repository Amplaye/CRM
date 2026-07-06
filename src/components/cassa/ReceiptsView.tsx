"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Ban, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ReceiptText, CalendarDays, X } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { fmtEur } from "@/lib/cassa/totals";
import type { CassaOrderFull } from "@/lib/cassa/types";
import { methodLabelKey } from "./PayModal";
import { MonthCalendar, monthOf } from "./MonthCalendar";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

// The day's journal (giornale scontrini): every receipt with its number,
// table, payments and state. Reprint anytime; annulment is owner/manager only
// and always keeps the numbered record visible. Past days are reachable with
// the arrows or the calendar (days with receipts are dotted).

interface ReceiptsViewProps {
  tenantId: string;
  receipts: CassaOrderFull[];
  businessDate: string;
  /** The current business day — upper bound for the calendar / next arrow. */
  today: string;
  /** Viewing the current business day (void allowed, "next" arrow disabled). */
  isToday: boolean;
  /** Move the viewed journal day by ±1. */
  onShiftDay: (delta: 1 | -1) => void;
  /** Jump straight to a "YYYY-MM-DD" journal day (from the calendar). */
  onPickDay: (date: string) => void;
  canVoid: boolean;
  busy: boolean;
  onReprint: (order: CassaOrderFull) => void;
  onVoid: (order: CassaOrderFull, reason: string) => void;
}

export function ReceiptsView({ tenantId, receipts, businessDate, today, isToday, onShiftDay, onPickDay, canVoid, busy, onReprint, onVoid }: ReceiptsViewProps) {
  const { t, language } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCal, setShowCal] = useState(false);
  const [calMonth, setCalMonth] = useState(monthOf(businessDate || today));
  // Days of the visible month that actually have receipts → calendar dots.
  const [receiptDays, setReceiptDays] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!showCal || !tenantId) return;
    let cancelled = false;
    (async () => {
      const [y, m] = calMonth.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from("cassa_orders")
        .select("receipt_date")
        .eq("tenant_id", tenantId)
        .gte("receipt_date", `${calMonth}-01`)
        .lte("receipt_date", `${calMonth}-${String(lastDay).padStart(2, "0")}`)
        .not("receipt_date", "is", null);
      if (cancelled) return;
      const days: Record<string, string> = {};
      for (const r of (data || []) as Array<{ receipt_date: string }>) {
        days[r.receipt_date] = "#c4956a";
      }
      setReceiptDays(days);
    })();
    return () => {
      cancelled = true;
    };
  }, [showCal, calMonth, supabase, tenantId]);

  return (
    <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
      <div className="px-4 py-3 border-b-2 flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
        <ReceiptText className="w-5 h-5 text-black" />
        <h2 className="font-bold text-black flex-1">
          {t("cassa_receipts_today")} · {businessDate.split("-").reverse().join("/")}
        </h2>
        {/* Day navigation: consult past journals (re-print an old receipt for a
            customer). Void stays possible only on the current day. */}
        <button
          onClick={() => {
            setCalMonth(monthOf(businessDate || today));
            setShowCal(true);
          }}
          className="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-black hover:bg-[#c4956a]/10 cursor-pointer"
          style={{ borderColor: "#c4956a" }}
          title={t("cassa_pick_day")}
          aria-label={t("cassa_pick_day")}
        >
          <CalendarDays className="w-4 h-4" />
        </button>
        <button
          onClick={() => onShiftDay(-1)}
          className="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-black hover:bg-[#c4956a]/10 cursor-pointer"
          style={{ borderColor: "#c4956a" }}
          aria-label="previous day"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onShiftDay(1)}
          disabled={isToday}
          className="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-black hover:bg-[#c4956a]/10 disabled:opacity-30 cursor-pointer"
          style={{ borderColor: "#c4956a" }}
          aria-label="next day"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {receipts.length === 0 ? (
        <p className="text-center text-sm text-black py-10">{t("cassa_no_receipts")}</p>
      ) : (
        <div className="divide-y" style={{ borderColor: "#c4956a" }}>
          {receipts.map((r) => {
            const expanded = openId === r.id;
            return (
              <div key={r.id} className={r.status === "void" ? "opacity-60" : ""}>
                <button
                  onClick={() => setOpenId(expanded ? null : r.id)}
                  className="w-full px-4 py-2.5 flex items-center gap-3 text-left cursor-pointer hover:bg-[#c4956a]/10"
                >
                  <span className="font-bold text-black w-12 sm:w-20 shrink-0 truncate">
                    {r.receipt_number ? `#${r.receipt_number}` : "—"}
                  </span>
                  <span className="text-sm text-black w-12 sm:w-14 shrink-0">
                    {r.closed_at ? new Date(r.closed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                  <span className="text-sm text-black flex-1 truncate">{r.table_name}</span>
                  {r.status === "void" && (
                    <span className="text-[11px] font-bold text-red-600 border border-red-600 rounded px-1.5 py-0.5">
                      {t("cassa_voided")}
                    </span>
                  )}
                  <span className="font-bold text-black">{fmtEur(r.total)}</span>
                  {expanded ? <ChevronUp className="w-4 h-4 text-black" /> : <ChevronDown className="w-4 h-4 text-black" />}
                </button>

                {expanded && (
                  <div className="px-4 pb-3 space-y-2">
                    <div className="rounded-lg border p-2.5 space-y-1" style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.55)" }}>
                      {r.items
                        .filter((i) => i.status !== "cancelled")
                        .map((i) => (
                          <div key={i.id} className="flex justify-between text-sm text-black">
                            <span>
                              {i.qty}× {i.name}
                            </span>
                            <span>{fmtEur(i.qty * i.unit_price)}</span>
                          </div>
                        ))}
                      {(r.payments || []).length > 0 && (
                        <div className="pt-1 mt-1 border-t border-dashed" style={{ borderColor: "#c4956a" }}>
                          {(r.payments || []).map((p) => (
                            <div key={p.id} className="flex justify-between text-xs text-black">
                              <span>{t(methodLabelKey(p.method) as keyof Dictionary)}</span>
                              <span>{fmtEur(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {r.status === "void" && r.void_reason && (
                        <p className="text-xs text-red-600 italic">
                          {t("cassa_void_reason")}: {r.void_reason}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onReprint(r)}
                        className="h-10 px-3 rounded-lg border-2 text-xs font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer inline-flex items-center gap-1.5"
                        style={{ borderColor: "#c4956a" }}
                      >
                        <Printer className="w-3.5 h-3.5" /> {t("cassa_print_receipt")}
                      </button>
                      {canVoid && r.status === "paid" && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt(t("cassa_void_prompt"));
                            if (reason && reason.trim()) onVoid(r, reason.trim());
                          }}
                          className="h-10 px-3 rounded-lg border-2 border-red-600 text-xs font-bold text-red-600 hover:bg-red-600/10 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" /> {t("cassa_void")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowCal(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border-2 p-4 space-y-2 max-h-[85dvh] overflow-y-auto"
            style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-black inline-flex items-center gap-2">
                <CalendarDays className="w-4 h-4" /> {t("cassa_pick_day")}
              </h3>
              <button onClick={() => setShowCal(false)} className="p-1.5 rounded-lg hover:bg-[#c4956a]/10 cursor-pointer" aria-label="Close">
                <X className="w-5 h-5 text-black" />
              </button>
            </div>
            <MonthCalendar
              month={calMonth}
              onMonth={setCalMonth}
              value={businessDate}
              onSelect={(d) => {
                setShowCal(false);
                onPickDay(d);
              }}
              markers={receiptDays}
              maxDate={today}
              locale={language}
            />
          </div>
        </div>
      )}
    </div>
  );
}
