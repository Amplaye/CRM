"use client";

import { Suspense, useState, useEffect } from "react";
import { Settings as SettingsIcon, Users, ToggleRight, CalendarClock, LineChart, Plug, CreditCard, Tags } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { StaffTab } from "@/components/settings/StaffTab";
import { FeaturesTab } from "@/components/settings/FeaturesTab";
import { BookingTab } from "@/components/settings/BookingTab";
import { ManagementTab } from "@/components/settings/ManagementTab";
import { PosTab } from "@/components/settings/PosTab";
import { PaymentsTab } from "@/components/settings/PaymentsTab";
import { CommercialInfoTab } from "@/components/settings/CommercialInfoTab";
import { getFeatures } from "@/lib/types/tenant-settings";

type Tab = "general" | "booking" | "features" | "commercial" | "management" | "pos" | "payments" | "staff";

function SettingsContent() {
  const { t } = useLanguage();
  const { activeRole, globalRole, activeTenant } = useTenant();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const TABS: Tab[] = ["general", "booking", "staff", "features", "commercial", "management", "pos", "payments"];
  const initial = (searchParams.get("tab") as Tab) || "general";
  const [tab, setTab] = useState<Tab>(TABS.includes(initial) ? initial : "general");

  useEffect(() => {
    const t = searchParams.get("tab") as Tab | null;
    if (t && TABS.includes(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Only the Admin (DB owner — the account creator) can manage staff.
  const canSeeStaffTab = activeRole === "owner";
  // Features = restaurant capabilities; the owner or Bali Flow staff (impersonating) sets them.
  const canSeeFeaturesTab = activeRole === "owner" || globalRole === "platform_admin";
  // Bookings = contact details + booking rules; owner-level, same gate as features.
  const canSeeBookingTab = activeRole === "owner" || globalRole === "platform_admin";
  // Listini & Info = guided editor for the commercial-info module's KB blocks. Same
  // owner/admin gate, and only when the (free) commercial_info_enabled flag is ON —
  // so the tab simply appears the moment they flip the toggle in Features.
  const commercialEnabled = getFeatures(activeTenant?.settings).commercial_info_enabled;
  // Show when enabled — OR when we're already on the tab. The "Configura Listini"
  // CTA flips the flag optimistically in FeaturesTab and navigates here before the
  // TenantContext refresh has propagated the new flag; without the `|| tab` fallback
  // the content would blank out in that race window (the "a volte sì a volte no" bug).
  const canSeeCommercialTab = (activeRole === "owner" || globalRole === "platform_admin") && (commercialEnabled || tab === "commercial");
  // Gestionale = financial targets/budgets; owner/admin only, and only when the
  // management module is enabled for this tenant.
  const managementEnabled = getFeatures(activeTenant?.settings).management_enabled;
  const canSeeManagementTab = (activeRole === "owner" || globalRole === "platform_admin") && managementEnabled;
  // Cassa = POS connection (paste token, test, sync). Same gate as gestionale —
  // it only matters once the management module is on and a till feeds the data.
  const canSeePosTab = (activeRole === "owner" || globalRole === "platform_admin") && managementEnabled;
  // Payments = plan/subscription + add-ons. Billing authority lives with the owner
  // (or Bali Flow staff impersonating); not gated on management, every owner can buy.
  const canSeePaymentsTab = activeRole === "owner" || globalRole === "platform_admin";

  const setActiveTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "general") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="border-b pb-5" style={{ borderColor: "#c4956a" }}>
        <h1 className="text-2xl font-bold text-black">{t("settings_title")}</h1>
        <p className="mt-1 text-sm text-black">{t("settings_subtitle")}</p>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab("general")}
          className={`inline-flex items-center gap-2 pr-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "general" ? "text-black" : "text-black hover:text-black border-transparent"}`}
          style={tab === "general" ? { borderColor: "#c4956a" } : {}}
        >
          <SettingsIcon className="w-4 h-4" />
          {t("settings_tab_general") || "Generale"}
        </button>
        {canSeeBookingTab && (
          <button
            onClick={() => setActiveTab("booking")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "booking" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "booking" ? { borderColor: "#c4956a" } : {}}
          >
            <CalendarClock className="w-4 h-4" />
            {t("settings_tab_booking") || "Prenotazioni"}
          </button>
        )}
        {canSeeStaffTab && (
          <button
            onClick={() => setActiveTab("staff")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "staff" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "staff" ? { borderColor: "#c4956a" } : {}}
          >
            <Users className="w-4 h-4" />
            {t("settings_tab_staff") || "Staff"}
          </button>
        )}
        {canSeeFeaturesTab && (
          <button
            onClick={() => setActiveTab("features")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "features" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "features" ? { borderColor: "#c4956a" } : {}}
          >
            <ToggleRight className="w-4 h-4" />
            {t("settings_tab_features") || "Funzionalità"}
          </button>
        )}
        {canSeeCommercialTab && (
          <button
            onClick={() => setActiveTab("commercial")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "commercial" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "commercial" ? { borderColor: "#c4956a" } : {}}
          >
            <Tags className="w-4 h-4" />
            {t("settings_tab_commercial") || "Listini & Info"}
          </button>
        )}
        {canSeeManagementTab && (
          <button
            onClick={() => setActiveTab("management")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "management" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "management" ? { borderColor: "#c4956a" } : {}}
          >
            <LineChart className="w-4 h-4" />
            {t("settings_tab_management") || "Gestionale"}
          </button>
        )}
        {canSeePosTab && (
          <button
            onClick={() => setActiveTab("pos")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "pos" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "pos" ? { borderColor: "#c4956a" } : {}}
          >
            <Plug className="w-4 h-4" />
            {t("settings_tab_pos") || "Cassa"}
          </button>
        )}
        {canSeePaymentsTab && (
          <button
            onClick={() => setActiveTab("payments")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "payments" ? "text-black" : "text-black hover:text-black border-transparent"}`}
            style={tab === "payments" ? { borderColor: "#c4956a" } : {}}
          >
            <CreditCard className="w-4 h-4" />
            {t("settings_tab_payments") || "Pagamenti"}
          </button>
        )}
      </div>

      {tab === "general" && <GeneralTab />}
      {tab === "booking" && canSeeBookingTab && <BookingTab />}
      {tab === "features" && canSeeFeaturesTab && <FeaturesTab />}
      {tab === "commercial" && canSeeCommercialTab && <CommercialInfoTab />}
      {tab === "management" && canSeeManagementTab && <ManagementTab />}
      {tab === "pos" && canSeePosTab && <PosTab />}
      {tab === "payments" && canSeePaymentsTab && <PaymentsTab />}
      {tab === "staff" && canSeeStaffTab && <StaffTab />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-black">…</div>}>
      <SettingsContent />
    </Suspense>
  );
}
