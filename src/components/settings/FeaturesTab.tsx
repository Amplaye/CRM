"use client";

import { Save, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { TenantFeatures, FEATURE_FLAGS, getFeatures } from "@/lib/types/tenant-settings";
import { largeToBlock } from "@/lib/onboarding/kb-generator";

// Owner-facing presets for the auto-confirm limit (the MAX party size that still
// auto-confirms). "Other" reveals a free number input.
const AUTO_CONFIRM_PRESETS = [2, 4, 6, 8, 10, 12];
// Default MAX shown when a tenant has no bot_config yet: the bot falls back to a
// large-threshold of 7, i.e. auto-confirm up to 6.
const DEFAULT_AUTO_CONFIRM_MAX = 6;

// Settings → Features. Each restaurant capability is a single on/off toggle that
// flips a flag in tenants.settings.features. No rules, no builders (see
// feedback_no_power_user_features): the owner just answers yes/no about their venue.
export function FeaturesTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  const [features, setFeatures] = useState<TenantFeatures>(getFeatures(null));
  // Owner-facing MAX party size that auto-confirms (= bot's large threshold − 1).
  const [autoConfirmMax, setAutoConfirmMax] = useState<number>(DEFAULT_AUTO_CONFIRM_MAX);
  const [customMax, setCustomMax] = useState(false);
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
    // Display the MAX (threshold − 1). No bot_config yet → bot uses 7 → show 6.
    const large = Number(tenant.settings?.bot_config?.party_size_threshold_large);
    const max = Number.isFinite(large) && large > 0 ? large - 1 : DEFAULT_AUTO_CONFIRM_MAX;
    setAutoConfirmMax(max);
    setCustomMax(!AUTO_CONFIRM_PRESETS.includes(max));
  }, [tenant]);

  const toggle = (key: keyof TenantFeatures) =>
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setSaved(false);

    // Translate the owner's MAX back to the bot's "first size that needs review"
    // threshold (max + 1), merged into the existing bot_config (never clobber
    // other keys like closing_time_offset_min). Bump the hard-block ceiling only
    // if it would otherwise sit below the new large threshold; otherwise keep the
    // owner's existing headroom. acceptsLarge mirrors the "events/large groups"
    // feature so a venue that takes big parties keeps room above the limit.
    const prevBotCfg = tenant.settings?.bot_config || {};
    const largeThreshold = Math.max(1, (autoConfirmMax || 0) + 1);
    const acceptsLarge = features.events_enabled !== false;
    const prevBlock = Number(prevBotCfg.party_size_block_threshold);
    const blockThreshold =
      Number.isFinite(prevBlock) && prevBlock > largeThreshold
        ? prevBlock
        : largeToBlock(largeThreshold, acceptsLarge);

    // Merge into the existing settings object — never clobber other fields.
    const newSettings = {
      ...(tenant.settings || {}),
      features,
      bot_config: {
        ...prevBotCfg,
        party_size_threshold_large: largeThreshold,
        party_size_block_threshold: blockThreshold,
      },
    };
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

      {/* Auto-confirm limit — the MAX party size the AI confirms instantly.
          Bigger groups become "requests" the staff approves (Pending). */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border-2"
        style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
      >
        <div className="flex-1">
          <label className="text-sm font-bold text-black">{t("settings_autoconfirm_label")}</label>
          <p className="text-xs text-black/70 mt-0.5">{t("settings_autoconfirm_hint")}</p>
        </div>
        <div className="shrink-0">
          <div className="relative w-36">
            <select
              value={customMax ? "__other__" : String(autoConfirmMax)}
              onChange={(e) => {
                if (e.target.value === "__other__") {
                  setCustomMax(true);
                  if (AUTO_CONFIRM_PRESETS.includes(autoConfirmMax)) {
                    setAutoConfirmMax(Math.max(...AUTO_CONFIRM_PRESETS) + 1);
                  }
                } else {
                  setCustomMax(false);
                  setAutoConfirmMax(Number(e.target.value));
                }
              }}
              className="appearance-none w-full bg-white border rounded-lg pl-3 pr-9 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]"
              style={{ borderColor: "#c4956a" }}
            >
              {AUTO_CONFIRM_PRESETS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} {t("settings_autoconfirm_unit")}
                </option>
              ))}
              <option value="__other__">{t("settings_autoconfirm_other")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 inset-y-0 my-auto w-4 h-4 text-[#8b6540]" aria-hidden />
          </div>
          {customMax && (
            <div className="mt-2 flex items-center gap-2 justify-end">
              <input
                type="number"
                min={1}
                value={autoConfirmMax || ""}
                onChange={(e) => setAutoConfirmMax(Math.max(0, Number(e.target.value)))}
                className="w-20 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]"
                style={{ borderColor: "#c4956a" }}
              />
              <span className="text-sm text-black">{t("settings_autoconfirm_unit")}</span>
            </div>
          )}
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
