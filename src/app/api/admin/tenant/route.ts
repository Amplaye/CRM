import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { isAdminSettableStatus } from "@/lib/tenants/status";
import { apiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const tenantId = req.nextUrl.searchParams.get("id");
    if (!tenantId) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const todayStr = toDateStr(now);
    const d30Str = toDateStr(d30);
    const d7Str = toDateStr(d7);

    const [tenantRes, reservationsRes, incidentsRes, logsRes, conversationsRes] = await Promise.all([
      supabase.from("tenants").select("id, name, status, settings, created_at, archived_at, purge_after").eq("id", tenantId).single(),
      supabase.from("reservations")
        .select("id, source, date, time, party_size, status, created_at, guest_id, guests(name, phone)")
        .eq("tenant_id", tenantId)
        .gte("date", d30Str).lte("date", todayStr)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("incidents")
        .select("id, type, title, description, status, severity, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("system_logs")
        .select("id, category, severity, title, description, status, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("conversations")
        .select("id, channel, status, sentiment, summary, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (!tenantRes.data) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const tenant = tenantRes.data;
    const reservations = reservationsRes.data || [];
    const incidents = incidentsRes.data || [];
    const logs = logsRes.data || [];
    const conversations = conversationsRes.data || [];
    const s = (tenant.settings || {}) as any;
    const avgSpend = s.avg_spend || 50;

    // KPIs
    const r7 = reservations.filter((r: any) => r.date >= d7Str);
    const ai = reservations.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const ai7 = r7.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const aiRevenue30 = ai.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);
    const aiRevenue7 = ai7.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);
    const aiPct = reservations.length > 0 ? Math.round((ai.length / reservations.length) * 100) : 0;
    const noShows = reservations.filter((r: any) => r.status === "no_show").length;
    const escalations = conversations.filter((c: any) => c.status === "escalated").length;
    const escalationRate = conversations.length > 0 ? Math.round((escalations / conversations.length) * 100) : 0;

    return NextResponse.json({
      tenant: { id: tenant.id, name: tenant.name, status: tenant.status, created_at: tenant.created_at, archived_at: tenant.archived_at, purge_after: tenant.purge_after, settings: tenant.settings || {} },
      kpis: {
        aiRevenue7,
        aiRevenue30,
        aiPct,
        totalBookings30: reservations.length,
        totalBookings7: r7.length,
        aiCount: ai.length,
        noShows,
        escalations,
        escalationRate,
      },
      recentReservations: reservations.slice(0, 15),
      recentConversations: conversations.slice(0, 10),
      recentIncidents: incidents,
      recentLogs: logs,
    });
  } catch (err: any) {
    return apiError(err, { route: "admin/tenant", publicMessage: "operation_failed", status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Platform-admin only: this can suspend a tenant (cuts off its traffic).
    const auth = await assertPlatformAdmin();
    if (!auth.ok) return auth.res;

    const { tenant_id, settings, status, name } = await req.json();
    if (!tenant_id || (settings === undefined && status === undefined && name === undefined)) {
      return NextResponse.json({ error: "Missing tenant_id or nothing to update" }, { status: 400 });
    }
    if (status !== undefined && !isAdminSettableStatus(status)) {
      // 'archived' is reachable only through the protected archive flow.
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    // Renaming a restaurant is admin-only (the Settings page no longer exposes
    // it): the name is stamped on menus, receipts and bot replies, so it must
    // never be blanked or turned into whitespace by accident.
    let cleanName: string | undefined;
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Invalid name" }, { status: 400 });
      }
      cleanName = name.trim().slice(0, 120);
    }

    const supabase = createServiceRoleClient();

    // Merge settings (if provided) with existing; set status (if provided).
    const { data: tenant } = await supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenant_id)
      .single();

    const update: Record<string, any> = {};
    let merged: Record<string, any> | undefined;
    if (settings !== undefined) {
      merged = { ...(tenant?.settings || {}), ...settings };
      update.settings = merged;
    }
    if (status !== undefined) update.status = status;
    if (cleanName !== undefined) update.name = cleanName;

    const { error } = await supabase
      .from("tenants")
      .update(update)
      .eq("id", tenant_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, settings: merged, status, name: cleanName });
  } catch (err: any) {
    return apiError(err, { route: "admin/tenant", publicMessage: "operation_failed", status: 500 });
  }
}
