"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, AlertTriangle, RefreshCw,
  Building, Clock, Grid3X3, ClipboardList, Loader2, Globe, Star,
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
// Two distinct "languages" live on this page, do not conflate them:
//   • UI language  — the wizard's own interface (top-right switcher).
//   • assistant languages — which language(s) the bot will SPEAK (multi-select
//     in step 1); the first one is primary and drives voice/locale/greeting.

type Step = 1 | 2 | 3 | 4 | 5;
type AsstLang = "es" | "it" | "en" | "de";

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

const PAYMENTS: Array<[PaymentMethod, string]> = [
  ["cash", "Efectivo"], ["card", "Tarjeta"], ["contactless", "Contactless"], ["bizum", "Bizum"],
];

// Major kitchen allergens (presence → cross-contamination warning in the KB).
const ALLERGENS: Array<[Allergen, string]> = [
  ["gluten", "Gluten / trigo"], ["dairy", "Lácteos"], ["egg", "Huevo"], ["nuts", "Frutos secos"],
  ["peanuts", "Cacahuetes"], ["fish", "Pescado"], ["shellfish", "Marisco"], ["soy", "Soja"], ["sesame", "Sésamo"],
];

const CANCELLATIONS: Array<[CancellationNotice, string]> = [
  ["none", "Sin aviso previo"], ["same_day", "El mismo día"], ["2h", "2 h antes"], ["24h", "24 h antes"],
];

const NOSHOW_OPTS: Array<[string, string]> = [
  ["0", "No especificar"], ["15", "15 min"], ["30", "30 min"], ["45", "45 min"], ["60", "60 min"],
];

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
  useEffect(() => {
    const saved = safeLocal.get("onboarding_ui_lang") as UiLang | null;
    if (saved && (UI_LANGS as readonly string[]).includes(saved)) setUi(saved);
  }, []);
  const changeUi = (l: UiLang) => { setUi(l); safeLocal.set("onboarding_ui_lang", l); };
  const t = UI[ui];

  const [bootState, setBootState] = useState<"loading" | "ready" | "anon">("loading");
  const [tenantId, setTenantId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  // STEP 1 — profile
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("+34 ");
  const [ownerPhone, setOwnerPhone] = useState("+34");
  // Assistant speaks these; the first is primary (drives voice/locale/greeting).
  const [languages, setLanguages] = useState<AsstLang[]>(["es"]);
  const [timezone, setTimezone] = useState("Atlantic/Canary");
  const [reviewUrl, setReviewUrl] = useState("");

  // STEP 2 — hours
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);
  // STEP 3 — tables
  const [tableSize, setTableSize] = useState<"small" | "medium" | "large">("medium");
  // STEP 4 — questionnaire (4 cards)
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
      const { data: rows } = await supabase
        .from("tenant_members")
        .select("tenant_id, role, tenants(id, name, settings)")
        .eq("user_id", user.id);
      const owner = (rows || []).find((r: any) => r.role === "owner");
      const tn = owner?.tenants as any;
      if (!owner || !tn) { router.replace("/"); return; }
      if (tn.settings?.onboarding?.completed) { router.replace("/"); return; }
      if (!active) return;
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
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          restaurant_name: restaurantName,
          restaurant_phone: restaurantPhone.trim(),
          owner_phone: ownerPhone.trim(),
          // Send the full list (primary first); keep `language` for back-compat.
          language: languages[0], languages,
          timezone,
          review_url: reviewUrl.trim(),
          opening_hours: hours,
          table_size_preset: tableSize,
          questionnaire: q,
        }),
      });
      if (!res.body) throw new Error("no stream");
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
            if (ev.step === "result") setDone({ ok: ev.ok });
            else setProgress((p) => [...p, { step: ev.step, message: ev.message, ok: ev.ok }]);
          } catch {}
        }
      }
    } catch (e: any) {
      setProgress((p) => [...p, { step: "error", message: e.message, ok: false }]);
      setDone({ ok: false });
    } finally {
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
        <p className="text-sm text-black/70 mb-6">
          {done?.ok ? t.creatingDone : done && !done.ok ? t.creatingFail : t.creatingBusy}
        </p>
        <div className="rounded-xl border-2 border-[#c4956a] bg-white p-4 space-y-2 max-h-[55vh] overflow-y-auto">
          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {p.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <span className="font-bold uppercase text-[11px] tracking-widest text-black/60 mr-2">{p.step}</span>
                <span className={p.ok ? "text-black break-words" : "text-red-600 font-medium break-words"}>{p.message}</span>
              </div>
            </div>
          ))}
          {running && <div className="flex items-center gap-2 text-xs text-black/60 pt-2"><RefreshCw className="w-3 h-3 animate-spin" /> {t.inProgress}</div>}
        </div>
        {done?.ok && (
          <div className="mt-6">
            <button onClick={goToPanel} className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold">{t.goToPanel}</button>
          </div>
        )}
        {done && !done.ok && (
          <div className="mt-6">
            <button onClick={() => { setRunning(false); setDone(null); setProgress([]); }} className="px-4 py-2 rounded-lg border-2 border-[#c4956a] bg-white">{t.retry}</button>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell ui={ui} onUi={changeUi} t={t}>
      <h1 className="text-2xl font-bold mb-1">{t.title}</h1>
      <p className="text-sm text-black/70 mb-6">{t.subtitle}</p>

      <div className="flex items-center gap-1.5 sm:gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((n) => (<div key={n} className={`flex-1 h-1.5 rounded-full transition-colors ${n <= step ? "bg-[#c4956a]" : "bg-zinc-200"}`} />))}
      </div>

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
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Clock className="w-4 h-4" /> 2. {t.s2}</h2>
          <p className="text-xs text-black/60">{t.s2hint}</p>
          <div className="space-y-2">
            {t.days.map((label, di) => {
              const idx = String((di + 1) % 7); // map Mon-first labels back to "1".."6","0"
              return (
                <div key={idx} className="rounded-xl border-2 border-[#c4956a]/40 bg-white/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold">{label}</h4>
                    <button onClick={() => addHourSlot(idx)} className="text-xs font-semibold text-[#8b6540]">{t.addSlot}</button>
                  </div>
                  {(hours[idx] || []).length === 0 ? <p className="text-xs text-black/40">{t.closed}</p> : (
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
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Grid3X3 className="w-4 h-4" /> 3. {t.s3}</h2>
          <p className="text-xs text-black/60">{t.s3hint}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { v: "small", lbl: t.tblSmall, desc: t.tblSmallD },
              { v: "medium", lbl: t.tblMedium, desc: t.tblMediumD },
              { v: "large", lbl: t.tblLarge, desc: t.tblLargeD },
            ].map((o) => (
              <button key={o.v} onClick={() => setTableSize(o.v as any)} className={`p-4 rounded-xl border-2 text-left transition-colors ${tableSize === o.v ? "border-[#c4956a] bg-[#c4956a]/10" : "border-zinc-200 bg-white hover:border-[#c4956a]/50"}`}>
                <div className="font-bold text-sm">{o.lbl}</div>
                <div className="text-xs text-black/60 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <h2 className="text-base font-bold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> 4. {t.s4}</h2>
          <p className="text-xs text-black/60">{t.s4hint}</p>

          {/* Card 1 — Reservas y grupos */}
          <Card title="Reservas y grupos">
            <NumField label="Aforo (plazas)" value={q.capacity_seats} onChange={(v) => setQF("capacity_seats", v)} />
            <Dropdown label="Confirmación automática hasta" value={String(q.auto_confirm_max)} onChange={(v) => setQF("auto_confirm_max", Number(v))} options={[["4", "4 personas"], ["6", "6 personas"], ["8", "8 personas"], ["10", "10 personas"]]} />
            <YesNo label="¿Aceptáis grupos grandes (por encima de ese número)?" value={q.accepts_large_groups} onChange={(v) => setQF("accepts_large_groups", v)} t={t} />
            {q.accepts_large_groups && <YesNo label="¿Pedís depósito para grupos grandes?" value={q.deposit_required} onChange={(v) => setQF("deposit_required", v)} t={t} />}
            <Dropdown label="Tolerancia de retraso" value={String(q.late_tolerance_min)} onChange={(v) => setQF("late_tolerance_min", Number(v))} options={[["10", "10 min"], ["15", "15 min"], ["20", "20 min"], ["30", "30 min"]]} />
            <YesNo label="¿Más margen si el cliente avisa con antelación?" value={q.late_grace_if_notified} onChange={(v) => setQF("late_grace_if_notified", v)} t={t} />
            <Dropdown label="Aviso de cancelación" value={q.cancellation_notice} onChange={(v) => setQF("cancellation_notice", v as CancellationNotice)} options={CANCELLATIONS} />
            <Dropdown label="Liberar mesa por no-show tras" value={String(q.noshow_release_min)} onChange={(v) => setQF("noshow_release_min", Number(v))} options={NOSHOW_OPTS} />
            <TimeField label="Última reserva (comida)" value={q.last_lunch} onChange={(v) => setQF("last_lunch", v)} />
            <TimeField label="Última reserva (cena)" value={q.last_dinner} onChange={(v) => setQF("last_dinner", v)} />
          </Card>

          {/* Card 2 — Servicios prácticos */}
          <Card title="Servicios prácticos">
            <YesNo label="¿Tronas para niños?" value={q.high_chairs} onChange={(v) => setQF("high_chairs", v)} t={t} />
            <YesNo label="¿Menú infantil?" value={q.kids_menu} onChange={(v) => setQF("kids_menu", v)} t={t} />
            <YesNo label="¿Se admiten mascotas?" value={q.pets} onChange={(v) => setQF("pets", v)} t={t} />
            <YesNo label="¿Entrada accesible?" value={q.accessible} onChange={(v) => setQF("accessible", v)} t={t} />
            <YesNo label="¿WiFi para clientes?" value={q.wifi} onChange={(v) => setQF("wifi", v)} t={t} />
            <YesNo label="¿Parking propio?" value={q.parking_lot} onChange={(v) => setQF("parking_lot", v)} t={t} />
            <YesNo label="¿Terraza?" value={q.terrace} onChange={(v) => setQF("terrace", v)} t={t} />
            <YesNo label="¿Comida para llevar?" value={q.takeaway} onChange={(v) => setQF("takeaway", v)} t={t} />
            {q.takeaway && <Field label="Tiempo de espera para llevar (opcional)" value={q.takeaway_wait} onChange={(v) => setQF("takeaway_wait", v)} placeholder="20-30 min" />}
            <YesNo label="¿Delivery (a domicilio)?" value={q.delivery} onChange={(v) => setQF("delivery", v)} t={t} />
            {q.delivery && <Field label="Plataforma de delivery (opcional)" value={q.delivery_platform} onChange={(v) => setQF("delivery_platform", v)} placeholder="Glovo, Uber Eats…" />}
            <YesNo label="¿Aceptáis celebraciones (cumpleaños, etc.)?" value={q.celebrations} onChange={(v) => setQF("celebrations", v)} t={t} />
            <YesNo label="¿Se puede traer tarta propia?" value={q.outside_cake} onChange={(v) => setQF("outside_cake", v)} t={t} />
            <div>
              <Lbl>Métodos de pago</Lbl>
              <div className="flex flex-wrap gap-2">
                {PAYMENTS.map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => togglePayment(k)} className={`px-3 py-1.5 rounded-full text-sm border-2 transition-colors ${q.payments.includes(k) ? "border-[#c4956a] bg-[#c4956a]/15 font-semibold" : "border-zinc-200 bg-white hover:border-[#c4956a]/50"}`}>{lbl}</button>
                ))}
              </div>
            </div>
          </Card>

          {/* Card 3 — Dietas y alergias */}
          <Card title="Dietas y alergias">
            <YesNo label="¿Opciones vegetarianas?" value={q.vegetarian} onChange={(v) => setQF("vegetarian", v)} t={t} />
            <YesNo label="¿Opciones veganas?" value={q.vegan} onChange={(v) => setQF("vegan", v)} t={t} />
            <YesNo label="¿Opciones sin gluten?" value={q.gluten_free} onChange={(v) => setQF("gluten_free", v)} t={t} />
            <YesNo label="¿Opciones sin lactosa?" value={q.lactose_free} onChange={(v) => setQF("lactose_free", v)} t={t} />
            <YesNo label="¿Protocolo para celíacos (preparación separada)?" value={q.celiac_safe} onChange={(v) => setQF("celiac_safe", v)} t={t} />
            <div className="pt-1 border-t border-zinc-100">
              <Lbl>Alérgenos presentes en cocina</Lbl>
              <p className="text-[11px] text-black/50 mb-2">Marca los que se manipulan: el asistente avisará del riesgo de contaminación cruzada.</p>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => toggleAllergen(k)} className={`px-3 py-1.5 rounded-full text-sm border-2 transition-colors ${q.kitchen_allergens.includes(k) ? "border-[#c4956a] bg-[#c4956a]/15 font-semibold" : "border-zinc-200 bg-white hover:border-[#c4956a]/50"}`}>{lbl}</button>
                ))}
              </div>
            </div>
            <YesNo label="¿No podéis garantizar ausencia total de trazas?" value={q.cannot_guarantee_traces} onChange={(v) => setQF("cannot_guarantee_traces", v)} t={t} />
            <YesNo label="¿Alergia severa → consultar cocina / responsable?" value={q.severe_allergy_escalate} onChange={(v) => setQF("severe_allergy_escalate", v)} t={t} />
            <YesNo label="¿Hoja de alérgenos disponible bajo petición?" value={q.allergen_info} onChange={(v) => setQF("allergen_info", v)} t={t} />
          </Card>

          {/* Card 4 — Cómo llegar */}
          <Card title="Cómo llegar">
            <Field label="Tipo de cocina / concepto (opcional)" value={q.cuisine_type} onChange={(v) => setQF("cuisine_type", v)} placeholder="Trattoria napolitana" />
            <Field label="Dirección" value={q.address} onChange={(v) => setQF("address", v)} placeholder="Avenida Rafael Cabrera, 7" />
            <Field label="Población / código postal (opcional)" value={q.city} onChange={(v) => setQF("city", v)} placeholder="35002 Las Palmas de Gran Canaria" />
            <Field label="Zona / barrio (opcional)" value={q.neighborhood} onChange={(v) => setQF("neighborhood", v)} placeholder="Triana / Vegueta" />
            <Dropdown label="Aparcamiento" value={q.parking_info} onChange={(v) => setQF("parking_info", v as ParkingKind)} options={[["own", "Parking propio"], ["public", "Parking público cercano"], ["street", "En la calle"], ["none", "Sin aparcamiento"]]} />
            <YesNo label="¿Bien comunicado en transporte público?" value={q.public_transport} onChange={(v) => setQF("public_transport", v)} t={t} />
            <Field label="Punto de referencia (opcional)" value={q.landmark} onChange={(v) => setQF("landmark", v)} placeholder="Junto a la playa de Las Canteras" />
          </Card>

          {/* Card 5 — Platos recomendados (opcional) */}
          <Card title="Platos recomendados (opcional)">
            <p className="text-[11px] text-black/50 -mt-1">Añade hasta 6 platos que recomiendas, con una nota corta. El asistente los usará para responder «¿qué me recomiendas?». Déjalo vacío si prefieres remitir a la carta.</p>
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

      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Check className="w-4 h-4" /> 5. {t.s5}</h2>
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
            <ul className="text-xs space-y-0.5">
              <li>• {t.sumRestaurant}: <b>{restaurantName || "—"}</b></li>
              <li>• {t.sumLanguages}: <b>{languages.map((l) => ASST_LANGS.find(([v]) => v === l)?.[1] || l).join(", ")}</b></li>
              <li>• {t.sumTables}: {tableSize}</li>
              <li>• {t.sumCapacity}: {q.capacity_seats} · {t.sumAutoConfirm} {q.auto_confirm_max}</li>
              <li>• {t.sumPayments}: {q.payments.length || "—"}</li>
            </ul>
          </div>
          <p className="text-xs text-black/60">{t.sumFootnote}</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button onClick={() => setStep((s) => (s - 1) as Step)} disabled={step === 1} className="flex items-center gap-1 px-4 py-2 rounded-lg border-2 border-zinc-200 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /> {t.back}</button>
        {step < 5 ? (
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
                on ? "border-[#c4956a] bg-[#c4956a]/15 text-[#5e421f]" : "border-zinc-200 bg-white text-black/70"
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
      <p className="text-[11px] text-black/50 mt-2">{hint}</p>
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-black/70">{children}</label>;
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-[#c4956a]/40 bg-white p-4 space-y-3">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, value, onChange, placeholder, type = "text", inputMode }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return (<div><Lbl>{label}</Lbl><input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]" /></div>);
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (<div><Lbl>{label}</Lbl><input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]" /></div>);
}
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (<div><Lbl>{label}</Lbl><input type="time" value={value} onChange={(e) => onChange(e.target.value)} className="border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]" /></div>);
}
// Native select with a CUSTOM chevron. The browser arrow is removed
// (appearance-none) and replaced by a lucide chevron positioned with right
// padding, so it never crowds the input border.
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div>
      <Lbl>{label}</Lbl>
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
function Dropdown(props: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return <SelectField {...props} />;
}
function YesNo({ label, value, onChange, t }: { label: string; value: boolean; onChange: (v: boolean) => void; t: (typeof UI)[UiLang] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-black/80">{label}</span>
      <div className="flex rounded-lg overflow-hidden border-2 border-[#c4956a]/40 flex-shrink-0">
        <button type="button" onClick={() => onChange(true)} className={`px-3 py-1 text-sm font-semibold transition-colors ${value ? "bg-[#c4956a] text-white" : "bg-white text-black/60"}`}>{t.yes}</button>
        <button type="button" onClick={() => onChange(false)} className={`px-3 py-1 text-sm font-semibold transition-colors ${!value ? "bg-[#c4956a] text-white" : "bg-white text-black/60"}`}>{t.no}</button>
      </div>
    </div>
  );
}
