"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { TenantFeatures, FEATURE_FLAGS, getRawFeatures } from "@/lib/types/tenant-settings";
import { getLoyaltyConfig } from "@/lib/loyalty/loyalty";
import { getSelfOrderConfig, FOOD_COOLDOWN_MIN } from "@/lib/self-order/config";

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
  // Per-toggle feedback: the owner asked to see "Saved!" right next to the switch
  // they just flipped (not only in the header), so a flip visibly "took". We track
  // which key is mid-save / just-saved; the row reads it to render its own badge.
  const [rowStatus, setRowStatus] = useState<{ key: keyof TenantFeatures; state: "saving" | "saved" | "error" } | null>(null);

  // Latest intended flags — lets rapid consecutive toggles accumulate without a
  // stale closure, and every persist write sends the complete object.
  const featuresRef = useRef(features);
  // Sync local state from the tenant only on first load (per tenant id). The
  // refreshActiveTenant() we fire after each save changes the tenant object
  // identity; without this guard that would clobber an in-flight optimistic flip.
  const initedFor = useRef<string | null>(null);
  const rowSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => () => {
    if (rowSavedTimer.current) clearTimeout(rowSavedTimer.current);
  }, []);

  // Persist the given flags immediately. Writes ONLY settings.features — booking
  // thresholds (auto-confirm) are owned by Settings → Bookings now.
  const persist = async (next: TenantFeatures, prev: TenantFeatures, key: keyof TenantFeatures) => {
    if (!tenant) return;
    setRowStatus({ key, state: "saving" });
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
      setRowStatus({ key, state: "error" });
      return;
    }

    setRowStatus({ key, state: "saved" });
    if (rowSavedTimer.current) clearTimeout(rowSavedTimer.current);
    rowSavedTimer.current = setTimeout(() => setRowStatus(null), 2000);
    // Propagate to the rest of the app (sidebar waitlist, floor zones, …) without
    // a reload. The init guard above keeps this from resetting our local state.
    await refreshActiveTenant();
  };

  const toggle = (key: keyof TenantFeatures) => {
    const prev = featuresRef.current;
    const next = { ...prev, [key]: !prev[key] };
    featuresRef.current = next;
    setFeatures(next);
    void persist(next, prev, key);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black">{t("settings_features_title")}</h2>
        <p className="mt-1 text-sm text-black">{t("settings_features_desc")}</p>
      </div>

      <div className="space-y-3">
        {FEATURE_FLAGS.map(({ key, labelKey, hintKey }) => {
          const on = features[key];
          return (
            <div key={key}
              className="flex items-center justify-between gap-4 p-3 rounded-lg border-2"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
              <div className="flex-1 min-w-0">
                <label className="text-sm font-bold text-black">{t(labelKey as keyof Dictionary)}</label>
                <p className="text-xs text-black mt-0.5">{t(hintKey as keyof Dictionary)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Per-row save feedback, so the owner sees THIS toggle took effect. */}
                <span className="h-5 flex items-center justify-end" aria-live="polite">
                  {rowStatus?.key === key && rowStatus.state === "saving" && (
                    <span className="text-xs font-medium text-black">…</span>
                  )}
                  {rowStatus?.key === key && rowStatus.state === "saved" && (
                    <span className="text-xs font-semibold text-green-600">{t("settings_saved")}</span>
                  )}
                  {rowStatus?.key === key && rowStatus.state === "error" && (
                    <span className="text-xs font-semibold text-red-600">{t("settings_save_error")}</span>
                  )}
                </span>
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
            </div>
          );
        })}
      </div>

      {/* Loyalty programme numbers — shown only while the module is ON. Same
          instant-save spirit: each field persists on blur. */}
      {features.loyalty_enabled && <LoyaltyConfigCard />}

      {/* Self-order: mark which menu categories are drinks. Shown only while the
          module is ON. There is NO cooldown-minutes field on purpose — the food
          delay is automatic; the owner only tells us what a "drink" is. */}
      {features.self_order_enabled && <SelfOrderConfigCard />}

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

// Points-per-visit, reward threshold and reward name for the loyalty module.
// Persists settings.loyalty on blur (spreading the full settings object —
// multi-tenant invariant: never drop other keys).
function LoyaltyConfigCard() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();
  const cfg = getLoyaltyConfig(tenant?.settings);
  const [ppv, setPpv] = useState(String(cfg.points_per_visit));
  const [rewardPts, setRewardPts] = useState(String(cfg.reward_points));
  const [rewardLabel, setRewardLabel] = useState(cfg.reward_label);
  const [status, setStatus] = useState<"saving" | "saved" | "error" | null>(null);

  const persist = async () => {
    if (!tenant) return;
    const next = {
      points_per_visit: Math.max(1, Math.round(Number(ppv) || cfg.points_per_visit)),
      reward_points: Math.max(1, Math.round(Number(rewardPts) || cfg.reward_points)),
      reward_label: rewardLabel.trim(),
    };
    setStatus("saving");
    const { error } = await supabase
      .from("tenants")
      .update({ settings: { ...(tenant.settings || {}), loyalty: next } })
      .eq("id", tenant.id);
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    setTimeout(() => setStatus(null), 2000);
    await refreshActiveTenant();
  };

  const inputCls = "w-full rounded-lg border-2 bg-white px-3 py-2 text-sm text-black focus:outline-none";
  const inputStyle = { borderColor: "#c4956a" } as const;

  return (
    <div className="p-3 rounded-lg border-2 space-y-3" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-black">{t("loyalty_config_title")}</p>
        <span className="text-xs" aria-live="polite">
          {status === "saving" && <span className="text-black">…</span>}
          {status === "saved" && <span className="font-semibold text-green-600">{t("settings_saved")}</span>}
          {status === "error" && <span className="font-semibold text-red-600">{t("settings_save_error")}</span>}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-bold text-black mb-1">{t("loyalty_config_ppv")}</label>
          <input inputMode="numeric" value={ppv} onChange={(e) => setPpv(e.target.value)} onBlur={persist} className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-bold text-black mb-1">{t("loyalty_config_reward_points")}</label>
          <input inputMode="numeric" value={rewardPts} onChange={(e) => setRewardPts(e.target.value)} onBlur={persist} className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-bold text-black mb-1">{t("loyalty_config_reward_label")}</label>
          <input value={rewardLabel} onChange={(e) => setRewardLabel(e.target.value)} onBlur={persist} placeholder={t("loyalty_config_reward_ph")} className={inputCls} style={inputStyle} />
        </div>
      </div>
      <p className="text-xs text-black">{t("loyalty_config_hint")}</p>
    </div>
  );
}

// Self-order drinks picker. The QR flow lets guests order DRINKS the instant they
// scan but keeps FOOD locked for the first few minutes (per table), so a rush of
// arrivals doesn't hit the kitchen all at once. The delay is automatic; the only
// thing the owner sets is WHICH menu categories are drinks — the system can't
// guess (menu items carry no station on these venues). Toggling a category saves
// instantly (optimistic, rolls back on error), same spirit as the toggles above.
function SelfOrderConfigCard() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(getSelfOrderConfig(tenant?.settings).drink_category_ids);
  const [status, setStatus] = useState<"saving" | "saved" | "error" | null>(null);
  const selectedRef = useRef(selected);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the tenant's categories once (RLS scopes this to the active tenant).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tenant) return;
      const { data } = await supabase
        .from("menu_categories")
        .select("id, name")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (!alive) return;
      setCategories((data as { id: string; name: string }[]) || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const persist = async (nextIds: string[], prevIds: string[]) => {
    if (!tenant) return;
    setStatus("saving");
    // Spread the whole settings object — multi-tenant invariant: never drop other keys.
    const nextSettings = {
      ...(tenant.settings || {}),
      self_order: { ...(tenant.settings?.self_order || {}), drink_category_ids: nextIds },
    };
    const { error } = await supabase.from("tenants").update({ settings: nextSettings }).eq("id", tenant.id);
    if (error) {
      selectedRef.current = prevIds;
      setSelected(prevIds);
      setStatus("error");
      return;
    }
    setStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setStatus(null), 2000);
    await refreshActiveTenant();
  };

  const toggle = (id: string) => {
    const prev = selectedRef.current;
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    selectedRef.current = next;
    setSelected(next);
    void persist(next, prev);
  };

  return (
    <div className="p-3 rounded-lg border-2 space-y-3" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-black">{t("self_order_config_title")}</p>
        <span className="text-xs" aria-live="polite">
          {status === "saving" && <span className="text-black">…</span>}
          {status === "saved" && <span className="font-semibold text-green-600">{t("settings_saved")}</span>}
          {status === "error" && <span className="font-semibold text-red-600">{t("settings_save_error")}</span>}
        </span>
      </div>
      <p className="text-xs text-black">
        {t("self_order_config_desc").replace("{min}", String(FOOD_COOLDOWN_MIN))}
      </p>

      {loading ? (
        <p className="text-xs text-black">…</p>
      ) : categories.length === 0 ? (
        // No categories yet → nothing to mark. Point them to the menu editor.
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white/70 border" style={{ borderColor: "#e7d3ba" }}>
          <span className="text-xs text-black">{t("self_order_config_no_categories")}</span>
          <Link href="/menu" className="inline-flex items-center gap-1 text-xs font-bold whitespace-nowrap" style={{ color: "#c4956a" }}>
            {t("self_order_config_open_menu")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-black">{t("self_order_config_pick")}</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  role="switch"
                  aria-checked={on}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border-2 cursor-pointer transition-colors"
                  style={on ? { background: "#c4956a", borderColor: "#c4956a", color: "#fff" } : { background: "#fff", borderColor: "#c4956a", color: "#000" }}
                >
                  <span aria-hidden>{on ? "✓" : "+"}</span>
                  {c.name}
                </button>
              );
            })}
          </div>
          {selected.length === 0 && (
            // With nothing flagged the cooldown has no "drinks" to let through, so
            // it would lock the WHOLE menu on arrival — almost never what they want.
            <p className="text-xs font-medium" style={{ color: "#b45309" }}>{t("self_order_config_warn_empty")}</p>
          )}
        </>
      )}
    </div>
  );
}
