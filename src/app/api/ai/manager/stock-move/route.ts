import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { assertManagement } from "@/lib/billing/guard";
import { verifiedStaffPhone } from "@/lib/ai/manager-auth";

// Warehouse movement from WhatsApp ("sono arrivati 20 kg di farina"). The bot
// asks CONFERMA before calling this, so by the time we're here the manager has
// confirmed. We match the ingredient by name and post a stock movement; the DB
// trigger tops up ingredients.stock_qty. Writes are audited by the movement row
// itself (reason 'whatsapp').
//
// Auth: x-ai-secret + a verified staff phone of the tenant + the gestionale add-on.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const unauth = assertAiSecret(req);
  if (unauth) return unauth;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_body" }, { status: 400 }); }
  const tenantId: string | undefined = body?.tenant_id;
  const phone: string | undefined = body?.phone;
  const ingredientName: string = String(body?.ingredient || "").trim();
  const qty = Number(body?.qty);
  const kind: string = body?.kind === "waste" || body?.kind === "adjustment" ? body.kind : "receipt";
  if (!tenantId || !phone || !ingredientName || !Number.isFinite(qty) || qty === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const gate = await assertManagement(tenantId, svc);
  if (gate) return gate;

  const staff = await verifiedStaffPhone(svc as any, tenantId, phone);
  if (!staff) return NextResponse.json({ error: "not_staff" }, { status: 403 });

  const { data: matches } = await svc
    .from("ingredients")
    .select("id, name, unit, stock_qty")
    .eq("tenant_id", tenantId)
    .eq("archived", false)
    .ilike("name", `%${ingredientName}%`)
    .limit(2);
  const list = (matches || []) as Array<{ id: string; name: string; unit: string; stock_qty: number }>;
  if (list.length === 0) return NextResponse.json({ found: false });
  if (list.length > 1) return NextResponse.json({ found: false, ambiguous: list.map((m) => m.name) });

  const ing = list[0];
  // waste/adjustment reduce; receipt adds. Movement delta signed accordingly.
  const delta = kind === "waste" ? -Math.abs(qty) : qty;
  const { error } = await svc.from("stock_movements").insert({
    tenant_id: tenantId,
    ingredient_id: ing.id,
    qty_delta: delta,
    kind: kind === "waste" ? "waste" : kind === "adjustment" ? "adjustment" : "receipt",
    reason: "whatsapp",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    ingredient: ing.name,
    unit: ing.unit,
    delta,
    new_stock: Math.round((Number(ing.stock_qty) + delta) * 1000) / 1000,
  });
}
