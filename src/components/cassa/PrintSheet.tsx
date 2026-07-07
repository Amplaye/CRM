"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmtEur, type CassaTotals, type VatLine } from "@/lib/cassa/totals";

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
  /** Chosen variant names ("Doppia porzione"…), printed indented under the line. */
  variants?: string[];
  total?: number; // omitted on comande — the kitchen doesn't need prices
}

export type PrintPayload =
  | {
      kind: "comanda";
      venue: string;
      tableLabel: string;
      when: string;
      comandaNo: number | null;
      /** Prep station (reparto) this sheet is for — printed big so the right
       * printer/counter grabs it; null = single sheet for everything. */
      station?: string | null;
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
      /** Scorporo IVA per rate — printed on the scontrino only. */
      vat?: VatLine[];
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

const STATION_KEYS: Record<string, keyof Dictionary> = {
  cucina: "cassa_station_cucina",
  bar: "cassa_station_bar",
  pizzeria: "cassa_station_pizzeria",
};

export function PrintSheet({ payload, onDone }: { payload: PrintPayload | null; onDone: () => void }) {
  const { t } = useLanguage();
  // Portal the sheet to <body> so it's a DIRECT body child. That lets the print
  // CSS `display:none` every OTHER body child (the whole app shell) and leave a
  // single short page — instead of nesting the sheet deep inside the tall,
  // height-capped dashboard shell where it printed 11 ghost pages on mobile.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  useEffect(() => {
    if (!payload) return;
    let done = false;
    // On desktop window.print() BLOCKS, so calling onDone() right after is fine.
    // On mobile it's ASYNC — returning immediately and unmounting the sheet
    // (display:none) races the print render and the page comes out blank. So we
    // wait for the dialog to close (afterprint, or a focus/visibility fallback
    // for browsers that don't fire it) before popping this sheet off the queue.
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      onDone();
    };
    const onAfterPrint = () => finish();
    const onFocus = () => setTimeout(finish, 100);
    const onVisible = () => {
      if (document.visibilityState === "visible") setTimeout(finish, 100);
    };
    const cleanup = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Let the sheet paint before the (possibly blocking) system dialog opens.
    const timer = setTimeout(() => {
      window.addEventListener("afterprint", onAfterPrint);
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisible);
      window.print();
      // Safety net: if no close event ever fires, don't strand the queue.
      setTimeout(finish, 60000);
    }, 120);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [payload, onDone]);

  if (!payload || !host) return null;

  const sep = <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />;

  return createPortal(
    <div className="cassa-print" aria-hidden="true">
      <style>{`
        .cassa-print { display: none; }
        @media print {
          /* Collapse the ENTIRE app to zero layout — display:none, not
             visibility:hidden. A hidden element still occupies its full box, so
             the tall app shell (menu grid + ticket) spanned ~11 printed pages of
             ghost/blank content on mobile. display:none removes it from flow, so
             the receipt is the only thing on the page → exactly one page. */
          body > *:not(.cassa-print) { display: none !important; }
          /* The sheet flows in normal (static) position, so the browser
             paginates ONE short page around it and a tall bill can spill onto a
             second page instead of being clipped. */
          .cassa-print, .cassa-print * { visibility: visible !important; }
          .cassa-print {
            display: block !important;
            position: static !important;
            width: 72mm; margin: 0 auto; padding: 2mm;
            background: #fff; color: #000;
            font-family: "Courier New", ui-monospace, monospace;
            font-size: 12px; line-height: 1.35;
          }
          @page { margin: 4mm; size: 72mm auto; }
        }
      `}</style>

      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 14 }}>{payload.venue}</div>

      {payload.kind === "comanda" ? (
        <>
          <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0" }}>
            {t("cassa_comanda").toUpperCase()}
            {payload.comandaNo ? ` #${payload.comandaNo}` : ""}
          </div>
          {payload.station ? (
            <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, margin: "2px 0", border: "1px solid #000", padding: "1px 0" }}>
              {(STATION_KEYS[payload.station] ? t(STATION_KEYS[payload.station]) : payload.station).toUpperCase()}
            </div>
          ) : null}
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
                  {(l.variants || []).map((v, j) => (
                    <div key={j} style={{ paddingLeft: 14 }}>+ {v}</div>
                  ))}
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
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                <span style={{ flex: 1 }}>
                  {l.qty}× {l.name}
                </span>
                <span>{l.total != null ? fmtEur(l.total) : ""}</span>
              </div>
              {(l.variants || []).map((v, j) => (
                <div key={j} style={{ paddingLeft: 14, fontSize: 11 }}>+ {v}</div>
              ))}
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
          {payload.vat && payload.vat.length > 0 && (
            <>
              {sep}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700 }}>
                <span style={{ width: "28%" }}>{t("cassa_vat")}</span>
                <span style={{ width: "36%", textAlign: "right" }}>{t("cassa_vat_taxable")}</span>
                <span style={{ width: "36%", textAlign: "right" }}>{t("cassa_vat_tax")}</span>
              </div>
              {payload.vat.map((v, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ width: "28%" }}>{v.rate}%</span>
                  <span style={{ width: "36%", textAlign: "right" }}>{fmtEur(v.net)}</span>
                  <span style={{ width: "36%", textAlign: "right" }}>{fmtEur(v.tax)}</span>
                </div>
              ))}
            </>
          )}
          {sep}
          <div style={{ textAlign: "center", fontWeight: 700, marginTop: 4 }}>
            {t("cassa_print_nonfiscal")}
          </div>
          <div style={{ textAlign: "center", marginTop: 2 }}>{t("cassa_print_thanks")}</div>
        </>
      )}
    </div>,
    host,
  );
}
