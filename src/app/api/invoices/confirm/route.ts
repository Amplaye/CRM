import { NextRequest, NextResponse } from "next/server";
import { assertManagement } from "@/lib/billing/guard";
import { deriveExpiry } from "@/lib/inventory/expiry";
import { suggestShelfLife } from "@/lib/inventory/shelf-life-presets";
import { authorizeInvoiceRequest } from "@/lib/ai/manager-auth";

// Confirm a parsed supplier invoice. The owner may have edited line values and
// mapped lines to ingredients. For every line that carries an ingredient_id we
// INSERT a row into ingredient_cost_history with the line's unit price — the DB
// trigger (fn_apply_ingredient_cost) then updates ingredients.current_unit_cost
// (last-price-wins). The invoice flips to status 'confirmed'.
//
// When receive_stock is on, goods also land in the warehouse as 'receipt'
// movements, and two automations mirror the manual receipt path:
//   • weighted-average costing — if the tenant's cost_method is 'avg', the new
//     goods blend into the average instead of overwriting with the last price;
//   • auto-expiry — ingredients with a shelf_life_days get expiry_date stamped as
//     (invoice date + shelf life), so the owner never types a date.
//
// Auth: signed-in dashboard user; RLS scopes everything to the tenant.

export const runtime = "nodejs";

type LineUpdate = {
  id: string;
  ingredient_id?: string | null;
  unit_price?: number | null;
  quantity?: number | null;
  description?: string | null;
  /** Create a brand-new warehouse ingredient for this line and map to it — the
   * "the warehouse builds itself from invoices" path. Ignored when the line
   * already carries an ingredient_id. */
  create_ingredient?: { name: string; unit: string } | null;
};

type Body = {
  tenant_id: string;
  invoice_id: string;
  /** WhatsApp bot path only: the verified staff number driving the confirm. */
  phone?: string;
  lines?: LineUpdate[]; // edits + ingredient mappings; omitted → confirm as-is
  /** When true, every mapped line with a quantity is also carried into stock as a
   * 'receipt' movement (the invoices → warehouse seam), once each (received_at). */
  receive_stock?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.tenant_id !== "string" || typeof body.invoice_id !== "string") {
    return NextResponse.json({ error: "Missing tenant_id or invoice_id" }, { status: 400 });
  }

  // Dashboard user (RLS) OR the WhatsApp bot on behalf of a verified staff member
  // (x-ai-secret + service-role). Same pipeline either way.
  const auth = await authorizeInvoiceRequest(req, body.tenant_id, body.phone);
  if ("error" in auth) return auth.error;
  const supabase = auth.supabase;

  // Paid add-on gate: confirming an invoice (writes ingredient costs) is gestionale.
  const gate = await assertManagement(body.tenant_id);
  if (gate) return gate;

  // The invoice header carries the supplier — stamped onto auto-created
  // ingredients so the reorder list can group by supplier from day one.
  const { data: invoiceHeader } = await supabase
    .from("supplier_invoices")
    .select("supplier_name, invoice_date")
    .eq("id", body.invoice_id)
    .eq("tenant_id", body.tenant_id)
    .maybeSingle();

  // Auto-create requested ingredients (dedup by name within this request, so two
  // lines of the same product don't create twins).
  let ingredientsCreated = 0;
  const createdByName = new Map<string, string>();
  for (const l of body.lines || []) {
    if (!l.id || l.ingredient_id || !l.create_ingredient) continue;
    const name = (l.create_ingredient.name || "").trim().slice(0, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    let newId = createdByName.get(key);
    if (!newId) {
      const { data: created, error: createErr } = await supabase
        .from("ingredients")
        .insert({
          tenant_id: body.tenant_id,
          name,
          unit: (l.create_ingredient.unit || "pz").trim().slice(0, 10) || "pz",
          current_unit_cost: 0, // the cost-history insert below sets the real price
          stock_qty: 0,
          par_level: 0,
          // Seed a typical shelf life from the product name so auto-expiry works
          // from the first delivery (owner can override). Null when unknown.
          shelf_life_days: suggestShelfLife(name),
          supplier_name: invoiceHeader?.supplier_name || null,
          archived: false,
        })
        .select("id")
        .single();
      if (createErr || !created) continue; // line simply stays unmapped
      newId = created.id as string;
      createdByName.set(key, newId);
      ingredientsCreated++;
    }
    l.ingredient_id = newId;
  }

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
    .select("id, ingredient_id, unit_price, quantity, received_at, kind, line_total")
    .eq("invoice_id", body.invoice_id)
    .eq("tenant_id", body.tenant_id);
  if (linesErr) {
    return NextResponse.json({ error: "Invoice not accessible", details: linesErr.message }, { status: 403 });
  }

  // Only 'goods' lines touch the warehouse/costs. A service or charge line
  // (noleggio RT, canone, trasporto) must never create ingredients, cost history,
  // stock or lots — even if it somehow carries an ingredient_id. Unclassified
  // (null kind, older rows) is treated as goods, matching the conservative default.
  const isGoodsLine = (l: any) => l.kind !== "service" && l.kind !== "charge";

  // Split the invoice value into merce vs servizi/attrezzature for the P&L header,
  // so a service invoice lands in operating costs, not in food purchases.
  let goodsTotal = 0;
  let serviceTotal = 0;
  for (const l of lines || []) {
    const amt = Number((l as any).line_total ?? 0) || 0;
    if (isGoodsLine(l)) goodsTotal += amt;
    else serviceTotal += amt;
  }
  goodsTotal = Math.round(goodsTotal * 100) / 100;
  serviceTotal = Math.round(serviceTotal * 100) / 100;

  // Lines that will carry stock in: goods only, mapped, positive qty, not received.
  const toReceive = (lines || []).filter(
    (l) => isGoodsLine(l) && l.ingredient_id && l.quantity != null && Number(l.quantity) > 0 && !l.received_at,
  );

  // Costing method + per-ingredient snapshots taken BEFORE we touch stock/cost.
  // 'avg' needs pre-receipt stock+cost to blend the new goods into the average
  // (mirrors the manual receipt path); shelf_life_days drives auto-expiry. Both
  // only matter when goods are actually received.
  let costMethod = "last";
  const preReceipt = new Map<string, { stock: number; cost: number; shelfLife: number | null }>();
  if (body.receive_stock && toReceive.length > 0) {
    const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", body.tenant_id).maybeSingle();
    costMethod = (tenant?.settings as any)?.management?.cost_method === "avg" ? "avg" : "last";
    const recvIds = [...new Set(toReceive.map((l) => l.ingredient_id as string))];
    const { data: snaps } = await supabase
      .from("ingredients")
      .select("id, stock_qty, current_unit_cost, shelf_life_days")
      .in("id", recvIds)
      .eq("tenant_id", body.tenant_id);
    for (const s of snaps || []) {
      preReceipt.set(s.id, {
        stock: Number(s.stock_qty),
        cost: Number(s.current_unit_cost),
        shelfLife: s.shelf_life_days == null ? null : Number(s.shelf_life_days),
      });
    }
  }

  const costRows = (lines || [])
    .filter((l) => isGoodsLine(l) && l.ingredient_id && l.unit_price != null)
    .map((l) => ({
      tenant_id: body.tenant_id,
      ingredient_id: l.ingredient_id,
      unit_cost: l.unit_price,
      source: "invoice" as const,
      invoice_item_id: l.id,
    }));

  let costsApplied = 0;
  if (costRows.length > 0) {
    // The AFTER INSERT trigger updates ingredients.current_unit_cost per row (last-price).
    const { error: histErr } = await supabase.from("ingredient_cost_history").insert(costRows);
    if (histErr) {
      return NextResponse.json({ error: "Failed to apply costs", details: histErr.message }, { status: 500 });
    }
    costsApplied = costRows.length;
  }

  // Carry goods into stock (the invoices → warehouse seam). For every mapped line
  // with a quantity not yet received, insert a 'receipt' movement (the trigger
  // tops up ingredients.stock_qty) and stamp received_at so a re-confirm can't
  // double-receive the same line.
  let stockReceived = 0;
  let expiriesSet = 0;
  let costsAveraged = 0;
  if (body.receive_stock && toReceive.length > 0) {
    const nowIso = new Date().toISOString();
    const movements = toReceive.map((l) => ({
      tenant_id: body.tenant_id,
      ingredient_id: l.ingredient_id,
      qty_delta: Number(l.quantity),
      kind: "receipt" as const,
      reason: "invoice",
      unit_cost: l.unit_price ?? null,
      ref_id: l.id,
    }));
    const { error: movErr } = await supabase.from("stock_movements").insert(movements);
    if (!movErr) {
      await supabase
        .from("supplier_invoice_items")
        .update({ received_at: nowIso })
        .in("id", toReceive.map((l) => l.id))
        .eq("tenant_id", body.tenant_id);
      stockReceived = toReceive.length;

      // Weighted-average costing on the invoice path (only when the tenant asked
      // for it): blend pre-receipt stock@cost with the incoming qty@price. Unpriced
      // received qty is left out of both sides so it can't skew the average.
      if (costMethod === "avg") {
        const incoming = new Map<string, { qty: number; value: number }>();
        for (const l of toReceive) {
          if (l.unit_price == null) continue;
          const price = Number(l.unit_price);
          if (!Number.isFinite(price)) continue;
          const qty = Number(l.quantity);
          const cur = incoming.get(l.ingredient_id as string) || { qty: 0, value: 0 };
          cur.qty += qty;
          cur.value += qty * price;
          incoming.set(l.ingredient_id as string, cur);
        }
        for (const [ingId, inc] of incoming) {
          const snap = preReceipt.get(ingId);
          if (!snap || inc.qty <= 0) continue;
          const denom = snap.stock + inc.qty;
          if (denom <= 0) continue;
          const weighted = Math.round(((snap.stock * snap.cost + inc.value) / denom) * 10000) / 10000;
          const { error: avgErr } = await supabase
            .from("ingredients")
            .update({ current_unit_cost: weighted, updated_at: nowIso })
            .eq("id", ingId)
            .eq("tenant_id", body.tenant_id);
          if (!avgErr) costsAveraged++;
        }
      }

      // Auto-expiry via lots: each received line with a shelf life becomes a lot
      // (a delivered batch), expiry = invoice date + shelf life. The stock_lots
      // trigger keeps ingredients.expiry_date = earliest open lot. Falls back to
      // today when the document carried no date.
      const expiryBase = invoiceHeader?.invoice_date || nowIso.slice(0, 10);
      const lotRows = [];
      for (const l of toReceive) {
        const derived = deriveExpiry(expiryBase, preReceipt.get(l.ingredient_id as string)?.shelfLife ?? null);
        if (!derived) continue;
        lotRows.push({
          tenant_id: body.tenant_id,
          ingredient_id: l.ingredient_id,
          qty: Number(l.quantity),
          expiry_date: derived,
          received_on: expiryBase,
          source: "invoice" as const,
          ref_id: l.id,
        });
      }
      if (lotRows.length > 0) {
        const { error: lotErr } = await supabase.from("stock_lots").insert(lotRows);
        if (!lotErr) expiriesSet = lotRows.length;
      }
    }
  }

  const { error: statusErr } = await supabase
    .from("supplier_invoices")
    .update({
      status: "confirmed",
      goods_total: goodsTotal,
      service_total: serviceTotal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.invoice_id)
    .eq("tenant_id", body.tenant_id);
  if (statusErr) {
    return NextResponse.json({ error: "Failed to confirm invoice", details: statusErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    costs_applied: costsApplied,
    stock_received: stockReceived,
    ingredients_created: ingredientsCreated,
    costs_averaged: costsAveraged,
    expiries_set: expiriesSet,
    goods_total: goodsTotal,
    service_total: serviceTotal,
  });
}
