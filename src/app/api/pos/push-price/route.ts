import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/pos/registry";
import { decryptCredentials } from "@/lib/pos/credentials";
import { getPosProvider } from "@/lib/pos/pos-provider";
import { verifyTenantMembership } from "@/lib/tenant-membership";

// CRM → POS price write-back. The owner changes a dish price in the CRM; we
// update menu_items.price (the CRM's own copy) AND push it to the connected till
// so the two never drift — the whole point of "manage everything from the CRM,
// never open the POS". User-authenticated (cookie) + ownership-checked, unlike
// /api/pos/sync which is a server-to-server secret route.
//
// Body: { menu_item_id: string, price: number }
// Returns: { ok, crmUpdated, pos: { attempted, ok, detail } }
export async function POST(req: Request) {
  // 1) Auth: who is calling? (membership is checked per-tenant below, once we know
  //    which dish — and therefore which tenant — is being edited.)
  const authClient = await createServerSupabaseClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let menuItemId: string | undefined;
  let price: number | undefined;
  try {
    const body = await req.json();
    menuItemId = body?.menu_item_id;
    price = typeof body?.price === "number" ? body.price : Number(body?.price);
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!menuItemId || price == null || !Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: "menu_item_id and a valid price are required" }, { status: 400 });
  }

  // 2) Resolve the dish + its tenant with the service role, then prove the caller
  //    is a member of that tenant (the ferrous ownership check).
  const svc = createServiceRoleClient();
  const { data: dish } = await svc
    .from("menu_items")
    .select("id, tenant_id, name, pos_external_product_id")
    .eq("id", menuItemId)
    .maybeSingle();
  if (!dish) return NextResponse.json({ error: "menu_item_not_found" }, { status: 404 });

  // Member OR platform admin (incl. impersonating from the admin panel).
  const allowed = await verifyTenantMembership(dish.tenant_id);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 3) Update the CRM's own price first (source of truth for food cost / menu).
  const { error: upErr } = await svc
    .from("menu_items")
    .update({ price, updated_at: new Date().toISOString() })
    .eq("id", menuItemId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // 4) Push to the till — best-effort, and only when this tenant actually has a
  //    real connection whose adapter supports writing. A mock/read-only/unlinked
  //    tenant still succeeds on the CRM side; we just report pos.attempted=false.
  const pos = { attempted: false, ok: false, detail: "" as string };

  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", dish.tenant_id).maybeSingle();
  const provider = getPosProvider(tenant?.settings as any);
  const adapter = getAdapter(provider);

  if (provider !== "mock" && typeof adapter.pushProductPrice === "function") {
    if (!dish.pos_external_product_id) {
      pos.detail = "Piatto non ancora collegato a un prodotto della cassa (verrà collegato al prossimo sync).";
    } else {
      const { data: conn } = await svc
        .from("pos_connections")
        .select("id, config")
        .eq("tenant_id", dish.tenant_id)
        .eq("provider", provider)
        .eq("active", true)
        .maybeSingle();
      if (!conn) {
        pos.detail = "Nessuna connessione cassa attiva.";
      } else {
        pos.attempted = true;
        try {
          const credentials = await decryptCredentials(svc, conn.id);
          const result = await adapter.pushProductPrice(
            { tenantId: dish.tenant_id, credentials, config: (conn.config as any) || {} },
            { externalProductId: dish.pos_external_product_id, price },
          );
          pos.ok = result.ok;
          pos.detail = result.detail || (result.ok ? "Prezzo inviato alla cassa." : "Invio alla cassa non riuscito.");
        } catch (e: any) {
          pos.ok = false;
          pos.detail = `Errore cassa: ${e?.message || e}`;
        }
      }
    }
  } else {
    pos.detail = provider === "mock" ? "Cassa demo: nessun invio." : "Questa cassa non supporta ancora la scrittura.";
  }

  return NextResponse.json({ ok: true, crmUpdated: true, pos });
}
