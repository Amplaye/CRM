"use client";

import { Save, ChevronDown, Phone, CalendarClock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import type { CancellationNotice } from "@/lib/onboarding/kb-generator";

// Settings → Bookings. Lets an owner change, after onboarding, the contact
// details and booking rules they set in the wizard. The heavy lifting (writing
// the structured settings + regenerating the reservation KB article so the bot
// QUOTES the same policy it ENFORCES) happens server-side in /api/settings/booking.

const CANCELLATION_OPTIONS: CancellationNotice[] = ["none", "same_day", "2h", "24h"];
const CANCELLATION_KEY: Record<CancellationNotice, string> = {
  none: "settings_cancel_none",
  same_day: "settings_cancel_same_day",
  "2h": "settings_cancel_2h",
  "24h": "settings_cancel_24h",
};
const LATE_OPTIONS = [10, 15, 20, 30];
// -1 = shift not served; 0 = up to closing; >0 = minutes before closing.
const OFFSET_OPTIONS = [-1, 0, 15, 30, 45, 60, 90];

const INPUT = "block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a] sm:w-56";
const INPUT_BORDER = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
const SELECT_CLS = "appearance-none w-full bg-white border rounded-lg pl-3 pr-9 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40 focus:border-[#c4956a]";
const SECTION = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" } as const;

// Hoisted to module scope so they keep a stable identity across renders — a
// component defined inside BookingTab would remount on every keystroke and the
// inputs would lose focus mid-typing.
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} role="switch" aria-checked={on}
      className="relative inline-flex items-center h-7 w-12 rounded-full transition-colors shrink-0 cursor-pointer"
      style={{ background: on ? "#c4956a" : "#d4d4d4" }}>
      <span className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? "translateX(22px)" : "translateX(4px)" }} />
    </button>
  );
}

function FieldSelect({ id, value, onChange, children }: { id?: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <div className="relative w-full sm:w-56">
      <select id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLS} style={{ borderColor: "#c4956a" }}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 inset-y-0 my-auto w-4 h-4 text-[#8b6540]" aria-hidden />
    </div>
  );
}

function Row({ htmlFor, label, hint, children }: { htmlFor?: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b last:border-b-0" style={{ borderColor: "rgba(196,149,106,0.25)" }}>
      <div className="flex-1">
        <label htmlFor={htmlFor} className="text-sm font-bold text-black">{label}</label>
        {hint && <p className="text-xs text-black mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0 w-full sm:w-auto">{children}</div>
    </div>
  );
}

export function BookingTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();

  const [ownerPhone, setOwnerPhone] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [cancellation, setCancellation] = useState<CancellationNotice>("none");
  const [lateTol, setLateTol] = useState(15);
  const [lateGrace, setLateGrace] = useState(true);
  const [lunchOff, setLunchOff] = useState(45);
  const [dinnerOff, setDinnerOff] = useState(60);
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  // Re-read from DB on mount (TenantContext caches settings in sessionStorage).
  useEffect(() => {
    refreshActiveTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant) return;
    const s = (tenant.settings as any) || {};
    setOwnerPhone(s.owner_phone || "");
    setRestaurantPhone(s.restaurant_phone || "");
    setReviewUrl(s.review_url || "");
    const venue = s.venue || {};
    setCancellation(CANCELLATION_OPTIONS.includes(venue.cancellation_notice) ? venue.cancellation_notice : "none");
    setDepositRequired(!!venue.deposit_required);
    setDepositAmount(venue.deposit_amount || "");
    const off = s.last_reservation_offset || {};
    setLunchOff(Number.isFinite(off.lunch) ? off.lunch : 45);
    setDinnerOff(Number.isFinite(off.dinner) ? off.dinner : 60);
    const bc = s.bot_config || {};
    setLateTol(Number.isFinite(bc.late_tolerance_min) ? bc.late_tolerance_min : 15);
    setLateGrace(bc.late_grace_if_notified !== false);
  }, [tenant]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setSaved(false);
    setError(false);
    try {
      const res = await fetch("/api/settings/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          owner_phone: ownerPhone,
          restaurant_phone: restaurantPhone,
          review_url: reviewUrl,
          cancellation_notice: cancellation,
          late_tolerance_min: lateTol,
          late_grace_if_notified: lateGrace,
          last_lunch_offset_min: lunchOff,
          last_dinner_offset_min: dinnerOff,
          deposit_required: depositRequired,
          deposit_amount: depositAmount,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The contacts are read live from the DB by the workflows — nothing to
      // re-sync, the save alone propagates them.
      // Push the regenerated KB into the voice assistant (best-effort, like General).
      try {
        await fetch("/api/sync-kb-vapi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenant.id }),
        });
      } catch { /* non-blocking */ }
      await refreshActiveTenant();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error("Save booking settings failed:", e);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const offsetLabel = (n: number) =>
    n === -1 ? t("settings_offset_noservice") : n === 0 ? t("settings_offset_atclose") : `${n} ${t("settings_offset_minbefore")}`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-black">{t("settings_booking_title")}</h2>
          <p className="mt-1 text-sm text-black">{t("settings_booking_desc")}</p>
        </div>
        <div className="mt-3 sm:mt-0 flex items-center space-x-3">
          {saved && <span className="text-sm font-medium text-green-600">{t("settings_saved")}</span>}
          {error && <span className="text-sm font-medium text-red-600">{t("settings_save_error")}</span>}
          <button onClick={handleSave} disabled={saving}
            className="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}>
            <Save className="-ml-1 mr-2 h-5 w-5" />
            {saving ? "Saving..." : t("settings_save")}
          </button>
        </div>
      </div>

      {/* Contacts */}
      <section className="p-6 rounded-xl border-2" style={SECTION}>
        <h3 className="text-lg font-bold text-black mb-1 flex items-center gap-2"><Phone className="w-4 h-4" />{t("settings_booking_contacts")}</h3>
        <p className="text-xs text-black mb-3">{t("settings_booking_contacts_desc")}</p>
        <Row htmlFor="owner_phone" label={t("settings_booking_owner_phone")} hint={t("settings_booking_owner_phone_hint")}>
          <input id="owner_phone" name="owner_phone" type="tel" autoComplete="tel" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+34 600 000 000" className={INPUT} style={INPUT_BORDER} />
        </Row>
        <Row htmlFor="restaurant_phone" label={t("settings_booking_public_phone")} hint={t("settings_booking_public_phone_hint")}>
          <input id="restaurant_phone" name="restaurant_phone" type="tel" autoComplete="tel" value={restaurantPhone} onChange={(e) => setRestaurantPhone(e.target.value)} placeholder="+34 828 000 000" className={INPUT} style={INPUT_BORDER} />
        </Row>
        <Row htmlFor="review_url" label={t("settings_booking_review_url")} hint={t("settings_booking_review_url_hint")}>
          <input id="review_url" name="review_url" type="url" autoComplete="url" value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/..." className={INPUT} style={INPUT_BORDER} />
        </Row>
      </section>

      {/* Booking rules */}
      <section className="p-6 rounded-xl border-2" style={SECTION}>
        <h3 className="text-lg font-bold text-black mb-1 flex items-center gap-2"><CalendarClock className="w-4 h-4" />{t("settings_booking_rules")}</h3>
        <p className="text-xs text-black mb-3">{t("settings_booking_rules_desc")}</p>

        <Row htmlFor="cancellation_notice" label={t("settings_booking_cancellation")} hint={t("settings_booking_cancellation_hint")}>
          <FieldSelect id="cancellation_notice" value={cancellation} onChange={(v) => setCancellation(v as CancellationNotice)}>
            {CANCELLATION_OPTIONS.map((c) => <option key={c} value={c}>{t(CANCELLATION_KEY[c] as any)}</option>)}
          </FieldSelect>
        </Row>

        <Row htmlFor="late_tolerance" label={t("settings_booking_late")} hint={t("settings_booking_late_hint")}>
          <FieldSelect id="late_tolerance" value={String(lateTol)} onChange={(v) => setLateTol(Number(v))}>
            {LATE_OPTIONS.map((n) => <option key={n} value={String(n)}>{n} min</option>)}
          </FieldSelect>
        </Row>
        <Row label={t("settings_booking_late_grace")} hint={t("settings_booking_late_grace_hint")}>
          <Toggle on={lateGrace} onClick={() => setLateGrace((v) => !v)} />
        </Row>

        <Row htmlFor="last_lunch_offset" label={t("settings_booking_last_lunch")} hint={t("settings_booking_last_hint")}>
          <FieldSelect id="last_lunch_offset" value={String(lunchOff)} onChange={(v) => setLunchOff(Number(v))}>
            {OFFSET_OPTIONS.map((n) => <option key={n} value={String(n)}>{offsetLabel(n)}</option>)}
          </FieldSelect>
        </Row>
        <Row htmlFor="last_dinner_offset" label={t("settings_booking_last_dinner")} hint={t("settings_booking_last_hint")}>
          <FieldSelect id="last_dinner_offset" value={String(dinnerOff)} onChange={(v) => setDinnerOff(Number(v))}>
            {OFFSET_OPTIONS.map((n) => <option key={n} value={String(n)}>{offsetLabel(n)}</option>)}
          </FieldSelect>
        </Row>

        <Row label={t("settings_booking_deposit_required")} hint={t("settings_booking_deposit_hint")}>
          <Toggle on={depositRequired} onClick={() => setDepositRequired((v) => !v)} />
        </Row>
        {depositRequired && (
          <Row htmlFor="deposit_amount" label={t("settings_booking_deposit_amount")}>
            <input id="deposit_amount" name="deposit_amount" type="text" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
              placeholder={t("settings_booking_deposit_amount_ph")} className={INPUT} style={INPUT_BORDER} />
          </Row>
        )}
      </section>
    </div>
  );
}
