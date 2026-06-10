"use client";

import Link from "next/link";
import { Lock, Calculator, PieChart, Package, FileText, Check } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// Shown in place of a gestionale page (Food Cost / P&L / Inventory) when the
// smart_inventory paid add-on isn't active for the tenant. It's a SELLING screen,
// not an error: it explains what the module does and links to Settings → Payments.
// Locking the page here is the visible half; the real enforcement is the
// server-side guard on the management API routes.
//
// NOTE: smart_inventory is still `comingSoon` in the catalog (module in
// development), so this screen does NOT promise self-serve checkout — the CTA
// points to Payments where the add-on shows "coming soon". Until launch the only
// way in is the admin manual override (management_enabled). When the add-on goes
// live, switch the CTA copy to a concrete "unlock at €199/mo".

export function ManagementLocked() {
  const { t } = useLanguage();

  const perks: Array<{ icon: typeof Calculator; label: string }> = [
    { icon: Calculator, label: t("nav_food_cost" as keyof Dictionary) || "Food cost" },
    { icon: PieChart, label: t("nav_pl" as keyof Dictionary) || "Conto economico" },
    { icon: Package, label: t("nav_inventory" as keyof Dictionary) || "Magazzino" },
    { icon: FileText, label: t("management_locked_invoices" as keyof Dictionary) || "Fatture fornitori" },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="max-w-2xl mx-auto mt-6 rounded-2xl border-2 bg-white/70 p-6 sm:p-8 text-center" style={{ borderColor: "#c4956a" }}>
        <div className="mx-auto w-14 h-14 rounded-full bg-[#c4956a]/15 flex items-center justify-center mb-4">
          <Lock className="w-7 h-7 text-[#8b6540]" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-black">
          {t("management_locked_title" as keyof Dictionary) || "Gestionale — funzione premium"}
        </h1>
        <p className="mt-2 text-sm text-black max-w-md mx-auto">
          {t("management_locked_body" as keyof Dictionary) ||
            "Collega la cassa e tieni sotto controllo food cost, margini, conto economico, magazzino e fatture. Modulo in arrivo: contattaci per attivarlo sul tuo ristorante."}
        </p>

        <div className="grid grid-cols-2 gap-2 my-6 text-left max-w-sm mx-auto">
          {perks.map((p) => (
            <div key={p.label} className="flex items-center gap-2 text-sm text-black">
              <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="flex items-center gap-1.5"><p.icon className="w-3.5 h-3.5 text-[#8b6540]" /> {p.label}</span>
            </div>
          ))}
        </div>

        <Link
          href="/settings?upgrade=management"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#c4956a] text-white font-bold hover:bg-[#b3855c] transition-colors"
        >
          {t("management_locked_cta" as keyof Dictionary) || "Scopri il modulo gestionale"}
        </Link>
      </div>
    </div>
  );
}
