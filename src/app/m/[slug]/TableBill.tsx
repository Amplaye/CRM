"use client";

// Pay-at-table sheet, rendered on /m/<slug>?table=<id> when the tenant has
// qr_pay_enabled. A floating "bill" pill opens a bottom sheet that shows the
// table's LIVE bill (server-derived — /api/public/table-bill) and a pay button
// that hands off to Stripe Checkout on the venue's own account. Coming back
// from Stripe (?pay=success&cs=…) the sheet auto-opens and calls the confirm
// endpoint, which verifies the session against Stripe and closes the bill at
// the till; the guest sees the receipt number.
//
// Works overlaid on BOTH menu modes (self-order UI and the showcase
// templates) — it owns nothing of the menu, only the bill.

import { useCallback, useEffect, useRef, useState } from "react";

export type TableBillStrings = {
  billButton: string;
  billTitle: string;
  loading: string;
  noBill: string;
  covers: string;
  discount: string;
  total: string;
  pay: string;
  redirecting: string;
  notPayableStripe: string;
  notPayableClosed: string;
  confirming: string;
  paidTitle: string;
  paidBody: string;
  receipt: string;
  mismatchBody: string;
  alreadyClosedBody: string;
  needsStaffBody: string;
  unpaidBody: string;
  cancelledNote: string;
  genericError: string;
  close: string;
  refresh: string;
};

type BillLine = { name: string; qty: number; unit_price: number; variants: string[] };
type Bill = {
  payable: boolean;
  reason?: string;
  order?: {
    items: BillLine[];
    covers: number;
    cover_total: number;
    discount: number;
    subtotal: number;
    total: number;
  };
};

const ACCENT = "var(--accent, #b45309)";
const euro = (n: number) => `€ ${n.toFixed(2)}`;

export default function TableBill({
  slug,
  tableId,
  strings: s,
  initialSessionId,
  initialCancelled,
}: {
  slug: string;
  tableId: string;
  strings: TableBillStrings;
  /** Set when returning from Stripe (?pay=success&cs=…): auto-open + confirm. */
  initialSessionId?: string;
  /** Set when returning via ?pay=cancel. */
  initialCancelled?: boolean;
}) {
  const [open, setOpen] = useState(!!initialSessionId || !!initialCancelled);
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirm outcome takes over the whole sheet when present.
  const [outcome, setOutcome] = useState<
    | null
    | { kind: "confirming" }
    | { kind: "settled"; receipt: string; total: number }
    | { kind: "amount_mismatch" }
    | { kind: "already_closed" }
    | { kind: "needs_staff" }
    | { kind: "unpaid" }
  >(initialSessionId ? { kind: "confirming" } : null);
  const confirmedRef = useRef(false);

  const loadBill = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/public/table-bill?slug=${encodeURIComponent(slug)}&table_id=${encodeURIComponent(tableId)}`,
      );
      const data = await res.json();
      if (res.ok) setBill(data as Bill);
      else if (data?.error === "qr_pay_disabled") setBill(null);
      else setError(s.genericError);
    } catch {
      setError(s.genericError);
    } finally {
      setLoading(false);
    }
  }, [slug, tableId, s.genericError]);

  // Return from Stripe: verify + settle exactly once (the endpoint is
  // idempotent anyway; the ref only avoids a double POST from strict mode).
  useEffect(() => {
    if (!initialSessionId || confirmedRef.current) return;
    confirmedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/public/table-pay/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, session_id: initialSessionId }),
        });
        const data = await res.json();
        // Drop ?pay&cs from the URL so a refresh shows the menu, not a re-confirm.
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("pay");
          url.searchParams.delete("cs");
          window.history.replaceState(null, "", url.toString());
        } catch {
          /* cosmetic only */
        }
        if (data?.status === "settled") {
          setOutcome({
            kind: "settled",
            receipt: data.receipt_number != null ? `${data.receipt_number}/${data.receipt_year}` : "—",
            total: Number(data.total) || 0,
          });
        } else if (data?.status === "amount_mismatch") setOutcome({ kind: "amount_mismatch" });
        else if (data?.status === "already_closed") setOutcome({ kind: "already_closed" });
        else if (data?.status === "unpaid") setOutcome({ kind: "unpaid" });
        else setOutcome({ kind: "needs_staff" });
      } catch {
        // Money may be captured: never claim failure — route the guest to staff.
        setOutcome({ kind: "needs_staff" });
      }
    })();
  }, [initialSessionId, slug]);

  useEffect(() => {
    if (open && !outcome) void loadBill();
  }, [open, outcome, loadBill]);

  const pay = async () => {
    if (paying) return;
    setPaying(true);
    setError(null);
    try {
      const res = await fetch("/api/public/table-pay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, table_id: tableId }),
      });
      const data = await res.json();
      if (res.ok && data?.url) {
        window.location.href = data.url;
        return; // keep the spinner while the browser navigates
      }
      if (data?.error === "no_stripe") setError(s.notPayableStripe);
      else if (data?.error === "cassa_closed") setError(s.notPayableClosed);
      else if (data?.error === "no_order") {
        setError(null);
        await loadBill();
      } else setError(s.genericError);
      setPaying(false);
    } catch {
      setError(s.genericError);
      setPaying(false);
    }
  };

  const order = bill?.order;
  const hasBill = !!order && order.total > 0;

  return (
    <>
      {/* Floating bill pill — top-right, clear of the cart bar at the bottom.
          In self-order mode OrderLayer renders a sticky table bar across that
          same strip, so we sit just below it (--ol-topbar-h, 0 when absent)
          instead of being hidden underneath it. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-3 z-40 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-bold text-white shadow-lg cursor-pointer"
          style={{ background: ACCENT, top: "calc(0.75rem + var(--ol-topbar-h, 0px))" }}
        >
          <span aria-hidden>🧾</span> {s.billButton}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" style={{ fontFamily: "var(--font-body)" }}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div
            className="relative bg-white rounded-t-3xl max-h-[85dvh] flex flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-stone-100">
              <h2 className="text-lg font-bold text-stone-900" style={{ fontFamily: "var(--font-display)" }}>
                {s.billTitle}
              </h2>
              <button onClick={() => setOpen(false)} className="text-stone-400 text-2xl leading-none cursor-pointer" aria-label={s.close}>
                ×
              </button>
            </div>

            {/* ── Confirm outcome (return from Stripe) ── */}
            {outcome ? (
              <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
                {outcome.kind === "confirming" && (
                  <>
                    <div className="h-8 w-8 rounded-full border-2 border-stone-200 animate-spin" style={{ borderTopColor: ACCENT }} />
                    <p className="text-sm text-stone-600">{s.confirming}</p>
                  </>
                )}
                {outcome.kind === "settled" && (
                  <>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl" style={{ background: ACCENT }}>✓</div>
                    <h3 className="text-xl font-bold text-stone-900" style={{ fontFamily: "var(--font-display)" }}>{s.paidTitle}</h3>
                    <p className="text-sm text-stone-600 max-w-xs">{s.paidBody}</p>
                    <p className="text-sm font-semibold text-stone-900">
                      {s.receipt} {outcome.receipt} · {euro(outcome.total)}
                    </p>
                  </>
                )}
                {outcome.kind === "amount_mismatch" && <p className="text-sm text-stone-700 max-w-xs">{s.mismatchBody}</p>}
                {outcome.kind === "already_closed" && <p className="text-sm text-stone-700 max-w-xs">{s.alreadyClosedBody}</p>}
                {outcome.kind === "needs_staff" && <p className="text-sm text-stone-700 max-w-xs">{s.needsStaffBody}</p>}
                {outcome.kind === "unpaid" && (
                  <>
                    <p className="text-sm text-stone-700 max-w-xs">{s.unpaidBody}</p>
                    <button
                      onClick={() => setOutcome(null)}
                      className="mt-2 px-5 py-2.5 rounded-full text-white text-sm font-semibold cursor-pointer"
                      style={{ background: ACCENT }}
                    >
                      {s.refresh}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                {initialCancelled && <p className="px-5 pt-3 text-[13px] text-stone-500">{s.cancelledNote}</p>}

                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {loading && <p className="text-sm text-stone-500 py-8 text-center">{s.loading}</p>}
                  {!loading && !hasBill && !error && (
                    <p className="text-sm text-stone-500 py-8 text-center">{s.noBill}</p>
                  )}
                  {!loading && hasBill && (
                    <div className="space-y-2.5">
                      {order!.items.map((l, i) => (
                        <div key={i} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[14.5px] text-stone-900 leading-snug">
                              <span className="font-semibold tabular-nums">{l.qty}×</span> {l.name}
                            </p>
                            {l.variants.length > 0 && (
                              <p className="text-[12px] text-stone-500">{l.variants.join(", ")}</p>
                            )}
                          </div>
                          <p className="text-[14px] font-semibold text-stone-900 tabular-nums shrink-0">
                            {euro(l.unit_price * l.qty)}
                          </p>
                        </div>
                      ))}
                      {order!.cover_total > 0 && (
                        <div className="flex items-center justify-between text-[13.5px] text-stone-600">
                          <span>{s.covers} ×{order!.covers}</span>
                          <span className="tabular-nums">{euro(order!.cover_total)}</span>
                        </div>
                      )}
                      {order!.discount > 0 && (
                        <div className="flex items-center justify-between text-[13.5px] text-stone-600">
                          <span>{s.discount}</span>
                          <span className="tabular-nums">−{euro(order!.discount)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
                  {!loading && bill && !bill.payable && hasBill && !error && (
                    <p className="text-[13px] text-stone-500 mt-4">
                      {bill.reason === "cassa_closed" ? s.notPayableClosed : bill.reason === "no_stripe" ? s.notPayableStripe : null}
                    </p>
                  )}
                </div>

                {hasBill && (
                  <div className="px-5 py-4 border-t border-stone-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-stone-500">{s.total}</span>
                      <span className="text-xl font-bold text-stone-900 tabular-nums">{euro(order!.total)}</span>
                    </div>
                    <button
                      onClick={pay}
                      disabled={paying || !bill!.payable}
                      className="w-full py-3.5 rounded-2xl text-white font-bold cursor-pointer disabled:opacity-60"
                      style={{ background: ACCENT }}
                    >
                      {paying ? s.redirecting : `${s.pay} · ${euro(order!.total)}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
