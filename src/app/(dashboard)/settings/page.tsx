"use client";

import { Save, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface TimeSlot { open: string; close: string }
type OpeningHours = Record<string, TimeSlot[]>;

const DAY_LABELS_KEYS = ["settings_day_sun", "settings_day_mon", "settings_day_tue", "settings_day_wed", "settings_day_thu", "settings_day_fri", "settings_day_sat"] as const;

const DEFAULT_OPENING_HOURS: OpeningHours = {
  "0": [{ open: "12:30", close: "15:30" }],
  "1": [],
  "2": [{ open: "19:30", close: "22:30" }],
  "3": [{ open: "19:30", close: "22:30" }],
  "4": [{ open: "12:30", close: "15:30" }, { open: "20:00", close: "22:30" }],
  "5": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
  "6": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
};

export default function SettingsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Atlantic/Canary");
  const [avgSpend, setAvgSpend] = useState(50);
  const [avgCost, setAvgCost] = useState(25);
  const [aiMonthlyCost, setAiMonthlyCost] = useState(0);
  const [noShowBaseline, setNoShowBaseline] = useState(15);
  const [aiBooking, setAiBooking] = useState(true);
  const [aiVoice, setAiVoice] = useState(true);
  const [openingHours, setOpeningHours] = useState<OpeningHours>(DEFAULT_OPENING_HOURS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name);
    const s = tenant.settings as any;
    if (s) {
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
    }
  }, [tenant]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setSaved(false);

    const channels: string[] = [];
    if (aiBooking) channels.push("whatsapp");
    if (aiVoice) channels.push("voice");

    const newSettings = {
      timezone,
      currency: "EUR",
      ai_enabled_channels: channels,
      avg_spend: avgSpend,
      avg_cost: avgCost,
      ai_monthly_cost: aiMonthlyCost,
      no_show_baseline_pct: noShowBaseline,
      opening_hours: openingHours,
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

    // Clear tenant cache so dashboard picks up new settings
    try { sessionStorage.clear(); } catch {}

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

  const inputStyle = "block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]";
  const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b pb-5" style={{ borderColor: "#c4956a" }}>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t("settings_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("settings_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
          {saved && <span className="text-sm font-medium text-green-600">{t("settings_saved")}</span>}
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white transition-colors disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}>
            <Save className="-ml-1 mr-2 h-5 w-5" />
            {saving ? "Saving..." : t("settings_save")}
          </button>
        </div>
      </div>

      <div className="space-y-6">

        {/* General */}
        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_general")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_name")}</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className={`mt-1 ${inputStyle}`} style={inputBorder} />
            </div>
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_timezone")}</label>
              <input type="text" value={timezone} onChange={e => setTimezone(e.target.value)}
                className={`mt-1 ${inputStyle}`} style={inputBorder} />
            </div>
          </div>
        </section>

        {/* Analytics & KPI */}
        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_analytics")}</h2>
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
              <p className="mt-1 text-xs text-black/50">{t("settings_avg_spend_desc")}</p>
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
              <p className="mt-1 text-xs text-black/50">{t("settings_ai_monthly_cost_desc")}</p>
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
              <p className="mt-1 text-xs text-black/50">{t("settings_noshow_baseline_desc")}</p>
            </div>
          </div>
        </section>

        {/* Opening Hours */}
        <section className="p-6 rounded-xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h2 className="text-lg font-bold text-zinc-900 mb-1">{t("settings_opening_hours")}</h2>
          <p className="text-xs text-black/50 mb-4">{t("settings_opening_hours_desc")}</p>
          <div className="space-y-3">
            {DAY_LABELS_KEYS.map((dayKey_, dayIdx) => {
              const dayLabel = t(dayKey_);
              const dayKey = String(dayIdx);
              const slots = openingHours[dayKey] || [];
              return (
                <div key={dayIdx} className="flex flex-col sm:flex-row sm:items-start gap-2 py-2 border-b last:border-b-0" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                  <span className="text-sm font-medium text-black w-24 pt-1.5 flex-shrink-0">{dayLabel}</span>
                  <div className="flex-1 space-y-2">
                    {slots.length === 0 ? (
                      <span className="text-xs text-black/40 italic pt-1.5">{t("settings_closed")}</span>
                    ) : (
                      slots.map((slot, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input type="time" value={slot.open}
                            onChange={e => updateSlot(dayKey, idx, "open", e.target.value)}
                            className="rounded-lg border-2 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                            style={inputBorder} />
                          <span className="text-xs text-black/50">{t("settings_to")}</span>
                          <input type="time" value={slot.close}
                            onChange={e => updateSlot(dayKey, idx, "close", e.target.value)}
                            className="rounded-lg border-2 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                            style={inputBorder} />
                          <button onClick={() => removeSlot(dayKey, idx)}
                            className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <button onClick={() => addSlot(dayKey)}
                    className="p-1.5 hover:bg-[#c4956a]/10 rounded-lg transition-colors text-[#c4956a] self-start mt-1">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
