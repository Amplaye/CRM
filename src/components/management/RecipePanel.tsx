"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Calculator, Sparkles, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getFeatures } from "@/lib/types/tenant-settings";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { dishCost, foodCostPct, effectiveQty } from "@/lib/management/food-cost";
import { convertQty } from "@/lib/management/units";
import { UnitSelect } from "./UnitSelect";
import type { RecipeLine } from "@/lib/management/types";
import type { ResolvedLine } from "@/lib/management/recipe-suggest";
import {
  toReviewLines,
  saveReviewedRecipe,
  RecipeReviewRow,
  type ReviewLine,
} from "./RecipeReview";

// Recipe editor for a single dish, mounted in the Menu edit modal. Lists the
// dish's ingredients (qty in the ingredient's unit), shows live cost + food
// cost % against the dish price, and upserts recipe_items optimistically (same
// instant-save idiom as FeaturesTab). Self-hides when management_enabled is OFF,
// so the host file never needs to know about the flag.

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  current_unit_cost: number;
}
interface RecipeRow {
  id?: string;
  ingredient_id: string;
  qty: number;
  waste_pct?: number;
}

export function RecipePanel({
  tenantId,
  menuItemId,
  price,
  dishName,
  dishDescription,
}: {
  tenantId: string;
  menuItemId: string;
  price: number | null;
  /** Optional: dish name/description for the AI "suggest recipe" button. When
   * absent the button falls back to reading the menu_items row on demand. */
  dishName?: string;
  dishDescription?: string | null;
}) {
  const { activeTenant } = useTenant();
  const { t } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const enabled = getFeatures(activeTenant?.settings).management_enabled;

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [picker, setPicker] = useState("");
  const [qty, setQty] = useState("");
  // The unit the COOK types in, which needn't be the unit the warehouse stocks:
  // a recipe says "150 g of flour" even when flour is bought by the kg. It
  // follows the chosen ingredient by default, and the quantity is converted on
  // save.
  const [addUnit, setAddUnit] = useState("g");
  const [addWaste, setAddWaste] = useState("0");
  // Why the last add attempt did nothing. The form used to fail silently.
  const [addError, setAddError] = useState<string | null>(null);
  // Free-text filter over the ingredient list — a 180-row <select> is unusable
  // without one.
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI suggest-recipe review block (draft, above the add-form).
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "review" | "saving" | "error">("idle");
  const [aiLines, setAiLines] = useState<ReviewLine[]>([]);

  const reload = async () => {
    const [{ data: ings }, { data: recipe }] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id, name, unit, current_unit_cost")
        .eq("tenant_id", tenantId)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("recipe_items")
        .select("id, ingredient_id, qty, waste_pct")
        .eq("menu_item_id", menuItemId),
    ]);
    setIngredients((ings || []) as Ingredient[]);
    setRows((recipe || []) as RecipeRow[]);
  };

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const [{ data: ings }, { data: recipe }] = await Promise.all([
        supabase
          .from("ingredients")
          .select("id, name, unit, current_unit_cost")
          .eq("tenant_id", tenantId)
          .eq("archived", false)
          .order("name"),
        supabase
          .from("recipe_items")
          .select("id, ingredient_id, qty, waste_pct")
          .eq("menu_item_id", menuItemId),
      ]);
      if (cancelled) return;
      setIngredients((ings || []) as Ingredient[]);
      setRows((recipe || []) as RecipeRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, supabase, tenantId, menuItemId]);

  // ── AI suggest recipe ─────────────────────────────────────────────────────
  const suggestRecipe = async () => {
    setAiStatus("loading");
    setAiLines([]);
    try {
      // Fall back to the DB row if the host didn't pass name/description.
      let name = dishName || "";
      let description = dishDescription ?? null;
      if (!name) {
        const { data } = await supabase
          .from("menu_items")
          .select("name, description")
          .eq("id", menuItemId)
          .maybeSingle();
        name = (data?.name as string) || "";
        description = (data?.description as string) ?? null;
      }
      const res = await fetch("/api/management/suggest-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, dishes: [{ menuItemId, name, description, price }] }),
      });
      if (!res.ok) throw new Error("suggest failed");
      const data = (await res.json()) as { results: Array<{ menuItemId: string; lines: ResolvedLine[] }> };
      const lines = data.results?.[0]?.lines || [];
      setAiLines(toReviewLines(lines));
      setAiStatus("review");
    } catch {
      setAiStatus("error");
    }
  };

  const saveAiRecipe = async () => {
    setAiStatus("saving");
    const existing = new Set(rows.map((r) => r.ingredient_id));
    const { saved } = await saveReviewedRecipe(supabase, tenantId, menuItemId, aiLines, existing);
    if (saved > 0) await reload();
    setAiLines([]);
    setAiStatus("idle");
  };

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of ingredients) m.set(i.id, Number(i.current_unit_cost));
    return m;
  }, [ingredients]);

  const recipeLines: RecipeLine[] = rows.map((r) => ({ ingredientId: r.ingredient_id, qty: Number(r.qty), wastePct: r.waste_pct != null ? Number(r.waste_pct) : 0 }));
  const { cost } = dishCost(recipeLines, costMap);
  const pct = foodCostPct(cost, price);

  const ingById = (id: string) => ingredients.find((i) => i.id === id);

  /**
   * Add the composed line to the dish.
   *
   * The old version returned silently on every rejection — empty picker, bad
   * number, ingredient already in the dish — so a click that did nothing looked
   * identical to a click that worked. Every branch now says why, and the
   * quantity is converted from the unit the cook typed into the unit the
   * warehouse stocks (write "150 g" against an ingredient held in kg and it
   * must be stored as 0.15, never 150).
   */
  const addRow = async () => {
    const qn = Number(qty.replace(",", "."));
    const ing = ingredients.find((i) => i.id === picker);
    if (!ing) return setAddError(t("recipe_err_pick_ingredient"));
    if (!Number.isFinite(qn) || qn <= 0) return setAddError(t("recipe_err_qty"));
    if (rows.some((r) => r.ingredient_id === picker)) return setAddError(t("recipe_err_duplicate"));

    const stored = convertQty(qn, addUnit, ing.unit);
    if (stored == null) return setAddError(t("recipe_err_unit").replace("{unit}", ing.unit));

    setAddError(null);
    setStatus("saving");
    const wn = Math.min(99, Math.max(0, Number(addWaste.replace(",", ".")) || 0));
    const { data, error } = await supabase
      .from("recipe_items")
      .insert({
        tenant_id: tenantId,
        menu_item_id: menuItemId,
        ingredient_id: picker,
        qty: Math.round(stored * 1e6) / 1e6,
        waste_pct: wn,
      })
      .select("id, ingredient_id, qty, waste_pct")
      .single();
    if (error || !data) {
      setStatus("error");
      setAddError(t("recipe_err_save"));
      return;
    }
    setRows((prev) => [...prev, data as RecipeRow]);
    setPicker("");
    setQty("");
    setAddWaste("0");
    flashSaved();
  };

  const updateQty = async (id: string | undefined, ingredientId: string, value: string) => {
    const qn = Number(value.replace(",", "."));
    setRows((prev) => prev.map((r) => (r.ingredient_id === ingredientId ? { ...r, qty: qn } : r)));
    if (!id || !Number.isFinite(qn) || qn <= 0) return;
    setStatus("saving");
    const { error } = await supabase.from("recipe_items").update({ qty: qn }).eq("id", id);
    if (error) setStatus("error");
    else flashSaved();
  };

  const updateWaste = async (id: string | undefined, ingredientId: string, value: string) => {
    let wn = Number(value.replace(",", "."));
    if (!Number.isFinite(wn) || wn < 0) wn = 0;
    if (wn > 99) wn = 99;
    setRows((prev) => prev.map((r) => (r.ingredient_id === ingredientId ? { ...r, waste_pct: wn } : r)));
    if (!id) return;
    setStatus("saving");
    const { error } = await supabase.from("recipe_items").update({ waste_pct: wn }).eq("id", id);
    if (error) setStatus("error");
    else flashSaved();
  };

  const removeRow = async (id: string | undefined, ingredientId: string) => {
    setRows((prev) => prev.filter((r) => r.ingredient_id !== ingredientId));
    if (id) await supabase.from("recipe_items").delete().eq("id", id);
  };

  const flashSaved = () => {
    setStatus("idle");
    if (savedTimer.current) clearTimeout(savedTimer.current);
  };

  if (!enabled) return null;

  const available = ingredients.filter((i) => !rows.some((r) => r.ingredient_id === i.id));
  const q = search.trim().toLowerCase();
  const filteredAvailable = q ? available.filter((i) => i.name.toLowerCase().includes(q)) : available;

  // Live preview of the line being composed: what it becomes in warehouse units
  // and what it costs. The whole point of letting the cook type "150 g" against
  // a product stocked in kg is that they can see it land as 0,15 kg before
  // saving, instead of discovering a 1000× food cost afterwards.
  const previewIng = ingredients.find((i) => i.id === picker);
  const previewQty = Number(qty.replace(",", "."));
  let addPreview: { converted: string; cost: number } | null = null;
  if (previewIng && Number.isFinite(previewQty) && previewQty > 0) {
    const stored = convertQty(previewQty, addUnit, previewIng.unit);
    if (stored != null) {
      const wn = Math.min(99, Math.max(0, Number(addWaste.replace(",", ".")) || 0));
      addPreview = {
        converted: `${previewQty} ${addUnit} = ${Number(stored.toFixed(6))} ${previewIng.unit}`,
        cost: effectiveQty(stored, wn) * Number(previewIng.current_unit_cost),
      };
    }
  }

  return (
    <div className="px-4 py-4 border-t" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.5)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-black flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          {t("recipe_title" as keyof Dictionary) || "Ricetta & food cost"}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={suggestRecipe}
            disabled={aiStatus === "loading" || aiStatus === "saving"}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {aiStatus === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t("food_cost_suggest_recipe")}
          </button>
          <div className="text-sm font-bold text-black">
            {t("recipe_cost" as keyof Dictionary) || "Costo"}: € {cost.toFixed(2)}
            {pct != null && (
              <span className={`ml-2 ${pct > 30 ? "text-red-600" : "text-emerald-600"}`}>({pct.toFixed(1)}%)</span>
            )}
          </div>
        </div>
      </div>

      {/* AI suggestion review block — a draft the owner confirms before saving */}
      {aiStatus === "error" && (
        <p className="text-xs text-red-600 mb-3">{t("food_cost_bulk_error")}</p>
      )}
      {(aiStatus === "review" || aiStatus === "saving") && (
        <div className="mb-3 rounded-xl border p-3" style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.7)" }}>
          <p className="text-xs mb-1" style={{ color: "#000" }}>{t("food_cost_ai_estimate_hint")}</p>
          {aiLines.length === 0 ? (
            <p className="text-xs text-black">{t("food_cost_ai_no_lines")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs mb-1" style={{ color: "#b45309" }}>{t("food_cost_ai_new_note")}</p>
              {aiLines.map((l, i) => (
                <RecipeReviewRow
                  key={i}
                  line={l}
                  options={ingredients.map((ing) => ({ id: ing.id, name: ing.name, unit: ing.unit }))}
                  createLabel={(name) => t("food_cost_create_ingredient").replace("{name}", name)}
                  matchedLabel={t("food_cost_ai_matched")}
                  newLabel={t("food_cost_ai_new")}
                  onChange={(next) => setAiLines((prev) => prev.map((p, j) => (j === i ? next : p)))}
                />
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={() => { setAiLines([]); setAiStatus("idle"); }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border cursor-pointer text-black bg-white/70"
              style={{ borderColor: "#d9c3a3" }}
            >
              {t("cancel")}
            </button>
            <button
              onClick={saveAiRecipe}
              disabled={aiStatus === "saving" || aiLines.filter((l) => l.include).length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "#059669" }}
            >
              {aiStatus === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("food_cost_save_recipe")}
            </button>
          </div>
        </div>
      )}

      {ingredients.length === 0 && aiStatus === "idle" ? (
        <p className="text-xs text-black">
          {t("recipe_no_ingredients" as keyof Dictionary) ||
            "Nessun ingrediente: aggiungili dalla sezione Inventario."}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((r) => {
              const ing = ingById(r.ingredient_id);
              return (
                <div key={r.ingredient_id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm text-black">{ing?.name || r.ingredient_id}</span>
                  <input
                    type="number"
                    value={r.qty}
                    onChange={(e) => updateQty(r.id, r.ingredient_id, e.target.value)}
                    className="w-20 px-2 py-1 text-sm border-2 rounded"
                    style={{ borderColor: "#c4956a" }}
                  />
                  <span className="w-8 text-xs text-black">{ing?.unit}</span>
                  <label className="flex items-center gap-1" title={t("recipe_waste_hint" as keyof Dictionary) || "Scarto/calo %: quanto si perde in pulitura o cottura"}>
                    <input
                      type="number"
                      value={r.waste_pct ?? 0}
                      onChange={(e) => updateWaste(r.id, r.ingredient_id, e.target.value)}
                      className="w-12 px-1.5 py-1 text-xs border-2 rounded text-right"
                      style={{ borderColor: "#c4956a" }}
                    />
                    <span className="text-xs text-black">% {t("recipe_waste" as keyof Dictionary) || "scarto"}</span>
                  </label>
                  <span className="w-20 text-right text-xs text-black">
                    € {(effectiveQty(Number(r.qty) || 0, r.waste_pct) * (costMap.get(r.ingredient_id) || 0)).toFixed(2)}
                  </span>
                  <button
                    onClick={() => removeRow(r.id, r.ingredient_id)}
                    className="p-1 text-red-500 hover:bg-red-50 rounded cursor-pointer"
                    aria-label="remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add-ingredient form: search + picker + qty in ANY unit + waste %.
              Deliberately mirrors what the AI review row can express, so a
              hand-written line is never second-class next to a generated one. */}
          <div className="mt-3 rounded-xl border p-2.5" style={{ borderColor: "#d9c3a3", background: "rgba(255,255,255,0.6)" }}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[12rem] flex flex-col gap-1">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("recipe_search_ingredient")}
                  className="w-full px-2 py-1.5 text-sm border-2 rounded text-black"
                  style={{ borderColor: "#d9c3a3" }}
                />
                <select
                  value={picker}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPicker(id);
                    setAddError(null);
                    // Default to the warehouse unit: the common case is typing
                    // the quantity in the same unit the product is stocked in.
                    const chosen = ingredients.find((i) => i.id === id);
                    if (chosen) setAddUnit(chosen.unit);
                  }}
                  className="w-full px-2 py-1.5 text-sm border-2 rounded cursor-pointer text-black"
                  style={{ borderColor: "#c4956a" }}
                >
                  <option value="">{t("recipe_pick_ingredient" as keyof Dictionary) || "Aggiungi ingrediente…"}</option>
                  {filteredAvailable.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (€{Number(i.current_unit_cost).toFixed(4)}/{i.unit})
                    </option>
                  ))}
                </select>
                {search.trim() !== "" && filteredAvailable.length === 0 && (
                  <span className="text-xs" style={{ color: "#b45309" }}>{t("recipe_no_ingredient_match")}</span>
                )}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-black">{t("recipe_qty")}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={qty}
                  onChange={(e) => { setQty(e.target.value); setAddError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void addRow(); }}
                  className="w-24 px-2 py-1.5 text-sm border-2 rounded text-black"
                  style={{ borderColor: "#c4956a" }}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-black">{t("inventory_unit")}</span>
                <UnitSelect
                  value={addUnit}
                  onChange={(u) => { setAddUnit(u); setAddError(null); }}
                  t={t}
                  className="w-40 px-2 py-1.5 text-sm border-2 rounded cursor-pointer text-black bg-white"
                  style={{ borderColor: "#c4956a" }}
                />
              </label>

              <label className="flex flex-col gap-1" title={t("recipe_waste_hint" as keyof Dictionary) || ""}>
                <span className="text-xs font-bold text-black">% {t("recipe_waste" as keyof Dictionary) || "scarto"}</span>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={addWaste}
                  onChange={(e) => setAddWaste(e.target.value)}
                  className="w-16 px-2 py-1.5 text-sm border-2 rounded text-right text-black"
                  style={{ borderColor: "#c4956a" }}
                />
              </label>

              <button
                onClick={addRow}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-white rounded cursor-pointer"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                <Plus className="w-4 h-4" /> {t("recipe_add_line")}
              </button>
            </div>

            {/* What the line will actually cost, before it's committed. */}
            {addPreview && (
              <p className="mt-2 text-xs text-black">
                {addPreview.converted}
                <span className="font-bold"> · € {addPreview.cost.toFixed(2)}</span>
              </p>
            )}
            {addError && <p className="mt-2 text-xs font-bold text-red-600">{addError}</p>}
          </div>

          {status === "error" && !addError && (
            <p className="text-xs text-red-600 mt-2">{t("settings_save_error" as keyof Dictionary) || "Errore"}</p>
          )}
        </>
      )}
    </div>
  );
}
