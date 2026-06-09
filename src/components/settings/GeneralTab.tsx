"use client";

import { Save, Plus, Trash2, Clock, Power, PowerOff, Upload, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface TimeSlot { open: string; close: string }
type OpeningHours = Record<string, TimeSlot[]>;
type VoicemailSchedule = Record<string, TimeSlot[]>;

interface VoicemailMessage {
  es: string;
  en: string;
  it: string;
  de: string;
}

type VoicemailMode = "always" | "scheduled" | "off";
interface VoicemailConfig {
  enabled: boolean;
  mode: VoicemailMode;
  schedule: VoicemailSchedule;
  forward_phone: string;
  message: VoicemailMessage;
}

const DAY_LABELS_KEYS = ["settings_day_sun", "settings_day_mon", "settings_day_tue", "settings_day_wed", "settings_day_thu", "settings_day_fri", "settings_day_sat"] as const;

// Mirror of server-side isInsideSchedule in /api/sync-vapi-voicemail/route.ts.
// Kept here so the toggle can reflect the effective state in real time without a roundtrip.
function isInsideScheduleNow(schedule: VoicemailSchedule, tz: string): boolean {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
    return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
  };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const today = dayMap[wd] ?? 0;
  const yesterday = (today + 6) % 7;
  const nowMin = toMin(`${hh}:${mm}`);
  for (const s of schedule[String(today)] || []) {
    const a = toMin(s.open), b = toMin(s.close);
    if (a <= b) { if (nowMin >= a && nowMin < b) return true; }
    else if (nowMin >= a) return true;
  }
  for (const s of schedule[String(yesterday)] || []) {
    const a = toMin(s.open), b = toMin(s.close);
    if (a > b && nowMin < b) return true;
  }
  return false;
}

const DEFAULT_OPENING_HOURS: OpeningHours = {
  "0": [{ open: "12:30", close: "15:30" }],
  "1": [],
  "2": [{ open: "19:30", close: "22:30" }],
  "3": [{ open: "19:30", close: "22:30" }],
  "4": [{ open: "12:30", close: "15:30" }, { open: "20:00", close: "22:30" }],
  "5": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "6": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
};

// Neutral defaults — no restaurant name, no phone pre-filled. The owner sets
// their own forwarding number and (optionally) personalizes the scripts.
const DEFAULT_VOICEMAIL: VoicemailConfig = {
  enabled: false,
  mode: "off",
  schedule: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
  forward_phone: "",
  message: {
    es: "Hola, ha llamado al contestador del restaurante. Ahora estamos cerrados. Si quiere reservar puede escribirnos por WhatsApp al mismo número o llamar durante el horario de apertura. Gracias.",
    en: "Hi, you've reached the restaurant's answering machine. We are closed right now. To book a table please message us on WhatsApp at this same number or call us during opening hours. Thank you.",
    it: "Ciao, ha chiamato la segreteria del ristorante. Adesso siamo chiusi. Per prenotare può scriverci su WhatsApp allo stesso numero o richiamare negli orari di apertura. Grazie.",
    de: "Hallo, Sie haben den Anrufbeantworter des Restaurants erreicht. Wir haben gerade geschlossen. Für eine Reservierung schreiben Sie uns bitte auf WhatsApp unter derselben Nummer oder rufen Sie während der Öffnungszeiten an. Danke.",
  },
};

export function GeneralTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [timezone, setTimezone] = useState("Atlantic/Canary");
  const [avgSpend, setAvgSpend] = useState(50);
  const [avgCost, setAvgCost] = useState(25);
  const [aiMonthlyCost, setAiMonthlyCost] = useState(0);
  const [noShowBaseline, setNoShowBaseline] = useState(15);
  const [aiBooking, setAiBooking] = useState(true);
  const [aiVoice, setAiVoice] = useState(true);
  const [openingHours, setOpeningHours] = useState<OpeningHours>(DEFAULT_OPENING_HOURS);
  const [voicemail, setVoicemail] = useState<VoicemailConfig>(DEFAULT_VOICEMAIL);
  const [, setNowTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const insideScheduleNow = isInsideScheduleNow(voicemail.schedule, timezone || "Atlantic/Canary");
  // Mirror of the server's mode logic so the UI can show the real-time effective state.
  const voicemailEffectiveActive =
    voicemail.mode === "always" ? true :
    voicemail.mode === "scheduled" ? insideScheduleNow :
    false;

  // Always re-fetch the active tenant from the DB on mount. The TenantContext
  // caches tenant.settings in sessionStorage, so without this call the page
  // would render stale data after any external write (admin script, API call
  // from a bot, another tab) — and the bot, which always reads from DB, would
  // disagree with what the user sees in this form. Forcing a refresh keeps
  // the Settings page in lockstep with the source of truth.
  useEffect(() => {
    refreshActiveTenant();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name);
    const s = tenant.settings as any;
    if (s) {
      setLogoUrl(s.branding?.logo_url || "");
      setTimezone(s.timezone || "Atlantic/Canary");
      setAvgSpend(s.avg_spend || 50);
      setAvgCost(s.avg_cost || 25);
      setAiMonthlyCost(s.ai_monthly_cost || 0);
      setNoShowBaseline(s.no_show_baseline_pct || 15);
      if (s.opening_hours && Object.keys(s.opening_hours).length > 0) {
        setOpeningHours(s.opening_hours);
      }
      if (s.ai_enabled_channels) {
        setAiBooking(s.ai_enabled_channels.includes("whatsapp"));
        setAiVoice(s.ai_enabled_channels.includes("voice"));
      }
      if (s.vapi_voicemail) {
        const vm = s.vapi_voicemail;
        const schedule = { ...DEFAULT_VOICEMAIL.schedule, ...(vm.schedule || {}) };
        // New configs carry an explicit `mode`; legacy ones only have `enabled`
        // + `schedule`, so derive it: manual enable → always, any slot → scheduled.
        const hasSlots = Object.values(schedule).some((slots) => (slots as TimeSlot[]).length > 0);
        const mode: VoicemailMode = vm.mode || (vm.enabled ? "always" : hasSlots ? "scheduled" : "off");
        setVoicemail({
          enabled: mode === "always",
          mode,
          schedule,
          forward_phone: vm.forward_phone || DEFAULT_VOICEMAIL.forward_phone,
          message: { ...DEFAULT_VOICEMAIL.message, ...(vm.message || {}) },
        });
      }
    }
  }, [tenant]);

  // Compress a picked logo to a square-ish WebP (~256px) and upload it to the
  // public "branding" bucket, then persist settings.branding.logo_url right away
  // so the sidebar updates without waiting for the Save button. Mirrors the
  // dish-photo upload in the Menu editor (Supabase Free shares one bucket, so
  // we keep logos tiny).
  const compressLogo = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 256;
        let { width, height } = img;
        if (width > height && width > MAX) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else if (height >= width && height > MAX) {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no 2d context"));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/webp", 0.9);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image decode failed"));
      };
      img.src = url;
    });

  const persistLogo = async (nextUrl: string) => {
    if (!tenant) return;
    const merged = {
      ...((tenant.settings as any) || {}),
      branding: { ...((tenant.settings as any)?.branding || {}), logo_url: nextUrl || undefined },
    };
    const { error } = await supabase.from("tenants").update({ settings: merged }).eq("id", tenant.id);
    if (error) throw error;
    await refreshActiveTenant();
  };

  const handleLogoPick = async (file: File | null) => {
    if (!tenant || !file || !file.type.startsWith("image/")) return;
    setLogoUploading(true);
    try {
      const blob = await compressLogo(file);
      const path = `${tenant.id}/logo.webp`;
      const { error: upErr } = await supabase.storage
        .from("branding")
        .upload(path, blob, { contentType: "image/webp", upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("branding").getPublicUrl(path);
      // Cache-bust so an overwritten logo refreshes immediately in the sidebar.
      const nextUrl = `${pub.publicUrl}?v=${blob.size}`;
      setLogoUrl(nextUrl);
      await persistLogo(nextUrl);
    } catch (e) {
      console.error("[settings] logo upload failed", e);
      alert(`Errore caricamento logo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleLogoRemove = async () => {
    if (!tenant) return;
    setLogoUploading(true);
    try {
      await supabase.storage.from("branding").remove([`${tenant.id}/logo.webp`]).catch(() => {});
      setLogoUrl("");
      await persistLogo("");
    } catch (e) {
      console.error("[settings] logo remove failed", e);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setSaved(false);

    const channels: string[] = [];
    if (aiBooking) channels.push("whatsapp");
    if (aiVoice) channels.push("voice");

    const newSettings = {
      // Preserve any settings keys this form doesn't manage (e.g. pos, voice,
      // n8n, bot_config) — they'd be wiped otherwise since we overwrite the
      // whole settings JSONB below.
      ...((tenant.settings as any) || {}),
      branding: { ...((tenant.settings as any)?.branding || {}), logo_url: logoUrl || undefined },
      timezone,
      currency: "EUR",
      ai_enabled_channels: channels,
      avg_spend: avgSpend,
      avg_cost: avgCost,
      ai_monthly_cost: aiMonthlyCost,
      no_show_baseline_pct: noShowBaseline,
      opening_hours: openingHours,
      vapi_voicemail: voicemail,
    };

    const { error } = await supabase.from("tenants").update({
      name,
      settings: newSettings,
    }).eq("id", tenant.id);

    if (error) {
      console.error("Save failed:", error);
      setSaving(false);
      return;
    }

    // Upsert KB article "Horario del restaurante" so the bots (voice + chat)
    // always read the same schedule as the availability API.
    try {
      const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
      const lines: string[] = [];
      for (let d = 0; d < 7; d++) {
        const slots = openingHours[String(d)] || [];
        if (slots.length === 0) {
          lines.push(`${dayNames[d]}: CERRADO`);
        } else {
          const parts = slots.map((s) => {
            const startMin = parseInt(s.open.split(":")[0]) * 60 + parseInt(s.open.split(":")[1]);
            const label = startMin < 960 ? "almuerzo" : "cena";
            return `${s.open}-${s.close} (${label})`;
          });
          lines.push(`${dayNames[d]}: ${parts.join(" y ")}`);
        }
      }
      const content = lines.join("\n");

      const { data: existing } = await supabase
        .from("knowledge_articles")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("title", "Horario del restaurante")
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from("knowledge_articles")
          .update({ content, status: "published", category: "general" })
          .eq("id", existing.id);
      } else {
        await supabase.from("knowledge_articles").insert({
          tenant_id: tenant.id,
          title: "Horario del restaurante",
          content,
          category: "general",
          status: "published",
        });
      }

      await fetch("/api/sync-kb-vapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
    } catch (syncErr) {
      console.error("KB sync after settings save failed:", syncErr);
    }

    try {
      await fetch("/api/sync-vapi-voicemail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
    } catch (syncErr) {
      console.error("Vapi voicemail sync after settings save failed:", syncErr);
    }

    await refreshActiveTenant();

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const updateSlot = (day: string, idx: number, field: "open" | "close", value: string) => {
    setOpeningHours(prev => {
      const updated = { ...prev };
      updated[day] = [...(updated[day] || [])];
      updated[day][idx] = { ...updated[day][idx], [field]: value };
      return updated;
    });
  };

  const addSlot = (day: string) => {
    setOpeningHours(prev => ({
      ...prev,
      [day]: [...(prev[day] || []), { open: "12:00", close: "15:00" }],
    }));
  };

  const removeSlot = (day: string, idx: number) => {
    setOpeningHours(prev => ({
      ...prev,
      [day]: (prev[day] || []).filter((_, i) => i !== idx),
    }));
  };

  const updateVmSlot = (day: string, idx: number, field: "open" | "close", value: string) => {
    setVoicemail(prev => {
      const updated = { ...prev.schedule };
      updated[day] = [...(updated[day] || [])];
      updated[day][idx] = { ...updated[day][idx], [field]: value };
      return { ...prev, schedule: updated };
    });
  };

  const addVmSlot = (day: string) => {
    setVoicemail(prev => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: [...(prev.schedule[day] || []), { open: "23:00", close: "12:00" }],
      },
    }));
  };

  const removeVmSlot = (day: string, idx: number) => {
    setVoicemail(prev => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: (prev.schedule[day] || []).filter((_, i) => i !== idx),
      },
    }));
  };

  const inputStyle = "block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]";
  const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-black">{t("settings_general")}</h2>
        </div>
        <div className="mt-3 sm:mt-0 flex items-center space-x-3">
          {saved && <span className="text-sm font-medium text-green-600">{t("settings_saved")}</span>}
          <button onClick={handleSave} disabled={saving}
            className="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}>
            <Save className="-ml-1 mr-2 h-5 w-5" />
            {saving ? "Saving..." : t("settings_save")}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-lg font-bold text-black mb-4">{t("settings_general")}</h3>
          <div>
            <label className="block text-sm font-medium text-black">{t("settings_name")}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className={`mt-1 ${inputStyle}`} style={inputBorder} />
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium text-black">{t("settings_logo")}</label>
            <p className="mt-0.5 text-xs text-black/70">{t("settings_logo_desc")}</p>
            <div className="mt-3 flex items-center gap-4">
              <div
                className="h-16 w-16 rounded-xl border-2 flex items-center justify-center overflow-hidden shrink-0"
                style={{ borderColor: "#c4956a", background: "white" }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={name || "logo"} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-7 w-7 text-[#c4956a]" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => handleLogoPick(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-semibold text-black hover:bg-[#c4956a]/10 transition-colors disabled:opacity-50"
                  style={{ borderColor: "#c4956a" }}
                >
                  <Upload className="h-4 w-4 text-[#c4956a]" />
                  {logoUploading ? t("settings_logo_uploading") : logoUrl ? t("settings_logo_change") : t("settings_logo_upload")}
                </button>
                {logoUrl && !logoUploading && (
                  <button
                    type="button"
                    onClick={handleLogoRemove}
                    className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-600 text-red-600 text-sm font-medium hover:bg-red-600 hover:text-white transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("settings_logo_remove")}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-black/60">{t("settings_logo_hint")}</p>
          </div>
        </section>

        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-lg font-bold text-black mb-4">{t("settings_analytics")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_avg_spend")}</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-black text-sm">€</span>
                </div>
                <input type="number" value={avgSpend} onChange={e => setAvgSpend(Number(e.target.value))}
                  className={`pl-7 ${inputStyle}`} style={inputBorder} />
              </div>
              <p className="mt-1 text-xs text-black">{t("settings_avg_spend_desc")}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_avg_cost")}</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-black text-sm">€</span>
                </div>
                <input type="number" value={avgCost} onChange={e => setAvgCost(Number(e.target.value))}
                  className={`pl-7 ${inputStyle}`} style={inputBorder} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_ai_monthly_cost")}</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-black text-sm">€</span>
                </div>
                <input type="number" value={aiMonthlyCost} onChange={e => setAiMonthlyCost(Number(e.target.value))}
                  className={`pl-7 ${inputStyle}`} style={inputBorder} />
              </div>
              <p className="mt-1 text-xs text-black">{t("settings_ai_monthly_cost_desc")}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_noshow_baseline")}</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-black text-sm">%</span>
                </div>
                <input type="number" value={noShowBaseline} onChange={e => setNoShowBaseline(Number(e.target.value))}
                  className={`pl-7 ${inputStyle}`} style={inputBorder} min={0} max={100} />
              </div>
              <p className="mt-1 text-xs text-black">{t("settings_noshow_baseline_desc")}</p>
            </div>
          </div>
        </section>

        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-lg font-bold text-black mb-1">{t("settings_opening_hours")}</h3>
          <p className="text-xs text-black mb-4">{t("settings_opening_hours_desc")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {DAY_LABELS_KEYS.map((dayKey, dayIdx) => {
              const dayStr = String(dayIdx);
              const slots = openingHours[dayStr] || [];
              return (
                <div
                  key={dayStr}
                  className="rounded-lg border-2 p-3 flex flex-col gap-2"
                  style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-black">{t(dayKey as any)}</span>
                    {slots.length === 0 && (
                      <span className="text-[10px] italic text-black/60 uppercase tracking-wider">{t("settings_closed")}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {slots.map((slot, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          type="time"
                          value={slot.open}
                          onChange={(e) => updateSlot(dayStr, idx, "open", e.target.value)}
                          className="flex-1 min-w-0 rounded-md border-2 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                          style={{ borderColor: "#c4956a", background: "white" }}
                        />
                        <span className="text-black text-xs">—</span>
                        <input
                          type="time"
                          value={slot.close}
                          onChange={(e) => updateSlot(dayStr, idx, "close", e.target.value)}
                          className="flex-1 min-w-0 rounded-md border-2 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                          style={{ borderColor: "#c4956a", background: "white" }}
                        />
                        <button
                          onClick={() => removeSlot(dayStr, idx)}
                          className="p-1 rounded-md text-red-600 hover:bg-red-500/10 transition-colors shrink-0"
                          title={t("settings_remove_slot")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addSlot(dayStr)}
                      className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-md border-2 border-dashed text-black hover:bg-[#c4956a]/10 transition-colors"
                      style={{ borderColor: "#c4956a" }}
                    >
                      <Plus className="w-3.5 h-3.5" /> {t("settings_add_slot")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-lg font-bold text-black mb-1">{t("settings_voicemail_title")}</h3>
          <p className="text-xs text-black mb-4">{t("settings_voicemail_desc")}</p>

          <div className="mb-5 p-3 rounded-lg border-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
            {/* Header row: title/hint on the left, the compact mode buttons aligned
                to the top-right. The selected mode's full description sits below. */}
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-bold text-black">{t("settings_voicemail_mode")}</label>
                <p className="text-xs text-black/70 mt-0.5">{t("settings_voicemail_mode_hint")}</p>
              </div>

              <div className="flex flex-wrap gap-1.5 shrink-0" role="radiogroup" aria-label={t("settings_voicemail_mode")}>
                {([
                  { value: "always" as const, icon: Power, label: t("settings_voicemail_mode_always") },
                  { value: "scheduled" as const, icon: Clock, label: t("settings_voicemail_mode_scheduled") },
                  { value: "off" as const, icon: PowerOff, label: t("settings_voicemail_mode_off") },
                ]).map(({ value, icon: Icon, label }) => {
                  const selected = voicemail.mode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setVoicemail(prev => ({ ...prev, mode: value, enabled: value === "always" }))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                      style={{
                        borderColor: selected ? "#c4956a" : "#e5d9c8",
                        background: selected ? "#c4956a" : "white",
                        color: selected ? "white" : "#1a1a1a",
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: selected ? "white" : "#c4956a" }} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Description of the currently selected mode + live effective state. */}
            <div className="mt-3 flex flex-col gap-1.5">
              <p className="text-xs text-black/70">
                {voicemail.mode === "always"
                  ? t("settings_voicemail_mode_always_desc")
                  : voicemail.mode === "scheduled"
                  ? t("settings_voicemail_mode_scheduled_desc")
                  : t("settings_voicemail_mode_off_desc")}
              </p>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: voicemailEffectiveActive ? "#16a34a" : "#9ca3af" }}
                />
                <span style={{ color: voicemailEffectiveActive ? "#16a34a" : "rgba(0,0,0,0.5)" }}>
                  {voicemailEffectiveActive ? t("settings_voicemail_status_on") : t("settings_voicemail_status_off")}
                  {voicemail.mode === "scheduled" && ` ${t("settings_voicemail_status_by_schedule")}`}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-black">{t("settings_voicemail_forward")}</label>
            <input
              type="tel"
              value={voicemail.forward_phone}
              onChange={(e) => setVoicemail(prev => ({ ...prev, forward_phone: e.target.value }))}
              className={`mt-1 ${inputStyle}`}
              style={inputBorder}
              placeholder="+34 600 000 000"
            />
            <p className="mt-1 text-xs text-black/70">{t("settings_voicemail_forward_hint")}</p>
          </div>

          <div className="mb-5" data-testid="voicemail-schedule">
            <h4 className="text-sm font-bold text-black mb-1">{t("settings_voicemail_schedule")}</h4>
            <p className="text-xs text-black/70 mb-3">{t("settings_voicemail_schedule_desc")}</p>
            {voicemail.mode !== "scheduled" && (
              <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg border" style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.12)" }}>
                <Clock className="w-4 h-4 mt-0.5 shrink-0 text-[#c4956a]" />
                <p className="text-xs text-black">{t("settings_voicemail_schedule_only_in_scheduled")}</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {DAY_LABELS_KEYS.map((dayKey, dayIdx) => {
                const dayStr = String(dayIdx);
                const slots = voicemail.schedule[dayStr] || [];
                return (
                  <div
                    key={dayStr}
                    className="rounded-lg border-2 p-3 flex flex-col gap-2"
                    style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-black">{t(dayKey as any)}</span>
                      {slots.length === 0 && (
                        <span className="text-[10px] italic text-black/60 uppercase tracking-wider">—</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {slots.map((slot, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={slot.open}
                            onChange={(e) => updateVmSlot(dayStr, idx, "open", e.target.value)}
                            className="flex-1 min-w-0 rounded-md border-2 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                            style={{ borderColor: "#c4956a", background: "white" }}
                          />
                          <span className="text-black text-xs">—</span>
                          <input
                            type="time"
                            value={slot.close}
                            onChange={(e) => updateVmSlot(dayStr, idx, "close", e.target.value)}
                            className="flex-1 min-w-0 rounded-md border-2 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                            style={{ borderColor: "#c4956a", background: "white" }}
                          />
                          <button
                            onClick={() => removeVmSlot(dayStr, idx)}
                            className="p-1 rounded-md text-red-600 hover:bg-red-500/10 transition-colors shrink-0"
                            title={t("settings_remove_slot")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addVmSlot(dayStr)}
                        className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-md border-2 border-dashed text-black hover:bg-[#c4956a]/10 transition-colors"
                        style={{ borderColor: "#c4956a" }}
                      >
                        <Plus className="w-3.5 h-3.5" /> {t("settings_add_slot")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-black mb-1">{t("settings_voicemail_message")}</h4>
            <p className="text-xs text-black/70 mb-3">{t("settings_voicemail_message_hint")}</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(["es", "en", "it", "de"] as const).map((lang) => (
                <div key={lang}>
                  <label className="block text-sm font-medium text-black">{t(`settings_voicemail_message_${lang}` as any)}</label>
                  <textarea
                    value={voicemail.message[lang]}
                    onChange={(e) => setVoicemail(prev => ({
                      ...prev,
                      message: { ...prev.message, [lang]: e.target.value },
                    }))}
                    rows={5}
                    className={`mt-1 ${inputStyle}`}
                    style={inputBorder}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
