"use client";

import { useMemo, useState } from "react";
import { Banknote, CreditCard, Ticket, Landmark, Globe, CircleDollarSign, X, Users, Printer, Check } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import {
  fmtEur,
  toCents,
  fromCents,
  changeDue,
  splitEqual,
  remainingDue,
  type CassaPaymentMethod,
} from "@/lib/cassa/totals";

// Payment sheet: one-tap full settle (cash with change calculator, card), or
// split payments (mixed methods / alla romana) that accumulate until the
// remaining hits zero. On success shows the change big and offers the receipt
// print — the two things a busy waiter actually needs to see.

export interface PayEntry {
  method: CassaPaymentMethod;
  amount: number;
  received?: number | null;
}

const METHODS: Array<{ id: CassaPaymentMethod; icon: typeof Banknote; labelKey: string }> = [
  { id: "cash", icon: Banknote, labelKey: "cassa_method_cash" },
  { id: "card", icon: CreditCard, labelKey: "cassa_method_card" },
  { id: "meal_voucher", icon: Ticket, labelKey: "cassa_method_voucher" },
  { id: "online", icon: Globe, labelKey: "cassa_method_online" },
  { id: "bank_transfer", icon: Landmark, labelKey: "cassa_method_bank" },
  { id: "other", icon: CircleDollarSign, labelKey: "cassa_method_other" },
];

export function methodLabelKey(method: string): string {
  return METHODS.find((m) => m.id === method)?.labelKey || "cassa_method_other";
}

interface PayModalProps {
  total: number;
  busy: boolean;
  /** After a successful charge: set to show the closing screen. */
  result: { receiptNumber: number | null; receiptYear: number | null; change: number } | null;
  onConfirm: (payments: PayEntry[]) => void;
  onPrintReceipt: () => void;
  onClose: () => void;
}

export function PayModal({ total, busy, result, onConfirm, onPrintReceipt, onClose }: PayModalProps) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<PayEntry[]>([]);
  const [method, setMethod] = useState<CassaPaymentMethod>("cash");
  const [amountStr, setAmountStr] = useState("");
  const [receivedStr, setReceivedStr] = useState("");
  const [splitParts, setSplitParts] = useState(0);

  const remaining = useMemo(() => remainingDue(total, entries), [total, entries]);
  const parsedAmount = Number(amountStr.replace(",", "."));
  const parsedReceived = Number(receivedStr.replace(",", "."));
  const received = receivedStr.trim() !== "" && Number.isFinite(parsedReceived) ? parsedReceived : null;

  // The amount field pre-fills with what's left, so the fast path stays one tap.
  const effectiveAmount =
    amountStr.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0
      ? fromCents(toCents(parsedAmount))
      : remaining;

  const change = method === "cash" && received != null ? changeDue(received, effectiveAmount) : 0;

  const addEntry = () => {
    if (effectiveAmount <= 0 || busy) return;
    const amount = Math.min(effectiveAmount, remaining);
    if (amount <= 0) return;
    const entry: PayEntry = {
      method,
      amount,
      received: method === "cash" && received != null ? received : null,
    };
    const next = [...entries, entry];
    if (remainingDue(total, next) === 0) {
      onConfirm(next);
      setEntries(next);
    } else {
      setEntries(next);
      setAmountStr("");
      setReceivedStr("");
    }
  };

  const splitAmounts = splitParts >= 2 ? splitEqual(total, splitParts) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={result ? undefined : onClose}>
      <div
        className="w-full max-w-md rounded-2xl border-2 shadow-xl overflow-hidden"
        style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
        onClick={(e) => e.stopPropagation()}
      >
        {result ? (
          // ---- success screen -------------------------------------------------
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
              <Check className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-black">
                {t("cassa_paid_ok")}
                {result.receiptNumber ? ` — ${t("cassa_receipt")} N. ${result.receiptNumber}/${result.receiptYear}` : ""}
              </p>
              {result.change > 0 && (
                <p className="mt-3 text-black">
                  {t("cassa_change")}
                  <span className="block text-4xl font-bold">{fmtEur(result.change)}</span>
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={onPrintReceipt}
                className="px-4 py-2.5 text-sm font-bold rounded-lg border-2 cursor-pointer text-black hover:bg-[#c4956a]/10 inline-flex items-center gap-2"
                style={{ borderColor: "#c4956a" }}
              >
                <Printer className="w-4 h-4" /> {t("cassa_print_receipt")}
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2.5 text-white text-sm font-bold rounded-lg cursor-pointer"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                {t("cassa_done")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b-2" style={{ borderColor: "#c4956a" }}>
              <h3 className="font-bold text-black">{t("cassa_charge")}</h3>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#c4956a]/10 cursor-pointer">
                <X className="w-5 h-5 text-black" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-center">
                <p className="text-sm text-black">{entries.length > 0 ? t("cassa_remaining") : t("cassa_total")}</p>
                <p className="text-4xl font-bold text-black">{fmtEur(remaining)}</p>
                {entries.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {entries.map((e, i) => (
                      <p key={i} className="text-xs text-black">
                        ✓ {t(methodLabelKey(e.method) as keyof Dictionary)} · {fmtEur(e.amount)}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Split alla romana — informational helper */}
              <div className="flex items-center justify-center gap-2">
                <Users className="w-4 h-4 text-black" />
                <span className="text-sm text-black">{t("cassa_split")}</span>
                {[0, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSplitParts(n)}
                    className={`h-8 min-w-8 px-2 rounded-lg border-2 text-xs font-bold cursor-pointer ${splitParts === n ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                    style={splitParts === n ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                  >
                    {n === 0 ? "—" : n}
                  </button>
                ))}
              </div>
              {splitAmounts && (
                <p className="text-center text-sm font-bold text-black">
                  {splitAmounts.every((a) => a === splitAmounts[0])
                    ? `${splitParts} × ${fmtEur(splitAmounts[0])}`
                    : `${splitAmounts.filter((a) => a === splitAmounts[0]).length} × ${fmtEur(splitAmounts[0])} + ${splitAmounts.filter((a) => a !== splitAmounts[0]).length} × ${fmtEur(splitAmounts[splitAmounts.length - 1])}`}
                </p>
              )}

              {/* Method picker */}
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 cursor-pointer ${method === m.id ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                    style={method === m.id ? { background: "linear-gradient(135deg, #d4a574, #c4956a)", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                  >
                    <m.icon className="w-5 h-5" />
                    <span className="text-xs font-bold">{t(m.labelKey as keyof Dictionary)}</span>
                  </button>
                ))}
              </div>

              {/* Amount (defaults to the remaining) */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-bold text-black">{t("cassa_amount")}</label>
                  <input
                    inputMode="decimal"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    placeholder={remaining.toFixed(2)}
                    className="w-full px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
                    style={{ borderColor: "#c4956a" }}
                  />
                </div>
                {method === "cash" && (
                  <div className="flex-1">
                    <label className="text-xs font-bold text-black">{t("cassa_received")}</label>
                    <input
                      inputMode="decimal"
                      value={receivedStr}
                      onChange={(e) => setReceivedStr(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
                      style={{ borderColor: "#c4956a" }}
                    />
                  </div>
                )}
              </div>

              {/* Cash quick-tender buttons */}
              {method === "cash" && (
                <div className="flex gap-2 flex-wrap">
                  {[5, 10, 20, 50, 100].map((n) => (
                    <button
                      key={n}
                      onClick={() => setReceivedStr(String(n))}
                      className="px-3 h-9 rounded-lg border-2 text-sm font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer"
                      style={{ borderColor: "#c4956a" }}
                    >
                      {n} €
                    </button>
                  ))}
                  <button
                    onClick={() => setReceivedStr(effectiveAmount.toFixed(2))}
                    className="px-3 h-9 rounded-lg border-2 text-sm font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer"
                    style={{ borderColor: "#c4956a" }}
                  >
                    {t("cassa_exact_amount")}
                  </button>
                </div>
              )}

              {method === "cash" && received != null && change > 0 && (
                <p className="text-center text-black">
                  {t("cassa_change")}: <span className="font-bold text-xl">{fmtEur(change)}</span>
                </p>
              )}

              <button
                onClick={addEntry}
                disabled={busy || remaining <= 0 || effectiveAmount <= 0 || (method === "cash" && received != null && received < Math.min(effectiveAmount, remaining))}
                className="w-full py-3.5 text-white text-base font-bold rounded-xl disabled:opacity-40 cursor-pointer"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                {busy
                  ? "…"
                  : effectiveAmount >= remaining
                    ? `${t("cassa_pay_confirm")} · ${fmtEur(remaining)}`
                    : `${t("cassa_add_payment")} · ${fmtEur(Math.min(effectiveAmount, remaining))}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
