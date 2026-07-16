"use client";

import { useEffect, useState } from "react";
import { CreditCard, Check, Loader2, CheckCircle2, XCircle, Sparkles, Building2, Layers, MessageCircle, Gift, Lock } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { TablePayCard } from "@/components/settings/TablePayCard";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import {
  PLANS,
  ADDONS,
  planAmount,
  bundleTotal,
  formatEur,
  contactWhatsappUrl,
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
  // Recurring add-ons the owner ticked to pay together with the plan (the bundle).
  const [selectedAddons, setSelectedAddons] = useState<Set<AddonId>>(new Set());
  // Which plan the "pay everything together" bundle button targets.
  const [bundlePlan, setBundlePlan] = useState<PlanId>(PLANS.find((p) => p.highlighted)?.id || PLANS[0].id);
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

  // Pay the chosen plan + all ticked recurring add-ons in ONE Stripe subscription.
  async function checkoutBundle() {
    if (!tenant?.id) return;
    const addons = Array.from(selectedAddons);
    if (addons.length === 0) return;
    setBusy("bundle");
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          provider: "stripe", // bundle is Stripe-only
          kind: "bundle",
          plan: bundlePlan,
          cycle,
          addons,
        }),
      });
      const data = await res.json();
      if (data?.ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      if (data?.error === "not_configured") {
        setError(t(tk("settings_payments_not_configured")) || "Pagamenti non ancora configurati.");
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

  function toggleAddon(id: AddonId) {
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const cardStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  const anyProvider = providers.stripe || providers.paypal;
  // Tenant with no active paid plan = the free "entry package" (menu + settings
  // only). Surface it here so the owner sees what they have today and what a plan
  // unlocks — the missing link between the freemium locks and this pricing list.
  const onEntryPackage = !hasActivePlan(tenant?.settings);
  const selectedList = Array.from(selectedAddons);
  const bundlePlanObj = PLANS.find((p) => p.id === bundlePlan) || PLANS[0];
  const bundleSum = bundleTotal(bundlePlanObj, cycle, selectedList);
  const perLabel = cycle === "yearly" ? t(tk("settings_payments_per_year")) || "anno" : t(tk("settings_payments_per_month")) || "mese";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <CreditCard className="w-5 h-5" /> {t(tk("settings_payments_title")) || "Abbonamento e pagamenti"}
        </h2>
        <p className="mt-1 text-sm text-black">
          {t(tk("settings_payments_desc")) || "Scegli il piano, paga con Stripe o PayPal e gestisci i componenti aggiuntivi. Senza commissioni sulle tue prenotazioni."}
        </p>
      </div>

      {/* Return-from-checkout notice */}
      {notice && (
        <div
          className={`flex items-start gap-2 text-sm rounded-lg p-3 ${notice.ok ? "text-emerald-700" : "text-black"}`}
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
              <div className="text-xs text-black">
                {t(tk("settings_payments_status")) || "Stato"}: {sub.status}
                {sub.current_period_end
                  ? ` · ${(t(tk("settings_payments_renews")) || "rinnova il {d}").replace("{d}", new Date(sub.current_period_end).toLocaleDateString())}`
                  : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Entry package — shown when the tenant has no active paid plan. The free
          tier they're on right now: what's included + what a plan unlocks. */}
      {onEntryPackage && (
        <div
          className="rounded-xl border-2 p-5"
          style={{ borderColor: "#c4956a", background: "linear-gradient(135deg, rgba(196,149,106,0.12), rgba(252,246,237,0.6))" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-bold text-black flex items-center gap-2">
              <Gift className="w-5 h-5" style={{ color: "#c4956a" }} />
              {t(tk("settings_payments_entry_title")) || "Pacchetto Entry"}
            </h3>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-white" style={{ background: "#c4956a" }}>
              {t(tk("settings_payments_entry_badge")) || "Gratis · Piano attuale"}
            </span>
          </div>
          <p className="mt-2 text-sm text-black">
            {t(tk("settings_payments_entry_desc")) || "Stai usando BaliFlow gratis. Hai pieno accesso al menu digitale e alle impostazioni del tuo locale."}
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border-2 p-3" style={{ borderColor: "#eaddcb", background: "rgba(255,255,255,0.5)" }}>
              <div className="text-xs font-bold text-black flex items-center gap-1.5">
                <Check className="w-4 h-4 shrink-0" style={{ color: "#2f9e6b" }} />
                {t(tk("settings_payments_entry_included_label")) || "Già incluso"}
              </div>
              <p className="mt-1.5 text-sm text-black">
                {t(tk("settings_payments_entry_included")) || "Menu digitale pubblico, editor del menu e impostazioni del locale"}
              </p>
            </div>
            <div className="rounded-lg border-2 p-3" style={{ borderColor: "#eaddcb", background: "rgba(255,255,255,0.5)" }}>
              <div className="text-xs font-bold text-black flex items-center gap-1.5">
                <Lock className="w-4 h-4 shrink-0" style={{ color: "#c4956a" }} />
                {t(tk("settings_payments_entry_unlock_label")) || "Sblocca con un piano"}
              </div>
              <p className="mt-1.5 text-sm text-black">
                {t(tk("settings_payments_entry_unlock")) || "Prenotazioni, sala, ospiti, conversazioni, lista d'attesa e analisi"}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm font-bold flex items-center gap-1.5" style={{ color: "#8b6540" }}>
            <Sparkles className="w-4 h-4" />
            {t(tk("settings_payments_entry_cta")) || "Scegli Premium o Business qui sotto per sbloccare tutto"}
          </p>
        </div>
      )}

      {/* Provider-not-configured hint */}
      {!loading && !anyProvider && (
        <div className="rounded-lg border-2 p-3 text-sm text-black" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.4)" }}>
          {t(tk("settings_payments_not_configured")) || "I pagamenti online si attivano a breve. L'interfaccia è pronta: appena colleghiamo Stripe e PayPal potrai abbonarti da qui."}
        </div>
      )}

      {/* Billing cycle toggle */}
      <div className="inline-flex rounded-lg border-2 p-1" style={{ borderColor: "#c4956a" }}>
        {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
          <button
            key={c}
            onClick={() => setCycle(c)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${cycle === c ? "text-white font-bold" : "text-black"}`}
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
          // Business plan gets a "diamond" border: a shimmering iridescent
          // gradient ring (padding-box trick) instead of a flat border colour.
          const isBusiness = plan.id === "business";
          return (
            <div
              key={plan.id}
              className={`rounded-xl flex flex-col ${isBusiness ? "payments-diamond-border p-[2px]" : "border-2 p-5"}`}
              style={
                isBusiness
                  ? undefined
                  : {
                      borderColor: plan.highlighted ? "#c4956a" : "#eaddcb",
                      background: plan.highlighted ? "rgba(196,149,106,0.08)" : "rgba(252,246,237,0.5)",
                    }
              }
            >
            <div className={isBusiness ? "rounded-[10px] p-5 flex flex-col flex-1" : "contents"} style={isBusiness ? { background: "rgba(252,246,237,0.95)" } : undefined}>
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
              <p className="mt-1 text-xs text-black">{t(tk(plan.taglineKey)) || ""}</p>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-black">{formatEur(amount)}</span>
                <span className="text-sm text-black">
                  /{cycle === "yearly" ? t(tk("settings_payments_per_year")) || "anno" : t(tk("settings_payments_per_month")) || "mese"}
                </span>
              </div>

              <ul className="mt-4 space-y-1.5 flex-1">
                {plan.featureKeys.map((fk) => (
                  <li key={fk} className="flex items-start gap-2 text-sm text-black">
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
            </div>
          );
        })}
      </div>

      {/* Add-ons */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-black">{t(tk("settings_payments_addons_title")) || "Componenti aggiuntivi"}</h3>
          <p className="text-xs text-black">{t(tk("settings_payments_addons_desc")) || "Aggiungi ciò che ti serve. Si acquistano a parte dal tuo piano."}</p>
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
            // Recurring, payable add-ons can be added to the "pay everything
            // together" bundle. One-offs and coming-soon ones stay separate-only.
            const bundleable = addon.billing === "recurring" && !addon.comingSoon && !owned;
            const checked = selectedAddons.has(addon.id);
            return (
              <div
                key={addon.id}
                className="rounded-lg border-2 p-4 flex flex-col"
                style={{
                  borderColor: "#c4956a",
                  background: checked ? "rgba(196,149,106,0.10)" : "rgba(252,246,237,0.5)",
                  opacity: addon.comingSoon ? 0.6 : 1,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-black flex items-center gap-2">
                    {bundleable && (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAddon(addon.id)}
                        aria-label={t(tk("settings_payments_addon_select")) || "Seleziona per pagare insieme al piano"}
                        className="w-4 h-4 rounded cursor-pointer accent-[#c4956a]"
                      />
                    )}
                    {t(tk(addon.nameKey)) || addon.name}
                  </span>
                  <span className="text-sm font-extrabold text-black whitespace-nowrap">{priceLabel}</span>
                </div>
                <p className="mt-1 text-xs text-black flex-1">{t(tk(addon.descKey)) || ""}</p>
                {addon.contactUs ? (
                  // Variable-priced, sold by hand → single "contact us" CTA that
                  // opens WhatsApp with Sofía instead of Stripe/PayPal buttons.
                  <a
                    href={contactWhatsappUrl(
                      t(tk("settings_payments_contact_us_message")) || "Ciao, sarei interessato alla pagina web",
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-white text-xs font-bold rounded-lg cursor-pointer"
                    style={{ background: "linear-gradient(135deg, #25d366, #128c7e)" }}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    {t(tk("settings_payments_contact_us")) || "Contattaci"}
                  </a>
                ) : addon.comingSoon ? (
                  <div className="mt-3 text-center text-xs text-black py-2 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
                    {t(tk("settings_payments_coming_soon")) || "Prossimamente"}
                  </div>
                ) : owned ? (
                  <div className="mt-3 text-center text-xs font-bold text-emerald-700 py-2 rounded-lg" style={{ background: "rgba(16,185,129,0.08)" }}>
                    {t(tk("settings_payments_added")) || "Attivo"}
                  </div>
                ) : (
                  <>
                    {bundleable && (
                      <p className="mt-3 text-[11px] text-black">{t(tk("settings_payments_addon_buy_separately")) || "oppure acquistalo a parte:"}</p>
                    )}
                    <div className="mt-2 flex gap-2">
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
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pay everything together — plan + ticked recurring add-ons, one Stripe checkout */}
      <div className="rounded-xl border-2 p-5" style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.06)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[220px] flex-1">
            <h3 className="text-base font-bold text-black flex items-center gap-2">
              <Layers className="w-4 h-4" /> {t(tk("settings_payments_bundle_title")) || "Paga tutto in un'unica soluzione"}
            </h3>
            <p className="mt-1 text-xs text-black">
              {t(tk("settings_payments_bundle_desc")) || "Piano + componenti aggiuntivi selezionati, in un solo abbonamento Stripe."}
            </p>

            {/* Plan selector for the bundle */}
            <div className="mt-3 inline-flex rounded-lg border-2 p-1" style={{ borderColor: "#eaddcb" }}>
              {PLANS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setBundlePlan(p.id)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${bundlePlan === p.id ? "text-white font-bold" : "text-black"}`}
                  style={bundlePlan === p.id ? { background: "linear-gradient(135deg, #d4a574, #c4956a)" } : {}}
                >
                  {t(tk(p.nameKey)) || p.name}
                </button>
              ))}
            </div>

            {/* Selected add-ons recap */}
            {selectedList.length > 0 ? (
              <ul className="mt-3 space-y-1">
                <li className="flex items-center justify-between text-xs text-black">
                  <span>{t(tk(bundlePlanObj.nameKey)) || bundlePlanObj.name}</span>
                  <span className="font-bold">{formatEur(planAmount(bundlePlanObj, cycle))}/{perLabel}</span>
                </li>
                {selectedList.map((id) => {
                  const a = ADDONS.find((x) => x.id === id);
                  if (!a) return null;
                  return (
                    <li key={id} className="flex items-center justify-between text-xs text-black">
                      <span>+ {t(tk(a.nameKey)) || a.name}</span>
                      <span className="font-bold">{formatEur(cycle === "yearly" ? a.amount * 10 : a.amount)}/{perLabel}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-black">{t(tk("settings_payments_bundle_select_hint")) || "Seleziona almeno un componente aggiuntivo qui sopra per pagare tutto insieme."}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <div className="text-[11px] text-black">
                {(t(tk("settings_payments_bundle_total")) || "Totale {cycle}").replace("{cycle}", perLabel)}
              </div>
              <div className="text-2xl font-extrabold text-black">
                {formatEur(bundleSum)}<span className="text-sm font-normal text-black">/{perLabel}</span>
              </div>
            </div>
            <button
              onClick={checkoutBundle}
              disabled={!providers.stripe || selectedList.length === 0 || busy !== null}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #635bff, #4f46e5)" }}
            >
              {busy === "bundle" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {(t(tk("settings_payments_bundle_pay")) || "Paga piano + {n} aggiuntivi (Stripe)").replace("{n}", String(selectedList.length))}
            </button>
            {!providers.stripe && (
              <p className="text-[11px] text-black max-w-[200px] text-right">{t(tk("settings_payments_bundle_paypal_note")) || "Il pagamento combinato è disponibile solo con Stripe."}</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm rounded-lg p-3 text-red-600" style={{ background: "rgba(220,38,38,0.06)" }}>
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* The venue's OWN Stripe key for pay-at-table (QR) — money-in for the
          restaurant, unrelated to the subscription plans above. */}
      <TablePayCard />

      <p className="text-xs text-black">
        {t(tk("settings_payments_secure_note")) || "Pagamenti gestiti in modo sicuro da Stripe e PayPal. BALI Flow non conserva i dati della tua carta."}
      </p>
    </div>
  );
}
