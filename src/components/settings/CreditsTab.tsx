"use client";

import { useState, useEffect, useMemo } from "react";
import { Coins, Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  ACTION_MC,
  CREDIT_PACKS,
  formatCredits,
  type CreditAction,
} from "@/lib/billing/credits-catalog";
import { formatEur } from "@/lib/billing/catalog";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

// Settings → Credits. Four things, in the order the owner needs them:
//   1. how much is left       2. how to buy more
//   3. what each action costs 4. what was actually spent
//
// (3) is not decoration. A prepaid meter the customer can't predict is a meter
// they don't trust, and the first time the bot goes quiet they'll assume we
// invented the charges. So every price is shown, generated from the same
// ACTION_MC the server debits from — the table cannot drift from the billing.

const tk = (k: string) => k as keyof Dictionary;

const cardStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
const softCardStyle = { borderColor: "#eaddcb", background: "rgba(255,255,255,0.5)" };

interface Balance {
  includedRemainingMc: number;
  purchasedRemainingMc: number;
  includedGrantedMc: number;
  totalRemainingMc: number;
}

interface CreditEvent {
  id: string;
  action_type: string;
  credits_mc: number;
  created_at: string;
}

// Order matters: the actions an owner burns most are the ones they most need to
// be able to predict.
const PRICED_ACTIONS: CreditAction[] = [
  "bot_message",
  "marketing_whatsapp",
  "marketing_email",
  "voice_minute",
  "transcription",
  "ai_text",
  "invoice_ocr",
  "menu_import",
];

const ACTION_LABEL_KEY: Record<string, string> = {
  bot_message: "credits_action_bot_message",
  marketing_whatsapp: "credits_action_marketing_whatsapp",
  marketing_email: "credits_action_marketing_email",
  voice_minute: "credits_action_voice_minute",
  transcription: "credits_action_transcription",
  ai_text: "credits_action_ai_text",
  invoice_ocr: "credits_action_invoice_ocr",
  menu_import: "credits_action_menu_import",
  topup: "credits_action_topup",
  plan_reset: "credits_action_plan_reset",
};

const ACTION_FALLBACK: Record<string, string> = {
  bot_message: "Messaggio del bot",
  marketing_whatsapp: "Campagna WhatsApp (per destinatario)",
  marketing_email: "Email marketing",
  voice_minute: "Minuto di chiamata",
  transcription: "Nota vocale trascritta",
  ai_text: "Testo generato dall'AI",
  invoice_ocr: "Fattura scansionata",
  menu_import: "Import menu (per blocco)",
  topup: "Ricarica",
  plan_reset: "Crediti del piano",
};

export function CreditsTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const [balance, setBalance] = useState<Balance | null>(null);
  const [events, setEvents] = useState<CreditEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);

  const tenantId = tenant?.id;

  // Back from a Stripe top-up? Say so — the balance itself arrives on its own,
  // via the realtime subscription, the moment the webhook credits it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") setJustPaid(true);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const [balRes, evRes] = await Promise.all([
          fetch(`/api/credits/balance?tenant_id=${tenantId}`),
          fetch(`/api/credits/events?tenant_id=${tenantId}&limit=50`),
        ]);
        const bal = await balRes.json();
        const ev = await evRes.json();
        if (cancelled) return;
        if (bal?.ok) {
          setBalance({
            includedRemainingMc: Number(bal.included_remaining_mc) || 0,
            purchasedRemainingMc: Number(bal.purchased_remaining_mc) || 0,
            includedGrantedMc: Number(bal.included_granted_mc) || 0,
            totalRemainingMc: Number(bal.total_remaining_mc) || 0,
          });
        }
        if (ev?.ok) setEvents(ev.events || []);
      } catch {
        if (!cancelled) setError("load_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Same live channel as the badge: the balance updates while this tab is open.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`credit-balance-tab-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_balances", filter: `tenant_id=eq.${tenantId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          const included = Number(row.included_remaining_mc) || 0;
          const purchased = Number(row.purchased_remaining_mc) || 0;
          setBalance({
            includedRemainingMc: included,
            purchasedRemainingMc: purchased,
            includedGrantedMc: Number(row.included_granted_mc) || 0,
            totalRemainingMc: included + purchased,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, supabase]);

  const buy = async (packId: string) => {
    if (!tenantId) return;
    setBusy(packId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          provider: "stripe",
          kind: "credits",
          pack: packId,
        }),
      });
      const data = await res.json();
      if (data?.ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      setError(data?.error === "not_configured" ? "not_configured" : "checkout_failed");
    } catch {
      setError("checkout_failed");
    } finally {
      setBusy(null);
    }
  };

  const usedPct =
    balance && balance.includedGrantedMc > 0
      ? Math.min(
          100,
          Math.max(0, ((balance.includedGrantedMc - balance.includedRemainingMc) / balance.includedGrantedMc) * 100),
        )
      : 0;

  const actionLabel = (action: string) =>
    t(tk(ACTION_LABEL_KEY[action] || "")) || ACTION_FALLBACK[action] || action;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <Coins className="w-5 h-5" />
          {t(tk("credits_title")) || "Crediti"}
        </h2>
        <p className="text-sm text-black mt-1">
          {t(tk("credits_desc")) ||
            "I crediti pagano tutto ciò che consuma AI: risposte del bot, chiamate, campagne, scansioni. Si azzerano ogni mese; quelli acquistati non scadono."}
        </p>
      </div>

      {justPaid && (
        <div
          className="rounded-lg border-2 p-4 flex items-center gap-2 text-sm font-medium text-black"
          style={{ borderColor: "#16a34a", background: "rgba(22,163,74,0.08)" }}
        >
          <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} />
          {t(tk("credits_topup_success")) || "Ricarica completata. I crediti sono già disponibili."}
        </div>
      )}

      {/* 1 — Balance */}
      <div className="rounded-xl border-2 p-5" style={cardStyle}>
        <p className="text-sm font-medium text-black">{t(tk("credits_balance")) || "Saldo disponibile"}</p>
        <p className="text-4xl font-bold text-black mt-1">
          {balance ? formatCredits(balance.totalRemainingMc) : "—"}
          <span className="text-base font-medium ml-2">{t(tk("credits_unit")) || "crediti"}</span>
        </p>

        {balance && balance.includedGrantedMc > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs font-medium text-black mb-1">
              <span>{t(tk("credits_monthly_included")) || "Inclusi nel piano"}</span>
              <span>
                {formatCredits(balance.includedRemainingMc)} / {formatCredits(balance.includedGrantedMc)}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.25)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${100 - usedPct}%`,
                  background: "linear-gradient(135deg, #d4a574, #c4956a)",
                }}
              />
            </div>
          </div>
        )}

        {balance && (
          <div className="flex justify-between text-sm font-medium text-black mt-3">
            <span>{t(tk("credits_purchased")) || "Acquistati (non scadono)"}</span>
            <span>{formatCredits(balance.purchasedRemainingMc)}</span>
          </div>
        )}
      </div>

      {/* 2 — Top-up */}
      <div>
        <h3 className="text-base font-bold text-black mb-3">{t(tk("credits_topup")) || "Ricarica"}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} className="rounded-xl border-2 p-5 flex flex-col" style={cardStyle}>
              <p className="text-2xl font-bold text-black">
                {formatCredits(pack.creditsMc)}
                <span className="text-sm font-medium ml-1.5">{t(tk("credits_unit")) || "crediti"}</span>
              </p>
              <p className="text-sm font-medium text-black mt-1">{formatEur(pack.amount)}</p>
              <button
                onClick={() => buy(pack.id)}
                disabled={busy !== null}
                className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #635bff, #4f46e5)" }}
              >
                {busy === pack.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  t(tk("credits_buy")) || "Acquista"
                )}
              </button>
            </div>
          ))}
        </div>
        {error === "not_configured" && (
          <p className="text-sm font-medium text-black mt-3">
            {t(tk("credits_not_configured")) || "Pagamenti non ancora configurati. Contattaci per ricaricare."}
          </p>
        )}
        {error === "checkout_failed" && (
          <p className="text-sm font-medium mt-3" style={{ color: "#dc2626" }}>
            {t(tk("credits_checkout_failed")) || "Non è stato possibile aprire il pagamento. Riprova."}
          </p>
        )}
      </div>

      {/* 3 — Price list */}
      <div>
        <h3 className="text-base font-bold text-black mb-1">
          {t(tk("credits_pricing_title")) || "Quanto costa ogni azione"}
        </h3>
        <p className="text-sm text-black mb-3">
          {t(tk("credits_pricing_desc")) || "Nessun costo nascosto: questi sono gli unici consumi."}
        </p>
        <div className="rounded-xl border-2 overflow-hidden" style={softCardStyle}>
          {PRICED_ACTIONS.map((action, i) => {
            const mc = ACTION_MC[action];
            // "≈ 25 per credito" — the number the owner actually reasons with.
            // A price of "0,04 cr" means nothing on its own; "25 messaggi per
            // credito" is a fact they can hold in their head.
            const perCredit = Math.round(1000 / mc);
            return (
              <div
                key={action}
                className="flex items-center justify-between px-4 py-3"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid #eaddcb",
                }}
              >
                <span className="text-sm font-medium text-black">{actionLabel(action)}</span>
                <span className="text-sm text-black text-right">
                  <span className="font-bold">{formatCredits(mc)}</span>
                  <span className="ml-1.5 text-xs">
                    ({t(tk("credits_per_credit")) ? `≈ ${perCredit} ${t(tk("credits_per_credit"))}` : `≈ ${perCredit} per credito`})
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4 — History */}
      <div>
        <h3 className="text-base font-bold text-black mb-3">
          {t(tk("credits_history")) || "Ultime attività"}
        </h3>
        {events.length === 0 ? (
          <div className="rounded-xl border-2 p-5" style={softCardStyle}>
            <p className="text-sm font-medium text-black">
              {t(tk("credits_history_empty")) || "Ancora nessun consumo."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border-2 overflow-hidden" style={softCardStyle}>
            {events.map((ev, i) => {
              const isCredit = ev.credits_mc > 0;
              return (
                <div
                  key={ev.id}
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderTop: i === 0 ? "none" : "1px solid #eaddcb" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-black truncate">{actionLabel(ev.action_type)}</p>
                    <p className="text-xs text-black">
                      {new Date(ev.created_at).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className="text-sm font-bold shrink-0 ml-3"
                    style={{ color: isCredit ? "#16a34a" : "#000000" }}
                  >
                    {isCredit ? "+" : "−"}
                    {formatCredits(Math.abs(ev.credits_mc))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
