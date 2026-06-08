import { NextResponse } from "next/server";
import { authorizeTenant, resolveTill, notConnected, notSupported, type PosOutcome } from "@/lib/pos/write-back";
import { createServiceRoleClient } from "@/lib/supabase/server";

// CRM → POS stock write-back. The owner corrects an ingredient's on-hand quantity
// in the editable Magazzino; we save it to ingredients.stock_qty (the CRM's own
// stock) AND, when the ingredient is linked to a sellable till product
// (ingredients.pos_external_product_id), push the new absolute level to the till's
// inventory — so the two never drift. User-authenticated + ownership-checked.
//
// Body: { ingredient_id: string, stock_qty: number }
// Returns: { ok, crmUpdated, pos: { attempted, ok, detail } }
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const ingredientId: string | undefined = body?.ingredient_id || undefined;
  const stockQty = body?.stock_qty == null ? NaN : Number(body.stock_qty);
  if (!ingredientId) return NextResponse.json({ error: "ingredient_id_required" }, { status: 400 });
  if (!Number.isFinite(stockQty) || stockQty < 0) {
    return NextResponse.json({ error: "invalid_stock_qty" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: ing } = await svc
    .from("ingredients")
    .select("id, tenant_id, name, pos_external_product_id")
    .eq("id", ingredientId)
    .maybeSingle();
  if (!ing) return NextResponse.json({ error: "ingredient_not_found" }, { status: 404 });

  const auth = await authorizeTenant(ing.tenant_id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  // CRM stock is the source of truth for the warehouse; save it first.
  const { error: upErr } = await svc
    .from("ingredients")
    .update({ stock_qty: stockQty, updated_at: new Date().toISOString() })
    .eq("id", ingredientId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Push to the till only when this ingredient is linked to a till product.
  let pos: PosOutcome;
  const till = await resolveTill(svc, ing.tenant_id);
  if (!ing.pos_external_product_id) {
    pos = { attempted: false, ok: false, detail: "Ingrediente non collegato a un prodotto della cassa." };
  } else if (!till.ctx) {
    pos = notConnected(till.provider);
  } else if (typeof till.adapter.pushStock !== "function") {
    pos = notSupported();
  } else {
    pos = { attempted: true, ok: false, detail: "" };
    try {
      const r = await till.adapter.pushStock(till.ctx, {
        externalProductId: ing.pos_external_product_id,
        quantity: stockQty,
      });
      pos.ok = r.ok;
      pos.detail = r.detail || (r.ok ? "Giacenza inviata alla cassa." : "Invio alla cassa non riuscito.");
    } catch (e: any) {
      pos.ok = false;
      pos.detail = `Errore cassa: ${e?.message || e}`;
    }
  }

  return NextResponse.json({ ok: true, crmUpdated: true, pos });
}
