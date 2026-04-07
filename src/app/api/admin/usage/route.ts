import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d30Str = toDateStr(d30);
    const todayStr = toDateStr(now);

    const [tenants, reservations, conversations, waitlist] = await Promise.all([
      supabase.from("tenants").select("id, name, settings"),
      supabase.from("reservations").select("id, tenant_id, source, party_size, created_at")
        .gte("date", d30Str).lte("date", todayStr),
      supabase.from("conversations").select("id, tenant_id, channel, created_at")
        .gte("created_at", d30Str),
      supabase.from("waitlist_entries").select("id, tenant_id, created_at")
        .gte("created_at", d30Str),
    ]);

    const allTenants = tenants.data || [];
    const allRes = reservations.data || [];
    const allConv = conversations.data || [];
    const allWl = waitlist.data || [];

    const result = allTenants.map((t: any) => {
      const s = (t.settings || {}) as any;
      const monthlyFee = s.client_monthly_fee || 0;
      const avgSpend = s.avg_spend || 50;

      const tRes = allRes.filter((r: any) => r.tenant_id === t.id);
      const tConv = allConv.filter((c: any) => c.tenant_id === t.id);
      const tWl = allWl.filter((w: any) => w.tenant_id === t.id);

      const aiRes = tRes.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
      const chatCount = tConv.filter((c: any) => c.channel === "whatsapp").length;
      const voiceCount = tConv.filter((c: any) => c.channel === "voice").length;

      // Estimated costs (configurable per tenant, fallback to rough estimates)
      const costPerWhatsappMsg = s.cost_per_whatsapp || 0.05;
      const costPerVoiceMin = s.cost_per_voice_min || 0.15;
      const avgVoiceDuration = s.avg_voice_duration_min || 3;
      const costPerApiCall = s.cost_per_api_call || 0.002;

      const whatsappCost = Math.round(chatCount * costPerWhatsappMsg * 100) / 100;
      const voiceCost = Math.round(voiceCount * costPerVoiceMin * avgVoiceDuration * 100) / 100;
      const apiCost = Math.round((tRes.length + tConv.length + tWl.length) * costPerApiCall * 100) / 100;
      const totalCost = Math.round((whatsappCost + voiceCost + apiCost) * 100) / 100;

      // Revenue generated for client
      const aiRevenue = aiRes.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

      // Margin
      const margin = monthlyFee > 0 ? Math.round((monthlyFee - totalCost) / monthlyFee * 100) : 0;

      return {
        id: t.id,
        name: t.name,
        monthlyFee,
        costs: { whatsapp: whatsappCost, voice: voiceCost, api: apiCost, total: totalCost },
        usage: {
          reservations: tRes.length,
          aiBookings: aiRes.length,
          whatsappConversations: chatCount,
          voiceCalls: voiceCount,
          waitlistEntries: tWl.length,
        },
        aiRevenue,
        margin,
      };
    });

    const platformTotals = {
      totalFees: result.reduce((s: number, t: any) => s + t.monthlyFee, 0),
      totalCosts: Math.round(result.reduce((s: number, t: any) => s + t.costs.total, 0) * 100) / 100,
      totalAiRevenue: result.reduce((s: number, t: any) => s + t.aiRevenue, 0),
    };

    return NextResponse.json({ tenants: result, platform: platformTotals });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
