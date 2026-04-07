import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    // Verify caller is platform_admin
    const authHeader = req.headers.get("x-user-id");
    if (authHeader) {
      const { data: user } = await supabase
        .from("users")
        .select("global_role")
        .eq("id", authHeader)
        .single();
      if (user?.global_role !== "platform_admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    // Get all tenants
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, name, settings, created_at");

    if (!tenants || tenants.length === 0) {
      return NextResponse.json({ tenants: [] });
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d7prev = new Date(now); d7prev.setDate(d7prev.getDate() - 14);
    const d7Str = toDateStr(d7);
    const d30Str = toDateStr(d30);
    const d7prevStr = toDateStr(d7prev);
    const todayStr = toDateStr(now);

    // Fetch minimal columns for speed
    const [allRes30, allRes7prev, allIncidents, allLogs] = await Promise.all([
      supabase.from("reservations")
        .select("tenant_id, source, party_size, status, date, created_at")
        .gte("date", d30Str).lte("date", todayStr),
      supabase.from("reservations")
        .select("tenant_id, source, party_size, status")
        .gte("date", d7prevStr).lt("date", d7Str),
      supabase.from("incidents")
        .select("tenant_id, severity")
        .in("status", ["open", "investigating"]),
      supabase.from("system_logs")
        .select("tenant_id, severity")
        .eq("status", "open"),
    ]);

    const reservations = allRes30.data || [];
    const prevWeekRes = allRes7prev.data || [];
    const incidents = allIncidents.data || [];
    const logs = allLogs.data || [];

    // Aggregate per tenant
    const result = tenants.map((t: any) => {
      const s = (t.settings || {}) as any;
      const avgSpend = s.avg_spend || 50;

      // Last 7 days
      const r7 = reservations.filter((r: any) => r.tenant_id === t.id && r.date >= d7Str);
      const ai7 = r7.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
      const aiRevenue7 = ai7.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

      // Last 30 days
      const r30 = reservations.filter((r: any) => r.tenant_id === t.id);
      const ai30 = r30.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
      const aiRevenue30 = ai30.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

      // AI booking %
      const aiPct = r30.length > 0 ? Math.round((ai30.length / r30.length) * 100) : 0;

      // No-show trend
      const noShows7 = r7.filter((r: any) => r.status === "no_show").length;
      const prevR7 = prevWeekRes.filter((r: any) => r.tenant_id === t.id);
      const noShowsPrev = prevR7.filter((r: any) => r.status === "no_show").length;
      let noShowTrend: "up" | "down" | "stable" = "stable";
      if (noShows7 > noShowsPrev + 1) noShowTrend = "up";
      else if (noShows7 < noShowsPrev - 1) noShowTrend = "down";

      // Active issues
      const tenantIncidents = incidents.filter((i: any) => i.tenant_id === t.id);
      const tenantLogs = logs.filter((l: any) => l.tenant_id === t.id);
      const activeIssues = tenantIncidents.length + tenantLogs.length;
      const criticalIssues = [
        ...tenantIncidents.filter((i: any) => i.severity === "critical"),
        ...tenantLogs.filter((l: any) => l.severity === "critical"),
      ].length;

      // Last activity
      const lastRes = r30.length > 0
        ? r30.reduce((latest: any, r: any) => r.created_at > latest.created_at ? r : latest)
        : null;
      const lastActivity = lastRes?.created_at || t.created_at;

      // Health status
      let health: "healthy" | "attention" | "critical" = "healthy";
      if (criticalIssues > 0) health = "critical";
      else if (activeIssues > 2 || (r7.length === 0 && r30.length > 0)) health = "attention";
      else if (noShowTrend === "up") health = "attention";

      // Booking change week over week
      const prevWeekCount = prevR7.length;
      const bookingChange = prevWeekCount > 0
        ? Math.round(((r7.length - prevWeekCount) / prevWeekCount) * 100)
        : (r7.length > 0 ? 100 : 0);

      return {
        id: t.id,
        name: t.name,
        health,
        aiRevenue7,
        aiRevenue30,
        aiPct,
        totalBookings7: r7.length,
        totalBookings30: r30.length,
        noShows7,
        noShowTrend,
        activeIssues,
        criticalIssues,
        lastActivity,
        bookingChange,
      };
    });

    // Sort: critical first, then attention, then healthy
    const order = { critical: 0, attention: 1, healthy: 2 };
    result.sort((a: any, b: any) => order[a.health as keyof typeof order] - order[b.health as keyof typeof order]);

    // Platform totals
    const platformTotals = {
      totalTenants: tenants.length,
      totalOpenIssues: incidents.length + logs.length,
      totalCritical: [...incidents, ...logs].filter((x: any) => x.severity === "critical").length,
      totalBookings7: reservations.filter((r: any) => r.date >= d7Str).length,
      totalAiRevenue7: result.reduce((s: number, t: any) => s + t.aiRevenue7, 0),
    };

    return NextResponse.json({ tenants: result, platform: platformTotals });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
