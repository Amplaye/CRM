"use client";

import { useState } from "react";
import { GIFT_MAX_CENTS, GIFT_MIN_CENTS, GIFT_PRESETS_CENTS } from "@/lib/gift-cards/gift-cards";
import type { GiftDesign } from "@/lib/gift-cards/designs";
import { GiftCardPreview } from "@/components/gift-cards/GiftCardPreview";

// The purchase form on /g/<slug>. Client-side because it needs local state,
// but ALL validation that matters re-runs server-side in the checkout route.
// Strings come pre-localized from the server page.
//
// Two modes, decided by the owner: when they have designed cards in the Gift
// Cards dashboard, the guest PICKS A CARD (fixed amount, the design they see is
// what they buy). When they haven't, the page falls back to the historical
// preset-amount buttons — so a tenant that never opens the editor is unaffected.

export interface GiftFormStrings {
  amountLabel: string;
  chooseCard: string;
  customAmount: string;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
  messagePh: string;
  submit: string;
  submitting: string;
  errorGeneric: string;
}

const INPUT = "w-full rounded-lg border-2 bg-white px-3 py-2.5 text-sm text-black focus:outline-none";

export default function GiftForm({
  slug,
  accent,
  strings: ui,
  designs = [],
}: {
  slug: string;
  accent: string;
  strings: GiftFormStrings;
  /** Published cards. Empty → preset-amount fallback. */
  designs?: GiftDesign[];
}) {
  const hasDesigns = designs.length > 0;
  const [designId, setDesignId] = useState<string | null>(hasDesigns ? designs[0].id : null);
  const [amountCents, setAmountCents] = useState<number>(GIFT_PRESETS_CENTS[1]);
  const [customStr, setCustomStr] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = hasDesigns ? designs.find((d) => d.id === designId) ?? null : null;
  const customCents = Math.round(Number(customStr.replace(",", ".")) * 100);
  // A card carries its own price; the free-amount input only exists in fallback mode.
  const effectiveCents = chosen
    ? chosen.amount_cents
    : customStr.trim() !== ""
      ? customCents
      : amountCents;
  const amountOk =
    Number.isInteger(effectiveCents) && effectiveCents >= GIFT_MIN_CENTS && effectiveCents <= GIFT_MAX_CENTS;
  const canSubmit = amountOk && buyerEmail.includes("@") && !busy && (!hasDesigns || !!chosen);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-cards/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          // The server re-reads the design and trusts ITS amount, never this one.
          design_id: chosen?.id ?? null,
          amount_cents: effectiveCents,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          message,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.url) {
        window.location.href = json.url;
        return;
      }
      setError(ui.errorGeneric);
    } catch {
      setError(ui.errorGeneric);
    }
    setBusy(false);
  };

  return (
    <div className="mt-6 space-y-4 rounded-xl border-2 bg-white p-5" style={{ borderColor: accent }}>
      {hasDesigns ? (
        <div>
          <label className="mb-2 block text-sm font-bold text-black">{ui.chooseCard}</label>
          <div className="grid gap-3 sm:grid-cols-2">
            {designs.map((d) => (
              <GiftCardPreview
                key={d.id}
                design={d}
                selected={d.id === designId}
                onClick={() => setDesignId(d.id)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-2 block text-sm font-bold text-black">{ui.amountLabel}</label>
          <div className="flex flex-wrap gap-2">
            {GIFT_PRESETS_CENTS.map((c) => {
              const active = customStr.trim() === "" && amountCents === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setAmountCents(c);
                    setCustomStr("");
                  }}
                  className={`h-11 min-w-16 rounded-lg border-2 px-3 text-base font-bold ${active ? "text-white" : "text-black"}`}
                  style={active ? { background: accent, borderColor: accent } : { borderColor: accent }}
                >
                  {c / 100} €
                </button>
              );
            })}
          </div>
          <input
            inputMode="decimal"
            value={customStr}
            onChange={(e) => setCustomStr(e.target.value)}
            placeholder={ui.customAmount}
            className={`${INPUT} mt-2`}
            style={{ borderColor: accent }}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder={ui.buyerName}
          className={INPUT}
          style={{ borderColor: accent }}
        />
        <input
          type="email"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          placeholder={ui.buyerEmail}
          className={INPUT}
          style={{ borderColor: accent }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder={ui.recipientName}
          className={INPUT}
          style={{ borderColor: accent }}
        />
        <input
          type="email"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
          placeholder={ui.recipientEmail}
          className={INPUT}
          style={{ borderColor: accent }}
        />
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 280))}
        rows={3}
        placeholder={ui.messagePh}
        className={INPUT}
        style={{ borderColor: accent }}
      />

      {error ? <p className="text-center text-sm font-bold text-red-700">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="w-full rounded-xl py-3.5 text-base font-bold text-white disabled:opacity-40"
        style={{ background: accent }}
      >
        {busy ? ui.submitting : ui.submit}
      </button>
    </div>
  );
}
