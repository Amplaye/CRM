"use client";

import { Suspense, useState, useEffect } from "react";
import { Settings as SettingsIcon, Users, ToggleRight, CalendarClock } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { StaffTab } from "@/components/settings/StaffTab";
import { FeaturesTab } from "@/components/settings/FeaturesTab";
import { BookingTab } from "@/components/settings/BookingTab";

type Tab = "general" | "booking" | "features" | "staff";

function SettingsContent() {
  const { t } = useLanguage();
  const { activeRole, globalRole } = useTenant();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const TABS: Tab[] = ["general", "booking", "features", "staff"];
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
          className={`inline-flex items-center gap-2 pr-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "general" ? "text-black" : "text-black/60 hover:text-black border-transparent"}`}
          style={tab === "general" ? { borderColor: "#c4956a" } : {}}
        >
          <SettingsIcon className="w-4 h-4" />
          {t("settings_tab_general") || "Generale"}
        </button>
        {canSeeBookingTab && (
          <button
            onClick={() => setActiveTab("booking")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "booking" ? "text-black" : "text-black/60 hover:text-black border-transparent"}`}
            style={tab === "booking" ? { borderColor: "#c4956a" } : {}}
          >
            <CalendarClock className="w-4 h-4" />
            {t("settings_tab_booking") || "Prenotazioni"}
          </button>
        )}
        {canSeeFeaturesTab && (
          <button
            onClick={() => setActiveTab("features")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "features" ? "text-black" : "text-black/60 hover:text-black border-transparent"}`}
            style={tab === "features" ? { borderColor: "#c4956a" } : {}}
          >
            <ToggleRight className="w-4 h-4" />
            {t("settings_tab_features") || "Funzionalità"}
          </button>
        )}
        {canSeeStaffTab && (
          <button
            onClick={() => setActiveTab("staff")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === "staff" ? "text-black" : "text-black/60 hover:text-black border-transparent"}`}
            style={tab === "staff" ? { borderColor: "#c4956a" } : {}}
          >
            <Users className="w-4 h-4" />
            {t("settings_tab_staff") || "Staff"}
          </button>
        )}
      </div>

      {tab === "general" && <GeneralTab />}
      {tab === "booking" && canSeeBookingTab && <BookingTab />}
      {tab === "features" && canSeeFeaturesTab && <FeaturesTab />}
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
