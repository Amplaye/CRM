"use client";

import { useState } from "react";
import Link from "next/link";
import { useTenant } from "@/lib/contexts/TenantContext";
import { ChevronLeft, ChevronRight, Check, AlertTriangle, RefreshCw, Globe, Building, Clock, Grid3X3, BookOpen, User, ExternalLink } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

interface OpeningSlot { open: string; close: string }
type Hours = Record<string, OpeningSlot[]>;

const DAYS = [
  { idx: "1", label: "Lunes" },
  { idx: "2", label: "Martes" },
  { idx: "3", label: "Miércoles" },
  { idx: "4", label: "Jueves" },
  { idx: "5", label: "Viernes" },
  { idx: "6", label: "Sábado" },
  { idx: "0", label: "Domingo" },
];

const DEFAULT_HOURS: Hours = {
  "0": [{ open: "12:30", close: "15:30" }],
  "1": [],
  "2": [{ open: "19:30", close: "22:30" }],
  "3": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "4": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "5": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "6": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
};

const VOICE_PROMPT_TEMPLATE = (restName: string) => `# Identidad
Eres el agente vocal de ${restName}. Responde breve y cálido, máximo 2 frases por turno.

# Tareas
- Reservar mesa: pide personas, fecha, hora, nombre. Llama check_availability primero, luego book_reservation.
- Modificar / cancelar: pide referencia (fecha+hora) y usa modify_reservation / cancel_reservation.
- Información del restaurante (menú, horarios, dirección): usa la base de conocimiento adjunta.
- Si fuera de horario o sin disponibilidad: el backend propone alternativas, transmítelas literalmente.

# Reglas
- Nunca inventes menú, precios u horarios — siempre consulta la KB.
- Confirma SIEMPRE antes de llamar el tool de reserva.
- Si el cliente cancela la conversación: end_call con saludo cortés.`;

const DEFAULT_KB = (restName: string, addr: string, phone: string) => [
  {
    title: "Política de reservas",
    category: "policies",
    content: `Capacidad: 12 mesas, 50 plazas (zona interior + terraza).\nGrupos 1-6: confirmación automática si hay disponibilidad.\nGrupos 7+: solicitud pendiente, el responsable contacta al cliente.\nTolerancia de retraso: 15 min.\nÚltima reserva almuerzo: 14:45. Última reserva cena: 21:30.`,
  },
  {
    title: "Ubicación y contacto",
    category: "general",
    content: `${restName}\n${addr}\nTeléfono: ${phone}`,
  },
  {
    title: "Servicios adicionales",
    category: "general",
    content: `Familias: tronas disponibles\nMascotas: sí, avisar al reservar\nAccesibilidad: entrada accesible\nPagos: efectivo, tarjeta, contactless`,
  },
];

export default function OnboardPage() {
  const { globalRole } = useTenant();
  const [step, setStep] = useState<Step>(1);

  // STEP 1
  const [restaurantName, setRestaurantName] = useState("");
  const [slug, setSlug] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("+34 ");
  const [restaurantAddr, setRestaurantAddr] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("+34");
  const [language, setLanguage] = useState<"es" | "it" | "en" | "de">("es");
  const [timezone, setTimezone] = useState("Atlantic/Canary");
  const [reviewUrl, setReviewUrl] = useState("https://www.google.com/maps?cid=");

  // STEP 2
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);

  // STEP 3
  const [tableSize, setTableSize] = useState<"small" | "medium" | "large">("medium");

  // STEP 4
  const [kbArticles, setKbArticles] = useState(() => DEFAULT_KB("", "", ""));
  const [voicePrompt, setVoicePrompt] = useState(VOICE_PROMPT_TEMPLATE(""));

  // STEP 5
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerName, setOwnerName] = useState("");

  // RUN
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Array<{ step: string; message: string; ok: boolean }>>([]);
  const [done, setDone] = useState<{ ok: boolean; tenant_id?: string } | null>(null);

  // Auto-derive slug from name
  function syncSlug(v: string) {
    setSlug(v.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30));
  }

  function setHourSlot(day: string, idx: number, field: "open" | "close", value: string) {
    setHours((h) => {
      const next = { ...h, [day]: [...(h[day] || [])] };
      next[day][idx] = { ...next[day][idx], [field]: value };
      return next;
    });
  }
  function addHourSlot(day: string) {
    setHours((h) => ({ ...h, [day]: [...(h[day] || []), { open: "12:30", close: "15:30" }] }));
  }
  function removeHourSlot(day: string, idx: number) {
    setHours((h) => ({ ...h, [day]: (h[day] || []).filter((_, i) => i !== idx) }));
  }

  function fillKbDefaults() {
    setKbArticles(DEFAULT_KB(restaurantName, restaurantAddr, restaurantPhone));
    setVoicePrompt(VOICE_PROMPT_TEMPLATE(restaurantName));
  }

  function updateKbArticle(i: number, field: "title" | "category" | "content", value: string) {
    setKbArticles((arr) => arr.map((a, j) => (i === j ? { ...a, [field]: value } : a)));
  }
  function addKbArticle() {
    setKbArticles((arr) => [...arr, { title: "", category: "general", content: "" }]);
  }
  function removeKbArticle(i: number) {
    setKbArticles((arr) => arr.filter((_, j) => j !== i));
  }

  async function submit() {
    setRunning(true);
    setProgress([]);
    setDone(null);
    try {
      const res = await fetch("/api/admin/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_name: restaurantName,
          slug,
          restaurant_phone: restaurantPhone.trim(),
          owner_phone: ownerPhone.trim(),
          timezone,
          locale: language === "it" ? "it-IT" : language === "en" ? "en-GB" : language === "de" ? "de-DE" : "es-ES",
          language,
          review_url: reviewUrl.trim(),
          opening_hours: hours,
          table_size_preset: tableSize,
          kb_articles: kbArticles.filter((a) => a.title.trim() && a.content.trim()),
          voice_prompt: voicePrompt,
          owner_email: ownerEmail.trim().toLowerCase(),
          owner_password: ownerPassword,
          owner_name: ownerName.trim(),
        }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        // Split SSE messages (data: ...\n\n)
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const ev = JSON.parse(json);
            if (ev.step === "result") {
              setDone({ ok: ev.ok, tenant_id: ev.data?.tenant_id });
            } else {
              setProgress((p) => [...p, { step: ev.step, message: ev.message, ok: ev.ok }]);
            }
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

  if (globalRole !== "platform_admin") {
    return (
      <div className="p-8 max-w-2xl">
        <div className="rounded-xl border-2 border-red-200 bg-red-50 p-6 text-red-700">
          <AlertTriangle className="w-6 h-6 mb-2" />
          <h2 className="font-bold">Forbidden</h2>
          <p className="text-sm mt-1">Solo platform admin può accedere all&apos;onboarding.</p>
        </div>
      </div>
    );
  }

  // Status / final view
  if (running || done) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Creazione CRM in corso…</h1>
        <p className="text-sm text-black/70 mb-6">
          {done?.ok
            ? "✅ Completato. Vedi link sotto."
            : done && !done.ok
              ? "❌ Onboarding fallito. Controlla il log e riprova."
              : "Provisioning di tenant, KB, Retell agent e workflow n8n…"}
        </p>

        <div className="rounded-xl border-2 border-[#c4956a] bg-white p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {p.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
              <div className="flex-1">
                <span className="font-bold uppercase text-[11px] tracking-widest text-black/60 mr-2">{p.step}</span>
                <span className={p.ok ? "text-black" : "text-red-600 font-medium"}>{p.message}</span>
              </div>
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-xs text-black/60 pt-2">
              <RefreshCw className="w-3 h-3 animate-spin" /> in corso…
            </div>
          )}
        </div>

        {done?.ok && done.tenant_id && (
          <div className="mt-6 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <h2 className="font-bold text-emerald-800">CRM pronto 🎉</h2>
            <p className="text-sm text-emerald-700">
              Tenant ID: <code className="bg-white/70 px-1.5 py-0.5 rounded">{done.tenant_id}</code>
            </p>
            <p className="text-sm text-emerald-700">
              Login owner: <b>{ownerEmail}</b> · password: <b>{ownerPassword}</b>
            </p>
            <p className="text-xs text-emerald-700/80 mt-3">
              ⚠️ Per ricevere i messaggi WhatsApp Sandbox sul nuovo bot, vai su Twilio Console e cambia
              il webhook del numero <b>+14155238886</b> da
              <code className="mx-1 bg-white/70 px-1 py-0.5 rounded">picnic-whatsapp</code>
              a <code className="mx-1 bg-white/70 px-1 py-0.5 rounded">{slug}-whatsapp</code>.
            </p>
            <div className="flex gap-2 pt-2">
              <Link href="/admin" className="text-sm font-semibold text-emerald-800 underline">← Torna al pannello admin</Link>
            </div>
          </div>
        )}

        {done && !done.ok && (
          <div className="mt-6 flex gap-2">
            <button onClick={() => { setRunning(false); setDone(null); setProgress([]); }} className="px-4 py-2 rounded-lg border-2 border-[#c4956a] bg-white">Riprova</button>
          </div>
        )}
      </div>
    );
  }

  // Step content
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-xs text-black/50 mb-2">
        <Link href="/admin" className="hover:text-black">Admin</Link> / <span>Onboard nuovo cliente</span>
      </div>
      <h1 className="text-2xl font-bold mb-1">Crea un nuovo CRM ristorante</h1>
      <p className="text-sm text-black/70 mb-6">5 step. Alla fine premi <b>Crea CRM</b> e tutto viene provisionato in ~1 minuto.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className={`flex-1 h-1.5 rounded-full ${n <= step ? "bg-[#c4956a]" : "bg-zinc-200"}`} />
        ))}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Building className="w-4 h-4" /> 1. Profilo ristorante</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome ristorante" value={restaurantName} onChange={(v) => { setRestaurantName(v); syncSlug(v); }} placeholder="Trattoria Rossa" />
            <Field label="Slug (auto, usato nei webhook)" value={slug} onChange={setSlug} placeholder="trattoria-rossa" />
            <Field label="Telefono ristorante (pubblico)" value={restaurantPhone} onChange={setRestaurantPhone} placeholder="+34 928 123 456" />
            <Field label="Indirizzo" value={restaurantAddr} onChange={setRestaurantAddr} placeholder="Calle Mayor 12, Las Palmas" />
            <Field label="Telefono owner (notifiche staff WhatsApp)" value={ownerPhone} onChange={setOwnerPhone} placeholder="+39333..." />
            <Field label="Google Review URL" value={reviewUrl} onChange={setReviewUrl} placeholder="https://www.google.com/maps?cid=..." />
            <SelectField label="Lingua principale" value={language} onChange={(v) => setLanguage(v as any)} options={[["es", "Spagnolo"], ["it", "Italiano"], ["en", "Inglese"], ["de", "Tedesco"]]} />
            <SelectField label="Timezone" value={timezone} onChange={setTimezone} options={[["Atlantic/Canary", "Atlantic/Canary (Las Palmas)"], ["Europe/Madrid", "Europe/Madrid"], ["Europe/Rome", "Europe/Rome"]]} />
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Clock className="w-4 h-4" /> 2. Orari di apertura</h2>
          <p className="text-xs text-black/60">Lascia vuoto un giorno per chiusura. Più slot = pranzo + cena.</p>
          <div className="space-y-2">
            {DAYS.map((d) => (
              <div key={d.idx} className="rounded-xl border-2 border-[#c4956a]/40 bg-white/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold w-28">{d.label}</h4>
                  <button onClick={() => addHourSlot(d.idx)} className="text-xs font-semibold text-[#8b6540]">+ slot</button>
                </div>
                {(hours[d.idx] || []).length === 0 ? (
                  <p className="text-xs text-black/40">Cerrado</p>
                ) : (
                  <div className="space-y-2">
                    {(hours[d.idx] || []).map((s, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input type="time" value={s.open} onChange={(e) => setHourSlot(d.idx, i, "open", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                        <span className="text-xs">→</span>
                        <input type="time" value={s.close} onChange={(e) => setHourSlot(d.idx, i, "close", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                        <button onClick={() => removeHourSlot(d.idx, i)} className="text-xs text-red-500">rimuovi</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Grid3X3 className="w-4 h-4" /> 3. Tavoli (layout default)</h2>
          <p className="text-xs text-black/60">Scegli quanti tavoli iniziali. Sposta/aggiungi/rimuovi dopo dal Plan view.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { v: "small", lbl: "Piccolo (6)", desc: "ristorante <30 coperti" },
              { v: "medium", lbl: "Medio (12)", desc: "ristorante 30-60 coperti" },
              { v: "large", lbl: "Grande (20)", desc: "ristorante >60 coperti" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setTableSize(o.v as any)}
                className={`p-4 rounded-xl border-2 text-left ${tableSize === o.v ? "border-[#c4956a] bg-[#c4956a]/10" : "border-zinc-200 bg-white"}`}
              >
                <div className="font-bold text-sm">{o.lbl}</div>
                <div className="text-xs text-black/60 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2"><BookOpen className="w-4 h-4" /> 4. Knowledge Base & Voice Prompt</h2>
            <button onClick={fillKbDefaults} className="text-xs px-3 py-1.5 rounded-lg border-2 border-[#c4956a] bg-white">Riempi default</button>
          </div>
          <p className="text-xs text-black/60">Articoli che il bot userà. Aggiungi menu/policies/contatti.</p>
          <div className="space-y-3">
            {kbArticles.map((a, i) => (
              <div key={i} className="rounded-xl border-2 border-[#c4956a]/40 bg-white p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={a.title} onChange={(e) => updateKbArticle(i, "title", e.target.value)} placeholder="Titolo (es. Carta - Pizzas)" className="sm:col-span-2 border border-zinc-200 rounded px-3 py-2 text-sm" />
                  <select value={a.category} onChange={(e) => updateKbArticle(i, "category", e.target.value)} className="border border-zinc-200 rounded px-3 py-2 text-sm">
                    <option value="general">general</option>
                    <option value="menu">menu</option>
                    <option value="policies">policies</option>
                  </select>
                </div>
                <textarea value={a.content} onChange={(e) => updateKbArticle(i, "content", e.target.value)} rows={4} placeholder="Contenuto articolo…" className="w-full border border-zinc-200 rounded px-3 py-2 text-sm" />
                <button onClick={() => removeKbArticle(i)} className="text-xs text-red-500">rimuovi</button>
              </div>
            ))}
            <button onClick={addKbArticle} className="text-sm font-semibold text-[#8b6540]">+ articolo</button>
          </div>
          <div className="rounded-xl border-2 border-zinc-200 bg-zinc-50 p-3">
            <h4 className="text-xs font-bold uppercase tracking-widest mb-2">Voice prompt (Retell)</h4>
            <textarea value={voicePrompt} onChange={(e) => setVoicePrompt(e.target.value)} rows={10} className="w-full border border-zinc-200 rounded px-3 py-2 text-sm font-mono" />
          </div>
        </div>
      )}

      {/* STEP 5 */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><User className="w-4 h-4" /> 5. Account owner</h2>
          <p className="text-xs text-black/60">L&apos;owner ricerverà queste credenziali per accedere al CRM.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome owner" value={ownerName} onChange={setOwnerName} placeholder="Mario Rossi" />
            <Field label="Email" value={ownerEmail} onChange={setOwnerEmail} placeholder="mario@trattoria.com" type="email" />
            <Field label="Password (≥8 caratteri)" value={ownerPassword} onChange={setOwnerPassword} placeholder="" type="text" />
          </div>
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
            <h4 className="font-bold flex items-center gap-1.5 mb-1"><Globe className="w-4 h-4" /> Recap</h4>
            <ul className="text-xs space-y-0.5">
              <li>• Tenant: <b>{restaurantName || "—"}</b> ({slug || "—"})</li>
              <li>• Lingua / TZ: {language} / {timezone}</li>
              <li>• Tavoli iniziali: {tableSize}</li>
              <li>• Articoli KB: {kbArticles.filter((a) => a.title.trim()).length}</li>
              <li>• Workflow n8n da clonare: 13</li>
            </ul>
          </div>
        </div>
      )}

      {/* Nav */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => setStep((s) => (s - 1) as Step)}
          disabled={step === 1}
          className="flex items-center gap-1 px-4 py-2 rounded-lg border-2 border-zinc-200 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" /> Indietro
        </button>
        {step < 5 ? (
          <button
            onClick={() => setStep((s) => (s + 1) as Step)}
            className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-[#c4956a] text-white font-bold"
          >
            Avanti <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!restaurantName || !slug || !ownerEmail || !ownerPassword}
            className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Crea CRM
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-black/70">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-black/70">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
        {options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
      </select>
    </div>
  );
}
