"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedLine } from "@/lib/management/recipe-suggest";
import { convertQty } from "@/lib/management/units";

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

/**
 * Wrap the route's ResolvedLine[] into editable review lines.
 *
 * Accept-by-default ONLY the lines the AI snapped onto a REAL warehouse
 * ingredient (confidence high/medium → a concrete ingredientId). Lines that
 * would create a brand-new ingredient (confidence "none") start UNCHECKED: they
 * are the AI's guesses, and a guessed ingredient lands in the warehouse at cost
 * 0 and silently skews food cost. So "Salva tutte" never writes a phantom
 * ingredient the owner didn't deliberately tick — this is the fix for the AI
 * inventing whole recipes when the menu doesn't match the stock.
 */
export function toReviewLines(lines: ResolvedLine[]): ReviewLine[] {
  return lines.map((l) => ({
    ...l,
    include: l.match.ingredientId != null,
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
  matchedLabel = "in magazzino",
  newLabel = "nuovo",
  onChange,
}: {
  line: ReviewLine;
  options: IngredientOption[];
  /** Label for the "create «X»" option, e.g. `crea «Tartufo»`. */
  createLabel: (name: string) => string;
  /** Badge for a line snapped onto a real warehouse ingredient. */
  matchedLabel?: string;
  /** Badge for a line that would create a brand-new (guessed) ingredient. */
  newLabel?: string;
  onChange: (next: ReviewLine) => void;
}) {
  // The badge tracks the CURRENT choice, not the original AI match: pick a real
  // ingredient from the select and the "new" tag flips to "in magazzino" live.
  const isNew = line.chosenId === "";
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={line.include}
        onChange={(e) => onChange({ ...line, include: e.target.checked })}
        className="w-4 h-4 shrink-0 cursor-pointer accent-[#c4956a]"
        aria-label="include"
      />
      <span
        className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
        style={isNew
          ? { background: "rgba(217,119,6,0.12)", color: "#b45309" }
          : { background: "rgba(5,150,105,0.12)", color: "#047857" }}
        title={isNew ? line.suggestedName : undefined}
      >
        {isNew ? newLabel : matchedLabel}
      </span>
      <select
        value={line.chosenId}
        onChange={(e) => {
          // Re-point the line at another ingredient — and carry the quantity
          // ACROSS units. A "100 g" line moved onto an ingredient stocked in kg
          // must become 0.1, never stay 100 (that would be 100 kg in the dish).
          const id = e.target.value;
          const nextUnit = id
            ? (options.find((o) => o.id === id)?.unit ?? line.unit)
            : line.match.proposalUnit;
          const converted = convertQty(line.qty, line.unit, nextUnit);
          onChange({
            ...line,
            chosenId: id,
            unit: nextUnit,
            // Incompatible dimensions (ml → kg) can't be converted without a
            // density: keep the number and let the owner fix it.
            qty: converted != null ? Math.round(converted * 1e6) / 1e6 : line.qty,
          });
        }}
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
