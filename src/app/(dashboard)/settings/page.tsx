"use client";

import { Save } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Madrid");
  const [avgSpend, setAvgSpend] = useState(50);
  const [avgCost, setAvgCost] = useState(25);
  const [aiBooking, setAiBooking] = useState(true);
  const [aiVoice, setAiVoice] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name);
    const s = tenant.settings as any;
    if (s) {
      setTimezone(s.timezone || "Europe/Madrid");
      setAvgSpend(s.avg_spend || 50);
      setAvgCost(s.avg_cost || 25);
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

    await supabase.from("tenants").update({
      name,
      settings: {
        timezone,
        currency: "EUR",
        ai_enabled_channels: channels,
        avg_spend: avgSpend,
        avg_cost: avgCost,
      }
    }).eq("id", tenant.id);

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="p-8 w-full space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b pb-5" style={{ borderColor: '#c4956a' }}>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t("settings_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("settings_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
          {saved && <span className="text-sm font-medium text-green-600">Saved!</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white transition-colors disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
          >
            <Save className="-ml-1 mr-2 h-5 w-5" />
            {saving ? "Saving..." : t("settings_save")}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_general")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_name")}</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="mt-1 block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_timezone")}</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="mt-1 block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
              >
                <option value="Europe/Madrid">Europe/Madrid</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Rome">Europe/Rome</option>
                <option value="America/New_York">America/New_York</option>
              </select>
            </div>
          </div>
        </section>

        <section className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_analytics")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_avg_spend")}</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-black text-sm">€</span>
                </div>
                <input
                  type="number"
                  value={avgSpend}
                  onChange={e => setAvgSpend(Number(e.target.value))}
                  className="pl-7 block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-black">{t("settings_avg_cost")}</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-black text-sm">€</span>
                </div>
                <input
                  type="number"
                  value={avgCost}
                  onChange={e => setAvgCost(Number(e.target.value))}
                  className="pl-7 block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                />
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-black/50">{t("settings_analytics_desc")}</p>
        </section>

        <section className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_ai_title")}</h2>
          <div className="space-y-4">
            <div className="flex items-start">
              <input
                id="ai_booking"
                type="checkbox"
                checked={aiBooking}
                onChange={e => setAiBooking(e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-[#c4956a]"
              />
              <div className="ml-3 text-sm">
                <label htmlFor="ai_booking" className="font-medium text-black">{t("settings_ai_booking")}</label>
                <p className="text-black/50">{t("settings_ai_booking_desc")}</p>
              </div>
            </div>
            <div className="flex items-start">
              <input
                id="ai_voice"
                type="checkbox"
                checked={aiVoice}
                onChange={e => setAiVoice(e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-[#c4956a]"
              />
              <div className="ml-3 text-sm">
                <label htmlFor="ai_voice" className="font-medium text-black">{t("settings_ai_voice")}</label>
                <p className="text-black/50">{t("settings_ai_voice_desc")}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
