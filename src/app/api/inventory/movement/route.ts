import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertManagement } from "@/lib/billing/guard";
import { deriveExpiry } from "@/lib/inventory/expiry";

// Record a stock movement (the audited write path for inventory). The trigger
// trg_apply_stock_movement keeps ingredients.stock_qty in sync, so we only INSERT
// the ledger row — never touch stock directly here.
//
//   receipt    goods in (+qty). May carry a unit_cost → updates ingredient cost.
//   count      physical count: qty is the COUNTED absolute; delta = counted − system.
//   waste      spoilage / breakage (−qty).
//   adjustment free signed correction (delta = qty, may be negative).
//
// On a receipt with a unit_cost, the observed price is written to
// ingredient_cost_history (price-history truth, trigger sets last-price-wins). If
// the tenant's cost method is 'avg', current_unit_cost is then overwritten with
// the weighted average of the pre-receipt stock and the new goods.
//
// Body: { ingredient_id, kind, qty, unit_cost?, reason? }
// Returns: { ok, kind, qty_delta, new_unit_cost? }
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const ingredientId: string | undefined = body?.ingredient_id || undefined;
  const kind: string | undefined = body?.kind;
  const qty = body?.qty == null ? NaN : Number(body.qty);
  const unitCost = body?.unit_cost == null ? null : Number(body.unit_cost);
  const reason: string | null = typeof body?.reason === "string" ? body.reason.slice(0, 200) : null;

  if (!ingredientId) return NextResponse.json({ error: "ingredient_id_required" }, { status: 400 });
  if (!kind || !["receipt", "count", "waste", "adjustment"].includes(kind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (!Number.isFinite(qty)) return NextResponse.json({ error: "invalid_qty" }, { status: 400 });
  // receipt/count/waste take a non-negative magnitude; adjustment is signed.
  if (kind !== "adjustment" && qty < 0) return NextResponse.json({ error: "invalid_qty" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data: ing } = await svc
    .from("ingredients")
    .select("id, tenant_id, stock_qty, current_unit_cost, shelf_life_days")
    .eq("id", ingredientId)
    .maybeSingle();
  if (!ing) return NextResponse.json({ error: "ingredient_not_found" }, { status: 404 });

  const auth = await authorizeTenant(ing.tenant_id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }
  const gate = await assertManagement(ing.tenant_id, svc);
  if (gate) return gate;

  const stock = Number(ing.stock_qty);
  const curCost = Number(ing.current_unit_cost);

  let qtyDelta: number;
  if (kind === "receipt") qtyDelta = qty;
  else if (kind === "waste") qtyDelta = -qty;
  else if (kind === "count") qtyDelta = qty - stock; // qty is the counted absolute
  else qtyDelta = qty; // adjustment: signed

  // Cost update on a priced receipt: observed price → history (last-price-wins via
  // trigger); then weighted-average overwrite when the tenant prefers it.
  let newUnitCost: number | undefined;
  if (kind === "receipt" && unitCost != null && Number.isFinite(unitCost) && unitCost >= 0) {
    await svc.from("ingredient_cost_history").insert({
      tenant_id: ing.tenant_id,
      ingredient_id: ingredientId,
      unit_cost: unitCost,
      source: "manual",
    });
    newUnitCost = unitCost;
    const { data: tenant } = await svc.from("tenants").select("settings").eq("id", ing.tenant_id).maybeSingle();
    const method = (tenant?.settings as any)?.management?.cost_method ?? "last";
    if (method === "avg" && stock + qty > 0) {
      const weighted = Math.round(((stock * curCost + qty * unitCost) / (stock + qty)) * 10000) / 10000;
      await svc.from("ingredients").update({ current_unit_cost: weighted, updated_at: new Date().toISOString() }).eq("id", ingredientId);
      newUnitCost = weighted;
    }
  }

  const { error: movErr } = await svc.from("stock_movements").insert({
    tenant_id: ing.tenant_id,
    ingredient_id: ingredientId,
    qty_delta: qtyDelta,
    kind,
    reason,
    unit_cost: newUnitCost ?? curCost,
  });
  if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 });

  // Auto-expiry: fresh goods in → push the expiry to (today + shelf life) when the
  // ingredient carries a shelf life. Single per-ingredient date, so a receipt always
  // sets the freshest batch's expiry (best we can do without per-lot tracking).
  // A received batch with a shelf life becomes a lot; the stock_lots trigger
  // refreshes ingredients.expiry_date to the earliest open lot.
  let newExpiry: string | undefined;
  if (kind === "receipt") {
    const derived = deriveExpiry(new Date(), ing.shelf_life_days);
    if (derived) {
      newExpiry = derived;
      await svc.from("stock_lots").insert({
        tenant_id: ing.tenant_id,
        ingredient_id: ingredientId,
        qty,
        expiry_date: derived,
        source: "manual",
      });
    }
  }

  return NextResponse.json({ ok: true, kind, qty_delta: qtyDelta, new_unit_cost: newUnitCost, expiry_date: newExpiry });
}
