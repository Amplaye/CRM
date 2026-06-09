"use client";

import { useEffect, useState } from "react";
import { CreditCard, Check, Loader2, CheckCircle2, XCircle, Sparkles, Building2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import {
  PLANS,
  ADDONS,
  planAmount,
  formatEur,
  type PlanId,
  type AddonId,
  type BillingCycle,
} from "@/lib/billing/catalog";

// Settings → Payments. The owner picks a plan (Premium / Business), a billing cycle
// (monthly / yearly — yearly = 2 months free), and optional add-ons, then pays with
// Stripe or PayPal. Prices come from the shared catalog (single source of truth,
// mirrors the public pricing page). The actual subscription is written by the
// provider webhooks; this tab only kicks off checkout and reflects current state.
//
// Until the Stripe/PayPal keys land in env, /api/billing/status reports the
// provider as not configured and the pay buttons show "coming soon" instead of
// 503-ing the owner.

interface SubState {
  plan: PlanId | null;
  cycle: BillingCycle | null;
  status: string;
  provider: string | null;
  current_period_end: string | null;
  addons: string[];
}

type Provider = "stripe" | "paypal";

const tk = (k: string) => k as keyof Dictionary;

export function PaymentsTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [sub, setSub] = useState<SubState | null>(null);
  const [providers, setProviders] = useState<{ stripe: boolean; paypal: boolean }>({ stripe: false, paypal: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // "plan:premium:stripe" etc.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reflect ?checkout=success|cancel after coming back from the hosted page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("checkout");
    if (c === "success") setNotice({ ok: true, msg: t(tk("settings_payments_checkout_success")) || "Pagamento ricevuto. L'abbonamento si attiva tra pochi istanti." });
    else if (c === "cancel") setNotice({ ok: false, msg: t(tk("settings_payments_checkout_cancel")) || "Pagamento annullato." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/billing/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenant.id }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.subscription) {
          setSub(data.subscription);
          if (data.subscription.cycle) setCycle(data.subscription.cycle);
        }
        if (data?.providers) setProviders(data.providers);
      } catch {
        /* leave defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant?.id]);

  async function checkout(provider: Provider, kind: "plan" | "addon", id: PlanId | AddonId) {
    if (!tenant?.id) return;
    const tag = `${kind}:${id}:${provider}`;
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          provider,
          kind,
          ...(kind === "plan" ? { plan: id, cycle } : { addon: id }),
        }),
      });
      const data = await res.json();
      if (data?.ok && data?.url) {
        window.location.href = data.url; // hosted checkout / approval page
        return;
      }
      if (data?.error === "not_configured") {
        setError(t(tk("settings_payments_not_configured")) || "Pagamenti non ancora configurati. Stiamo completando l'attivazione.");
      } else {
        setError(data?.detail || data?.error || (t(tk("settings_save_error")) || "Errore"));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setBusy(null);
    }
  }

  const cardStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  const anyProvider = providers.stripe || providers.paypal;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <CreditCard className="w-5 h-5" /> {t(tk("settings_payments_title")) || "Abbonamento e pagamenti"}
        </h2>
        <p className="mt-1 text-sm text-black/70">
          {t(tk("settings_payments_desc")) || "Scegli il piano, paga con Stripe o PayPal e gestisci i componenti aggiuntivi. Senza commissioni sulle tue prenotazioni."}
        </p>
      </div>

      {/* Return-from-checkout notice */}
      {notice && (
        <div
          className={`flex items-start gap-2 text-sm rounded-lg p-3 ${notice.ok ? "text-emerald-700" : "text-black/70"}`}
          style={{ background: notice.ok ? "rgba(16,185,129,0.08)" : "rgba(196,149,106,0.10)" }}
        >
          {notice.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{notice.msg}</span>
        </div>
      )}

      {/* Current subscription banner */}
      {!loading && sub?.plan && (
        <div className="rounded-lg border-2 p-4 flex flex-wrap items-center justify-between gap-3" style={cardStyle}>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="font-bold text-black">
                {(t(tk("settings_payments_current")) || "Piano attivo: {p}").replace(
                  "{p}",
                  PLANS.find((p) => p.id === sub.plan)?.name || sub.plan,
                )}
                {sub.cycle ? ` · ${t(tk(sub.cycle === "yearly" ? "settings_payments_yearly" : "settings_payments_monthly")) || sub.cycle}` : ""}
              </div>
              <div className="text-xs text-black/60">
                {t(tk("settings_payments_status")) || "Stato"}: {sub.status}
                {sub.current_period_end
                  ? ` · ${(t(tk("settings_payments_renews")) || "rinnova il {d}").replace("{d}", new Date(sub.current_period_end).toLocaleDateString())}`
                  : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider-not-configured hint */}
      {!loading && !anyProvider && (
        <div className="rounded-lg border-2 p-3 text-sm text-black/70" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.4)" }}>
          {t(tk("settings_payments_not_configured")) || "I pagamenti online si attivano a breve. L'interfaccia è pronta: appena colleghiamo Stripe e PayPal potrai abbonarti da qui."}
        </div>
      )}

      {/* Billing cycle toggle */}
      <div className="inline-flex rounded-lg border-2 p-1" style={{ borderColor: "#c4956a" }}>
        {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
          <button
            key={c}
            onClick={() => setCycle(c)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${cycle === c ? "text-white font-bold" : "text-black/70"}`}
            style={cycle === c ? { background: "linear-gradient(135deg, #d4a574, #c4956a)" } : {}}
          >
            {c === "monthly"
              ? t(tk("settings_payments_monthly")) || "Mensile"
              : t(tk("settings_payments_yearly")) || "Annuale"}
            {c === "yearly" && (
              <span className="ml-1 text-[10px] font-bold" style={{ color: cycle === c ? "#fff" : "#8b6540" }}>
                · {t(tk("settings_payments_2months_free")) || "2 mesi gratis"}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {PLANS.map((plan) => {
          const amount = planAmount(plan, cycle);
          const isCurrent = sub?.plan === plan.id && (sub?.status === "active" || sub?.status === "trialing");
          const Icon = plan.id === "premium" ? Sparkles : Building2;
          return (
            <div
              key={plan.id}
              className="rounded-xl border-2 p-5 flex flex-col"
              style={{
                borderColor: plan.highlighted ? "#c4956a" : "#eaddcb",
                background: plan.highlighted ? "rgba(196,149,106,0.08)" : "rgba(252,246,237,0.5)",
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-black flex items-center gap-2">
                  <Icon className="w-4 h-4" /> {t(tk(plan.nameKey)) || plan.name}
                </h3>
                {plan.highlighted && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: "#c4956a" }}>
                    {t(tk("settings_payments_recommended")) || "Consigliato"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-black/60">{t(tk(plan.taglineKey)) || ""}</p>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-black">{formatEur(amount)}</span>
                <span className="text-sm text-black/60">
                  /{cycle === "yearly" ? t(tk("settings_payments_per_year")) || "anno" : t(tk("settings_payments_per_month")) || "mese"}
                </span>
              </div>

              <ul className="mt-4 space-y-1.5 flex-1">
                {plan.featureKeys.map((fk) => (
                  <li key={fk} className="flex items-start gap-2 text-sm text-black/80">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#c4956a" }} />
                    <span>{t(tk(fk)) || fk}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="mt-5 text-center text-sm font-bold text-emerald-700 py-2.5 rounded-lg" style={{ background: "rgba(16,185,129,0.08)" }}>
                  {t(tk("settings_payments_active_plan")) || "Piano attivo"}
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    onClick={() => checkout("stripe", "plan", plan.id)}
                    disabled={!providers.stripe || busy !== null}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    style={{ background: "linear-gradient(135deg, #635bff, #4f46e5)" }}
                  >
                    {busy === `plan:${plan.id}:stripe` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {t(tk("settings_payments_pay_stripe")) || "Paga con carta (Stripe)"}
                  </button>
                  <button
                    onClick={() => checkout("paypal", "plan", plan.id)}
                    disabled={!providers.paypal || busy !== null}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    style={{ borderColor: "#ffc439", color: "#003087", background: "#ffffff" }}
                  >
                    {busy === `plan:${plan.id}:paypal` ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="font-extrabold italic">PayPal</span>}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-ons */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-black">{t(tk("settings_payments_addons_title")) || "Componenti aggiuntivi"}</h3>
          <p className="text-xs text-black/60">{t(tk("settings_payments_addons_desc")) || "Aggiungi ciò che ti serve. Si acquistano a parte dal tuo piano."}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ADDONS.map((addon) => {
            const owned = sub?.addons?.includes(addon.id);
            const priceLabel =
              (addon.fromPrice ? (t(tk("settings_payments_from")) || "da") + " " : "") +
              formatEur(addon.amount) +
              (addon.billing === "recurring" ? `/${t(tk("settings_payments_per_month")) || "mese"}` : "");
            // PayPal one-offs aren't wired; offer Stripe only for the one-off.
            const stripeOk = providers.stripe;
            const paypalOk = providers.paypal && addon.billing === "recurring";
            return (
              <div
                key={addon.id}
                className="rounded-lg border-2 p-4 flex flex-col"
                style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.5)", opacity: addon.comingSoon ? 0.6 : 1 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-black">{t(tk(addon.nameKey)) || addon.name}</span>
                  <span className="text-sm font-extrabold text-black whitespace-nowrap">{priceLabel}</span>
                </div>
                <p className="mt-1 text-xs text-black/60 flex-1">{t(tk(addon.descKey)) || ""}</p>
                {addon.comingSoon ? (
                  <div className="mt-3 text-center text-xs text-black/50 py-2 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
                    {t(tk("settings_payments_coming_soon")) || "Prossimamente"}
                  </div>
                ) : owned ? (
                  <div className="mt-3 text-center text-xs font-bold text-emerald-700 py-2 rounded-lg" style={{ background: "rgba(16,185,129,0.08)" }}>
                    {t(tk("settings_payments_added")) || "Attivo"}
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => checkout("stripe", "addon", addon.id)}
                      disabled={!stripeOk || busy !== null}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-white text-xs font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      style={{ background: "linear-gradient(135deg, #635bff, #4f46e5)" }}
                    >
                      {busy === `addon:${addon.id}:stripe` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                      Stripe
                    </button>
                    <button
                      onClick={() => checkout("paypal", "addon", addon.id)}
                      disabled={!paypalOk || busy !== null}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      style={{ borderColor: "#ffc439", color: "#003087", background: "#fff" }}
                    >
                      {busy === `addon:${addon.id}:paypal` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="italic font-extrabold">PayPal</span>}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm rounded-lg p-3 text-red-600" style={{ background: "rgba(220,38,38,0.06)" }}>
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-xs text-black/40">
        {t(tk("settings_payments_secure_note")) || "Pagamenti gestiti in modo sicuro da Stripe e PayPal. BALI Flow non conserva i dati della tua carta."}
      </p>
    </div>
  );
}
