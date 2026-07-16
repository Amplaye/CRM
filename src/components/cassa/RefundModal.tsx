"use client";

import { useMemo, useState } from "react";
import { X, Minus, Plus, Undo2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { fmtEur, isActiveLine } from "@/lib/cassa/totals";
import { quoteRefund, type RefundSelection } from "@/lib/cassa/refund";
import type { CassaOrderFull } from "@/lib/cassa/types";

// Il reso parziale, dal punto di vista del cassiere: si scelgono le righe da
// rendere, si scrive il motivo, si conferma.
//
// La cifra mostrata qui NON è la somma dei prezzi di listino: è il preventivo vero,
// calcolato con la stessa funzione che userà il server (quoteRefund). Se lo
// scontrino aveva uno sconto, le righe rese hanno già assorbito la loro quota — su
// un conto scontato del 10%, due birre da 5 € rendono 9 €, non 10. Mostrare 10 e
// restituirne 9 sarebbe un modo per far litigare cassiere e cliente al bancone; e
// mostrare 10 e restituire 10 sarebbe denaro che esce di tasca al ristoratore.
//
// Il residuo non è mai superabile: `alreadyRefunded` è ciò che il registro dice
// essere già stato reso su questo scontrino, e il totale selezionabile si ferma lì.
// Il server ricontrolla comunque sotto lock — questo è solo il freno visibile.

interface RefundModalProps {
  order: CassaOrderFull;
  /** Già reso su questo scontrino (dal registro), in €. */
  alreadyRefunded: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (lines: RefundSelection[], reason: string) => void;
}

export function RefundModal({ order, alreadyRefunded, busy, onClose, onConfirm }: RefundModalProps) {
  const { t } = useLanguage();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");

  const lines = useMemo(() => (order.items || []).filter(isActiveLine), [order.items]);

  const selection: RefundSelection[] = useMemo(
    () => Object.entries(qty).filter(([, q]) => q > 0).map(([line_id, q]) => ({ line_id, qty: q })),
    [qty],
  );

  // Il preventivo: la stessa matematica del server, così il numero sul pulsante è
  // il numero che finirà sullo scontrino di reso.
  const quote = useMemo(() => quoteRefund(order, lines, selection), [order, lines, selection]);
  const refund = -quote.importeTotal;

  const residual = Math.max(0, Math.round((Number(order.total || 0) - alreadyRefunded) * 100) / 100);
  const overResidual = refund > residual + 0.001;
  const canConfirm = !busy && refund > 0 && !overResidual && reason.trim().length > 0;

  const bump = (id: string, max: number, delta: number) =>
    setQty((prev) => {
      const next = Math.min(max, Math.max(0, (prev[id] || 0) + delta));
      return { ...prev, [id]: next };
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border-2 bg-[#faf6f1] max-h-[85dvh] flex flex-col"
        style={{ borderColor: "#c4956a" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b-2" style={{ borderColor: "#c4956a" }}>
          <h2 className="font-bold text-black flex items-center gap-2">
            <Undo2 className="w-4 h-4" /> {t("cassa_refund")}
            {order.receipt_number ? <span className="text-sm font-normal">#{order.receipt_number}</span> : null}
          </h2>
          <button onClick={onClose} className="cursor-pointer text-black hover:opacity-60">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {alreadyRefunded > 0 && (
            <p className="text-xs font-bold text-black">
              {t("cassa_refund_already")}: {fmtEur(alreadyRefunded)} · {t("cassa_refund_residual")}: {fmtEur(residual)}
            </p>
          )}

          <div className="space-y-1.5">
            {lines.map((l) => {
              const picked = qty[l.id] || 0;
              return (
                <div
                  key={l.id}
                  className="flex items-center gap-2 rounded-lg border p-2"
                  style={{ borderColor: "#c4956a", background: picked > 0 ? "rgba(196,149,106,0.15)" : "rgba(255,255,255,0.55)" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-black truncate">{l.name}</p>
                    <p className="text-xs text-black">
                      {l.qty}× {fmtEur(l.unit_price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      disabled={picked <= 0}
                      onClick={() => bump(l.id, l.qty, -1)}
                      className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black disabled:opacity-30 cursor-pointer"
                      style={{ borderColor: "#c4956a" }}
                      aria-label={`${t("cassa_refund")} −`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center font-bold text-black">{picked}</span>
                    <button
                      disabled={picked >= l.qty}
                      onClick={() => bump(l.id, l.qty, +1)}
                      className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black disabled:opacity-30 cursor-pointer"
                      style={{ borderColor: "#c4956a" }}
                      aria-label={`${t("cassa_refund")} +`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("cassa_refund_reason")}
            maxLength={300}
            className="w-full h-11 px-3 rounded-lg border-2 text-black bg-white placeholder:text-black/50"
            style={{ borderColor: "#c4956a" }}
          />

          {overResidual && (
            <p className="text-xs font-bold text-red-600">{t("cassa_refund_exceeds")}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t-2 space-y-2" style={{ borderColor: "#c4956a" }}>
          <div className="flex justify-between font-bold text-black">
            <span>{t("cassa_refund_total")}</span>
            <span>{fmtEur(refund)}</span>
          </div>
          <button
            disabled={!canConfirm}
            onClick={() => onConfirm(selection, reason.trim())}
            className="w-full h-12 rounded-lg bg-red-600 text-white font-bold disabled:opacity-40 cursor-pointer"
          >
            {t("cassa_refund_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
