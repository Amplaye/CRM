"use client";

import Link from "next/link";
import { Lock, Calculator, PieChart, Package, FileText } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// Shown in place of a gestionale page (Food Cost / P&L / Inventory) when the
// smart_inventory paid add-on isn't active. The page stays VISIBLE: we render a
// blurred, non-interactive mock of the section behind a centred "coming soon"
// lock card, so the section is clearly there but not yet usable — instead of a
// click that silently bounces to Settings. The real enforcement is the
// server-side guard on the management API routes.
//
// `section` tailors the centred card (icon + title) to the page it gates.

type Section = "food_cost" | "pl" | "inventory" | "management";

const SECTION_ICON: Record<Section, typeof Calculator> = {
  food_cost: Calculator,
  pl: PieChart,
  inventory: Package,
  management: FileText,
};

const SECTION_TITLE_KEY: Record<Section, keyof Dictionary> = {
  food_cost: "nav_food_cost" as keyof Dictionary,
  pl: "nav_pl" as keyof Dictionary,
  inventory: "nav_inventory" as keyof Dictionary,
  management: "management_locked_title" as keyof Dictionary,
};

// A purely decorative skeleton of a dashboard — bars, KPI tiles, rows — that
// sits blurred behind the lock card so the section reads as "real content here,
// just not unlocked yet". No data, no interactivity.
function BlurredBackdrop() {
  return (
    <div className="absolute inset-0 p-4 sm:p-6 lg:p-8 overflow-hidden select-none pointer-events-none" aria-hidden="true">
      <div className="h-7 w-48 rounded-md bg-[#c4956a]/25 mb-6" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border-2 p-4 bg-white/60" style={{ borderColor: "#c4956a" }}>
            <div className="h-3 w-20 rounded bg-[#c4956a]/20 mb-3" />
            <div className="h-6 w-16 rounded bg-[#c4956a]/30" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border-2 p-4 bg-white/60 mb-6" style={{ borderColor: "#c4956a" }}>
        <div className="flex items-end gap-2 h-32">
          {[60, 85, 45, 95, 70, 50, 80, 40, 65, 90].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-[#c4956a]/30" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border-2 p-3 bg-white/60" style={{ borderColor: "#c4956a" }}>
            <div className="h-4 flex-1 rounded bg-[#c4956a]/20" />
            <div className="h-4 w-16 rounded bg-[#c4956a]/25" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManagementLocked({ section = "management" }: { section?: Section }) {
  const { t } = useLanguage();
  const Icon = SECTION_ICON[section];
  const title = (t(SECTION_TITLE_KEY[section]) as string) || "Gestionale";

  return (
    <div className="relative w-full min-h-[calc(100dvh-4rem)]">
      {/* Blurred section preview */}
      <div className="absolute inset-0 blur-[6px] opacity-60">
        <BlurredBackdrop />
      </div>

      {/* Centred lock card */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100dvh-4rem)] p-4">
        <div
          className="w-full max-w-sm rounded-2xl border-2 bg-white/85 backdrop-blur-sm p-6 sm:p-8 text-center shadow-xl"
          style={{ borderColor: "#c4956a", boxShadow: "0 20px 60px rgba(196,149,106,0.25)" }}
        >
          <div className="mx-auto w-16 h-16 rounded-full bg-[#c4956a]/15 flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-[#8b6540]" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide text-white mb-3" style={{ background: "#c4956a" }}>
            {(t("settings_payments_coming_soon" as keyof Dictionary) as string) || "Prossimamente"}
          </span>

          <h1 className="text-xl sm:text-2xl font-bold text-black flex items-center justify-center gap-2">
            <Icon className="w-5 h-5 text-[#8b6540]" /> {title}
          </h1>
          <p className="mt-2 text-sm text-black">
            {(t("management_locked_body" as keyof Dictionary) as string) ||
              "Questa sezione sarà presto disponibile. Tieni sotto controllo food cost, margini, magazzino e fatture direttamente qui."}
          </p>

          <Link
            href="/settings?tab=payments"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#c4956a] text-white font-bold hover:bg-[#b3855c] transition-colors"
          >
            {(t("management_locked_cta" as keyof Dictionary) as string) || "Scopri di più"}
          </Link>
        </div>
      </div>
    </div>
  );
}
