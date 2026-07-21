"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedLine } from "@/lib/management/recipe-suggest";

// Shared review UI + save logic for AI-suggested recipes, used by both the
// per-dish RecipePanel button and the bulk food-cost modal. An AI suggestion is
// a DRAFT: each line becomes an editable row (ingredient select, qty, include
// checkbox); on save we auto-create any "— crea «X» —" ingredients (unit from
// the AI, cost 0, flagged for the owner to price in Inventory) then batch-insert
// the accepted recipe_items. Keeping this in one place means both entry points
// behave identically.

export interface ReviewLine extends ResolvedLine {
  include: boolean;
  /** The chosen ingredient id, "" means "create a new ingredient from the AI name". */
  chosenId: string;
}

export interface IngredientOption {
  id: string;
  name: string;
  unit: string;
}

/** Wrap the route's ResolvedLine[] into editable review lines (accept-by-default). */
export function toReviewLines(lines: ResolvedLine[]): ReviewLine[] {
  return lines.map((l) => ({
    ...l,
    include: true,
    chosenId: l.match.ingredientId ?? "",
  }));
}

/**
 * Persist the accepted lines of ONE dish into recipe_items. Auto-creates any
 * "create" ingredient first (chosenId === "", using the AI's proposed name +
 * unit, cost 0), skips lines whose ingredient is already in the dish, and
 * inserts the rest in a single batch. Returns how many lines were saved.
 *
 * Total & defensive: a failed ingredient-create just skips that line rather than
 * failing the whole dish.
 */
export async function saveReviewedRecipe(
  supabase: SupabaseClient,
  tenantId: string,
  menuItemId: string,
  lines: ReviewLine[],
  existingIngredientIds: Set<string>,
): Promise<{ saved: number; created: number }> {
  const accepted = lines.filter((l) => l.include);
  let created = 0;
  const seen = new Set<string>(existingIngredientIds);
  const rows: Array<{ tenant_id: string; menu_item_id: string; ingredient_id: string; qty: number }> = [];

  for (const l of accepted) {
    let ingredientId = l.chosenId;

    // Create a brand-new ingredient from the AI proposal when none was chosen.
    if (!ingredientId) {
      const name = l.match.proposalName.trim();
      if (!name) continue;
      // Reuse an existing row with the same name if there is one (unique per
      // tenant), otherwise insert.
      const { data: existing } = await supabase
        .from("ingredients")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", name)
        .maybeSingle();
      if (existing?.id) {
        ingredientId = existing.id as string;
      } else {
        const { data: inserted, error } = await supabase
          .from("ingredients")
          .insert({ tenant_id: tenantId, name, unit: l.match.proposalUnit, current_unit_cost: 0 })
          .select("id")
          .single();
        if (error || !inserted) continue;
        ingredientId = inserted.id as string;
        created++;
      }
    }

    if (!ingredientId || seen.has(ingredientId)) continue; // unique per dish
    seen.add(ingredientId);
    rows.push({ tenant_id: tenantId, menu_item_id: menuItemId, ingredient_id: ingredientId, qty: l.qty });
  }

  if (rows.length === 0) return { saved: 0, created };
  const { error } = await supabase.from("recipe_items").insert(rows);
  if (error) return { saved: 0, created };
  return { saved: rows.length, created };
}

/** One editable review row: ingredient select + qty + include checkbox. */
export function RecipeReviewRow({
  line,
  options,
  createLabel,
  onChange,
}: {
  line: ReviewLine;
  options: IngredientOption[];
  /** Label for the "create «X»" option, e.g. `crea «Tartufo»`. */
  createLabel: (name: string) => string;
  onChange: (next: ReviewLine) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={line.include}
        onChange={(e) => onChange({ ...line, include: e.target.checked })}
        className="w-4 h-4 shrink-0 cursor-pointer accent-[#c4956a]"
        aria-label="include"
      />
      <select
        value={line.chosenId}
        onChange={(e) => onChange({ ...line, chosenId: e.target.value })}
        disabled={!line.include}
        className="flex-1 min-w-0 px-2 py-1.5 text-sm border-2 rounded text-black bg-white cursor-pointer disabled:opacity-50"
        style={{ borderColor: "#c4956a" }}
      >
        <option value="">{createLabel(line.match.proposalName || line.suggestedName)}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={line.qty}
        onChange={(e) => onChange({ ...line, qty: Number(e.target.value.replace(",", ".")) || 0 })}
        disabled={!line.include}
        className="w-20 px-2 py-1.5 text-sm border-2 rounded text-black disabled:opacity-50"
        style={{ borderColor: "#c4956a" }}
        aria-label="qty"
      />
      <span className="w-8 text-xs text-black shrink-0">{line.unit}</span>
    </div>
  );
}
