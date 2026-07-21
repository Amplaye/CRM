// Fill a tenant's warehouse with the default catalogue.
//
// Called at tenant creation (so a new restaurant lands on a usable Inventory /
// Food Cost page instead of an empty table), and re-runnable from the Inventory
// page for tenants that predate it.
//
// Idempotent by design: it only inserts names the tenant doesn't already have,
// so running it twice is a no-op and running it on a stocked warehouse tops it
// up without touching a single existing row's cost, stock or category. The
// `ingredients_name_per_tenant` unique constraint is the backstop.

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultIngredientsFor } from "./default-ingredients";

export interface SeedResult {
  inserted: number;
  skipped: number;
}

/** Normalised name key — matching is case/accent-insensitive so "Miele" and
 * "miele" never both land in the warehouse. */
function key(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function seedDefaultIngredients(
  supabase: SupabaseClient,
  tenantId: string,
  locale: string,
): Promise<SeedResult> {
  const wanted = defaultIngredientsFor(locale);

  const { data: existing, error: readError } = await supabase
    .from("ingredients")
    .select("name")
    .eq("tenant_id", tenantId);
  if (readError) throw new Error(`seed ingredients read: ${readError.message}`);

  const have = new Set((existing || []).map((r: { name: string }) => key(r.name)));
  const missing = wanted.filter((w) => !have.has(key(w.name)));

  if (missing.length === 0) return { inserted: 0, skipped: wanted.length };

  const { error: writeError } = await supabase.from("ingredients").insert(
    missing.map((m) => ({
      tenant_id: tenantId,
      name: m.name,
      unit: m.unit,
      category: m.category,
      // Cost/stock stay at 0 on purpose: an invented price silently produces a
      // plausible-looking wrong food cost, which is worse than a visible gap.
      current_unit_cost: 0,
      stock_qty: 0,
      par_level: 0,
    })),
  );
  if (writeError) throw new Error(`seed ingredients write: ${writeError.message}`);

  return { inserted: missing.length, skipped: wanted.length - missing.length };
}
