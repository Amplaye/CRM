"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Calculator } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getFeatures } from "@/lib/types/tenant-settings";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { dishCost, foodCostPct } from "@/lib/management/food-cost";
import type { RecipeLine } from "@/lib/management/types";

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
}

export function RecipePanel({
  tenantId,
  menuItemId,
  price,
}: {
  tenantId: string;
  menuItemId: string;
  price: number | null;
}) {
  const { activeTenant } = useTenant();
  const { t } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const enabled = getFeatures(activeTenant?.settings).management_enabled;

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [picker, setPicker] = useState("");
  const [qty, setQty] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          .select("id, ingredient_id, qty")
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

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of ingredients) m.set(i.id, Number(i.current_unit_cost));
    return m;
  }, [ingredients]);

  const recipeLines: RecipeLine[] = rows.map((r) => ({ ingredientId: r.ingredient_id, qty: Number(r.qty) }));
  const { cost } = dishCost(recipeLines, costMap);
  const pct = foodCostPct(cost, price);

  const ingById = (id: string) => ingredients.find((i) => i.id === id);

  const addRow = async () => {
    const qn = Number(qty.replace(",", "."));
    if (!picker || !Number.isFinite(qn) || qn <= 0) return;
    if (rows.some((r) => r.ingredient_id === picker)) return; // unique per dish
    setStatus("saving");
    const { data, error } = await supabase
      .from("recipe_items")
      .insert({ tenant_id: tenantId, menu_item_id: menuItemId, ingredient_id: picker, qty: qn })
      .select("id, ingredient_id, qty")
      .single();
    if (error || !data) {
      setStatus("error");
      return;
    }
    setRows((prev) => [...prev, data as RecipeRow]);
    setPicker("");
    setQty("");
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

  return (
    <div className="px-4 py-4 border-t" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.5)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-black flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          {t("recipe_title" as keyof Dictionary) || "Ricetta & food cost"}
        </h3>
        <div className="text-sm font-bold text-black">
          {t("recipe_cost" as keyof Dictionary) || "Costo"}: € {cost.toFixed(2)}
          {pct != null && (
            <span className={`ml-2 ${pct > 30 ? "text-red-600" : "text-emerald-600"}`}>({pct.toFixed(1)}%)</span>
          )}
        </div>
      </div>

      {ingredients.length === 0 ? (
        <p className="text-xs text-black/60">
          {t("recipe_no_ingredients" as keyof Dictionary) ||
            "Nessun ingrediente: aggiungili dalla sezione Magazzino."}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((r) => {
              const ing = ingById(r.ingredient_id);
              return (
                <div key={r.ingredient_id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-black">{ing?.name || r.ingredient_id}</span>
                  <input
                    type="number"
                    value={r.qty}
                    onChange={(e) => updateQty(r.id, r.ingredient_id, e.target.value)}
                    className="w-20 px-2 py-1 text-sm border-2 rounded"
                    style={{ borderColor: "#c4956a" }}
                  />
                  <span className="w-8 text-xs text-black/60">{ing?.unit}</span>
                  <span className="w-20 text-right text-xs text-black/70">
                    € {((Number(r.qty) || 0) * (costMap.get(r.ingredient_id) || 0)).toFixed(2)}
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

          <div className="flex items-center gap-2 mt-3">
            <select
              value={picker}
              onChange={(e) => setPicker(e.target.value)}
              className="flex-1 px-2 py-1.5 text-sm border-2 rounded cursor-pointer"
              style={{ borderColor: "#c4956a" }}
            >
              <option value="">{t("recipe_pick_ingredient" as keyof Dictionary) || "Aggiungi ingrediente…"}</option>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (€{Number(i.current_unit_cost).toFixed(4)}/{i.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-20 px-2 py-1.5 text-sm border-2 rounded"
              style={{ borderColor: "#c4956a" }}
            />
            <button
              onClick={addRow}
              disabled={!picker || !qty}
              className="p-1.5 text-white rounded disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              aria-label="add"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {status === "error" && (
            <p className="text-xs text-red-600 mt-2">{t("settings_save_error" as keyof Dictionary) || "Errore"}</p>
          )}
        </>
      )}
    </div>
  );
}
