"use client";

import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { TenantFeatures, FEATURE_FLAGS, getFeatures } from "@/lib/types/tenant-settings";

// Settings → Features. Each restaurant capability is a single on/off toggle that
// flips a flag in tenants.settings.features. No rules, no builders (see
// feedback_no_power_user_features): the owner just answers yes/no about their venue.
export function FeaturesTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  const [features, setFeatures] = useState<TenantFeatures>(getFeatures(null));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-read from DB on mount: TenantContext caches settings in sessionStorage, so
  // without this the form could show stale flags after an external write.
  useEffect(() => {
    refreshActiveTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant) return;
    setFeatures(getFeatures(tenant.settings));
  }, [tenant]);

  const toggle = (key: keyof TenantFeatures) =>
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setSaved(false);

    // Merge into the existing settings object — never clobber other fields.
    const newSettings = { ...(tenant.settings || {}), features };
    const { error } = await supabase
      .from("tenants")
      .update({ settings: newSettings })
      .eq("id", tenant.id);

    if (error) {
      console.error("Save features failed:", error);
      setSaving(false);
      return;
    }

    await refreshActiveTenant();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-black">{t("settings_features_title")}</h2>
          <p className="mt-1 text-sm text-black/70">{t("settings_features_desc")}</p>
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

      <div className="space-y-3">
        {FEATURE_FLAGS.map(({ key, labelKey, hintKey }) => {
          const on = features[key];
          return (
            <div key={key}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border-2"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
              <div className="flex-1">
                <label className="text-sm font-bold text-black">{t(labelKey as keyof Dictionary)}</label>
                <p className="text-xs text-black/70 mt-0.5">{t(hintKey as keyof Dictionary)}</p>
              </div>
              <button
                type="button"
                onClick={() => toggle(key)}
                className="relative inline-flex items-center h-7 w-12 rounded-full transition-colors shrink-0 cursor-pointer"
                style={{ background: on ? "#c4956a" : "#d4d4d4" }}
                role="switch"
                aria-checked={on}
              >
                <span
                  className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
                  style={{ transform: on ? "translateX(22px)" : "translateX(4px)" }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
