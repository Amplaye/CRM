"use client";

import { useEffect, useState } from "react";
import { Euro, Lock, Unlock, AlertTriangle, Settings2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { fmtEur, toCents, fromCents, type SessionSummary } from "@/lib/cassa/totals";
import type { CassaSessionRow } from "@/lib/cassa/types";
import { methodLabelKey } from "./PayModal";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

// Daily cash session: open with a float, watch the live totals, count the
// drawer, close the day. The frozen summary lands in cassa_sessions.totals.

interface SessionViewProps {
  session: CassaSessionRow | null;
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* --------- session state / open / close --------- */}
      {card(
        session == null ? (
          <div className="space-y-3">
            <h2 className="font-bold text-black inline-flex items-center gap-2">
              <Unlock className="w-5 h-5" /> {t("cassa_open_session")}
            </h2>
            <p className="text-sm text-black">{t("cassa_open_session_hint")}</p>
            <div>
              <label className="text-xs font-bold text-black">{t("cassa_opening_float")}</label>
              <input
                inputMode="decimal"
                value={floatStr}
                onChange={(e) => setFloatStr(e.target.value)}
                placeholder="100.00"
                className="w-full max-w-xs px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
                style={{ borderColor: "#c4956a" }}
              />
            </div>
            <button
              disabled={busy}
              onClick={() => {
                const v = Number(floatStr.replace(",", "."));
                onOpenSession(Number.isFinite(v) && v > 0 ? v : 0);
              }}
              className="px-5 py-2.5 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {t("cassa_open_session")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="font-bold text-black inline-flex items-center gap-2">
              <Lock className="w-5 h-5" /> {t("cassa_close_day")}
            </h2>
            <p className="text-sm text-black">
              {t("cassa_session_open_since")}{" "}
              <b>
                {new Date(session.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </b>
              {session.opened_by_name ? ` · ${session.opened_by_name}` : ""} · {t("cassa_opening_float")}{" "}
              <b>{fmtEur(session.opening_float)}</b>
            </p>
            {openOrdersCount > 0 && (
              <p className="text-sm text-black inline-flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-terracotta-500" />
                {t("cassa_close_open_orders_warn").replace("{n}", String(openOrdersCount))}
              </p>
            )}
            {canManage ? (
              <>
                <div className="flex gap-3 flex-wrap">
                  <div>
                    <label className="text-xs font-bold text-black">{t("cassa_expected_cash")}</label>
                    <p className="text-lg font-bold text-black">{summary ? fmtEur(summary.expectedCash) : "—"}</p>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-black">{t("cassa_counted_cash")}</label>
                    <input
                      inputMode="decimal"
                      value={countedStr}
                      onChange={(e) => setCountedStr(e.target.value)}
                      placeholder="0.00"
                      className="block w-36 px-3 py-2 text-lg font-bold text-black border-2 rounded-lg bg-white"
                      style={{ borderColor: "#c4956a" }}
                    />
                  </div>
                  {diff != null && (
                    <div>
                      <label className="text-xs font-bold text-black">{t("cassa_difference")}</label>
                      <p className={`text-lg font-bold ${Math.abs(diff) < 0.005 ? "text-olive-700" : "text-red-600"}`}>
                        {diff > 0 ? "+" : ""}
                        {fmtEur(diff)}
                      </p>
                    </div>
                  )}
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
                  className="px-5 py-2.5 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer"
                  style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                >
                  {t("cassa_close_day")}
                </button>
              </>
            ) : (
              <p className="text-sm text-black italic">{t("cassa_close_manager_only")}</p>
            )}
          </div>
        ),
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
                {[
                  { label: t("cassa_gross"), value: fmtEur(summary.gross) },
                  { label: t("cassa_receipts"), value: String(summary.receipts) },
                  { label: t("cassa_covers"), value: String(summary.covers) },
                  { label: t("cassa_avg_receipt"), value: fmtEur(summary.avgReceipt) },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-lg border-2 p-2.5 bg-white/60" style={{ borderColor: "#c4956a" }}>
                    <p className="text-[11px] font-bold text-black">{kpi.label}</p>
                    <p className="text-lg font-bold text-black">{kpi.value}</p>
                  </div>
                ))}
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
