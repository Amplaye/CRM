"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, CreditCard, Gift, Ticket, X, Users, Printer, Check, Minus, Plus } from "lucide-react";
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
  /** Voucher code, only on method "gift_card" — the pay route re-validates
   * and burns the balance server-side. */
  gift_code?: string;
}

// Only the methods an Italian restaurant actually rings up at the till: cash,
// card, meal vouchers (buoni pasto) and gift cards (buoni regalo). Online/
// bank/other were removed on request to keep the pay screen fast and
// unambiguous. Gift card appears only when the tenant enabled the module.
const METHODS: Array<{ id: CassaPaymentMethod; icon: typeof Banknote; labelKey: string }> = [
  { id: "cash", icon: Banknote, labelKey: "cassa_method_cash" },
  { id: "card", icon: CreditCard, labelKey: "cassa_method_card" },
  { id: "meal_voucher", icon: Ticket, labelKey: "cassa_method_voucher" },
  { id: "gift_card", icon: Gift, labelKey: "cassa_method_gift" },
];

export function methodLabelKey(method: string): string {
  return METHODS.find((m) => m.id === method)?.labelKey || "cassa_method_other";
}

interface PayModalProps {
  /** Needed by the gift-card balance lookup (/api/gift-cards/validate). */
  tenantId: string;
  /** Show the gift-card method only when the tenant enabled the module. */
  giftEnabled?: boolean;
  total: number;
  busy: boolean;
  /** After a successful charge: set to show the closing screen. */
  result: { receiptNumber: number | null; receiptYear: number | null; change: number } | null;
  onConfirm: (payments: PayEntry[]) => void;
  onPrintReceipt: () => void;
  onClose: () => void;
}

export function PayModal({ tenantId, giftEnabled = false, total, busy, result, onConfirm, onPrintReceipt, onClose }: PayModalProps) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<PayEntry[]>([]);
  const [method, setMethod] = useState<CassaPaymentMethod>("cash");
  const [amountStr, setAmountStr] = useState("");
  const [receivedStr, setReceivedStr] = useState("");
  const [splitParts, setSplitParts] = useState(0);
  // Gift-card state: the till types a code, verifies it (live balance from the
  // server), then charges up to that balance. The real burn happens in the pay
  // route — this is display/UX validation only.
  const [giftCodeStr, setGiftCodeStr] = useState("");
  const [giftCard, setGiftCard] = useState<{ code: string; balanceCents: number } | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [giftChecking, setGiftChecking] = useState(false);
  // Exact-cash confirmation gate: charging CASH with no received amount typed
  // needs a second tap — "30€ due, 0€ typed, charged anyway" must never happen
  // silently again.
  const [confirmExact, setConfirmExact] = useState(false);

  // The floating assistant bubble must never hover over the money screen.
  useEffect(() => {
    document.body.classList.add("cassa-overlay-open");
    return () => document.body.classList.remove("cassa-overlay-open");
  }, []);

  const remaining = useMemo(() => remainingDue(total, entries), [total, entries]);
  const parsedAmount = Number(amountStr.replace(",", "."));
  const parsedReceived = Number(receivedStr.replace(",", "."));
  const received = receivedStr.trim() !== "" && Number.isFinite(parsedReceived) ? parsedReceived : null;

  // What the verified voucher can still cover, net of gift entries already added.
  const giftAvailableC = useMemo(() => {
    if (!giftCard) return 0;
    const usedC = entries
      .filter((e) => e.method === "gift_card" && e.gift_code === giftCard.code)
      .reduce((s, e) => s + toCents(e.amount), 0);
    return Math.max(0, giftCard.balanceCents - usedC);
  }, [giftCard, entries]);

  // The amount field pre-fills with what's left, so the fast path stays one
  // tap. A gift card additionally clamps to its available balance.
  const baseAmount =
    amountStr.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0
      ? fromCents(toCents(parsedAmount))
      : remaining;
  const effectiveAmount =
    method === "gift_card" ? Math.min(baseAmount, fromCents(giftAvailableC)) : baseAmount;

  const verifyGiftCode = async () => {
    if (!giftCodeStr.trim() || giftChecking) return;
    setGiftChecking(true);
    setGiftError(null);
    setGiftCard(null);
    try {
      const res = await fetch("/api/gift-cards/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, code: giftCodeStr }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.code) {
        setGiftCard({ code: json.code, balanceCents: Number(json.balance_cents) || 0 });
      } else {
        setGiftError(
          json?.error === "not_found"
            ? t("cassa_gift_not_found")
            : json?.error === "invalid_code"
              ? t("cassa_gift_invalid")
              : t("cassa_gift_not_active"),
        );
      }
    } catch {
      setGiftError(t("cassa_gift_not_active"));
    } finally {
      setGiftChecking(false);
    }
  };

  const change = method === "cash" && received != null ? changeDue(received, effectiveAmount) : 0;
  // Typed cash that doesn't cover what's being charged → hard stop with a
  // visible reason (the button used to just grey out with no explanation).
  const cashShort =
    method === "cash" && received != null && toCents(received) < toCents(Math.min(effectiveAmount, remaining));

  // Any change to the inputs invalidates a pending exact-cash confirmation.
  useEffect(() => {
    setConfirmExact(false);
  }, [method, receivedStr, amountStr, entries.length]);

  const addEntry = () => {
    if (effectiveAmount <= 0 || busy || cashShort) return;
    // A gift entry needs a VERIFIED code with balance left.
    if (method === "gift_card" && (!giftCard || giftAvailableC <= 0)) return;
    const amount = Math.min(effectiveAmount, remaining);
    if (amount <= 0) return;
    // Cash with NOTHING typed in "Ricevuto": warn first, charge on the second
    // tap (counts as explicit "exact amount" confirmation).
    if (method === "cash" && received == null && !confirmExact) {
      setConfirmExact(true);
      return;
    }
    const entry: PayEntry = {
      method,
      amount,
      received: method === "cash" && received != null ? received : null,
      ...(method === "gift_card" && giftCard ? { gift_code: giftCard.code } : {}),
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
  // How many equal shares are still unpaid, and the value of the next one. Shares
  // are charged largest-first (splitEqual front-loads the remainder cents) so the
  // running list matches what each person actually hands over.
  const sharesPaid = splitAmounts
    ? Math.min(
        splitParts,
        (() => {
          let paidC = toCents(total) - toCents(remaining);
          let n = 0;
          for (const a of splitAmounts) {
            if (paidC + 1 >= toCents(a)) {
              paidC -= toCents(a);
              n++;
            } else break;
          }
          return n;
        })(),
      )
    : 0;
  const nextShare = splitAmounts && sharesPaid < splitParts ? splitAmounts[sharesPaid] : 0;

  // Charge exactly one alla-romana share with the selected method.
  const paySplitShare = () => {
    if (!nextShare || busy) return;
    if (method === "gift_card" && (!giftCard || giftAvailableC <= 0)) return;
    let amount = Math.min(nextShare, remaining);
    if (method === "gift_card") amount = Math.min(amount, fromCents(giftAvailableC));
    if (amount <= 0) return;
    const entry: PayEntry = {
      method,
      amount,
      received: method === "cash" && received != null ? received : null,
      ...(method === "gift_card" && giftCard ? { gift_code: giftCard.code } : {}),
    };
    const next = [...entries, entry];
    setEntries(next);
    setAmountStr("");
    setReceivedStr("");
    if (remainingDue(total, next) === 0) onConfirm(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={result ? undefined : onClose}>
      <div
        className="w-full max-w-md rounded-2xl border-2 shadow-xl max-h-[90dvh] overflow-y-auto"
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

              {/* Split alla romana: presets + a stepper for any number of people. */}
              <div className="rounded-xl border-2 p-3 space-y-2.5" style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.06)" }}>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-black" />
                  <span className="text-sm font-bold text-black">{t("cassa_split")}</span>
                  <span className="flex-1" />
                  {/* manual person count stepper */}
                  <button
                    onClick={() => setSplitParts((n) => (n <= 2 ? 0 : n - 1))}
                    className="w-9 h-9 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
                    style={{ borderColor: "#c4956a" }}
                    aria-label="-"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-7 text-center text-base font-bold text-black">{splitParts >= 2 ? splitParts : "—"}</span>
                  <button
                    onClick={() => setSplitParts((n) => (n < 2 ? 2 : Math.min(50, n + 1)))}
                    className="w-9 h-9 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
                    style={{ borderColor: "#c4956a" }}
                    aria-label="+"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSplitParts(0)}
                    className={`h-9 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer ${splitParts < 2 ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
                    style={splitParts < 2 ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                  >
                    {t("cassa_remove")}
                  </button>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => setSplitParts(n)}
                      className={`h-9 min-w-9 px-2 rounded-lg border-2 text-sm font-bold cursor-pointer ${splitParts === n ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
                      style={splitParts === n ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {splitAmounts && (
                  <>
                    <p className="text-center text-sm text-black">
                      {splitAmounts.every((a) => a === splitAmounts[0])
                        ? `${splitParts} × ${fmtEur(splitAmounts[0])}`
                        : `${splitAmounts.filter((a) => a === splitAmounts[0]).length} × ${fmtEur(splitAmounts[0])} + ${splitAmounts.filter((a) => a !== splitAmounts[0]).length} × ${fmtEur(splitAmounts[splitAmounts.length - 1])}`}
                      {sharesPaid > 0 ? ` · ${sharesPaid}/${splitParts} ${t("cassa_split_paid")}` : ""}
                    </p>
                    {nextShare > 0 && (
                      <button
                        onClick={paySplitShare}
                        disabled={busy || remaining <= 0}
                        className="w-full h-11 rounded-lg text-sm font-bold text-white disabled:opacity-40 cursor-pointer"
                        style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                      >
                        {t("cassa_pay_share")} · {fmtEur(Math.min(nextShare, remaining))}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Method picker */}
              <div className={`grid gap-2 ${giftEnabled ? "grid-cols-4" : "grid-cols-3"}`}>
                {METHODS.filter((m) => m.id !== "gift_card" || giftEnabled).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 cursor-pointer ${method === m.id ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
                    style={method === m.id ? { background: "linear-gradient(135deg, #d4a574, #c4956a)", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                  >
                    <m.icon className="w-5 h-5" />
                    <span className="text-xs font-bold">{t(m.labelKey as keyof Dictionary)}</span>
                  </button>
                ))}
              </div>

              {/* Gift-card code: verify against the server before charging */}
              {method === "gift_card" && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={giftCodeStr}
                      onChange={(e) => {
                        setGiftCodeStr(e.target.value);
                        setGiftCard(null);
                        setGiftError(null);
                      }}
                      placeholder="GIFT-XXXX-XXXX"
                      autoCapitalize="characters"
                      className="flex-1 px-3 py-2.5 text-base font-bold text-black border-2 rounded-lg bg-white uppercase"
                      style={{ borderColor: "#c4956a" }}
                    />
                    <button
                      onClick={verifyGiftCode}
                      disabled={giftChecking || !giftCodeStr.trim()}
                      className="px-4 rounded-lg border-2 text-sm font-bold text-black active:bg-[#c4956a]/20 disabled:opacity-40 cursor-pointer"
                      style={{ borderColor: "#c4956a" }}
                    >
                      {giftChecking ? "…" : t("cassa_gift_verify")}
                    </button>
                  </div>
                  {giftCard && (
                    <p className="text-center text-sm font-bold text-black">
                      {t("cassa_gift_balance")}: {fmtEur(fromCents(giftAvailableC))}
                    </p>
                  )}
                  {giftError && (
                    <p className="flex items-center justify-center gap-1.5 text-center text-sm font-bold text-red-700">
                      <AlertTriangle className="w-4 h-4 shrink-0" /> {giftError}
                    </p>
                  )}
                </div>
              )}

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
                      className="px-3 h-10 rounded-lg border-2 text-sm font-bold text-black active:bg-[#c4956a]/20 cursor-pointer"
                      style={{ borderColor: "#c4956a" }}
                    >
                      {n} €
                    </button>
                  ))}
                  <button
                    onClick={() => setReceivedStr(effectiveAmount.toFixed(2))}
                    className="px-3 h-10 rounded-lg border-2 text-sm font-bold text-black active:bg-[#c4956a]/20 cursor-pointer"
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

              {/* typed cash doesn't cover the charge → say WHY the button is dead */}
              {cashShort && (
                <p className="flex items-center justify-center gap-1.5 text-center text-sm font-bold text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("cassa_cash_insufficient")} ({fmtEur(Math.min(effectiveAmount, remaining))})
                </p>
              )}
              {/* exact-cash gate armed → explain the second tap */}
              {confirmExact && !cashShort && (
                <p className="flex items-center justify-center gap-1.5 text-center text-sm font-bold" style={{ color: "#92400e" }}>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("cassa_cash_exact_confirm")}
                </p>
              )}

              <button
                onClick={addEntry}
                disabled={busy || remaining <= 0 || effectiveAmount <= 0 || cashShort}
                className="w-full py-3.5 text-white text-base font-bold rounded-xl disabled:opacity-40 cursor-pointer"
                style={{
                  background: confirmExact && !cashShort
                    ? "linear-gradient(135deg, #d97706, #b45309)"
                    : "linear-gradient(135deg, #d4a574, #c4956a)",
                }}
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
