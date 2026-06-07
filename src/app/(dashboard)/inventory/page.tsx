"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, AlertTriangle, Clock } from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  current_unit_cost: number;
  stock_qty: number;
  par_level: number;
  supplier_name: string | null;
  expiry_date: string | null;
}

const EXPIRY_SOON_DAYS = 5;

export default function InventoryPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const enabled = getFeatures(activeTenant?.settings).management_enabled;

  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("ingredients")
        .select("id, name, unit, current_unit_cost, stock_qty, par_level, supplier_name, expiry_date")
        .eq("tenant_id", activeTenant.id)
        .eq("archived", false)
        .order("name");
      if (cancelled) return;
      setRows((data || []) as IngredientRow[]);
      setLoading(false);
    };
    load();
    // realtime: ingredients is in the publication (live stock after a sync)
    const channel = supabase
      .channel(`inventory-${activeTenant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ingredients", filter: `tenant_id=eq.${activeTenant.id}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeTenant?.id, enabled, supabase]);

  const isLow = (r: IngredientRow) => Number(r.stock_qty) <= Number(r.par_level);
  const daysToExpiry = (r: IngredientRow): number | null => {
    if (!r.expiry_date) return null;
    const ms = new Date(r.expiry_date + "T00:00:00").getTime() - Date.now();
    return Math.floor(ms / 86400000);
  };
  const isExpiringSoon = (r: IngredientRow) => {
    const d = daysToExpiry(r);
    return d != null && d <= EXPIRY_SOON_DAYS;
  };

  const lowCount = rows.filter(isLow).length;
  const expiringCount = rows.filter(isExpiringSoon).length;

  if (!enabled) {
    return <div className="p-8 text-sm text-black">{t("management_disabled" as keyof Dictionary) || "Modulo gestionale non attivo."}</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b pb-5" style={{ borderColor: "#c4956a" }}>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2">
          <Package className="w-6 h-6" /> {t("nav_inventory" as keyof Dictionary) || "Magazzino"}
        </h1>
        <p className="mt-1 text-sm text-black">{t("inventory_subtitle" as keyof Dictionary) || "Giacenze, scorta minima e scadenze."}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title={t("inventory_count" as keyof Dictionary) || "Ingredienti"} value={rows.length} icon={<Package className="w-5 h-5" />} />
        <KPICard title={t("inventory_low" as keyof Dictionary) || "Scorta bassa"} value={lowCount} icon={<AlertTriangle className="w-5 h-5" />} valueClassName={lowCount > 0 ? "text-red-600" : undefined} />
        <KPICard title={t("inventory_expiring" as keyof Dictionary) || "In scadenza"} value={expiringCount} icon={<Clock className="w-5 h-5" />} valueClassName={expiringCount > 0 ? "text-amber-600" : undefined} />
      </div>

      <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "#c4956a" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ background: "rgba(196,149,106,0.15)" }}>
              <th className="px-4 py-2 font-bold text-black">{t("inventory_col_name" as keyof Dictionary) || "Ingrediente"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("inventory_col_stock" as keyof Dictionary) || "Giacenza"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("inventory_col_par" as keyof Dictionary) || "Scorta min."}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("inventory_col_cost" as keyof Dictionary) || "Costo"}</th>
              <th className="px-4 py-2 font-bold text-black">{t("inventory_col_supplier" as keyof Dictionary) || "Fornitore"}</th>
              <th className="px-4 py-2 font-bold text-black">{t("inventory_col_expiry" as keyof Dictionary) || "Scadenza"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-black/50">…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-black/50">{t("inventory_empty" as keyof Dictionary) || "Nessun ingrediente."}</td></tr>
            ) : (
              rows.map((r) => {
                const low = isLow(r);
                const soon = isExpiringSoon(r);
                return (
                  <tr key={r.id} className="border-t" style={{ borderColor: "#eaddcb", background: low ? "rgba(220,38,38,0.06)" : undefined }}>
                    <td className="px-4 py-2 text-black font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={low ? "text-red-600 font-bold" : "text-black"}>{Number(r.stock_qty).toFixed(2)} {r.unit}</span>
                      {low && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t("inventory_low_badge" as keyof Dictionary) || "bassa"}</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-black">{Number(r.par_level).toFixed(2)} {r.unit}</td>
                    <td className="px-4 py-2 text-right text-black">€ {Number(r.current_unit_cost).toFixed(4)}</td>
                    <td className="px-4 py-2 text-black">{r.supplier_name || "—"}</td>
                    <td className="px-4 py-2">
                      {r.expiry_date ? (
                        <span className={soon ? "text-amber-700 font-bold" : "text-black"}>
                          {r.expiry_date}
                          {soon && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{t("inventory_expiring_badge" as keyof Dictionary) || "in scadenza"}</span>}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
