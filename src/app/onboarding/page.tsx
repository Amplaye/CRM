"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, AlertTriangle, RefreshCw,
  Building, Clock, ClipboardList, Loader2, Globe, Star, Info, MessageCircle,
} from "lucide-react";
import {
  KbQuestionnaire, PaymentMethod, ParkingKind, Allergen, CancellationNotice, defaultQuestionnaire,
} from "@/lib/onboarding/kb-generator";
import { safeLocal } from "@/lib/safe-storage";
import { UI, type UiLang, UI_LANGS } from "./i18n";

// Client-facing self-serve onboarding. The owner provisions their OWN CRM:
// profile → hours → tables → fixed-field questionnaire (replaces the old
// "write the KB" step). There is NO voice-prompt step — that template is built
// server-side and the client never sees it. The admin's only remaining manual
// step (attaching the real WhatsApp number) happens afterwards.
//
// Three distinct "languages" live on this page, do not conflate them:
//   • UI language  — the wizard's own interface (top-right switcher); only
//     affects what THIS form looks like while filling it in.
//   • assistant languages — which language(s) the bot will SPEAK (multi-select
//     in step 1); the first one is primary and drives the voice + greeting.
//   • CRM language — the single language the owner's dashboard will be in after
//     onboarding (single-select in step 1). Saved on the tenant; the CRM is
//     then fixed to it (no in-app switcher). Independent of the two above.

// Bali Flow agency support number (Sofía's official WhatsApp — Meta WhatsApp,
// not the old Twilio sandbox). The "Contact support" button on the provisioning
// screen deep-links here so a stuck owner reaches us in one tap. When we get a
// dedicated support line, change only this constant.
const SUPPORT_WHATSAPP = "34641459479"; // E.164 without "+", for wa.me

type Step = 1 | 2 | 3 | 4;
type AsstLang = "es" | "it" | "en" | "de";
type CrmLang = "es" | "it" | "en" | "de";

interface Slot { open: string; close: string }
type Hours = Record<string, Slot[]>;

// Assistant languages shown as multi-select chips (native names).
const ASST_LANGS: Array<[AsstLang, string]> = [
  ["es", "Español"], ["it", "Italiano"], ["en", "English"], ["de", "Deutsch"],
];

const DEFAULT_HOURS: Hours = {
  "0": [{ open: "12:30", close: "15:30" }], "1": [],
  "2": [{ open: "19:30", close: "22:30" }],
  "3": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "4": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "5": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "6": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
};

// Option lists pair a stable enum key with a TRANSLATED label, so the labels
// follow the UI language while the value sent to the API never changes.
// "Bizum" is a brand name and stays untranslated.
type Q4 = (typeof UI)[UiLang]["q4"];
const PAYMENTS = (q4: Q4): Array<[PaymentMethod, string]> => [
  ["cash", q4.payCash], ["card", q4.payCard], ["contactless", q4.payContactless], ["bizum", "Bizum"],
];
// Major kitchen allergens (presence → cross-contamination warning in the KB).
const ALLERGENS = (q4: Q4): Array<[Allergen, string]> => [
  ["gluten", q4.alGluten], ["dairy", q4.alDairy], ["egg", q4.alEgg], ["nuts", q4.alNuts],
  ["peanuts", q4.alPeanuts], ["fish", q4.alFish], ["shellfish", q4.alShellfish], ["soy", q4.alSoy], ["sesame", q4.alSesame],
];
const CANCELLATIONS = (q4: Q4): Array<[CancellationNotice, string]> => [
  ["none", q4.cxNone], ["same_day", q4.cxSameDay], ["2h", q4.cx2h], ["24h", q4.cx24h],
];
const NOSHOW_OPTS = (q4: Q4): Array<[string, string]> => [
  ["0", q4.nsNone], ["15", "15 min"], ["30", "30 min"], ["45", "45 min"], ["60", "60 min"],
];
// Last-reservation cut-off = minutes BEFORE each shift's closing time. The actual
// time is computed per day from opening_hours; the owner only picks the margin.
// -1 = that shift isn't served at all.
const LAST_RESERVATION_OPTS = (q4: Q4): Array<[string, string]> => [
  ["0", q4.lrAtClose], ["15", `15 min ${q4.lrBeforeClose}`], ["30", `30 min ${q4.lrBeforeClose}`],
  ["45", `45 min ${q4.lrBeforeClose}`], ["60", `1 h ${q4.lrBeforeClose}`], ["90", `1 h 30 ${q4.lrBeforeClose}`],
  ["-1", q4.lrNoService],
];

// Quick-pick party sizes for auto-confirmation; "Other…" lets the owner type any
// number. Module-level so the array identity is stable across renders.
const AUTO_CONFIRM_PRESETS = [4, 6, 8, 10];

const TIMEZONES: Array<[string, string]> = [
  ["Atlantic/Canary", "Atlantic/Canary (Las Palmas)"],
  ["Europe/Madrid", "Europe/Madrid"],
  ["Europe/Rome", "Europe/Rome"],
  ["Europe/Berlin", "Europe/Berlin (Deutschland)"],
];

export default function OnboardingPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  // UI language for the wizard chrome (separate from the assistant languages).
  const [ui, setUi] = useState<UiLang>("es");
  // Tracks whether the owner has explicitly picked a CRM language; until then we
  // mirror the wizard UI language into it (the most likely choice).
  const crmTouched = useRef(false);
  useEffect(() => {
    const saved = safeLocal.get("onboarding_ui_lang") as UiLang | null;
    if (saved && (UI_LANGS as readonly string[]).includes(saved)) {
      setUi(saved);
      if (!crmTouched.current) setCrmLocale(saved);
    }
  }, []);
  const changeUi = (l: UiLang) => {
    setUi(l); safeLocal.set("onboarding_ui_lang", l);
    if (!crmTouched.current) setCrmLocale(l); // keep CRM lang in step with UI until chosen
  };
  const changeCrmLocale = (l: CrmLang) => { crmTouched.current = true; setCrmLocale(l); };
  const t = UI[ui];

  const [bootState, setBootState] = useState<"loading" | "ready" | "anon">("loading");
  const [tenantId, setTenantId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  // STEP 1 — profile
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("+34 ");
  const [ownerPhone, setOwnerPhone] = useState("+34");
  // Assistant speaks these; the first is primary (drives voice/greeting).
  const [languages, setLanguages] = useState<AsstLang[]>(["es"]);
  // The single language the owner's CRM dashboard will be in (independent of
  // the assistant languages above). Defaults to the wizard's UI language so the
  // most likely choice is pre-filled.
  const [crmLocale, setCrmLocale] = useState<CrmLang>("es");
  const [timezone, setTimezone] = useState("Atlantic/Canary");
  const [reviewUrl, setReviewUrl] = useState("");

  // STEP 2 — hours
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);
  // STEP 3 — questionnaire (5 cards). The starter floor plan is generated from
  // the declared capacity (Card 1 → capacity_seats), so there's no separate
  // small/medium/large table step any more.
  const [q, setQ] = useState<KbQuestionnaire>(() => defaultQuestionnaire());

  const [step, setStep] = useState<Step>(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Array<{ step: string; message: string; ok: boolean }>>([]);
  const [done, setDone] = useState<{ ok: boolean } | null>(null);

  // Toggle an assistant language. Removing the primary promotes the next one;
  // never let the list go empty (at least one language must stay selected).
  const toggleLang = (l: AsstLang) =>
    setLanguages((prev) =>
      prev.includes(l) ? (prev.length > 1 ? prev.filter((x) => x !== l) : prev) : [...prev, l]);
  // Make a selected language the primary one (move to front).
  const makePrimary = (l: AsstLang) =>
    setLanguages((prev) => (prev[0] === l || !prev.includes(l) ? prev : [l, ...prev.filter((x) => x !== l)]));

  // Resolve the owner's tenant; bounce if already provisioned or not signed in.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) { setBootState("anon"); router.replace("/login"); return; }
      const load = async () =>
        (await supabase
          .from("tenant_members")
          .select("tenant_id, role, tenants(id, name, settings)")
          .eq("user_id", user.id)).data || [];
      let rows = await load();
      let owner = rows.find((r: any) => r.role === "owner");
      // Self-heal: an owner can reach the wizard with NO tenant if the
      // tenant-creation fetch at sign-up never completed (flaky network, tab
      // closed, email confirmed on another device). Rather than bounce them to
      // an empty dashboard, create the trial tenant now and continue. Only the
      // genuine "no membership at all" case triggers repair; staff/manager rows
      // are left to fall through to the dashboard.
      if (!owner && rows.length === 0) {
        try {
          await fetch("/api/ensure-tenant", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          rows = await load();
          owner = rows.find((r: any) => r.role === "owner");
        } catch { /* fall through to the bounce below */ }
      }
      if (!active) return;
      const tn = owner?.tenants as any;
      if (!owner || !tn) { router.replace("/"); return; }
      if (tn.settings?.onboarding?.completed) { router.replace("/"); return; }
      setUserId(user.id);
      setTenantId(tn.id);
      if (tn.name) setRestaurantName(tn.name);
      setBootState("ready");
    })();
    return () => { active = false; };
  }, [supabase, router]);

  const setQF = <K extends keyof KbQuestionnaire>(k: K, v: KbQuestionnaire[K]) =>
    setQ((prev) => ({ ...prev, [k]: v }));
  const togglePayment = (m: PaymentMethod) =>
    setQ((prev) => ({
      ...prev,
      payments: prev.payments.includes(m) ? prev.payments.filter((x) => x !== m) : [...prev.payments, m],
    }));
  const toggleAllergen = (a: Allergen) =>
    setQ((prev) => ({
      ...prev,
      kitchen_allergens: prev.kitchen_allergens.includes(a)
        ? prev.kitchen_allergens.filter((x) => x !== a)
        : [...prev.kitchen_allergens, a],
    }));
  // Parking is multi-select (a venue can offer several options at once), but
  // "none" is mutually exclusive: picking it clears the rest, and picking any
  // real option clears "none".
  const toggleParking = (p: ParkingKind) =>
    setQ((prev) => {
      if (p === "none") return { ...prev, parking_info: prev.parking_info.includes("none") ? [] : ["none"] };
      const without = prev.parking_info.filter((x) => x !== "none");
      return {
        ...prev,
        parking_info: without.includes(p) ? without.filter((x) => x !== p) : [...without, p],
      };
    });
  const setRec = (i: number, v: string) =>
    setQ((prev) => { const next = [...prev.chef_recommendations]; next[i] = v; return { ...prev, chef_recommendations: next }; });
  const addRec = () =>
    setQ((prev) => (prev.chef_recommendations.length >= 6 ? prev : { ...prev, chef_recommendations: [...prev.chef_recommendations, ""] }));
  const removeRec = (i: number) =>
    setQ((prev) => ({ ...prev, chef_recommendations: prev.chef_recommendations.filter((_, idx) => idx !== i) }));

  function setHourSlot(day: string, idx: number, field: "open" | "close", value: string) {
    setHours((h) => { const next = { ...h, [day]: [...(h[day] || [])] }; next[day][idx] = { ...next[day][idx], [field]: value }; return next; });
  }
  const addHourSlot = (day: string) => setHours((h) => ({ ...h, [day]: [...(h[day] || []), { open: "12:30", close: "15:30" }] }));
  const removeHourSlot = (day: string, idx: number) => setHours((h) => ({ ...h, [day]: (h[day] || []).filter((_, i) => i !== idx) }));

  // After provisioning, the TenantContext sessionStorage cache still holds the
  // pre-onboarding settings (onboarding.completed:false). Clear it before the
  // full reload so the dashboard guard reads the fresh, completed state and
  // doesn't bounce the owner straight back into this wizard.
  function goToPanel() {
    try { if (userId) sessionStorage.removeItem(`tenant_ctx_${userId}`); } catch {}
    window.location.href = "/";
  }

  async function submit() {
    setRunning(true); setProgress([]); setDone(null);
    // Watchdog: provisioning is bounded server-side (maxDuration 120s + per-call
    // timeouts), but if the connection drops mid-stream — flaky mobile network,
    // Vercel killing the function, a proxy cutting an idle keep-alive — the
    // reader can hang and the wizard would sit on the loading screen forever
    // (the exact bug an owner hit on her phone). This aborts the fetch and shows
    // the retry / contact-support actions instead of an endless spinner. It's
    // cleared as soon as the stream ends normally.
    const ctrl = new AbortController();
    const watchdog = setTimeout(() => ctrl.abort(), 150_000);
    let sawResult = false;
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          restaurant_name: restaurantName,
          restaurant_phone: restaurantPhone.trim(),
          owner_phone: ownerPhone.trim(),
          // Send the full list (primary first); keep `language` for back-compat.
          language: languages[0], languages,
          // The dashboard language (independent of the assistant languages).
          crm_locale: crmLocale,
          timezone,
          review_url: reviewUrl.trim(),
          opening_hours: hours,
          questionnaire: q,
        }),
      });
      if (!res.ok || !res.body) throw new Error(res.ok ? "no stream" : `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done: sDone } = await reader.read();
        if (sDone) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim(); if (!json) continue;
          try {
            const ev = JSON.parse(json);
            if (ev.step === "result") { sawResult = true; setDone({ ok: ev.ok }); }
            else setProgress((p) => [...p, { step: ev.step, message: ev.message, ok: ev.ok }]);
          } catch {}
        }
      }
      // Stream ended without a terminal result event (truncated function, dropped
      // connection). Don't leave the user hanging — fail explicitly so the retry
      // and contact-support buttons appear.
      if (!sawResult) {
        setProgress((p) => [...p, { step: "error", message: t.connectionLost, ok: false }]);
        setDone({ ok: false });
      }
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? t.connectionLost : (e?.message || String(e));
      setProgress((p) => [...p, { step: "error", message: msg, ok: false }]);
      setDone({ ok: false });
    } finally {
      clearTimeout(watchdog);
      setRunning(false);
    }
  }

  if (bootState !== "ready") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#c4956a]" />
      </div>
    );
  }

  if (running || done) {
    return (
      <Shell ui={ui} onUi={changeUi} t={t}>
        <h1 className="text-2xl font-bold mb-2">{t.creatingTitle}</h1>
        <p className="text-sm text-black mb-6">
          {done?.ok ? t.creatingDone : done && !done.ok ? t.creatingFail : t.creatingBusy}
        </p>
        <div className="rounded-xl border-2 border-[#c4956a] bg-white p-4 space-y-2 max-h-[55vh] overflow-y-auto">
          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {p.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <span className="font-bold uppercase text-[11px] tracking-widest text-black mr-2">{p.step}</span>
                <span className={p.ok ? "text-black break-words" : "text-red-600 font-medium break-words"}>{p.message}</span>
              </div>
            </div>
          ))}
          {running && <div className="flex items-center gap-2 text-xs text-black pt-2"><RefreshCw className="w-3 h-3 animate-spin" /> {t.inProgress}</div>}
        </div>
        {done?.ok && (
          <div className="mt-6">
            <button onClick={goToPanel} className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold">{t.goToPanel}</button>
          </div>
        )}
        {done && !done.ok && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={() => { setRunning(false); setDone(null); setProgress([]); }} className="px-4 py-2 rounded-lg border-2 border-[#c4956a] bg-white">{t.retry}</button>
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
                `Hola, soy ${restaurantName || "un restaurante"} y tuve un error creando mi CRM.` +
                (tenantId ? ` (ID: ${tenantId})` : "") +
                (progress.find((p) => !p.ok)?.message ? `\nError: ${progress.find((p) => !p.ok)!.message}` : "")
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#25D366] text-white font-bold"
            >
              <MessageCircle className="w-4 h-4" /> {t.contactSupport}
            </a>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell ui={ui} onUi={changeUi} t={t}>
      <h1 className="text-2xl font-bold mb-1">{t.title}</h1>
      <p className="text-sm text-black mb-6">{t.subtitle}</p>

      <div className="flex items-center gap-1.5 sm:gap-2 mb-2">
        {[1, 2, 3, 4].map((n) => (<div key={n} className={`flex-1 h-1.5 rounded-full transition-colors ${n <= step ? "bg-[#c4956a]" : "bg-zinc-200"}`} />))}
      </div>
      <p className="text-[11px] text-black/60 mb-5">{t.stepCounter.replace("{n}", String(step)).replace("{total}", "4")}</p>

      {step === 1 && (
        <div className="space-y-5">
          <h2 className="text-base font-bold flex items-center gap-2"><Building className="w-4 h-4" /> 1. {t.s1}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
            <Field label={t.fName} value={restaurantName} onChange={setRestaurantName} placeholder="Trattoria Rossa" />
            <Field label={t.fPhone} value={restaurantPhone} onChange={setRestaurantPhone} placeholder="+34 928 123 456" inputMode="tel" />
            <Field label={t.fWhatsapp} value={ownerPhone} onChange={setOwnerPhone} placeholder="+34 6XX XXX XXX" inputMode="tel" />
            <Field label={t.fReview} value={reviewUrl} onChange={setReviewUrl} placeholder="https://maps.google.com/..." inputMode="url" />
            <SelectField label={t.fTimezone} value={timezone} onChange={setTimezone} options={TIMEZONES} />
            <div className="hidden sm:block" aria-hidden />
            <div className="sm:col-span-2">
              <LangMultiSelect
                label={t.fLanguages}
                hint={t.fLanguagesHint}
                primaryBadge={t.primary}
                makePrimaryHint={t.makePrimaryHint}
                selected={languages}
                onToggle={toggleLang}
                onPrimary={makePrimary}
              />
            </div>
            <div className="sm:col-span-2">
              <SelectField label={t.fCrmLang} value={crmLocale} onChange={(v) => changeCrmLocale(v as CrmLang)} options={ASST_LANGS} />
              <p className="text-[11px] text-black mt-2">{t.fCrmLangHint}</p>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Clock className="w-4 h-4" /> 2. {t.s2}</h2>
          <p className="text-xs text-black">{t.s2hint}</p>
          <div className="space-y-2">
            {t.days.map((label, di) => {
              const idx = String((di + 1) % 7); // map Mon-first labels back to "1".."6","0"
              return (
                <div key={idx} className="rounded-xl border-2 border-[#c4956a]/40 bg-white/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold">{label}</h4>
                    <button onClick={() => addHourSlot(idx)} className="text-xs font-semibold text-[#8b6540]">{t.addSlot}</button>
                  </div>
                  {(hours[idx] || []).length === 0 ? <p className="text-xs text-black">{t.closed}</p> : (
                    <div className="space-y-2">
                      {(hours[idx] || []).map((s, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-center">
                          <input type="time" value={s.open} onChange={(e) => setHourSlot(idx, i, "open", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                          <span className="text-xs">→</span>
                          <input type="time" value={s.close} onChange={(e) => setHourSlot(idx, i, "close", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                          <button onClick={() => removeHourSlot(idx, i)} className="text-xs text-red-500">{t.remove}</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <h2 className="text-base font-bold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> 3. {t.s4}</h2>
          <p className="text-xs text-black">{t.s4hint}</p>

          {/* Card 1 — Reservations & groups */}
          <Card title={t.q4.cardReservations}>
            <NumField label={t.q4.capacity} value={q.capacity_seats} onChange={(v) => setQF("capacity_seats", v)} />
            <PresetOrCustomNumber label={t.q4.autoConfirmUpTo} value={q.auto_confirm_max} onChange={(v) => setQF("auto_confirm_max", v)} presets={AUTO_CONFIRM_PRESETS} unit={t.q4.personsUnit} otherLabel={t.q4.optOther} optLabel={t.q4.optPersons} info={t.q4.info.autoConfirm} />
            <YesNo label={t.q4.largeGroups} value={q.accepts_large_groups} onChange={(v) => setQF("accepts_large_groups", v)} t={t} info={t.q4.info.largeGroups} />
            {q.accepts_large_groups && <YesNo label={t.q4.deposit} value={q.deposit_required} onChange={(v) => setQF("deposit_required", v)} t={t} info={t.q4.info.deposit} />}
            <Dropdown label={t.q4.lateTolerance} value={String(q.late_tolerance_min)} onChange={(v) => setQF("late_tolerance_min", Number(v))} options={[["10", "10 min"], ["15", "15 min"], ["20", "20 min"], ["30", "30 min"]]} info={t.q4.info.lateTolerance} />
            <YesNo label={t.q4.lateGrace} value={q.late_grace_if_notified} onChange={(v) => setQF("late_grace_if_notified", v)} t={t} info={t.q4.info.lateGrace} />
            <Dropdown label={t.q4.cancellationNotice} value={q.cancellation_notice} onChange={(v) => setQF("cancellation_notice", v as CancellationNotice)} options={CANCELLATIONS(t.q4)} info={t.q4.info.cancellationNotice} />
            <Dropdown label={t.q4.noShowRelease} value={String(q.noshow_release_min)} onChange={(v) => setQF("noshow_release_min", Number(v))} options={NOSHOW_OPTS(t.q4)} info={t.q4.info.noShowRelease} />
            <Dropdown label={t.q4.lastLunch} value={String(q.last_lunch_offset_min)} onChange={(v) => setQF("last_lunch_offset_min", Number(v))} options={LAST_RESERVATION_OPTS(t.q4)} info={t.q4.info.lastReservation} />
            <Dropdown label={t.q4.lastDinner} value={String(q.last_dinner_offset_min)} onChange={(v) => setQF("last_dinner_offset_min", Number(v))} options={LAST_RESERVATION_OPTS(t.q4)} info={t.q4.info.lastReservation} />
          </Card>

          {/* Card 2 — Practical services */}
          <Card title={t.q4.cardServices}>
            <YesNo label={t.q4.highChairs} value={q.high_chairs} onChange={(v) => setQF("high_chairs", v)} t={t} />
            <YesNo label={t.q4.kidsMenu} value={q.kids_menu} onChange={(v) => setQF("kids_menu", v)} t={t} />
            <YesNo label={t.q4.pets} value={q.pets} onChange={(v) => setQF("pets", v)} t={t} />
            <YesNo label={t.q4.accessible} value={q.accessible} onChange={(v) => setQF("accessible", v)} t={t} />
            <YesNo label={t.q4.wifi} value={q.wifi} onChange={(v) => setQF("wifi", v)} t={t} />
            <YesNo label={t.q4.terrace} value={q.terrace} onChange={(v) => setQF("terrace", v)} t={t} />
            <YesNo label={t.q4.takeaway} value={q.takeaway} onChange={(v) => setQF("takeaway", v)} t={t} />
            {q.takeaway && <Field label={t.q4.takeawayWait} value={q.takeaway_wait} onChange={(v) => setQF("takeaway_wait", v)} placeholder="20-30 min" />}
            <YesNo label={t.q4.delivery} value={q.delivery} onChange={(v) => setQF("delivery", v)} t={t} />
            {q.delivery && <Field label={t.q4.deliveryPlatform} value={q.delivery_platform} onChange={(v) => setQF("delivery_platform", v)} placeholder="Glovo, Uber Eats…" />}
            <YesNo label={t.q4.celebrations} value={q.celebrations} onChange={(v) => setQF("celebrations", v)} t={t} />
            <YesNo label={t.q4.outsideCake} value={q.outside_cake} onChange={(v) => setQF("outside_cake", v)} t={t} />
            <div>
              <Lbl>{t.q4.paymentMethods}</Lbl>
              <div className="flex flex-wrap gap-2">
                {PAYMENTS(t.q4).map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => togglePayment(k)} className={`px-3 py-1.5 rounded-full text-sm border-2 transition-colors ${q.payments.includes(k) ? "border-[#c4956a] bg-[#c4956a]/15 font-semibold" : "border-zinc-200 bg-white hover:border-[#c4956a]/50"}`}>{lbl}</button>
                ))}
              </div>
            </div>
          </Card>

          {/* Card 3 — Diets & allergies */}
          <Card title={t.q4.cardDiets}>
            <YesNo label={t.q4.vegetarian} value={q.vegetarian} onChange={(v) => setQF("vegetarian", v)} t={t} />
            <YesNo label={t.q4.vegan} value={q.vegan} onChange={(v) => setQF("vegan", v)} t={t} />
            <YesNo label={t.q4.glutenFree} value={q.gluten_free} onChange={(v) => setQF("gluten_free", v)} t={t} />
            <YesNo label={t.q4.lactoseFree} value={q.lactose_free} onChange={(v) => setQF("lactose_free", v)} t={t} />
            <YesNo label={t.q4.celiac} value={q.celiac_safe} onChange={(v) => setQF("celiac_safe", v)} t={t} info={t.q4.info.celiac} />
            <div className="pt-1 border-t border-zinc-100">
              <Lbl>{t.q4.allergensTitle}</Lbl>
              <p className="text-[11px] text-black mb-2">{t.q4.allergensHint}</p>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS(t.q4).map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => toggleAllergen(k)} className={`px-3 py-1.5 rounded-full text-sm border-2 transition-colors ${q.kitchen_allergens.includes(k) ? "border-[#c4956a] bg-[#c4956a]/15 font-semibold" : "border-zinc-200 bg-white hover:border-[#c4956a]/50"}`}>{lbl}</button>
                ))}
              </div>
            </div>
            <YesNo label={t.q4.cannotGuarantee} value={q.cannot_guarantee_traces} onChange={(v) => setQF("cannot_guarantee_traces", v)} t={t} info={t.q4.info.cannotGuarantee} />
            <YesNo label={t.q4.severeAllergy} value={q.severe_allergy_escalate} onChange={(v) => setQF("severe_allergy_escalate", v)} t={t} info={t.q4.info.severeAllergy} />
            <YesNo label={t.q4.allergenSheet} value={q.allergen_info} onChange={(v) => setQF("allergen_info", v)} t={t} info={t.q4.info.allergenSheet} />
          </Card>

          {/* Card 4 — How to get there */}
          <Card title={t.q4.cardLocation}>
            <Field label={t.q4.cuisineType} value={q.cuisine_type} onChange={(v) => setQF("cuisine_type", v)} placeholder="Trattoria napolitana" />
            <AddressField
              label={t.q4.address}
              value={q.address}
              placeholder="Avenida Rafael Cabrera, 7"
              hint={t.q4.addressHint}
              searching={t.q4.addressSearching}
              onChange={(v) => setQF("address", v)}
              onSelect={(p) => setQ((prev) => ({ ...prev, address: p.address, city: p.city || prev.city, neighborhood: p.neighborhood || prev.neighborhood }))}
            />
            <Field label={t.q4.cityPostal} value={q.city} onChange={(v) => setQF("city", v)} placeholder="35002 Las Palmas de Gran Canaria" />
            <Field label={t.q4.area} value={q.neighborhood} onChange={(v) => setQF("neighborhood", v)} placeholder="Triana / Vegueta" />
            <div>
              <Lbl>{t.q4.parking}</Lbl>
              <div className="flex flex-wrap gap-2">
                {([["own", t.q4.pkOwn], ["public", t.q4.pkPublic], ["street", t.q4.pkStreet], ["none", t.q4.pkNone]] as Array<[ParkingKind, string]>).map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => toggleParking(k)} className={`px-3 py-1.5 rounded-full text-sm border-2 transition-colors ${q.parking_info.includes(k) ? "border-[#c4956a] bg-[#c4956a]/15 font-semibold" : "border-zinc-200 bg-white hover:border-[#c4956a]/50"}`}>{lbl}</button>
                ))}
              </div>
            </div>
            <YesNo label={t.q4.publicTransport} value={q.public_transport} onChange={(v) => setQF("public_transport", v)} t={t} />
            <Field label={t.q4.landmark} value={q.landmark} onChange={(v) => setQF("landmark", v)} placeholder="Junto a la playa de Las Canteras" />
          </Card>

          {/* Card 5 — Recommended dishes (optional) */}
          <Card title={t.q4.cardChef}>
            <p className="text-[11px] text-black -mt-1">{t.q4.chefHint}</p>
            <div className="space-y-2">
              {q.chef_recommendations.map((r, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={r} onChange={(e) => setRec(i, e.target.value)} placeholder="Mortazza — la más pedida" className="flex-1 min-w-0 border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40" />
                  <button type="button" onClick={() => removeRec(i)} className="text-xs text-red-500 px-1 flex-shrink-0">{t.remove}</button>
                </div>
              ))}
              {q.chef_recommendations.length < 6 && (
                <button type="button" onClick={addRec} className="text-xs font-semibold text-[#8b6540]">{t.addDish}</button>
              )}
            </div>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Check className="w-4 h-4" /> 4. {t.s5}</h2>
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
            <ul className="text-xs space-y-0.5">
              <li>• {t.sumRestaurant}: <b>{restaurantName || "—"}</b></li>
              <li>• {t.sumLanguages}: <b>{languages.map((l) => ASST_LANGS.find(([v]) => v === l)?.[1] || l).join(", ")}</b></li>
              <li>• {t.sumCrmLang}: <b>{ASST_LANGS.find(([v]) => v === crmLocale)?.[1] || crmLocale}</b></li>
              <li>• {t.sumCapacity}: {q.capacity_seats} · {t.sumAutoConfirm} {q.auto_confirm_max}</li>
              <li>• {t.sumPayments}: {q.payments.length || "—"}</li>
            </ul>
          </div>
          <p className="text-xs text-black">{t.sumFootnote}</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button onClick={() => setStep((s) => (s - 1) as Step)} disabled={step === 1} className="flex items-center gap-1 px-4 py-2 rounded-lg border-2 border-[#c4956a] text-[#c4956a] disabled:opacity-30"><ChevronLeft className="w-4 h-4" /> {t.back}</button>
        {step < 4 ? (
          <button onClick={() => setStep((s) => (s + 1) as Step)} className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-[#c4956a] text-white font-bold hover:bg-[#b3855c] transition-colors">{t.next} <ChevronRight className="w-4 h-4" /></button>
        ) : (
          <button onClick={submit} disabled={!restaurantName.trim()} className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"><Check className="w-4 h-4" /> {t.createCrm}</button>
        )}
      </div>
    </Shell>
  );
}

/* ── small presentational helpers ── */
function Shell({ children, ui, onUi, t }: { children: React.ReactNode; ui: UiLang; onUi: (l: UiLang) => void; t: (typeof UI)[UiLang] }) {
  return (
    <div className="min-h-[100dvh] py-6 sm:py-10 px-4 relative z-10">
      <div className="max-w-3xl mx-auto rounded-2xl border-2 p-5 sm:p-8 relative" style={{ background: "rgba(252,246,237,0.9)", borderColor: "#c4956a" }}>
        <div className="flex justify-end mb-3 sm:mb-4">
          <LangSwitcher value={ui} onChange={onUi} label={t.uiLangLabel} />
        </div>
        {children}
      </div>
    </div>
  );
}

// Top-right wizard-UI language switcher. Compact segmented control; each option
// shows its native short code, full native name as title. Wraps cleanly on
// mobile where it sits above the title.
function LangSwitcher({ value, onChange, label }: { value: UiLang; onChange: (l: UiLang) => void; label: string }) {
  const items: Array<[UiLang, string, string]> = [
    ["es", "ES", "Español"], ["it", "IT", "Italiano"], ["en", "EN", "English"], ["de", "DE", "Deutsch"],
  ];
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <Globe className="w-3.5 h-3.5 text-[#8b6540] flex-shrink-0" aria-hidden />
      <div className="flex items-center rounded-full border-2 border-[#c4956a]/40 bg-white/70 p-0.5">
        {items.map(([code, short, full]) => (
          <button
            key={code}
            type="button"
            onClick={() => onChange(code)}
            title={full}
            aria-pressed={value === code}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide transition-colors ${
              value === code ? "bg-[#c4956a] text-white shadow-sm" : "text-[#8b6540] hover:bg-[#c4956a]/10"
            }`}
          >
            {short}
          </button>
        ))}
      </div>
    </div>
  );
}

// Assistant-language multi-select. Each chip = one language the bot will speak.
// The chip body toggles selection; the first selected language is the PRIMARY
// (drives voice + greeting). Primary is marked with a filled star + badge;
// selected non-primary chips show an outline star INSIDE the chip that promotes
// them. Everything is inline (no absolute positioning) so chips wrap cleanly on
// mobile without controls colliding. Always keeps ≥1 selected.
function LangMultiSelect({
  label, hint, primaryBadge, makePrimaryHint, selected, onToggle, onPrimary,
}: {
  label: string; hint: string; primaryBadge: string; makePrimaryHint: string;
  selected: AsstLang[]; onToggle: (l: AsstLang) => void; onPrimary: (l: AsstLang) => void;
}) {
  const primary = selected[0];
  return (
    <div>
      <Lbl>{label}</Lbl>
      <div className="flex flex-wrap gap-x-2 gap-y-2.5">
        {ASST_LANGS.map(([code, name]) => {
          const on = selected.includes(code);
          const isPrimary = primary === code;
          return (
            <div
              key={code}
              className={`flex items-center gap-1.5 rounded-xl text-sm border-2 transition-colors overflow-hidden ${
                on ? "border-[#c4956a] bg-[#c4956a]/15 text-[#5e421f]" : "border-zinc-200 bg-white text-black"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(code)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 pl-3 py-2 ${on ? "font-semibold" : "hover:text-[#5e421f]"} ${isPrimary || !on ? "pr-3" : "pr-2"}`}
              >
                {on && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                <span className="whitespace-nowrap">{name}</span>
                {isPrimary && (
                  <span className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-[#c4956a] text-white text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap">
                    <Star className="w-2.5 h-2.5 fill-current" /> {primaryBadge}
                  </span>
                )}
              </button>
              {/* Promote-to-primary: only on selected, non-primary chips. Inline,
                  with a divider, so it never overlaps neighbouring chips. */}
              {on && !isPrimary && (
                <button
                  type="button"
                  onClick={() => onPrimary(code)}
                  title={makePrimaryHint}
                  aria-label={`${makePrimaryHint}: ${name}`}
                  className="self-stretch px-2 border-l-2 border-[#c4956a]/30 text-[#8b6540] hover:bg-[#c4956a] hover:text-white transition-colors"
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-black mt-2">{hint}</p>
    </div>
  );
}

// Inline help affordance: a small ⓘ next to a label. The bubble opens on hover
// (desktop) and on tap/click (mobile/keyboard) — tap toggles, so it works where
// there is no hover. It closes on outside click or Escape. Self-contained so it
// can sit next to any label without extra wiring; only needs the help text.
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // Resolved on open from the button's on-screen position so the bubble is
  // clamped inside the viewport — a centred absolute tooltip used to overflow
  // the right edge on mobile for fields near the screen border.
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Position the bubble (fixed) above the icon, then nudge it left/right so it
  // never crosses an 8px margin on either side. The arrow tracks the icon.
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const M = 8; // viewport margin
    const W = Math.min(256, window.innerWidth - M * 2); // bubble width (max 16rem)
    const iconCenter = b.left + b.width / 2;
    let left = iconCenter - W / 2;
    left = Math.max(M, Math.min(left, window.innerWidth - M - W));
    const arrow = Math.max(12, Math.min(W - 12, iconCenter - left)); // arrow x inside bubble
    setPos({ left, top: b.top - 8, arrow });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onMove = () => place(); // keep aligned on scroll / orientation change
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  const W = typeof window !== "undefined" ? Math.min(256, window.innerWidth - 16) : 256;
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        aria-label={text}
        aria-expanded={open}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[#8b6540] hover:text-[#5e421f] focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40"
      >
        <Info className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && pos && (
        <span
          role="tooltip"
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, transform: "translateY(-100%)" }}
          className="z-50 rounded-lg bg-[#3a2a18] px-3 py-2 text-[11px] font-normal normal-case tracking-normal leading-snug text-white shadow-lg"
        >
          {text}
          <span style={{ left: pos.arrow }} className="absolute top-full -mt-px -translate-x-1/2 border-4 border-transparent border-t-[#3a2a18]" aria-hidden />
        </span>
      )}
    </span>
  );
}
function Lbl({ children, info }: { children: React.ReactNode; info?: string }) {
  return (
    <label className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider mb-1 text-black">
      <span>{children}</span>
      {info && <InfoTip text={info} />}
    </label>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-[#c4956a]/40 bg-white p-4 space-y-3">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, value, onChange, placeholder, type = "text", inputMode, info }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; info?: string }) {
  return (<div><Lbl info={info}>{label}</Lbl><input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]" /></div>);
}
// Worldwide address autocomplete backed by OpenStreetMap Nominatim (free, no
// API key). Typing fires a debounced search; picking a suggestion fills the
// street into `address` and best-effort city/postcode + neighbourhood into the
// two fields below it. The user can always edit any field by hand afterwards.
interface AddressPick { address: string; city: string; neighborhood: string }
interface NominatimResult {
  display_name: string;
  address?: Record<string, string>;
}
function buildPick(r: NominatimResult): AddressPick {
  const a = r.address || {};
  const street = a.road || a.pedestrian || a.footway || a.path || "";
  const houseNo = a.house_number || "";
  const line = street ? (houseNo ? `${street}, ${houseNo}` : street) : (r.display_name.split(",")[0] || "");
  const cityName = a.city || a.town || a.village || a.municipality || a.county || "";
  const postcode = a.postcode || "";
  const city = [postcode, cityName].filter(Boolean).join(" ");
  const neighborhood = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.district || "";
  return { address: line || r.display_name, city, neighborhood };
}
function AddressField({ label, value, placeholder, hint, searching, onChange, onSelect }: {
  label: string; value: string; placeholder?: string; hint?: string; searching?: string;
  onChange: (v: string) => void; onSelect: (p: AddressPick) => void;
}) {
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Skip the search that would fire right after a suggestion is chosen.
  const skipRef = useRef(false);

  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    const term = value.trim();
    if (term.length < 4) { setResults([]); setOpen(false); return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        // Proxy through our own API: Nominatim returns 403 to browser-origin
        // requests, so calling it directly from here returned nothing.
        const url = `/api/geocode?q=${encodeURIComponent(term)}`;
        const res = await fetch(url, { signal: ctrl.signal, headers: { "Accept-Language": navigator.language || "en" } });
        const data: NominatimResult[] = res.ok ? await res.json() : [];
        setResults(data);
        setOpen(data.length > 0);
      } catch { /* aborted or offline — keep typing usable as a plain field */ }
      finally { setLoading(false); }
    }, 450);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [value]);

  // Close the suggestion list when tapping/clicking outside. Listen for touch
  // too — on mobile only `touchstart` fires, so a mouse-only listener left the
  // list stuck open (and could swallow the tap on a result).
  useEffect(() => {
    const onDoc = (e: Event) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, []);

  const pickedRef = useRef(false);
  const pick = (r: NominatimResult) => {
    if (pickedRef.current) return; // guard the touchend→synthetic-mousedown double fire
    pickedRef.current = true;
    skipRef.current = true;
    onSelect(buildPick(r));
    setOpen(false);
    setResults([]);
    setTimeout(() => { pickedRef.current = false; }, 400);
  };

  return (
    <div ref={boxRef} className="relative">
      <Lbl>{label}</Lbl>
      <input
        type="text" value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]"
      />
      {hint && <p className="text-[11px] text-black/60 mt-1">{hint}</p>}
      {(open || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-zinc-300 bg-white shadow-lg overflow-y-auto max-h-64">
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-black/60 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />{searching || "…"}</div>
          ) : (
            results.map((r, i) => (
              // Both handlers: onMouseDown(preventDefault) wins on desktop before
              // the input blurs; onTouchEnd handles mobile, where mousedown is
              // unreliable. skipRef in pick() guards the double-fire.
              <button
                key={i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                onTouchEnd={(e) => { e.preventDefault(); pick(r); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#c4956a]/10 active:bg-[#c4956a]/20 border-b border-zinc-100 last:border-0"
              >
                {r.display_name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
function NumField({ label, value, onChange, info }: { label: string; value: number; onChange: (v: number) => void; info?: string }) {
  return (<div><Lbl info={info}>{label}</Lbl><input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]" /></div>);
}
// Number field with quick presets plus a free-entry escape hatch. The select
// offers the presets and an "Other…" option; choosing it reveals a numeric
// input for any value. The stored value stays a plain number (the API/KB
// contract is unchanged) — "custom mode" is local UI state, seeded from whether
// the current value is already a non-preset number.
function PresetOrCustomNumber({
  label, value, onChange, presets, unit, otherLabel, optLabel, info,
}: {
  label: string; value: number; onChange: (v: number) => void; presets: number[];
  unit: string; otherLabel: string; optLabel: (n: number) => string; info?: string;
}) {
  const isPreset = presets.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  // If the value becomes a preset again (e.g. user typed 6), follow it back to
  // the dropdown; if it drifts off-preset, switch to custom. Keeps UI in sync
  // when the value changes from outside this component.
  useEffect(() => { setCustom(!presets.includes(value)); }, [value, presets]);

  const OTHER = "__other__";
  return (
    <div>
      <Lbl info={info}>{label}</Lbl>
      <div className="relative">
        <select
          value={custom ? OTHER : String(value)}
          onChange={(e) => {
            if (e.target.value === OTHER) {
              setCustom(true);
              // Seed the custom input just past the largest preset so it never
              // starts on a value the dropdown would reclaim.
              if (isPreset) onChange(Math.max(...presets) + 1);
            } else {
              setCustom(false);
              onChange(Number(e.target.value));
            }
          }}
          className="w-full appearance-none border border-zinc-300 rounded-lg pl-3 pr-9 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a] cursor-pointer"
        >
          {presets.map((n) => <option key={n} value={String(n)}>{optLabel(n)}</option>)}
          <option value={OTHER}>{otherLabel}</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b6540]" aria-hidden />
      </div>
      {custom && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number" min={1} autoFocus
            value={value || ""}
            onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
            className="w-24 border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]"
          />
          <span className="text-sm text-black">{unit}</span>
        </div>
      )}
    </div>
  );
}
// Native select with a CUSTOM chevron. The browser arrow is removed
// (appearance-none) and replaced by a lucide chevron positioned with right
// padding, so it never crowds the input border.
function SelectField({ label, value, onChange, options, info }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; info?: string }) {
  return (
    <div>
      <Lbl info={info}>{label}</Lbl>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none border border-zinc-300 rounded-lg pl-3 pr-9 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a] cursor-pointer"
        >
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b6540]" aria-hidden />
      </div>
    </div>
  );
}
function Dropdown(props: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; info?: string }) {
  return <SelectField {...props} />;
}
function YesNo({ label, value, onChange, t, info }: { label: string; value: boolean; onChange: (v: boolean) => void; t: (typeof UI)[UiLang]; info?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1 text-sm text-black">{label}{info && <InfoTip text={info} />}</span>
      <div className="flex rounded-lg overflow-hidden border-2 border-[#c4956a]/40 flex-shrink-0">
        <button type="button" onClick={() => onChange(true)} className={`px-3 py-1 text-sm font-semibold transition-colors ${value ? "bg-[#c4956a] text-white" : "bg-white text-black"}`}>{t.yes}</button>
        <button type="button" onClick={() => onChange(false)} className={`px-3 py-1 text-sm font-semibold transition-colors ${!value ? "bg-[#c4956a] text-white" : "bg-white text-black"}`}>{t.no}</button>
      </div>
    </div>
  );
}
