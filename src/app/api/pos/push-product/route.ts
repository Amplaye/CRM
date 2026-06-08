import { NextResponse } from "next/server";
import { authorizeTenant, resolveTill, notConnected, notSupported, type PosOutcome } from "@/lib/pos/write-back";
import { createServiceRoleClient } from "@/lib/supabase/server";

// CRM → POS product write-back: CREATE a new dish or RENAME an existing one, and
// keep the till in step. The whole point of "manage everything from the CRM":
// the owner adds/renames a dish here and it appears/updates on the connected till
// without opening the POS.
//
// Two modes by body:
//   • CREATE  { tenant_id, name, price?, category? }  → insert menu_items, then
//     create the product on the till; persist the returned till id as the dish's
//     pos_external_product_id so future price/stock writes target it.
//   • RENAME  { menu_item_id, name, category? }       → update menu_items.name,
//     then rename the product on the till (if the dish is linked).
//
// User-authenticated (cookie) + ownership-checked, exactly like /api/pos/push-price.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const menuItemId: string | undefined = body?.menu_item_id || undefined;
  const tenantIdIn: string | undefined = body?.tenant_id || undefined;
  const category: string | null = typeof body?.category === "string" ? body.category : null;
  const price = body?.price == null ? null : Number(body.price);
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    return NextResponse.json({ error: "invalid_price" }, { status: 400 });
  }

  const svc = createServiceRoleClient();

  // ---- RENAME an existing dish ----------------------------------------------
  if (menuItemId) {
    const { data: dish } = await svc
      .from("menu_items")
      .select("id, tenant_id, name, pos_external_product_id")
      .eq("id", menuItemId)
      .maybeSingle();
    if (!dish) return NextResponse.json({ error: "menu_item_not_found" }, { status: 404 });

    const auth = await authorizeTenant(dish.tenant_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
    }

    const { error: upErr } = await svc
      .from("menu_items")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", menuItemId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const pos = await pushRename(dish.tenant_id, dish.pos_external_product_id, name, category);
    return NextResponse.json({ ok: true, crmUpdated: true, menu_item_id: menuItemId, pos });
  }

  // ---- CREATE a new dish -----------------------------------------------------
  if (!tenantIdIn) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  const auth = await authorizeTenant(tenantIdIn);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  // Insert the dish in the CRM first (the CRM is the source of truth for the menu).
  const { data: created, error: insErr } = await svc
    .from("menu_items")
    .insert({ tenant_id: tenantIdIn, name, price, available: true })
    .select("id")
    .single();
  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message || "insert_failed" }, { status: 500 });
  }

  // Create it on the till; on success persist the till id onto the new dish.
  const till = await resolveTill(svc, tenantIdIn);
  let pos: PosOutcome;
  if (!till.ctx) {
    pos = notConnected(till.provider);
  } else if (typeof till.adapter.pushProduct !== "function") {
    pos = notSupported();
  } else {
    pos = { attempted: true, ok: false, detail: "" };
    try {
      const r = await till.adapter.pushProduct(till.ctx, { name, price, category });
      pos.ok = r.ok;
      pos.detail = r.detail || (r.ok ? "Prodotto creato sulla cassa." : "Creazione sulla cassa non riuscita.");
      if (r.ok && r.externalProductId) {
        await svc
          .from("menu_items")
          .update({ pos_external_product_id: r.externalProductId })
          .eq("id", created.id);
      }
    } catch (e: any) {
      pos.ok = false;
      pos.detail = `Errore cassa: ${e?.message || e}`;
    }
  }

  return NextResponse.json({ ok: true, crmUpdated: true, menu_item_id: created.id, pos });
}

// Push a rename to the till (best-effort). Unlinked dish → reported, not an error.
async function pushRename(
  tenantId: string,
  externalProductId: string | null,
  name: string,
  category: string | null,
): Promise<PosOutcome> {
  const svc = createServiceRoleClient();
  const till = await resolveTill(svc, tenantId);
  if (!till.ctx) return notConnected(till.provider);
  if (typeof till.adapter.pushProduct !== "function") return notSupported();
  if (!externalProductId) {
    return { attempted: false, ok: false, detail: "Piatto non collegato alla cassa (verrà collegato al prossimo sync)." };
  }
  try {
    const r = await till.adapter.pushProduct(till.ctx, { externalProductId, name, category });
    return {
      attempted: true,
      ok: r.ok,
      detail: r.detail || (r.ok ? "Nome aggiornato sulla cassa." : "Aggiornamento sulla cassa non riuscito."),
    };
  } catch (e: any) {
    return { attempted: true, ok: false, detail: `Errore cassa: ${e?.message || e}` };
  }
}
