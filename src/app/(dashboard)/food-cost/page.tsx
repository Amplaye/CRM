"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Calculator, AlertTriangle, TrendingDown, FileWarning, ChevronDown, ChevronRight, ChevronLeft, Check, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { KPICard } from "@/components/ui/KPICard";
import { RecipePanel } from "@/components/management/RecipePanel";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { MenuEngineeringMatrix } from "@/components/management/MenuEngineeringMatrix";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import { dishCostTable } from "@/lib/management/food-cost";
import type { Dish, DishCostRow, RecipeLine } from "@/lib/management/types";
import type { MenuEngineeringInput } from "@/lib/management/menu-engineering";

const SALES_WINDOW_DAYS = 30;

// Per-dish price-save state, so each row shows its own spinner / result.
type SaveState = { status: "idle" | "saving" | "ok" | "error"; msg?: string };

export default function FoodCostPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const settings = activeTenant?.settings;
  const targetPct = (settings as any)?.management?.food_cost_target_pct ?? 30;
  const enabled = getFeatures(settings).management_enabled;

  // Source data (re-cost happens in a memo so editing a price re-renders cheaply).
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [recipesByDish, setRecipesByDish] = useState<Map<string, RecipeLine[]>>(new Map());
  const [costs, setCosts] = useState<Map<string, number>>(new Map());
  const [unitsSold, setUnitsSold] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  // UI state.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState("");
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [page, setPage] = useState(0); // 0-based; 25 dishes per page

  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled) return;
    setLoading(true);
    const [{ data: items }, { data: recipes }, { data: ings }] = await Promise.all([
      supabase.from("menu_items").select("id, name, price").eq("tenant_id", activeTenant.id),
      supabase.from("recipe_items").select("menu_item_id, ingredient_id, qty").eq("tenant_id", activeTenant.id),
      supabase.from("ingredients").select("id, current_unit_cost").eq("tenant_id", activeTenant.id),
    ]);
    const c = new Map<string, number>();
    for (const i of ings || []) c.set(i.id, Number(i.current_unit_cost));
    const byDish = new Map<string, RecipeLine[]>();
    for (const r of recipes || []) {
      const list = byDish.get(r.menu_item_id) || [];
      list.push({ ingredientId: r.ingredient_id, qty: Number(r.qty), wastePct: r.waste_pct != null ? Number(r.waste_pct) : 0 });
      byDish.set(r.menu_item_id, list);
    }
    setCosts(c);
    setRecipesByDish(byDish);
    setDishes((items || []).map((i: any) => ({ menuItemId: i.id, name: i.name, price: i.price })));

    // Sales volume per dish over the window → menu-engineering popularity axis.
    const from = new Date(Date.now() - SALES_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const { data: salesRaw } = await supabase
      .from("pos_sales")
      .select("id")
      .eq("tenant_id", activeTenant.id)
      .gte("business_date", from);
    const saleIds = (salesRaw || []).map((s: any) => s.id);
    const sold = new Map<string, number>();
    if (saleIds.length > 0) {
      const { data: saleItems } = await supabase
        .from("pos_sale_items")
        .select("menu_item_id, quantity")
        .in("sale_id", saleIds);
      for (const it of saleItems || []) {
        if (!it.menu_item_id) continue;
        sold.set(it.menu_item_id, (sold.get(it.menu_item_id) || 0) + Number(it.quantity));
      }
    }
    setUnitsSold(sold);
    setLoading(false);
  }, [activeTenant?.id, enabled, supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  // Recompute the table from current dishes/recipes/costs + target.
  const rows = useMemo(
    () => dishCostTable(dishes, recipesByDish, costs, targetPct),
    [dishes, recipesByDish, costs, targetPct],
  );

  const withPct = rows.filter((r) => r.foodCostPct != null);
  const avgPct = withPct.length ? withPct.reduce((s, r) => s + (r.foodCostPct || 0), 0) / withPct.length : null;
  const lowMarginCount = rows.filter((r) => r.lowMargin).length;
  const worst = withPct[0];
  const noRecipeCount = rows.filter((r) => r.noRecipe).length;
  const incompleteCount = rows.filter((r) => r.incompleteCost).length;
  const chartData = withPct.slice(0, 8).map((r) => ({ name: r.name, pct: r.foodCostPct as number, low: r.lowMargin }));

  // Menu-engineering input: dishes with a known unit margin, with their sales volume.
  const meInput: MenuEngineeringInput[] = useMemo(
    () =>
      rows
        .filter((r) => r.margin != null && !r.noRecipe)
        .map((r) => ({ menuItemId: r.menuItemId, name: r.name, margin: r.margin, unitsSold: unitsSold.get(r.menuItemId) || 0 })),
    [rows, unitsSold],
  );

  // Pagination: 25 dishes per page. KPIs and the chart stay computed over ALL
  // dishes (they summarise the whole menu); only the table is paged.
  const PER_PAGE = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  // Snap back to a valid page if the row count shrinks under us.
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);

  // Save a new price: optimistic local update → POST (CRM + POS write-back).
  async function savePrice(menuItemId: string, value: string) {
    const price = Number(value.replace(",", "."));
    setEditing(null);
    if (!Number.isFinite(price) || price < 0) return;
    const prev = dishes.find((d) => d.menuItemId === menuItemId)?.price ?? null;
    if (prev != null && Math.abs(prev - price) < 0.005) return; // unchanged

    setDishes((ds) => ds.map((d) => (d.menuItemId === menuItemId ? { ...d, price } : d)));
    setSaveStates((s) => ({ ...s, [menuItemId]: { status: "saving" } }));
    try {
      const res = await fetch("/api/pos/push-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_item_id: menuItemId, price }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "save failed");
      // CRM saved for sure; pos.detail tells whether the till got it too.
      setSaveStates((s) => ({
        ...s,
        [menuItemId]: { status: "ok", msg: data?.pos?.detail || (t("settings_saved" as keyof Dictionary) || "Salvato") },
      }));
      setTimeout(() => setSaveStates((s) => ({ ...s, [menuItemId]: { status: "idle" } })), 4000);
    } catch (e: any) {
      // revert local price on hard failure
      setDishes((ds) => ds.map((d) => (d.menuItemId === menuItemId ? { ...d, price: prev } : d)));
      setSaveStates((s) => ({ ...s, [menuItemId]: { status: "error", msg: e?.message || "Errore" } }));
    }
  }

  if (!enabled) {
    return <ManagementLocked section="food_cost" />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b pb-5" style={{ borderColor: "#c4956a" }}>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2">
          <Calculator className="w-6 h-6" /> {t("nav_food_cost" as keyof Dictionary) || "Food cost"}
        </h1>
        <p className="mt-1 text-sm text-black">
          {t("food_cost_subtitle_editable" as keyof Dictionary) ||
            "Costo e margine per piatto. Tocca il prezzo per modificarlo (si aggiorna anche sulla cassa) o espandi una riga per la ricetta."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t("food_cost_avg" as keyof Dictionary) || "Food cost medio"} value={avgPct != null ? `${avgPct.toFixed(1)}%` : "—"} icon={<Calculator className="w-5 h-5" />} />
        <KPICard title={t("food_cost_low_margin" as keyof Dictionary) || "Piatti sotto-margine"} value={lowMarginCount} icon={<TrendingDown className="w-5 h-5" />} />
        <KPICard title={t("food_cost_worst" as keyof Dictionary) || "Peggiore"} value={worst ? `${worst.name} (${(worst.foodCostPct || 0).toFixed(0)}%)` : "—"} icon={<AlertTriangle className="w-5 h-5" />} />
        <KPICard title={t("food_cost_no_recipe" as keyof Dictionary) || "Senza ricetta"} value={noRecipeCount} icon={<FileWarning className="w-5 h-5" />} />
      </div>

      {incompleteCount > 0 && (
        <div className="rounded-xl border-2 p-3 flex items-start gap-2 text-sm" style={{ borderColor: "#d97706", background: "rgba(217,119,6,0.08)" }}>
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
          <span className="text-black">
            {(t("food_cost_incomplete_warning" as keyof Dictionary) ||
              "{n} piatti hanno ingredienti senza costo: il loro food cost è sottostimato. Imposta i costi in Inventario.")
              .replace("{n}", String(incompleteCount))}
          </span>
        </div>
      )}

      {meInput.length > 0 && <MenuEngineeringMatrix input={meInput} />}

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
              <th className="px-3 py-2 w-8" aria-hidden />
              <th className="px-4 py-2 font-bold text-black">{t("food_cost_col_dish" as keyof Dictionary) || "Piatto"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_price" as keyof Dictionary) || "Prezzo"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_cost" as keyof Dictionary) || "Costo"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_pct" as keyof Dictionary) || "Food cost %"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("food_cost_col_margin" as keyof Dictionary) || "Margine"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-black">…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-black">{t("food_cost_empty" as keyof Dictionary) || "Nessun piatto."}</td></tr>
            ) : (
              pageRows.map((r) => {
                const isOpen = expanded === r.menuItemId;
                const ss = saveStates[r.menuItemId];
                return (
                  <FoodCostRowGroup
                    key={r.menuItemId}
                    r={r}
                    isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : r.menuItemId)}
                    editing={editing === r.menuItemId}
                    draftPrice={draftPrice}
                    setDraftPrice={setDraftPrice}
                    onStartEdit={() => { setEditing(r.menuItemId); setDraftPrice(r.price != null ? String(r.price) : ""); }}
                    onCommit={() => savePrice(r.menuItemId, draftPrice)}
                    onCancel={() => setEditing(null)}
                    saveState={ss}
                    tenantId={activeTenant!.id}
                    onRecipeChanged={load}
                    t={t}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > PER_PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-black">
            {(t("food_cost_pagination" as keyof Dictionary) || "Piatti {from}–{to} di {total}")
              .replace("{from}", String(safePage * PER_PAGE + 1))
              .replace("{to}", String(Math.min((safePage + 1) * PER_PAGE, rows.length)))
              .replace("{total}", String(rows.length))}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: "#c4956a", color: "#8b6540" }}
            >
              <ChevronLeft className="w-4 h-4" /> {t("back" as keyof Dictionary) || "Indietro"}
            </button>
            <span className="text-black tabular-nums">{safePage + 1} / {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: "#c4956a", color: "#8b6540" }}
            >
              {t("next" as keyof Dictionary) || "Avanti"} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// One dish: the main row (expandable, with inline price edit) + an optional
// expanded row hosting the recipe editor. Split out so the price-edit state and
// the recipe panel are scoped per dish.
function FoodCostRowGroup({
  r, isOpen, onToggle, editing, draftPrice, setDraftPrice, onStartEdit, onCommit, onCancel, saveState, tenantId, onRecipeChanged, t,
}: {
  r: DishCostRow;
  isOpen: boolean;
  onToggle: () => void;
  editing: boolean;
  draftPrice: string;
  setDraftPrice: (v: string) => void;
  onStartEdit: () => void;
  onCommit: () => void;
  onCancel: () => void;
  saveState?: SaveState;
  tenantId: string;
  onRecipeChanged: () => void | Promise<void>;
  t: (k: keyof Dictionary) => string;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: "#eaddcb", background: r.lowMargin ? "rgba(220,38,38,0.06)" : undefined }}>
        <td className="px-3 py-2 align-middle">
          <button onClick={onToggle} className="p-0.5 text-black hover:text-black cursor-pointer" aria-label="toggle recipe" aria-expanded={isOpen}>
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>
        <td className="px-4 py-2 text-black">
          {r.name}
          {r.noRecipe && <span className="ml-2 text-xs text-amber-600">({t("food_cost_no_recipe_tag" as keyof Dictionary) || "no ricetta"})</span>}
          {r.incompleteCost && <span className="ml-2 text-xs text-amber-600">⚠</span>}
        </td>
        <td className="px-4 py-2 text-right text-black">
          {editing ? (
            <input
              autoFocus
              type="number"
              step="0.01"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              onBlur={onCommit}
              onKeyDown={(e) => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
              className="w-24 px-2 py-1 text-right text-sm border-2 rounded"
              style={{ borderColor: "#c4956a" }}
            />
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              {saveState?.status === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
              {saveState?.status === "ok" && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              <button
                onClick={onStartEdit}
                className="px-2 py-0.5 rounded hover:bg-[#c4956a]/15 cursor-pointer underline decoration-dotted underline-offset-2"
                title={t("food_cost_edit_price_hint" as keyof Dictionary) || "Modifica prezzo (aggiorna anche la cassa)"}
              >
                {r.price != null ? `€ ${r.price.toFixed(2)}` : "—"}
              </button>
            </div>
          )}
        </td>
        <td className="px-4 py-2 text-right text-black">{r.noRecipe ? "—" : `€ ${r.cost.toFixed(2)}`}</td>
        <td className={`px-4 py-2 text-right font-bold ${r.lowMargin ? "text-red-600" : "text-black"}`}>{r.foodCostPct != null ? `${r.foodCostPct.toFixed(1)}%` : "—"}</td>
        <td className="px-4 py-2 text-right text-black">{r.margin != null ? `€ ${r.margin.toFixed(2)}` : "—"}</td>
      </tr>
      {saveState && (saveState.status === "ok" || saveState.status === "error") && saveState.msg && (
        <tr style={{ background: saveState.status === "error" ? "rgba(220,38,38,0.06)" : "rgba(16,185,129,0.06)" }}>
          <td />
          <td colSpan={5} className={`px-4 pb-2 text-xs ${saveState.status === "error" ? "text-red-600" : "text-emerald-700"}`}>
            {saveState.msg}
          </td>
        </tr>
      )}
      {isOpen && (
        <tr>
          <td />
          <td colSpan={5} className="px-2 pb-3">
            {/* RecipePanel writes recipe_items directly; refresh the table after
                edits so cost/% reflect the new recipe. */}
            <div onBlur={() => { void onRecipeChanged(); }}>
              <RecipePanel tenantId={tenantId} menuItemId={r.menuItemId} price={r.price} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
