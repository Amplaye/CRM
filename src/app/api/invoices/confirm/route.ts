import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertManagement } from "@/lib/billing/guard";

// Confirm a parsed supplier invoice. The owner may have edited line values and
// mapped lines to ingredients. For every line that carries an ingredient_id we
// INSERT a row into ingredient_cost_history with the line's unit price — the DB
// trigger (fn_apply_ingredient_cost) then updates ingredients.current_unit_cost
// (last-price-wins). The invoice flips to status 'confirmed'.
//
// Auth: signed-in dashboard user; RLS scopes everything to the tenant.

export const runtime = "nodejs";

type LineUpdate = {
  id: string;
  ingredient_id?: string | null;
  unit_price?: number | null;
  quantity?: number | null;
  description?: string | null;
};

type Body = {
  tenant_id: string;
  invoice_id: string;
  lines?: LineUpdate[]; // edits + ingredient mappings; omitted → confirm as-is
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.tenant_id !== "string" || typeof body.invoice_id !== "string") {
    return NextResponse.json({ error: "Missing tenant_id or invoice_id" }, { status: 400 });
  }

  // Paid add-on gate: confirming an invoice (writes ingredient costs) is gestionale.
  const gate = await assertManagement(body.tenant_id);
  if (gate) return gate;

  // Apply per-line edits + ingredient mappings.
  for (const l of body.lines || []) {
    if (!l.id) continue;
    const patch: Record<string, unknown> = {};
    if ("ingredient_id" in l) patch.ingredient_id = l.ingredient_id ?? null;
    if ("unit_price" in l) patch.unit_price = l.unit_price;
    if ("quantity" in l) patch.quantity = l.quantity;
    if ("description" in l && l.description != null) patch.description = l.description;
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("supplier_invoice_items")
        .update(patch)
        .eq("id", l.id)
        .eq("tenant_id", body.tenant_id);
    }
  }

  // Read back the lines that ended up mapped to an ingredient + have a price.
  const { data: lines, error: linesErr } = await supabase
    .from("supplier_invoice_items")
    .select("id, ingredient_id, unit_price")
    .eq("invoice_id", body.invoice_id)
    .eq("tenant_id", body.tenant_id);
  if (linesErr) {
    return NextResponse.json({ error: "Invoice not accessible", details: linesErr.message }, { status: 403 });
  }

  const costRows = (lines || [])
    .filter((l) => l.ingredient_id && l.unit_price != null)
    .map((l) => ({
      tenant_id: body.tenant_id,
      ingredient_id: l.ingredient_id,
      unit_cost: l.unit_price,
      source: "invoice" as const,
      invoice_item_id: l.id,
    }));

  let costsApplied = 0;
  if (costRows.length > 0) {
    // The AFTER INSERT trigger updates ingredients.current_unit_cost per row.
    const { error: histErr } = await supabase.from("ingredient_cost_history").insert(costRows);
    if (histErr) {
      return NextResponse.json({ error: "Failed to apply costs", details: histErr.message }, { status: 500 });
    }
    costsApplied = costRows.length;
  }

  const { error: statusErr } = await supabase
    .from("supplier_invoices")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", body.invoice_id)
    .eq("tenant_id", body.tenant_id);
  if (statusErr) {
    return NextResponse.json({ error: "Failed to confirm invoice", details: statusErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, costs_applied: costsApplied });
}
