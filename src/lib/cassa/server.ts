// Server-side shared bits for the /api/cassa routes: one auth+entitlement
// gate and one authoritative totals-recompute, so the seven routes can't drift.
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership, type TenantRole } from "@/lib/tenant-membership";
import { assertManagement } from "@/lib/billing/guard";
import { computeTotals, type CassaTotals } from "./totals";
import type { CassaOrderItemRow, CassaOrderRow } from "./types";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export interface CassaAccess {
  svc: ServiceClient;
  userId: string;
  role: TenantRole;
}

/**
 * The gate every cassa route passes: session member of the tenant (optionally
 * with one of `roles`) AND the gestionale add-on active. Returns the ready
 * service client on success, or the error NextResponse to bubble straight up.
 * Same fail-closed posture as the other management routes.
 */
export async function requireCassaAccess(
  tenantId: string | null | undefined,
  roles?: TenantRole[],
): Promise<CassaAccess | NextResponse> {
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  const member = await verifyTenantMembership(tenantId, roles);
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceRoleClient();
  const gate = await assertManagement(tenantId, svc);
  if (gate) return gate;
  return { svc, userId: member.userId, role: member.role };
}

export function isAccess(x: CassaAccess | NextResponse): x is CassaAccess {
  return !(x instanceof NextResponse);
}

/** Load an order with its lines; null when it doesn't exist. */
export async function loadOrder(
  svc: ServiceClient,
  orderId: string,
): Promise<{ order: CassaOrderRow; items: CassaOrderItemRow[] } | null> {
  const { data: order } = await svc
    .from("cassa_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;
  const { data: items } = await svc
    .from("cassa_order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  return { order: order as CassaOrderRow, items: (items || []) as CassaOrderItemRow[] };
}

/**
 * Recompute subtotal/total from the CURRENT lines and persist them on the
 * order. The client never sends totals — it sends facts (lines, covers,
 * discount) and this is the only place money gets derived.
 */
export async function recomputeOrder(
  svc: ServiceClient,
  order: CassaOrderRow,
  items: CassaOrderItemRow[],
): Promise<CassaTotals> {
  const totals = computeTotals(order, items);
  await svc
    .from("cassa_orders")
    .update({
      subtotal: totals.subtotal,
      total: totals.total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  return totals;
}

/** The tenant's coperto (per person) from settings.cassa.cover_charge. */
export async function getCassaSettings(
  svc: ServiceClient,
  tenantId: string,
): Promise<{ coverCharge: number; timezone: string }> {
  const { data } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const settings = (data?.settings || {}) as Record<string, any>;
  const raw = Number(settings?.cassa?.cover_charge);
  return {
    coverCharge: Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0,
    timezone: typeof settings?.timezone === "string" ? settings.timezone : "Europe/Rome",
  };
}
