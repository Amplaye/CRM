"use client";

import { useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmtEur, type CassaTotals } from "@/lib/cassa/totals";

// Browser-print rendering for the three cassa documents: comanda (kitchen
// ticket, no prices), preconto and scontrino (non-fiscal courtesy receipt).
// 72mm column → prints correctly on an 80mm thermal roll AND as a narrow
// column on A4. The `visibility` trick hides the whole app during print
// without disturbing its layout; the sheet itself is display:none on screen.
//
// Fiscal note: the printed receipt is explicitly marked "DOCUMENTO GESTIONALE
// — NON FISCALE". The legal receipt must come from a certified RT device; this
// print is the management copy (and the RT bridge is a future adapter).

export interface PrintLine {
  qty: number;
  name: string;
  notes?: string | null;
  course?: number;
  total?: number; // omitted on comande — the kitchen doesn't need prices
}

export type PrintPayload =
  | {
      kind: "comanda";
      venue: string;
      tableLabel: string;
      when: string;
      comandaNo: number | null;
      covers?: number;
      courses: Array<{ course: number; lines: PrintLine[] }>;
    }
  | {
      kind: "bill";
      variant: "preconto" | "scontrino";
      venue: string;
      tableLabel: string;
      when: string;
      covers: number;
      lines: PrintLine[];
      totals: CassaTotals;
      receipt?: { number: number | null; year: number | null } | null;
      payments?: Array<{ method: string; amount: number; received?: number | null }>;
      change?: number;
    };

const METHOD_KEYS: Record<string, string> = {
  cash: "cassa_method_cash",
  card: "cassa_method_card",
  online: "cassa_method_online",
  meal_voucher: "cassa_method_voucher",
  bank_transfer: "cassa_method_bank",
  other: "cassa_method_other",
};

export function PrintSheet({ payload, onDone }: { payload: PrintPayload | null; onDone: () => void }) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!payload) return;
    // Let the sheet paint before the (blocking) system dialog opens.
    const timer = setTimeout(() => {
      window.print();
      onDone();
    }, 80);
    return () => clearTimeout(timer);
  }, [payload, onDone]);

  if (!payload) return null;

  const sep = <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />;

  return (
    <div className="cassa-print" aria-hidden="true">
      <style>{`
        .cassa-print { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .cassa-print, .cassa-print * { visibility: visible !important; }
          .cassa-print {
            display: block !important;
            position: absolute; left: 0; top: 0;
            width: 72mm; padding: 2mm;
            background: #fff; color: #000;
            font-family: "Courier New", ui-monospace, monospace;
            font-size: 12px; line-height: 1.35;
          }
          @page { margin: 4mm; }
        }
      `}</style>

      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 14 }}>{payload.venue}</div>

      {payload.kind === "comanda" ? (
        <>
          <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0" }}>
            {t("cassa_comanda").toUpperCase()}
            {payload.comandaNo ? ` #${payload.comandaNo}` : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{payload.tableLabel}</span>
            <span>{payload.when}</span>
          </div>
          {payload.covers ? <div>{t("cassa_covers")}: {payload.covers}</div> : null}
          {sep}
          {payload.courses.map((g) => (
            <div key={g.course} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>— {t("cassa_course")} {g.course} —</div>
              {g.lines.map((l, i) => (
                <div key={i}>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 700 }}>{l.qty}×</span> {l.name}
                  </div>
                  {l.notes ? <div style={{ paddingLeft: 14, fontStyle: "italic" }}>» {l.notes}</div> : null}
                </div>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          <div style={{ textAlign: "center", margin: "4px 0", fontWeight: 700 }}>
            {payload.variant === "preconto"
              ? t("cassa_preconto").toUpperCase()
              : `${t("cassa_receipt").toUpperCase()}${
                  payload.receipt?.number ? ` N. ${payload.receipt.number}/${payload.receipt.year}` : ""
                }`}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{payload.tableLabel}</span>
            <span>{payload.when}</span>
          </div>
          {payload.covers > 0 ? <div>{t("cassa_covers")}: {payload.covers}</div> : null}
          {sep}
          {payload.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              <span style={{ flex: 1 }}>
                {l.qty}× {l.name}
              </span>
              <span>{l.total != null ? fmtEur(l.total) : ""}</span>
            </div>
          ))}
          {sep}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{t("cassa_subtotal")}</span>
            <span>{fmtEur(payload.totals.subtotal)}</span>
          </div>
          {payload.totals.coverTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{t("cassa_cover_charge")}</span>
              <span>{fmtEur(payload.totals.coverTotal)}</span>
            </div>
          )}
          {payload.totals.discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{t("cassa_discount")}</span>
              <span>-{fmtEur(payload.totals.discountAmount)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, marginTop: 2 }}>
            <span>{t("cassa_total").toUpperCase()}</span>
            <span>{fmtEur(payload.totals.total)}</span>
          </div>
          {payload.payments && payload.payments.length > 0 && (
            <>
              {sep}
              {payload.payments.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{t(METHOD_KEYS[p.method] as keyof Dictionary) || p.method}</span>
                  <span>{fmtEur(p.amount)}</span>
                </div>
              ))}
              {payload.change != null && payload.change > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                  <span>{t("cassa_change")}</span>
                  <span>{fmtEur(payload.change)}</span>
                </div>
              )}
            </>
          )}
          {sep}
          <div style={{ textAlign: "center", fontWeight: 700, marginTop: 4 }}>
            {t("cassa_print_nonfiscal")}
          </div>
          <div style={{ textAlign: "center", marginTop: 2 }}>{t("cassa_print_thanks")}</div>
        </>
      )}
    </div>
  );
}
