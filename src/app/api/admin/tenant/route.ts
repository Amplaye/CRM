import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
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
      supabase.from("tenants").select("id, name, settings, created_at").eq("id", tenantId).single(),
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
      tenant: { id: tenant.id, name: tenant.name, created_at: tenant.created_at },
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
