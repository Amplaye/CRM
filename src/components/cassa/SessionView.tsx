"use client";

import { useEffect, useState } from "react";
import {
  Euro,
  Lock,
  Unlock,
  AlertTriangle,
  Settings2,
  CheckCircle2,
  History,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { fmtEur, toCents, fromCents, type SessionSummary } from "@/lib/cassa/totals";
import type { CassaSessionRow } from "@/lib/cassa/types";
import { methodLabelKey } from "./PayModal";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

// The cash day, made obvious: a big OPEN/CLOSED state card first, then the live
// numbers, then the close ritual (count the drawer → see the difference live →
// close). When closed, the last closing report stays visible.

const QUICK_FLOATS = [0, 50, 100, 150, 200];

interface SessionViewProps {
  session: CassaSessionRow | null;
  lastSession: CassaSessionRow | null;
  summary: SessionSummary | null;
  coverCharge: number;
  canManage: boolean;
  openOrdersCount: number;
  busy: boolean;
  onOpenSession: (openingFloat: number) => void;
  onCloseSession: (countedCash: number | null, notes: string | null) => void;
  onSaveCoverCharge: (value: number) => void;
}

export function SessionView({
  session,
  lastSession,
  summary,
  coverCharge,
  canManage,
  openOrdersCount,
  busy,
  onOpenSession,
  onCloseSession,
  onSaveCoverCharge,
}: SessionViewProps) {
  const { t } = useLanguage();
  const [floatStr, setFloatStr] = useState("");
  const [countedStr, setCountedStr] = useState("");
  const [notes, setNotes] = useState("");
  const [coverStr, setCoverStr] = useState(coverCharge > 0 ? String(coverCharge) : "");
  // The coperto arrives async from /api/cassa/session — mirror it into the field.
  useEffect(() => {
    setCoverStr(coverCharge > 0 ? String(coverCharge) : "");
  }, [coverCharge]);

  const floatParsed = Number(floatStr.replace(",", "."));
  const floatValue = Number.isFinite(floatParsed) && floatParsed > 0 ? floatParsed : 0;

  const counted = countedStr.trim() === "" ? null : Number(countedStr.replace(",", "."));
  const diff =
    counted != null && Number.isFinite(counted) && summary
      ? fromCents(toCents(counted) - toCents(summary.expectedCash))
      : null;

  const card = (children: React.ReactNode) => (
    <div className="rounded-xl border-2 p-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
      {children}
    </div>
  );

  const kpiTile = (label: string, value: string) => (
    <div key={label} className="rounded-lg border-2 p-2.5 bg-white/60" style={{ borderColor: "#c4956a" }}>
      <p className="text-[11px] font-bold text-black">{label}</p>
      <p className="text-lg font-bold text-black">{value}</p>
    </div>
  );

  const diffBadge = (d: number | null) => {
    if (d == null) return null;
    if (Math.abs(d) < 0.005)
      return (
        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-bold text-white" style={{ background: "#059669" }}>
          <CheckCircle2 className="w-4 h-4" /> {t("cassa_diff_ok")}
        </span>
      );
    if (d < 0)
      return (
        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-bold text-white" style={{ background: "#dc2626" }}>
          <AlertTriangle className="w-4 h-4" /> {t("cassa_diff_short")} {fmtEur(-d)}
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-bold text-white" style={{ background: "#d97706" }}>
        {t("cassa_diff_over")} +{fmtEur(d)}
      </span>
    );
  };

  // Frozen report of the previous day (cassa_sessions.totals snapshot).
  const lastTotals = (lastSession?.totals || null) as Partial<SessionSummary> | null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* --------- open register (day closed) --------- */}
      {session == null && (
        <>
          {card(
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(220,38,38,0.1)" }}>
                  <Lock className="w-5 h-5 text-red-600" />
                </span>
                <div>
                  <h2 className="font-bold text-black">{t("cassa_session_closed")}</h2>
                  <p className="text-sm text-black">{t("cassa_open_session_hint")}</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-black">{t("cassa_opening_float")}</label>
                <p className="text-xs text-black">{t("cassa_opening_float_hint")}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_FLOATS.map((v) => {
                  const active = floatStr.trim() !== "" && floatValue === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setFloatStr(String(v))}
                      className={`h-10 px-3.5 rounded-lg border-2 text-sm font-bold cursor-pointer ${active ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                      style={active ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                    >
                      {v} €
                    </button>
                  );
                })}
              </div>
              <input
                inputMode="decimal"
                value={floatStr}
                onChange={(e) => setFloatStr(e.target.value)}
                placeholder="100.00"
                className="w-full max-w-xs px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
                style={{ borderColor: "#c4956a" }}
              />
              <button
                disabled={busy}
                onClick={() => onOpenSession(floatValue)}
                className="w-full max-w-xs h-12 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                <Unlock className="w-4 h-4" /> {t("cassa_open_session")}
              </button>
            </div>,
          )}

          {card(
            <div className="space-y-3">
              <h2 className="font-bold text-black inline-flex items-center gap-2">
                <History className="w-5 h-5" /> {t("cassa_last_close")}
              </h2>
              {!lastSession || !lastTotals ? (
                <p className="text-sm text-black">{t("cassa_no_last_close")}</p>
              ) : (
                <>
                  <p className="text-sm text-black">
                    {lastSession.closed_at
                      ? new Date(lastSession.closed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                      : "—"}
                    {lastSession.opened_by_name ? ` · ${lastSession.opened_by_name}` : ""}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {kpiTile(t("cassa_gross"), fmtEur(Number(lastTotals.gross) || 0))}
                    {kpiTile(t("cassa_receipts"), String(lastTotals.receipts ?? 0))}
                    {kpiTile(t("cassa_expected_cash"), lastSession.expected_cash != null ? fmtEur(lastSession.expected_cash) : "—")}
                    {kpiTile(t("cassa_counted_cash"), lastSession.counted_cash != null ? fmtEur(lastSession.counted_cash) : "—")}
                  </div>
                  <div>{diffBadge(lastSession.counted_cash != null ? lastSession.cash_difference : null)}</div>
                  {lastSession.notes ? <p className="text-sm italic text-black">» {lastSession.notes}</p> : null}
                </>
              )}
            </div>,
          )}
        </>
      )}

      {/* --------- day running + close ritual (day open) --------- */}
      {session != null && (
        <>
          {card(
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(16,185,129,0.12)" }}>
                  <Unlock className="w-5 h-5" style={{ color: "#059669" }} />
                </span>
                <div>
                  <h2 className="font-bold text-black">{t("cassa_day_running")}</h2>
                  <p className="text-sm text-black">
                    {t("cassa_session_open_since")}{" "}
                    <b>{new Date(session.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b>
                    {session.opened_by_name ? ` · ${session.opened_by_name}` : ""} · {t("cassa_opening_float")}{" "}
                    <b>{fmtEur(session.opening_float)}</b>
                  </p>
                </div>
              </div>
              {summary && (
                <div className="grid grid-cols-3 gap-2">
                  {kpiTile(t("cassa_gross"), fmtEur(summary.gross))}
                  {kpiTile(t("cassa_receipts"), String(summary.receipts))}
                  {kpiTile(t("cassa_expected_cash"), fmtEur(summary.expectedCash))}
                </div>
              )}
              <hr className="border-t-2" style={{ borderColor: "rgba(196,149,106,0.4)" }} />
              <h3 className="font-bold text-black inline-flex items-center gap-2">
                <Lock className="w-4 h-4" /> {t("cassa_close_day")}
              </h3>
              {openOrdersCount > 0 && (
                <p className="text-sm text-black inline-flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#d97706" }} />
                  {t("cassa_close_open_orders_warn").replace("{n}", String(openOrdersCount))}
                </p>
              )}
              {canManage ? (
                <>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="text-xs font-bold text-black">{t("cassa_counted_cash")}</label>
                      <input
                        inputMode="decimal"
                        value={countedStr}
                        onChange={(e) => setCountedStr(e.target.value)}
                        placeholder={summary ? String(summary.expectedCash.toFixed(2)) : "0.00"}
                        className="block w-36 px-3 py-2 text-lg font-bold text-black border-2 rounded-lg bg-white"
                        style={{ borderColor: "#c4956a" }}
                      />
                    </div>
                    {diffBadge(diff)}
                  </div>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("cassa_close_notes_placeholder")}
                    className="w-full px-3 py-2 text-sm text-black border-2 rounded-lg bg-white"
                    style={{ borderColor: "#c4956a" }}
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t("cassa_close_confirm"))) {
                        onCloseSession(
                          counted != null && Number.isFinite(counted) ? counted : null,
                          notes.trim() || null,
                        );
                      }
                    }}
                    className="w-full max-w-xs h-12 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                  >
                    <Lock className="w-4 h-4" /> {t("cassa_close_day")}
                  </button>
                </>
              ) : (
                <p className="text-sm text-black italic">{t("cassa_close_manager_only")}</p>
              )}
            </div>,
          )}

          {/* --------- live summary --------- */}
          {card(
            <div className="space-y-3">
              <h2 className="font-bold text-black inline-flex items-center gap-2">
                <Euro className="w-5 h-5" /> {t("cassa_day_summary")}
              </h2>
              {!summary || (summary.receipts === 0 && summary.voids === 0) ? (
                <p className="text-sm text-black">{t("cassa_no_receipts")}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {kpiTile(t("cassa_gross"), fmtEur(summary.gross))}
                    {kpiTile(t("cassa_receipts"), String(summary.receipts))}
                    {kpiTile(t("cassa_covers"), String(summary.covers))}
                    {kpiTile(t("cassa_avg_receipt"), fmtEur(summary.avgReceipt))}
                  </div>
                  <div className="space-y-1">
                    {Object.entries(summary.byMethod).map(([m, v]) => (
                      <div key={m} className="flex justify-between text-sm text-black">
                        <span>{t(methodLabelKey(m) as keyof Dictionary)}</span>
                        <span className="font-bold">{fmtEur(v as number)}</span>
                      </div>
                    ))}
                    {summary.discounts > 0 && (
                      <div className="flex justify-between text-sm text-black">
                        <span>{t("cassa_discounts_given")}</span>
                        <span className="font-bold">-{fmtEur(summary.discounts)}</span>
                      </div>
                    )}
                    {summary.voids > 0 && (
                      <div className="flex justify-between text-sm text-black">
                        <span>{t("cassa_voided_receipts")}</span>
                        <span className="font-bold">{summary.voids}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>,
          )}
        </>
      )}

      {/* --------- coperto setting --------- */}
      {canManage &&
        card(
          <div className="space-y-2">
            <h2 className="font-bold text-black inline-flex items-center gap-2">
              <Settings2 className="w-5 h-5" /> {t("cassa_cover_setting")}
            </h2>
            <p className="text-sm text-black">{t("cassa_cover_setting_hint")}</p>
            <div className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={coverStr}
                onChange={(e) => setCoverStr(e.target.value)}
                placeholder="2.00"
                className="w-28 px-3 py-2 text-lg font-bold text-black border-2 rounded-lg bg-white"
                style={{ borderColor: "#c4956a" }}
              />
              <span className="text-sm text-black">€ / {t("cassa_per_cover")}</span>
              <button
                disabled={busy}
                onClick={() => {
                  const v = Number(coverStr.replace(",", "."));
                  if (Number.isFinite(v) && v >= 0) onSaveCoverCharge(v);
                }}
                className="px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                {t("cassa_save")}
              </button>
            </div>
          </div>,
        )}
    </div>
  );
}
