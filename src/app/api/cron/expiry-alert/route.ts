import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { sendPushToTenant } from "@/lib/push/send";
import { addDaysIso } from "@/lib/inventory/expiry";
import { logSystemEvent } from "@/lib/system-log";

// Daily expiring-stock alert.
//
// The inventory page already shows an "in scadenza" badge, but only if the owner
// opens it. This cron is the push: once a day it finds ingredients whose
// expiry_date is within EXPIRY_WINDOW_DAYS (or already past) and still in stock,
// and sends the owner/managers a single web-push per tenant so nothing rots
// unseen.
//
// Idempotency: each item is alerted once per its expiry_date, recorded in
// audit_events (action 'expiry_alert', idempotency_key expiry:<id>:<date>). A
// re-received batch gets a new expiry_date → a fresh alert; a lingering item is
// not re-nagged every day. The bot-engine Worker sends `Authorization: Bearer
// ${CRON_SECRET}`.

export const runtime = "nodejs";

// How many days ahead counts as "expiring soon". Matches the inventory UI badge.
const EXPIRY_WINDOW_DAYS = 3;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const limitDate = addDaysIso(new Date(), EXPIRY_WINDOW_DAYS);

  // Candidate stock across all tenants: has an expiry within the window, still
  // physically present, not archived.
  const { data: rows } = await supabase
    .from("ingredients")
    .select("id, tenant_id, name, expiry_date, stock_qty, tenants(settings)")
    .not("expiry_date", "is", null)
    .lte("expiry_date", limitDate)
    .gt("stock_qty", 0)
    .eq("archived", false);

  type Row = {
    id: string; tenant_id: string; name: string; expiry_date: string; stock_qty: number;
    tenants: { settings: TenantSettings | null } | null;
  };

  // Group the not-yet-alerted items by tenant (only management tenants).
  const freshByTenant = new Map<string, Row[]>();
  for (const r of (rows || []) as unknown as Row[]) {
    if (!getFeatures(r.tenants?.settings).management_enabled) continue;
    const { data: prior } = await supabase
      .from("audit_events")
      .select("id")
      .eq("tenant_id", r.tenant_id)
      .eq("action", "expiry_alert")
      .eq("idempotency_key", `expiry:${r.id}:${r.expiry_date}`)
      .limit(1);
    if (prior && prior.length) continue;
    const list = freshByTenant.get(r.tenant_id) || [];
    list.push(r);
    freshByTenant.set(r.tenant_id, list);
  }

  let notified = 0;
  let items = 0;
  for (const [tenantId, list] of freshByTenant) {
    items += list.length;
    // One push per tenant summarizing how many items just entered the window.
    await sendPushToTenant(tenantId, "expiry_soon", { count: list.length }, { roles: ["owner", "admin", "manager"] });
    notified++;
    // Record each so it is not alerted again for this expiry date.
    await supabase.from("audit_events").insert(
      list.map((r) => ({
        tenant_id: tenantId,
        action: "expiry_alert",
        entity_id: r.id,
        source: "system",
        idempotency_key: `expiry:${r.id}:${r.expiry_date}`,
        details: { name: r.name, expiry_date: r.expiry_date },
      })),
    );
  }

  if (items > 0) {
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "low",
      title: `Expiry alert: ${items} items across ${notified} tenants`,
      metadata: { items, tenants: notified, window_days: EXPIRY_WINDOW_DAYS },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, tenants_notified: notified, items });
}
