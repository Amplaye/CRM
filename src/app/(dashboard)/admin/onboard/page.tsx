"use client";

import { useState } from "react";
import Link from "next/link";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { ChevronLeft, ChevronRight, Check, AlertTriangle, RefreshCw, Globe, Building, Clock, Grid3X3, BookOpen, User, ExternalLink } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

interface OpeningSlot { open: string; close: string }
type Hours = Record<string, OpeningSlot[]>;

const DAYS = [
  { idx: "1", key: "adm_onboard_day_mon" },
  { idx: "2", key: "adm_onboard_day_tue" },
  { idx: "3", key: "adm_onboard_day_wed" },
  { idx: "4", key: "adm_onboard_day_thu" },
  { idx: "5", key: "adm_onboard_day_fri" },
  { idx: "6", key: "adm_onboard_day_sat" },
  { idx: "0", key: "adm_onboard_day_sun" },
] as const;

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
  const { t } = useLanguage();
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
          // The orchestrator now seats the starter floor plan from a declared
          // capacity (the self-serve wizard reads it from the questionnaire).
          // This admin tool still offers the small/medium/large picker, so map it
          // to a representative seat count here.
          capacity_seats: tableSize === "small" ? 12 : tableSize === "large" ? 60 : 30,
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
          <h2 className="font-bold">{t("adm_onboard_forbidden")}</h2>
          <p className="text-sm mt-1">{t("adm_onboard_forbidden_msg")}</p>
        </div>
      </div>
    );
  }

  // Status / final view
  if (running || done) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">{t("adm_onboard_creating_title")}</h1>
        <p className="text-sm text-black mb-6">
          {done?.ok
            ? t("adm_onboard_status_done")
            : done && !done.ok
              ? t("adm_onboard_status_failed")
              : t("adm_onboard_status_provisioning")}
        </p>

        <div className="rounded-xl border-2 border-[#c4956a] bg-white p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {p.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
              <div className="flex-1">
                <span className="font-bold uppercase text-[11px] tracking-widest text-black mr-2">{p.step}</span>
                <span className={p.ok ? "text-black" : "text-red-600 font-medium"}>{p.message}</span>
              </div>
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-xs text-black pt-2">
              <RefreshCw className="w-3 h-3 animate-spin" /> {t("adm_onboard_in_progress")}
            </div>
          )}
        </div>

        {done?.ok && done.tenant_id && (
          <div className="mt-6 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <h2 className="font-bold text-emerald-800">{t("adm_onboard_crm_ready")}</h2>
            <p className="text-sm text-emerald-700">
              {t("adm_onboard_tenant_id")} <code className="bg-white/70 px-1.5 py-0.5 rounded">{done.tenant_id}</code>
            </p>
            <p className="text-sm text-emerald-700">
              {t("adm_onboard_owner_login")} <b>{ownerEmail}</b> · {t("adm_onboard_password")} <b>{ownerPassword}</b>
            </p>
            <p className="text-xs text-emerald-700/80 mt-3">
              {t("adm_onboard_whatsapp_note")}
            </p>
            <div className="flex gap-2 pt-2">
              <Link href="/admin" className="text-sm font-semibold text-emerald-800 underline">{t("adm_onboard_back_to_admin")}</Link>
            </div>
          </div>
        )}

        {done && !done.ok && (
          <div className="mt-6 flex gap-2">
            <button onClick={() => { setRunning(false); setDone(null); setProgress([]); }} className="px-4 py-2 rounded-lg border-2 border-[#c4956a] bg-white">{t("adm_onboard_retry")}</button>
          </div>
        )}
      </div>
    );
  }

  // Step content
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-xs text-black mb-2">
        <Link href="/admin" className="hover:text-black">{t("adm_onboard_breadcrumb_admin")}</Link> / <span>{t("adm_onboard_breadcrumb_new")}</span>
      </div>
      <h1 className="text-2xl font-bold mb-1">{t("adm_onboard_title")}</h1>
      <p className="text-sm text-black mb-6">{t("adm_onboard_intro")}</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className={`flex-1 h-1.5 rounded-full ${n <= step ? "bg-[#c4956a]" : "bg-zinc-200"}`} />
        ))}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Building className="w-4 h-4" /> {t("adm_onboard_step1_title")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("adm_onboard_field_name")} value={restaurantName} onChange={(v) => { setRestaurantName(v); syncSlug(v); }} placeholder="Trattoria Rossa" />
            <Field label={t("adm_onboard_field_slug")} value={slug} onChange={setSlug} placeholder="trattoria-rossa" />
            <Field label={t("adm_onboard_field_phone")} value={restaurantPhone} onChange={setRestaurantPhone} placeholder="+34 928 123 456" />
            <Field label={t("adm_onboard_field_addr")} value={restaurantAddr} onChange={setRestaurantAddr} placeholder={t("adm_onboard_addr_placeholder")} />
            <Field label={t("adm_onboard_field_owner_phone")} value={ownerPhone} onChange={setOwnerPhone} placeholder="+39333..." />
            <Field label={t("adm_onboard_field_review_url")} value={reviewUrl} onChange={setReviewUrl} placeholder="https://www.google.com/maps?cid=..." />
            <SelectField label={t("adm_onboard_field_language")} value={language} onChange={(v) => setLanguage(v as any)} options={[["es", t("adm_onboard_lang_es")], ["it", t("adm_onboard_lang_it")], ["en", t("adm_onboard_lang_en")], ["de", t("adm_onboard_lang_de")]]} />
            <SelectField label={t("adm_onboard_field_timezone")} value={timezone} onChange={setTimezone} options={[["Atlantic/Canary", "Atlantic/Canary (Las Palmas)"], ["Europe/Madrid", "Europe/Madrid"], ["Europe/Rome", "Europe/Rome"]]} />
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Clock className="w-4 h-4" /> {t("adm_onboard_step2_title")}</h2>
          <p className="text-xs text-black">{t("adm_onboard_hours_hint")}</p>
          <div className="space-y-2">
            {DAYS.map((d) => (
              <div key={d.idx} className="rounded-xl border-2 border-[#c4956a]/40 bg-white/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold w-28">{t(d.key)}</h4>
                  <button onClick={() => addHourSlot(d.idx)} className="text-xs font-semibold text-[#8b6540]">{t("adm_onboard_slot")}</button>
                </div>
                {(hours[d.idx] || []).length === 0 ? (
                  <p className="text-xs text-black">{t("adm_onboard_closed")}</p>
                ) : (
                  <div className="space-y-2">
                    {(hours[d.idx] || []).map((s, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input type="time" value={s.open} onChange={(e) => setHourSlot(d.idx, i, "open", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                        <span className="text-xs">→</span>
                        <input type="time" value={s.close} onChange={(e) => setHourSlot(d.idx, i, "close", e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-sm" />
                        <button onClick={() => removeHourSlot(d.idx, i)} className="text-xs text-red-500">{t("adm_onboard_remove")}</button>
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
          <h2 className="text-base font-bold flex items-center gap-2"><Grid3X3 className="w-4 h-4" /> {t("adm_onboard_step3_title")}</h2>
          <p className="text-xs text-black">{t("adm_onboard_tables_hint")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { v: "small", lbl: t("adm_onboard_table_small_lbl"), desc: t("adm_onboard_table_small_desc") },
              { v: "medium", lbl: t("adm_onboard_table_medium_lbl"), desc: t("adm_onboard_table_medium_desc") },
              { v: "large", lbl: t("adm_onboard_table_large_lbl"), desc: t("adm_onboard_table_large_desc") },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setTableSize(o.v as any)}
                className={`p-4 rounded-xl border-2 text-left ${tableSize === o.v ? "border-[#c4956a] bg-[#c4956a]/10" : "border-zinc-200 bg-white"}`}
              >
                <div className="font-bold text-sm">{o.lbl}</div>
                <div className="text-xs text-black mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2"><BookOpen className="w-4 h-4" /> {t("adm_onboard_step4_title")}</h2>
            <button onClick={fillKbDefaults} className="text-xs px-3 py-1.5 rounded-lg border-2 border-[#c4956a] bg-white">{t("adm_onboard_fill_default")}</button>
          </div>
          <p className="text-xs text-black">{t("adm_onboard_kb_hint")}</p>
          <div className="space-y-3">
            {kbArticles.map((a, i) => (
              <div key={i} className="rounded-xl border-2 border-[#c4956a]/40 bg-white p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={a.title} onChange={(e) => updateKbArticle(i, "title", e.target.value)} placeholder={t("adm_onboard_kb_title_placeholder")} className="sm:col-span-2 border border-zinc-200 rounded px-3 py-2 text-sm" />
                  <select value={a.category} onChange={(e) => updateKbArticle(i, "category", e.target.value)} className="border border-zinc-200 rounded px-3 py-2 text-sm">
                    <option value="general">general</option>
                    <option value="menu">menu</option>
                    <option value="policies">policies</option>
                  </select>
                </div>
                <textarea value={a.content} onChange={(e) => updateKbArticle(i, "content", e.target.value)} rows={4} placeholder={t("adm_onboard_kb_content_placeholder")} className="w-full border border-zinc-200 rounded px-3 py-2 text-sm" />
                <button onClick={() => removeKbArticle(i)} className="text-xs text-red-500">{t("adm_onboard_remove")}</button>
              </div>
            ))}
            <button onClick={addKbArticle} className="text-sm font-semibold text-[#8b6540]">{t("adm_onboard_add_article")}</button>
          </div>
          <div className="rounded-xl border-2 border-zinc-200 bg-zinc-50 p-3">
            <h4 className="text-xs font-bold uppercase tracking-widest mb-2">{t("adm_onboard_voice_prompt")}</h4>
            <textarea value={voicePrompt} onChange={(e) => setVoicePrompt(e.target.value)} rows={10} className="w-full border border-zinc-200 rounded px-3 py-2 text-sm font-mono" />
          </div>
        </div>
      )}

      {/* STEP 5 */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold flex items-center gap-2"><User className="w-4 h-4" /> {t("adm_onboard_step5_title")}</h2>
          <p className="text-xs text-black">{t("adm_onboard_owner_creds_hint")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("adm_onboard_field_owner_name")} value={ownerName} onChange={setOwnerName} placeholder="Mario Rossi" />
            <Field label={t("adm_onboard_field_email")} value={ownerEmail} onChange={setOwnerEmail} placeholder="mario@trattoria.com" type="email" />
            <Field label={t("adm_onboard_field_password")} value={ownerPassword} onChange={setOwnerPassword} placeholder="" type="text" />
          </div>
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
            <h4 className="font-bold flex items-center gap-1.5 mb-1"><Globe className="w-4 h-4" /> {t("adm_onboard_recap")}</h4>
            <ul className="text-xs space-y-0.5">
              <li>• {t("adm_onboard_recap_tenant")} <b>{restaurantName || "—"}</b> ({slug || "—"})</li>
              <li>• {t("adm_onboard_recap_lang_tz")} {language} / {timezone}</li>
              <li>• {t("adm_onboard_recap_tables")} {tableSize}</li>
              <li>• {t("adm_onboard_recap_kb")} {kbArticles.filter((a) => a.title.trim()).length}</li>
              <li>• {t("adm_onboard_recap_workflows")}</li>
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
          <ChevronLeft className="w-4 h-4" /> {t("adm_onboard_back")}
        </button>
        {step < 5 ? (
          <button
            onClick={() => setStep((s) => (s + 1) as Step)}
            className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-[#c4956a] text-white font-bold"
          >
            {t("adm_onboard_next")} <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!restaurantName || !slug || !ownerEmail || !ownerPassword}
            className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> {t("adm_onboard_create_crm")}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-black">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-black">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
        {options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
      </select>
    </div>
  );
}
