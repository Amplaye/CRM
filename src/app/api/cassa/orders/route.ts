import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, getCassaSettings } from "@/lib/cassa/server";

// The native cassa's order collection.
//
// GET  /api/cassa/orders?tenant_id=…&scope=open            → live bills (with lines)
// GET  /api/cassa/orders?tenant_id=…&scope=day&date=YYYY-MM-DD
//                                                          → the day's receipts (paid+void, with lines+payments)
// POST /api/cassa/orders  { tenant_id, table_id?, table_name, channel?, covers? }
//                                                          → open a new bill (or hand back the
//                                                            table's existing open one)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id");
  const scope = url.searchParams.get("scope") || "open";

  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc } = access;

  if (scope === "day") {
    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "invalid_date" }, { status: 400 });
    }
    const { data, error } = await svc
      .from("cassa_orders")
      .select("*, items:cassa_order_items(*), payments:cassa_payments(*)")
      .eq("tenant_id", tenantId!)
      .in("status", ["paid", "void"])
      .eq("receipt_date", date)
      .order("receipt_number", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data || [] });
  }

  const { data, error } = await svc
    .from("cassa_orders")
    .select("*, items:cassa_order_items(*)")
    .eq("tenant_id", tenantId!)
    .eq("status", "open")
    .order("opened_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data || [] });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  const tableId: string | null = typeof body?.table_id === "string" ? body.table_id : null;
  const tableName: string = typeof body?.table_name === "string" ? body.table_name.slice(0, 80) : "";
  const channel: string = ["sala", "asporto", "delivery"].includes(body?.channel) ? body.channel : "sala";
  const covers = Math.max(0, Math.min(500, Math.round(Number(body?.covers) || 0)));
  if (!tableName) return NextResponse.json({ error: "table_name_required" }, { status: 400 });

  // One live bill per table: tapping an occupied table RESUMES its order
  // instead of silently opening a second one (the second-bill flow is explicit
  // via a null table_id counter sale).
  if (tableId) {
    const { data: existing } = await svc
      .from("cassa_orders")
      .select("*, items:cassa_order_items(*)")
      .eq("tenant_id", tenantId!)
      .eq("table_id", tableId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (existing) return NextResponse.json({ order: existing, existing: true });
  }

  const { coverCharge } = await getCassaSettings(svc, tenantId!);

  // Waiter identity for the ticket header ("aperto da").
  const { data: profile } = await svc.from("users").select("name").eq("id", userId).maybeSingle();

  const { data: order, error } = await svc
    .from("cassa_orders")
    .insert({
      tenant_id: tenantId,
      table_id: tableId,
      table_name: tableName,
      channel,
      covers: channel === "sala" ? covers : 0,
      cover_unit: channel === "sala" ? coverCharge : 0,
      opened_by: userId,
      opened_by_name: profile?.name || null,
    })
    .select("*, items:cassa_order_items(*)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ order, existing: false });
}
