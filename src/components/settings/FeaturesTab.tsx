"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { TenantFeatures, FEATURE_FLAGS, getRawFeatures } from "@/lib/types/tenant-settings";

// Settings → Features. Each restaurant capability is a single on/off toggle that
// flips a flag in tenants.settings.features. Flipping a switch SAVES INSTANTLY —
// there is no Save button: the toggle is the action (optimistic UI, rolls back on
// error). No rules, no builders (see feedback_no_power_user_features): the owner
// just answers yes/no about their venue. The auto-confirm limit and the other
// booking rules live in Settings → Bookings.
export function FeaturesTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  // RAW flags, not billing-derived: this tab edits only the free self-serve
  // toggles and persists the whole features object. Reading the DERIVED
  // management_enabled here would let an unrelated toggle write the paid value
  // back into the raw override (silently making it permanent). management_enabled
  // is not even rendered (absent from FEATURE_FLAGS); we just must not clobber it.
  const [features, setFeatures] = useState<TenantFeatures>(getRawFeatures(null));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Latest intended flags — lets rapid consecutive toggles accumulate without a
  // stale closure, and every persist write sends the complete object.
  const featuresRef = useRef(features);
  // Sync local state from the tenant only on first load (per tenant id). The
  // refreshActiveTenant() we fire after each save changes the tenant object
  // identity; without this guard that would clobber an in-flight optimistic flip.
  const initedFor = useRef<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-read from DB on mount: TenantContext caches settings in sessionStorage, so
  // without this the form could show stale flags after an external write.
  useEffect(() => {
    refreshActiveTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant) return;
    if (initedFor.current === tenant.id) return;
    initedFor.current = tenant.id;
    const f = getRawFeatures(tenant.settings);
    featuresRef.current = f;
    setFeatures(f);
  }, [tenant]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Persist the given flags immediately. Writes ONLY settings.features — booking
  // thresholds (auto-confirm) are owned by Settings → Bookings now.
  const persist = async (next: TenantFeatures, prev: TenantFeatures) => {
    if (!tenant) return;
    setStatus("saving");
    const newSettings = { ...(tenant.settings || {}), features: next };
    const { error } = await supabase
      .from("tenants")
      .update({ settings: newSettings })
      .eq("id", tenant.id);

    if (error) {
      console.error("Save feature failed:", error);
      // Roll back the optimistic flip so the UI never lies about what's saved.
      featuresRef.current = prev;
      setFeatures(prev);
      setStatus("error");
      return;
    }

    setStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setStatus("idle"), 2000);
    // Propagate to the rest of the app (sidebar waitlist, floor zones, …) without
    // a reload. The init guard above keeps this from resetting our local state.
    await refreshActiveTenant();
  };

  const toggle = (key: keyof TenantFeatures) => {
    const prev = featuresRef.current;
    const next = { ...prev, [key]: !prev[key] };
    featuresRef.current = next;
    setFeatures(next);
    void persist(next, prev);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-black">{t("settings_features_title")}</h2>
          <p className="mt-1 text-sm text-black">{t("settings_features_desc")}</p>
        </div>
        {/* Inline status — the toggle saves on its own, so no button, just feedback. */}
        <div className="mt-3 sm:mt-0 h-5 flex items-center" aria-live="polite">
          {status === "saving" && <span className="text-sm font-medium text-black">…</span>}
          {status === "saved" && <span className="text-sm font-medium text-green-600">{t("settings_saved")}</span>}
          {status === "error" && <span className="text-sm font-medium text-red-600">{t("settings_save_error")}</span>}
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
                <p className="text-xs text-black mt-0.5">{t(hintKey as keyof Dictionary)}</p>
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

      {/* Guided follow-up: the moment the owner turns the commercial module ON, point
          them to where they actually add their price lists (no KB jargon, no guesswork). */}
      {features.commercial_info_enabled && (
        <Link
          href="/settings?tab=commercial"
          className="flex items-center justify-between gap-3 p-3 rounded-lg border-2 transition-colors hover:bg-[#fcf6ed]"
          style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
        >
          <span className="text-sm font-medium text-black">{t("settings_feature_commercial_info_cta")}</span>
          <span className="inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap" style={{ color: "#c4956a" }}>
            {t("settings_feature_commercial_info_cta_btn")}
            <ArrowRight className="w-4 h-4" />
          </span>
        </Link>
      )}
    </div>
  );
}
