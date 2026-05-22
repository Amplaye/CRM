"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, ChevronRight, Check, AlertTriangle, RefreshCw,
  Building, Clock, Grid3X3, ClipboardList, Loader2,
} from "lucide-react";
import {
  KbQuestionnaire, PaymentMethod, ParkingKind, defaultQuestionnaire,
} from "@/lib/onboarding/kb-generator";

// Client-facing self-serve onboarding. The owner provisions their OWN CRM:
// profile → hours → tables → fixed-field questionnaire (replaces the old
// "write the KB" step). There is NO voice-prompt step — that template is built
// server-side and the client never sees it. The admin's only remaining manual
// step (attaching the real WhatsApp number) happens afterwards.

type Step = 1 | 2 | 3 | 4 | 5;

interface Slot { open: string; close: string }
type Hours = Record<string, Slot[]>;

const DAYS = [
  { idx: "1", label: "Lunes" }, { idx: "2", label: "Martes" }, { idx: "3", label: "Miércoles" },
  { idx: "4", label: "Jueves" }, { idx: "5", label: "Viernes" }, { idx: "6", label: "Sábado" },
  { idx: "0", label: "Domingo" },
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

export default function OnboardingPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [bootState, setBootState] = useState<"loading" | "ready" | "anon">("loading");
  const [tenantId, setTenantId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  // STEP 1 — profile
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("+34 ");
  const [ownerPhone, setOwnerPhone] = useState("+34");
  const [language, setLanguage] = useState<"es" | "it" | "en" | "de">("es");
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
      const t = owner?.tenants as any;
      if (!owner || !t) { router.replace("/"); return; }
      if (t.settings?.onboarding?.completed) { router.replace("/"); return; }
      if (!active) return;
      setUserId(user.id);
      setTenantId(t.id);
      if (t.name) setRestaurantName(t.name);
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
          language, timezone,
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
      <Shell>
        <h1 className="text-2xl font-bold mb-2">Estamos creando tu CRM…</h1>
        <p className="text-sm text-black/70 mb-6">
          {done?.ok ? "✅ ¡Listo! Te llevamos a tu panel." : done && !done.ok
            ? "❌ Algo falló. Revisa los pasos y vuelve a intentar."
            : "Configurando tu restaurante, la base de conocimiento y el asistente…"}
        </p>
        <div className="rounded-xl border-2 border-[#c4956a] bg-white p-4 space-y-2 max-h-[55vh] overflow-y-auto">
          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {p.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
              <div className="flex-1">
                <span className="font-bold uppercase text-[11px] tracking-widest text-black/60 mr-2">{p.step}</span>
                <span className={p.ok ? "text-black" : "text-red-600 font-medium"}>{p.message}</span>
              </div>
            </div>
          ))}
          {running && <div className="flex items-center gap-2 text-xs text-black/60 pt-2"><RefreshCw className="w-3 h-3 animate-spin" /> en curso…</div>}
        </div>
        {done?.ok && (
          <div className="mt-6">
            <button onClick={goToPanel} className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold">Ir a mi panel →</button>
          </div>
        )}
        {done && !done.ok && (
          <div className="mt-6">
            <button onClick={() => { setRunning(false); setDone(null); setProgress([]); }} className="px-4 py-2 rounded-lg border-2 border-[#c4956a] bg-white">Reintentar</button>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold mb-1">Configura tu restaurante</h1>
      <p className="text-sm text-black/70 mb-6">5 pasos rápidos. Al terminar, tu asistente queda listo automáticamente.</p>

      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((n) => (<div key={n} className={`flex-1 h-1.5 rounded-full ${n <= step ? "bg-[#c4956a]" : "bg-zinc-200"}`} />))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Building className="w-4 h-4" /> 1. Datos del restaurante</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nombre del restaurante" value={restaurantName} onChange={setRestaurantName} placeholder="Trattoria Rossa" />
            <Field label="Teléfono público" value={restaurantPhone} onChange={setRestaurantPhone} placeholder="+34 928 123 456" />
            <Field label="Tu WhatsApp (avisos al personal)" value={ownerPhone} onChange={setOwnerPhone} placeholder="+34 6XX XXX XXX" />
            <Field label="Enlace de reseñas Google (opcional)" value={reviewUrl} onChange={setReviewUrl} placeholder="https://maps.google.com/..." />
            <SelectField label="Idioma del asistente" value={language} onChange={(v) => setLanguage(v as any)} options={[["es", "Español"], ["it", "Italiano"], ["en", "Inglés"], ["de", "Alemán"]]} />
            <SelectField label="Zona horaria" value={timezone} onChange={setTimezone} options={[["Atlantic/Canary", "Atlantic/Canary (Las Palmas)"], ["Europe/Madrid", "Europe/Madrid"], ["Europe/Rome", "Europe/Rome"]]} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Clock className="w-4 h-4" /> 2. Horario de apertura</h2>
          <p className="text-xs text-black/60">Deja un día vacío si cierras. Varios tramos = comida + cena.</p>
          <div className="space-y-2">
            {DAYS.map((d) => (
              <div key={d.idx} className="rounded-xl border-2 border-[#c4956a]/40 bg-white/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold w-28">{d.label}</h4>
                  <button onClick={() => addHourSlot(d.idx)} className="text-xs font-semibold text-[#8b6540]">+ tramo</button>
                </div>
                {(hours[d.idx] || []).length === 0 ? <p className="text-xs text-black/40">Cerrado</p> : (
                  <div className="space-y-2">
                    {(hours[d.idx] || []).map((s, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input type="time" value={s.open} onChange={(e) => setHourSlot(d.idx, i, "open", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                        <span className="text-xs">→</span>
                        <input type="time" value={s.close} onChange={(e) => setHourSlot(d.idx, i, "close", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                        <button onClick={() => removeHourSlot(d.idx, i)} className="text-xs text-red-500">quitar</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Grid3X3 className="w-4 h-4" /> 3. Mesas (distribución inicial)</h2>
          <p className="text-xs text-black/60">Elige el tamaño. Podrás mover/añadir/quitar mesas después desde el plano.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { v: "small", lbl: "Pequeño (6)", desc: "<30 comensales" },
              { v: "medium", lbl: "Mediano (12)", desc: "30-60 comensales" },
              { v: "large", lbl: "Grande (20)", desc: ">60 comensales" },
            ].map((o) => (
              <button key={o.v} onClick={() => setTableSize(o.v as any)} className={`p-4 rounded-xl border-2 text-left ${tableSize === o.v ? "border-[#c4956a] bg-[#c4956a]/10" : "border-zinc-200 bg-white"}`}>
                <div className="font-bold text-sm">{o.lbl}</div>
                <div className="text-xs text-black/60 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <h2 className="text-base font-bold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> 4. Cuestionario</h2>
          <p className="text-xs text-black/60">Responde estas preguntas: con ellas creamos automáticamente lo que el asistente necesita saber. No hay que escribir textos.</p>

          {/* Card 1 — Reservas y grupos */}
          <Card title="Reservas y grupos">
            <NumField label="Aforo (plazas)" value={q.capacity_seats} onChange={(v) => setQF("capacity_seats", v)} />
            <Dropdown label="Confirmación automática hasta" value={String(q.auto_confirm_max)} onChange={(v) => setQF("auto_confirm_max", Number(v))} options={[["4", "4 personas"], ["6", "6 personas"], ["8", "8 personas"], ["10", "10 personas"]]} />
            <YesNo label="¿Aceptáis grupos grandes (por encima de ese número)?" value={q.accepts_large_groups} onChange={(v) => setQF("accepts_large_groups", v)} />
            {q.accepts_large_groups && <YesNo label="¿Pedís depósito para grupos grandes?" value={q.deposit_required} onChange={(v) => setQF("deposit_required", v)} />}
            <Dropdown label="Tolerancia de retraso" value={String(q.late_tolerance_min)} onChange={(v) => setQF("late_tolerance_min", Number(v))} options={[["10", "10 min"], ["15", "15 min"], ["20", "20 min"], ["30", "30 min"]]} />
            <TimeField label="Última reserva (comida)" value={q.last_lunch} onChange={(v) => setQF("last_lunch", v)} />
            <TimeField label="Última reserva (cena)" value={q.last_dinner} onChange={(v) => setQF("last_dinner", v)} />
          </Card>

          {/* Card 2 — Servicios prácticos */}
          <Card title="Servicios prácticos">
            <YesNo label="¿Tronas para niños?" value={q.high_chairs} onChange={(v) => setQF("high_chairs", v)} />
            <YesNo label="¿Se admiten mascotas?" value={q.pets} onChange={(v) => setQF("pets", v)} />
            <YesNo label="¿Entrada accesible?" value={q.accessible} onChange={(v) => setQF("accessible", v)} />
            <YesNo label="¿WiFi para clientes?" value={q.wifi} onChange={(v) => setQF("wifi", v)} />
            <YesNo label="¿Parking propio?" value={q.parking_lot} onChange={(v) => setQF("parking_lot", v)} />
            <YesNo label="¿Terraza?" value={q.terrace} onChange={(v) => setQF("terrace", v)} />
            <YesNo label="¿Comida para llevar?" value={q.takeaway} onChange={(v) => setQF("takeaway", v)} />
            <div>
              <Lbl>Métodos de pago</Lbl>
              <div className="flex flex-wrap gap-2">
                {PAYMENTS.map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => togglePayment(k)} className={`px-3 py-1.5 rounded-full text-sm border-2 ${q.payments.includes(k) ? "border-[#c4956a] bg-[#c4956a]/15 font-semibold" : "border-zinc-200 bg-white"}`}>{lbl}</button>
                ))}
              </div>
            </div>
          </Card>

          {/* Card 3 — Dietas y alergias */}
          <Card title="Dietas y alergias">
            <YesNo label="¿Opciones vegetarianas?" value={q.vegetarian} onChange={(v) => setQF("vegetarian", v)} />
            <YesNo label="¿Opciones veganas?" value={q.vegan} onChange={(v) => setQF("vegan", v)} />
            <YesNo label="¿Opciones sin gluten?" value={q.gluten_free} onChange={(v) => setQF("gluten_free", v)} />
            <YesNo label="¿Protocolo para celíacos?" value={q.celiac_safe} onChange={(v) => setQF("celiac_safe", v)} />
            <YesNo label="¿Opciones sin lactosa?" value={q.lactose_free} onChange={(v) => setQF("lactose_free", v)} />
            <YesNo label="¿Información de alérgenos disponible?" value={q.allergen_info} onChange={(v) => setQF("allergen_info", v)} />
          </Card>

          {/* Card 4 — Cómo llegar */}
          <Card title="Cómo llegar">
            <Field label="Dirección" value={q.address} onChange={(v) => setQF("address", v)} placeholder="Calle Mayor 12, Las Palmas" />
            <Dropdown label="Aparcamiento" value={q.parking_info} onChange={(v) => setQF("parking_info", v as ParkingKind)} options={[["own", "Parking propio"], ["public", "Parking público cercano"], ["street", "En la calle"], ["none", "Sin aparcamiento"]]} />
            <YesNo label="¿Bien comunicado en transporte público?" value={q.public_transport} onChange={(v) => setQF("public_transport", v)} />
            <Field label="Punto de referencia (opcional)" value={q.landmark} onChange={(v) => setQF("landmark", v)} placeholder="Junto a la playa de Las Canteras" />
          </Card>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Check className="w-4 h-4" /> 5. Resumen</h2>
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
            <ul className="text-xs space-y-0.5">
              <li>• Restaurante: <b>{restaurantName || "—"}</b></li>
              <li>• Idioma del asistente: {language}</li>
              <li>• Mesas iniciales: {tableSize}</li>
              <li>• Aforo: {q.capacity_seats} · confirmación auto hasta {q.auto_confirm_max}</li>
              <li>• Métodos de pago: {q.payments.length || "—"}</li>
            </ul>
          </div>
          <p className="text-xs text-black/60">Al pulsar <b>Crear mi CRM</b> configuramos todo automáticamente (~1 minuto).</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => setStep((s) => (s - 1) as Step)} disabled={step === 1} className="flex items-center gap-1 px-4 py-2 rounded-lg border-2 border-zinc-200 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /> Atrás</button>
        {step < 5 ? (
          <button onClick={() => setStep((s) => (s + 1) as Step)} className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-[#c4956a] text-white font-bold">Siguiente <ChevronRight className="w-4 h-4" /></button>
        ) : (
          <button onClick={submit} disabled={!restaurantName.trim()} className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"><Check className="w-4 h-4" /> Crear mi CRM</button>
        )}
      </div>
    </Shell>
  );
}

/* ── small presentational helpers ── */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] py-10 px-4 relative z-10">
      <div className="max-w-3xl mx-auto rounded-2xl border-2 p-6 sm:p-8" style={{ background: "rgba(252,246,237,0.9)", borderColor: "#c4956a" }}>
        {children}
      </div>
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
function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (<div><Lbl>{label}</Lbl><input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40" /></div>);
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (<div><Lbl>{label}</Lbl><input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" /></div>);
}
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (<div><Lbl>{label}</Lbl><input type="time" value={value} onChange={(e) => onChange(e.target.value)} className="border border-zinc-300 rounded-lg px-3 py-2 text-sm" /></div>);
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (<div><Lbl>{label}</Lbl><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>);
}
function Dropdown(props: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return <SelectField {...props} />;
}
function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-black/80">{label}</span>
      <div className="flex rounded-lg overflow-hidden border-2 border-[#c4956a]/40 flex-shrink-0">
        <button type="button" onClick={() => onChange(true)} className={`px-3 py-1 text-sm font-semibold ${value ? "bg-[#c4956a] text-white" : "bg-white text-black/60"}`}>Sí</button>
        <button type="button" onClick={() => onChange(false)} className={`px-3 py-1 text-sm font-semibold ${!value ? "bg-[#c4956a] text-white" : "bg-white text-black/60"}`}>No</button>
      </div>
    </div>
  );
}
