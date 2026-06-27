"use client";

import { Hammer } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";

// Placeholder shown when a tenant NOT on the WIP allowlist lands on a
// work-in-progress section by direct URL (the sidebar already hides it). It's a
// neutral "coming soon", not an upsell — the section isn't sold yet, it's being
// built. Remove the route's WIP gate (and this render) when the section ships.
export function WipComingSoon() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "rgba(196,149,106,0.12)" }}
      >
        <Hammer className="w-8 h-8" style={{ color: "#c4956a" }} />
      </div>
      <h2 className="text-xl font-bold text-black">
        {t("wip_section_title") || "In lavorazione"}
      </h2>
      <p className="mt-2 max-w-md text-sm text-black">
        {t("wip_section_desc") || "Questa sezione è ancora in fase di sviluppo e sarà disponibile a breve."}
      </p>
    </div>
  );
}
