"use client";

import { memo, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Calculator, AlertTriangle, ChevronDown, ChevronRight, ChevronLeft, Check, Loader2, Search, X, Sparkles, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { RecipePanel } from "@/components/management/RecipePanel";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { WipComingSoon } from "@/components/management/WipComingSoon";
import { canSeeWip } from "@/lib/billing/wip";
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
type Filter = "all" | "low" | "norecipe" | "ok";

const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#d9c3a3" } as const;

/** Price that brings a dish exactly to the target food cost %, rounded UP to
 * 50 cents so the suggestion is always safe and menu-friendly. */
function suggestedPrice(cost: number, targetPct: number): number {
  if (!(cost > 0) || !(targetPct > 0)) return 0;
  return Math.ceil((cost / (targetPct / 100)) * 2) / 2;
}

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
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Mirror of `dishes` so per-row handlers stay referentially stable (rows are
  // memoized; closing over `dishes` would rebuild every handler per save).
  const dishesRef = useRef<Dish[]>([]);
  useEffect(() => { dishesRef.current = dishes; }, [dishes]);

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
  const noRecipeCount = rows.filter((r) => r.noRecipe).length;
  const okCount = withPct.length - lowMarginCount;
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

  // Filter + search, then paginate. KPIs and analysis stay computed over ALL dishes.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (filter === "low") return r.lowMargin;
      if (filter === "norecipe") return r.noRecipe;
      if (filter === "ok") return !r.noRecipe && !r.lowMargin && r.foodCostPct != null;
      return true;
    });
  }, [rows, query, filter]);

  const PER_PAGE = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);
  useEffect(() => { setPage(0); }, [filter, query]);

  // ── Stable per-row handlers (dish cards are React.memo) ───────────────────
  const toggleRow = useCallback((id: string) => {
    setExpanded((cur) => (cur === id ? null : id));
  }, []);

  const startEdit = useCallback((id: string) => {
    const cur = dishesRef.current.find((d) => d.menuItemId === id);
    setDraftPrice(cur?.price != null ? String(cur.price) : "");
    setEditing(id);
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  // Save a new price: optimistic local update → POST (CRM + POS write-back).
  const savePrice = useCallback(async (menuItemId: string, value: string) => {
    const price = Number(value.replace(",", "."));
    setEditing(null);
    if (!Number.isFinite(price) || price < 0) return;
    const prev = dishesRef.current.find((d) => d.menuItemId === menuItemId)?.price ?? null;
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
        [menuItemId]: { status: "ok", msg: data?.pos?.detail || t("settings_saved") },
      }));
      setTimeout(() => setSaveStates((s) => ({ ...s, [menuItemId]: { status: "idle" } })), 4000);
    } catch (e: any) {
      // revert local price on hard failure
      setDishes((ds) => ds.map((d) => (d.menuItemId === menuItemId ? { ...d, price: prev } : d)));
      setSaveStates((s) => ({ ...s, [menuItemId]: { status: "error", msg: e?.message || "Errore" } }));
    }
  }, [t]);

  const applySuggested = useCallback((menuItemId: string, price: number) => {
    void savePrice(menuItemId, String(price));
  }, [savePrice]);

  // Work-in-progress: hidden for everyone but the WIP allowlist (incl. direct URL).
  if (!canSeeWip(activeTenant?.id)) {
    return <WipComingSoon />;
  }

  if (!enabled) {
    return <ManagementLocked section="food_cost" />;
  }

  const avgColor = avgPct == null ? "#000" : avgPct > targetPct ? "#dc2626" : avgPct > targetPct - 5 ? "#d97706" : "#059669";

  const chips: Array<{ key: Filter; label: string; count: number; color?: string }> = [
    { key: "all", label: t("inventory_filter_all"), count: rows.length },
    { key: "low", label: t("food_cost_low_margin"), count: lowMarginCount, color: "#dc2626" },
    { key: "norecipe", label: t("food_cost_no_recipe"), count: noRecipeCount, color: "#d97706" },
    { key: "ok", label: "OK", count: okCount, color: "#059669" },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Calculator className="w-6 h-6" /> {t("nav_food_cost")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#000" }}>
            {t("food_cost_subtitle_v2")}
          </p>
        </div>
        <button
          onClick={() => setShowAnalysis((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70"
          style={{ borderColor: "#c4956a" }}
        >
          <BarChart3 className="w-4 h-4" />
          {t("food_cost_analysis")}
          {showAnalysis ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Hero: average food cost vs target + counters */}
      <div className={`${CARD} p-5 flex flex-wrap items-center gap-x-8 gap-y-4`} style={CARD_STYLE}>
        <div>
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "#000" }}>
            {t("food_cost_avg")}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums" style={{ color: avgColor }}>
              {avgPct != null ? `${avgPct.toFixed(1)}%` : "—"}
            </span>
            <span className="text-sm" style={{ color: "#000" }}>
              {t("food_cost_target").replace("{n}", String(targetPct))}
            </span>
          </div>
          {/* average vs target gauge */}
          <div className="mt-2 relative h-2 rounded-full w-48 overflow-hidden" style={{ background: "rgba(196,149,106,0.18)" }}>
            {avgPct != null && (
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (avgPct / 60) * 100)}%`, background: avgColor }} />
            )}
            <div className="absolute inset-y-0" style={{ left: `${Math.min(100, (targetPct / 60) * 100)}%`, width: 2, background: "rgba(0,0,0,0.35)" }} />
          </div>
        </div>
        <div className="flex items-center gap-6">
          <HeroStat label={t("food_cost_low_margin")} value={lowMarginCount} color={lowMarginCount > 0 ? "#dc2626" : "#059669"} />
          <HeroStat label={t("food_cost_no_recipe")} value={noRecipeCount} color={noRecipeCount > 0 ? "#d97706" : "#059669"} />
          <HeroStat label="OK" value={okCount} color="#059669" />
        </div>
      </div>

      {incompleteCount > 0 && (
        <div className="rounded-xl border p-3 flex items-start gap-2 text-sm" style={{ borderColor: "rgba(217,119,6,0.4)", background: "rgba(217,119,6,0.08)" }}>
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
          <span className="text-black">
            {t("food_cost_incomplete_warning").replace("{n}", String(incompleteCount))}
          </span>
        </div>
      )}

      {/* Analysis: menu-engineering matrix + worst-8 chart, collapsed by default */}
      {showAnalysis && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {meInput.length > 0 && <MenuEngineeringMatrix input={meInput} />}
          {chartData.length > 0 && (
            <div className={`${CARD} p-4`} style={CARD_STYLE}>
              <h2 className="text-sm font-bold text-black mb-3">{t("food_cost_chart_title")} (target {targetPct}%)</h2>
              <div style={{ height: 260 }}>
                <ChartFrame>
                  <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d3bd9c" />
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
        </div>
      )}

      {/* Search + filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#000" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("food_cost_search_ph")}
            className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border bg-white/70 text-black outline-none focus:border-[#c4956a]"
            style={{ borderColor: "#d9c3a3" }}
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer" aria-label="clear">
              <X className="w-4 h-4" style={{ color: "#000" }} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = filter === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setFilter(active && c.key !== "all" ? "all" : c.key)}
                className="px-3 py-1.5 text-sm font-bold rounded-full border cursor-pointer transition-colors"
                style={
                  active
                    ? { background: "#c4956a", borderColor: "#c4956a", color: "#fff" }
                    : { borderColor: "#d9c3a3", background: "rgba(255,255,255,0.7)", color: "#000" }
                }
              >
                {c.label}
                <span
                  className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full tabular-nums"
                  style={
                    active
                      ? { background: "rgba(255,255,255,0.3)", color: "#fff" }
                      : c.color && c.count > 0
                        ? { background: c.color, color: "#fff" }
                        : { color: "#000" }
                  }
                >
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dish list */}
      <div className="space-y-2">
        {loading ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className={`${CARD} h-16 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
          ))
        ) : filtered.length === 0 ? (
          <div className={`${CARD} p-8 text-center text-sm text-black`} style={CARD_STYLE}>
            {rows.length === 0 ? t("food_cost_empty") : t("inventory_no_match")}
          </div>
        ) : (
          pageRows.map((r) => (
            <DishCard
              key={r.menuItemId}
              r={r}
              targetPct={targetPct}
              isOpen={expanded === r.menuItemId}
              editing={editing === r.menuItemId}
              draft={editing === r.menuItemId ? draftPrice : ""}
              saveState={saveStates[r.menuItemId]}
              tenantId={activeTenant!.id}
              onToggle={toggleRow}
              onStartEdit={startEdit}
              onDraftChange={setDraftPrice}
              onCommit={savePrice}
              onCancel={cancelEdit}
              onApplySuggested={applySuggested}
              onRecipeChanged={load}
              t={t}
            />
          ))
        )}
      </div>

      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-black">
            {t("food_cost_pagination")
              .replace("{from}", String(safePage * PER_PAGE + 1))
              .replace("{to}", String(Math.min((safePage + 1) * PER_PAGE, filtered.length)))
              .replace("{total}", String(filtered.length))}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-white/70"
              style={{ borderColor: "#c4956a", color: "#000" }}
            >
              <ChevronLeft className="w-4 h-4" /> {t("back")}
            </button>
            <span className="text-black tabular-nums">{safePage + 1} / {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-white/70"
              style={{ borderColor: "#c4956a", color: "#000" }}
            >
              {t("next")} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "#000" }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

// One dish card: status dot, name, tappable price, food-cost gauge, margin and a
// one-tap suggested price when the dish is under target. Expands into the recipe.
// Memoized — id-based stable handlers, so expanding one card doesn't re-render
// the other 24 on the page.
const DishCard = memo(function DishCard({
  r, targetPct, isOpen, editing, draft, saveState, tenantId,
  onToggle, onStartEdit, onDraftChange, onCommit, onCancel, onApplySuggested, onRecipeChanged, t,
}: {
  r: DishCostRow;
  targetPct: number;
  isOpen: boolean;
  editing: boolean;
  draft: string;
  saveState?: SaveState;
  tenantId: string;
  onToggle: (id: string) => void;
  onStartEdit: (id: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: (id: string, value: string) => void;
  onCancel: () => void;
  onApplySuggested: (id: string, price: number) => void;
  onRecipeChanged: () => void | Promise<void>;
  t: (k: keyof Dictionary) => string;
}) {
  const statusColor = r.noRecipe ? "#d97706" : r.lowMargin ? "#dc2626" : r.foodCostPct == null ? "#d97706" : "#059669";
  const pctColor = r.foodCostPct == null ? "#000" : r.lowMargin ? "#dc2626" : "#059669";
  const suggested = r.lowMargin && r.cost > 0 ? suggestedPrice(r.cost, targetPct) : null;

  return (
    <div className={CARD} style={{ ...CARD_STYLE, borderColor: isOpen ? "#c4956a" : r.lowMargin ? "rgba(220,38,38,0.35)" : "#d9c3a3" }}>
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 cursor-pointer select-none" onClick={() => onToggle(r.menuItemId)}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor }} aria-hidden />

        {/* Name + gauge */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-black truncate">{r.name}</span>
            {r.noRecipe && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }}>
                {t("food_cost_no_recipe_tag")}
              </span>
            )}
            {r.incompleteCost && (
              <span title={t("food_cost_incomplete_tag")}>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {r.foodCostPct != null && (
              <>
                <div className="relative h-1.5 rounded-full w-24 sm:w-36 overflow-hidden" style={{ background: "rgba(196,149,106,0.18)" }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.min(100, (r.foodCostPct / 60) * 100)}%`, background: pctColor }}
                  />
                  <div className="absolute inset-y-0" style={{ left: `${Math.min(100, (targetPct / 60) * 100)}%`, width: 2, background: "rgba(0,0,0,0.3)" }} />
                </div>
                <span className="text-xs font-bold tabular-nums" style={{ color: pctColor }}>{r.foodCostPct.toFixed(0)}%</span>
              </>
            )}
            {!r.noRecipe && (
              <span className="text-xs tabular-nums" style={{ color: "#000" }}>
                {t("food_cost_cost_short")} € {r.cost.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Suggested price — the one-tap fix for a dish under target */}
        {suggested != null && suggested > (r.price ?? 0) && (
          <button
            onClick={(e) => { e.stopPropagation(); onApplySuggested(r.menuItemId, suggested); }}
            className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer shrink-0 text-white"
            style={{ background: "#059669" }}
            title={t("food_cost_suggested_hint")}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t("food_cost_suggested").replace("{p}", suggested.toFixed(2))}
          </button>
        )}

        {/* Margin */}
        <div className="hidden sm:block text-right shrink-0 w-20">
          <div className="text-xs" style={{ color: "#000" }}>{t("food_cost_col_margin")}</div>
          <div className="text-sm font-bold tabular-nums text-black">{r.margin != null ? `€ ${r.margin.toFixed(2)}` : "—"}</div>
        </div>

        {/* Price — tappable, writes back to the till */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          {editing ? (
            <input
              autoFocus
              type="number"
              step="0.01"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onBlur={() => onCommit(r.menuItemId, draft)}
              onKeyDown={(e) => { if (e.key === "Enter") onCommit(r.menuItemId, draft); if (e.key === "Escape") onCancel(); }}
              className="w-24 px-2 py-1.5 text-right text-sm font-bold border-2 rounded-lg text-black"
              style={{ borderColor: "#c4956a" }}
            />
          ) : (
            <button
              onClick={() => onStartEdit(r.menuItemId)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-[#c4956a]/10"
              title={t("food_cost_edit_price_hint")}
            >
              {saveState?.status === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
              {saveState?.status === "ok" && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              <span className="text-base font-bold tabular-nums text-black">{r.price != null ? `€ ${r.price.toFixed(2)}` : "—"}</span>
            </button>
          )}
        </div>

        {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-black" /> : <ChevronRight className="w-4 h-4 shrink-0 text-black" />}
      </div>

      {saveState && (saveState.status === "ok" || saveState.status === "error") && saveState.msg && (
        <div className={`px-4 pb-2 text-xs ${saveState.status === "error" ? "text-red-600" : "text-emerald-700"}`}>{saveState.msg}</div>
      )}

      {isOpen && (
        <div className="px-3 sm:px-4 pb-4 border-t pt-3" style={{ borderColor: "#e0d0b8" }}>
          {/* mobile-only suggested price (hidden in the row on small screens) */}
          {suggested != null && suggested > (r.price ?? 0) && (
            <button
              onClick={() => onApplySuggested(r.menuItemId, suggested)}
              className="md:hidden mb-3 inline-flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg cursor-pointer text-white"
              style={{ background: "#059669" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t("food_cost_suggested").replace("{p}", suggested.toFixed(2))}
            </button>
          )}
          {/* RecipePanel writes recipe_items directly; refresh the table after
              edits so cost/% reflect the new recipe. */}
          <div onBlur={() => { void onRecipeChanged(); }}>
            <RecipePanel tenantId={tenantId} menuItemId={r.menuItemId} price={r.price} />
          </div>
        </div>
      )}
    </div>
  );
});
