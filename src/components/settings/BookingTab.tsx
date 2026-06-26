"use client";

import { Save, ChevronDown, Phone, CalendarClock, PowerOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { isE164 } from "@/lib/booking-validation";
import type { CancellationNotice } from "@/lib/onboarding/kb-generator";

// A phone field is OK if empty (optional) or a valid E.164 number. We strip the
// pretty-print separators a user might type (spaces, dashes, parens) before the
// check so "+34 600 000 000" passes but "+34sdfsdf" (letters) does not.
function isPhoneOk(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  return isE164(v.replace(/[\s\-().]/g, ""));
}

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
// Owner-facing presets for the auto-confirm limit (the MAX party size that still
// auto-confirms). "Other" reveals a free number input.
const AUTO_CONFIRM_PRESETS = [2, 4, 6, 8, 10, 12];
// Default MAX shown when a tenant has no bot_config yet: the bot falls back to a
// large-threshold of 7, i.e. auto-confirm up to 6.
const DEFAULT_AUTO_CONFIRM_MAX = 6;

const INPUT = "block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a] sm:w-56";
const INPUT_BORDER = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
const INPUT_BORDER_ERR = { borderColor: "#dc2626", background: "rgba(254,242,242,0.6)" };
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
  // Kill switch for the live test: when on, the WhatsApp engine stops handling
  // requests and replies with botPausedMessage (which redirects to the owner).
  const [botPaused, setBotPaused] = useState(false);
  const [botPausedMessage, setBotPausedMessage] = useState("");
  // Owner-facing MAX party size that auto-confirms (= bot's large threshold − 1).
  const [autoConfirmMax, setAutoConfirmMax] = useState(DEFAULT_AUTO_CONFIRM_MAX);
  const [customMax, setCustomMax] = useState(false);
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
    setBotPaused(!!bc.bot_paused);
    // Prefill the auto-reply with a localized default (owner number appended when
    // we already have it) so the owner only has to paste the number tomorrow.
    const savedPauseMsg = typeof bc.bot_paused_message === "string" ? bc.bot_paused_message : "";
    const defOwner = (s.owner_phone || "").trim();
    setBotPausedMessage(savedPauseMsg || (t("settings_booking_pause_msg_default") + (defOwner ? ` 📞 ${defOwner}` : "")));
    // Display the MAX (threshold − 1). No bot_config yet → bot uses 7 → show 6.
    const large = Number(bc.party_size_threshold_large);
    const max = Number.isFinite(large) && large > 0 ? large - 1 : DEFAULT_AUTO_CONFIRM_MAX;
    setAutoConfirmMax(max);
    setCustomMax(!AUTO_CONFIRM_PRESETS.includes(max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const ownerPhoneOk = isPhoneOk(ownerPhone);
  const restaurantPhoneOk = isPhoneOk(restaurantPhone);

  const handleSave = async () => {
    if (!tenant) return;
    // Block garbage like "+34sdfsdf": a phone must be empty or a real E.164
    // number. We don't want the assistant handing guests a fake number.
    if (!ownerPhoneOk || !restaurantPhoneOk) {
      setError(true);
      return;
    }
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
          auto_confirm_max: autoConfirmMax,
          bot_paused: botPaused,
          bot_paused_message: botPausedMessage,
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

      {/* Pause bot — emergency kill switch for the live test. Sits at the top so
          the owner can flip it the moment the assistant misbehaves. */}
      <section className="p-6 rounded-xl border-2" style={botPaused ? { background: "rgba(254,242,242,0.95)", borderColor: "#dc2626" } : SECTION}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-lg font-bold text-black flex items-center gap-2"><PowerOff className="w-4 h-4" />{t("settings_booking_pause_title")}</h3>
          {botPaused && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: "#dc2626" }}>
              {t("settings_booking_pause_active")}
            </span>
          )}
        </div>
        <p className="text-xs text-black mb-3">{t("settings_booking_pause_desc")}</p>
        <Row label={t("settings_booking_pause_label")} hint={t("settings_booking_pause_hint")}>
          <Toggle on={botPaused} onClick={() => setBotPaused((v) => !v)} />
        </Row>
        <div className="py-3 border-b last:border-b-0" style={{ borderColor: "rgba(196,149,106,0.25)" }}>
          <label htmlFor="bot_paused_message" className="text-sm font-bold text-black">{t("settings_booking_pause_msg_label")}</label>
          <p className="text-xs text-black mt-0.5 mb-2">{t("settings_booking_pause_msg_hint")}</p>
          <textarea id="bot_paused_message" name="bot_paused_message" rows={3}
            value={botPausedMessage} onChange={(e) => setBotPausedMessage(e.target.value)}
            placeholder={t("settings_booking_pause_msg_default")}
            className="block w-full rounded-lg border-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={INPUT_BORDER} />
        </div>
        {botPaused && botPausedMessage.replace(/[^0-9]/g, "").length < 6 && (
          <p className="text-xs font-medium mt-2" style={{ color: "#dc2626" }}>{t("settings_booking_pause_warn")}</p>
        )}
      </section>

      {/* Contacts */}
      <section className="p-6 rounded-xl border-2" style={SECTION}>
        <h3 className="text-lg font-bold text-black mb-1 flex items-center gap-2"><Phone className="w-4 h-4" />{t("settings_booking_contacts")}</h3>
        <p className="text-xs text-black mb-3">{t("settings_booking_contacts_desc")}</p>
        <Row htmlFor="owner_phone" label={t("settings_booking_owner_phone")} hint={t("settings_booking_owner_phone_hint")}>
          <div className="w-full sm:w-56">
            <input id="owner_phone" name="owner_phone" type="tel" inputMode="tel" autoComplete="tel" value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+34 600 000 000"
              aria-invalid={!ownerPhoneOk}
              className={INPUT} style={ownerPhoneOk ? INPUT_BORDER : INPUT_BORDER_ERR} />
            {!ownerPhoneOk && <p className="text-xs font-medium mt-1" style={{ color: "#dc2626" }}>{t("settings_booking_phone_invalid")}</p>}
          </div>
        </Row>
        <Row htmlFor="restaurant_phone" label={t("settings_booking_public_phone")} hint={t("settings_booking_public_phone_hint")}>
          <div className="w-full sm:w-56">
            <input id="restaurant_phone" name="restaurant_phone" type="tel" inputMode="tel" autoComplete="tel" value={restaurantPhone}
              onChange={(e) => setRestaurantPhone(e.target.value)} placeholder="+34 828 000 000"
              aria-invalid={!restaurantPhoneOk}
              className={INPUT} style={restaurantPhoneOk ? INPUT_BORDER : INPUT_BORDER_ERR} />
            {!restaurantPhoneOk && <p className="text-xs font-medium mt-1" style={{ color: "#dc2626" }}>{t("settings_booking_phone_invalid")}</p>}
          </div>
        </Row>
        <Row htmlFor="review_url" label={t("settings_booking_review_url")} hint={t("settings_booking_review_url_hint")}>
          <input id="review_url" name="review_url" type="url" autoComplete="url" value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/..." className={INPUT} style={INPUT_BORDER} />
        </Row>
      </section>

      {/* Booking rules */}
      <section className="p-6 rounded-xl border-2" style={SECTION}>
        <h3 className="text-lg font-bold text-black mb-1 flex items-center gap-2"><CalendarClock className="w-4 h-4" />{t("settings_booking_rules")}</h3>
        <p className="text-xs text-black mb-3">{t("settings_booking_rules_desc")}</p>

        {/* Auto-confirm limit — the MAX party size the AI confirms instantly.
            Bigger groups become "requests" the staff approves (Pending). */}
        <Row htmlFor="auto_confirm" label={t("settings_autoconfirm_label")} hint={t("settings_autoconfirm_hint")}>
          <div>
            <FieldSelect
              id="auto_confirm"
              value={customMax ? "__other__" : String(autoConfirmMax)}
              onChange={(v) => {
                if (v === "__other__") {
                  setCustomMax(true);
                  if (AUTO_CONFIRM_PRESETS.includes(autoConfirmMax)) {
                    setAutoConfirmMax(Math.max(...AUTO_CONFIRM_PRESETS) + 1);
                  }
                } else {
                  setCustomMax(false);
                  setAutoConfirmMax(Number(v));
                }
              }}
            >
              {AUTO_CONFIRM_PRESETS.map((n) => (
                <option key={n} value={String(n)}>{n} {t("settings_autoconfirm_unit")}</option>
              ))}
              <option value="__other__">{t("settings_autoconfirm_other")}</option>
            </FieldSelect>
            {customMax && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="auto_confirm_custom"
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
        </Row>

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
