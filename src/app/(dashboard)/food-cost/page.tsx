"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, AlertTriangle, TrendingDown, FileWarning } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { KPICard } from "@/components/ui/KPICard";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import { dishCostTable } from "@/lib/management/food-cost";
import type { Dish, DishCostRow, RecipeLine } from "@/lib/management/types";

export default function FoodCostPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const settings = activeTenant?.settings;
  const targetPct = (settings as any)?.management?.food_cost_target_pct ?? 30;
  const enabled = getFeatures(settings).management_enabled;

  const [rows, setRows] = useState<DishCostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: items }, { data: recipes }, { data: ings }] = await Promise.all([
        supabase.from("menu_items").select("id, name, price").eq("tenant_id", activeTenant.id),
        supabase.from("recipe_items").select("menu_item_id, ingredient_id, qty").eq("tenant_id", activeTenant.id),
        supabase.from("ingredients").select("id, current_unit_cost").eq("tenant_id", activeTenant.id),
      ]);
      if (cancelled) return;

      const costs = new Map<string, number>();
      for (const i of ings || []) costs.set(i.id, Number(i.current_unit_cost));
      const recipesByDish = new Map<string, RecipeLine[]>();
      for (const r of recipes || []) {
        const list = recipesByDish.get(r.menu_item_id) || [];
        list.push({ ingredientId: r.ingredient_id, qty: Number(r.qty) });
        recipesByDish.set(r.menu_item_id, list);
      }
      const dishes: Dish[] = (items || []).map((i: any) => ({ menuItemId: i.id, name: i.name, price: i.price }));
      setRows(dishCostTable(dishes, recipesByDish, costs, targetPct));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTenant?.id, enabled, supabase, targetPct]);

  const withPct = rows.filter((r) => r.foodCostPct != null);
  const avgPct = withPct.length ? withPct.reduce((s, r) => s + (r.foodCostPct || 0), 0) / withPct.length : null;
  const lowMarginCount = rows.filter((r) => r.lowMargin).length;
  const worst = withPct[0];
  const noRecipeCount = rows.filter((r) => r.noRecipe).length;

  const chartData = withPct.slice(0, 8).map((r) => ({ name: r.name, pct: r.foodCostPct as number, low: r.lowMargin }));

  if (!enabled) {
    return <div className="p-8 text-sm text-black">{t("management_disabled" as keyof Dictionary) || "Modulo gestionale non attivo."}</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b pb-5" style={{ borderColor: "#c4956a" }}>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2">
          <Calculator className="w-6 h-6" /> {t("nav_food_cost" as keyof Dictionary) || "Food cost"}
        </h1>
        <p className="mt-1 text-sm text-black">{t("food_cost_subtitle" as keyof Dictionary) || "Costo e margine per piatto."}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t("food_cost_avg" as keyof Dictionary) || "Food cost medio"} value={avgPct != null ? `${avgPct.toFixed(1)}%` : "—"} icon={<Calculator className="w-5 h-5" />} />
        <KPICard title={t("food_cost_low_margin" as keyof Dictionary) || "Piatti sotto-margine"} value={lowMarginCount} icon={<TrendingDown className="w-5 h-5" />} />
        <KPICard title={t("food_cost_worst" as keyof Dictionary) || "Peggiore"} value={worst ? `${worst.name} (${(worst.foodCostPct || 0).toFixed(0)}%)` : "—"} icon={<AlertTriangle className="w-5 h-5" />} />
        <KPICard title={t("food_cost_no_recipe" as keyof Dictionary) || "Senza ricetta"} value={noRecipeCount} icon={<FileWarning className="w-5 h-5" />} />
      </div>

      {chartData.length > 0 && (
        <div className="rounded-xl border-2 p-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
          <h2 className="text-sm font-bold text-black mb-3">{t("food_cost_chart_title" as keyof Dictionary) || "Peggiori 8 — food cost %"} (target {targetPct}%)</h2>
          <div style={{ height: 260 }}>
            <ChartFrame>
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7d8c5" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                <ReferenceLine y={targetPct} stroke="#c4956a" strokeDasharray="4 4" />
                <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.low ? "#dc2626" : "#c4956a"} />
                  ))}
                </Bar>
              </BarChart>
            </ChartFrame>
          </div>
        </div>
      )}

      <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "#c4956a" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ background: "rgba(196,149,106,0.15)" }}>
              <th className="px-4 py-2 font-bold text-black">{t("food_cost_col_dish" as keyof Dictionary) || "Piatto"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_price" as keyof Dictionary) || "Prezzo"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_cost" as keyof Dictionary) || "Costo"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_pct" as keyof Dictionary) || "Food cost %"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_margin" as keyof Dictionary) || "Margine"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-black/50">…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-black/50">{t("food_cost_empty" as keyof Dictionary) || "Nessun piatto."}</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.menuItemId} className="border-t" style={{ borderColor: "#eaddcb", background: r.lowMargin ? "rgba(220,38,38,0.06)" : undefined }}>
                  <td className="px-4 py-2 text-black">
                    {r.name}
                    {r.noRecipe && <span className="ml-2 text-xs text-amber-600">({t("food_cost_no_recipe_tag" as keyof Dictionary) || "no ricetta"})</span>}
                    {r.incompleteCost && <span className="ml-2 text-xs text-amber-600">⚠</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-black">{r.price != null ? `€ ${r.price.toFixed(2)}` : "—"}</td>
                  <td className="px-4 py-2 text-right text-black">{r.noRecipe ? "—" : `€ ${r.cost.toFixed(2)}`}</td>
                  <td className={`px-4 py-2 text-right font-bold ${r.lowMargin ? "text-red-600" : "text-black"}`}>{r.foodCostPct != null ? `${r.foodCostPct.toFixed(1)}%` : "—"}</td>
                  <td className="px-4 py-2 text-right text-black">{r.margin != null ? `€ ${r.margin.toFixed(2)}` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
