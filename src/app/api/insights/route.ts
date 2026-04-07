import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

interface Insight {
  type: "revenue_opportunity" | "performance_drop" | "ai_optimization" | "loss_prevention" | "hidden_value";
  title: string;
  description: string;
  estimated_value: number;
  confidence: "low" | "medium" | "high";
}

interface TimeSlot { open: string; close: string }
type OpeningHours = Record<string, TimeSlot[]>;

function isOutOfHours(createdAt: string, openingHours: OpeningHours, timezone: string): boolean {
  if (!openingHours || Object.keys(openingHours).length === 0) return false;
  const date = new Date(createdAt);
  const localStr = date.toLocaleString("en-US", { timeZone: timezone || "UTC" });
  const local = new Date(localStr);
  const dow = local.getDay();
  const minutes = local.getHours() * 60 + local.getMinutes();
  const daySlots = openingHours[String(dow)] || [];
  if (daySlots.length === 0) return true;
  for (const slot of daySlots) {
    const [oh, om] = slot.open.split(":").map(Number);
    const [ch, cm] = slot.close.split(":").map(Number);
    if (minutes >= oh * 60 + om && minutes <= ch * 60 + cm) return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenant_id");
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const d14 = new Date(now); d14.setDate(d14.getDate() - 14);
    const todayStr = toDateStr(now);
    const d30Str = toDateStr(d30);
    const d60Str = toDateStr(d60);
    const d7Str = toDateStr(d7);
    const d14Str = toDateStr(d14);

    const [tenantRes, res30, res60, res7, res14, waitlist30, conversations30, conversations60] = await Promise.all([
      supabase.from("tenants").select("settings").eq("id", tenantId).single(),
      supabase.from("reservations").select("id, source, party_size, status, date, created_at")
        .eq("tenant_id", tenantId).gte("date", d30Str).lte("date", todayStr),
      supabase.from("reservations").select("id, source, party_size, status, date, created_at")
        .eq("tenant_id", tenantId).gte("date", d60Str).lt("date", d30Str),
      supabase.from("reservations").select("id, source, party_size, status, date, created_at")
        .eq("tenant_id", tenantId).gte("date", d7Str).lte("date", todayStr),
      supabase.from("reservations").select("id, source, party_size, status")
        .eq("tenant_id", tenantId).gte("date", d14Str).lt("date", d7Str),
      supabase.from("waitlist_entries").select("id, status")
        .eq("tenant_id", tenantId).gte("created_at", d30Str),
      supabase.from("conversations").select("id, channel, status, linked_reservation_id")
        .eq("tenant_id", tenantId).gte("created_at", d30Str),
      supabase.from("conversations").select("id, linked_reservation_id")
        .eq("tenant_id", tenantId).gte("created_at", d60Str).lt("created_at", d30Str),
    ]);

    const s = ((tenantRes.data?.settings || {}) as any);
    const avgSpend = s.avg_spend || 50;
    const noShowBaseline = s.no_show_baseline_pct || 15;
    const openingHours: OpeningHours = s.opening_hours || {};
    const tz = s.timezone || "Atlantic/Canary";

    const r30 = res30.data || [];
    const r60 = res60.data || [];
    const r7 = res7.data || [];
    const r14 = res14.data || [];
    const wl30 = waitlist30.data || [];
    const conv30 = conversations30.data || [];
    const conv60 = conversations60.data || [];

    const total30 = r30.length;
    const total7 = r7.length;
    const total14 = r14.length;
    const avgParty = total30 > 0 ? Math.round(r30.reduce((s: number, r: any) => s + r.party_size, 0) / total30) : 2;

    const ai30 = r30.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const ai7 = r7.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const ai14 = r14.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const aiPct7 = total7 > 0 ? (ai7.length / total7) * 100 : 0;
    const aiPct14 = total14 > 0 ? (ai14.length / total14) * 100 : 0;

    const noShows30 = r30.filter((r: any) => r.status === "no_show").length;
    const noShowPct = total30 > 0 ? (noShows30 / total30) * 100 : 0;
    const cancellations30 = r30.filter((r: any) => r.status === "cancelled").length;

    const wlRecovered = wl30.filter((w: any) => w.status === "converted_to_booking").length;

    const convWithBooking = conv30.filter((c: any) => c.linked_reservation_id).length;
    const convRate = conv30.length > 0 ? (convWithBooking / conv30.length) * 100 : 0;
    const prevConvWithBooking = conv60.filter((c: any) => c.linked_reservation_id).length;
    const prevConvRate = conv60.length > 0 ? (prevConvWithBooking / conv60.length) * 100 : 0;

    const oohBookings = ai30.filter((r: any) => r.created_at && isOutOfHours(r.created_at, openingHours, tz));
    const oohPct = ai30.length > 0 ? Math.round((oohBookings.length / ai30.length) * 100) : 0;

    const insights: Insight[] = [];

    // 1. WAITLIST OPPORTUNITY
    if (cancellations30 >= 3 && wlRecovered <= 1) {
      const missedRecoveries = Math.max(0, cancellations30 - wlRecovered - 1);
      const value = Math.round(missedRecoveries * avgParty * avgSpend);
      if (value > 0) {
        insights.push({
          type: "revenue_opportunity",
          title: "Waitlist recovery opportunity",
          description: `${cancellations30} cancellations last month but only ${wlRecovered} recovered from waitlist. Improving waitlist usage could recover ~€${value}/month.`,
          estimated_value: value,
          confidence: cancellations30 >= 5 ? "high" : "medium",
        });
      }
    }

    // 2. AI USAGE DROP
    if (total14 >= 5 && aiPct14 > 0 && aiPct7 < aiPct14 * 0.7) {
      const dropPct = Math.round(((aiPct14 - aiPct7) / aiPct14) * 100);
      const lostBookings = Math.round((aiPct14 - aiPct7) / 100 * total7);
      const value = Math.round(lostBookings * avgParty * avgSpend);
      if (value > 0) {
        insights.push({
          type: "performance_drop",
          title: "AI booking rate dropped",
          description: `AI handled ${Math.round(aiPct7)}% of bookings this week vs ${Math.round(aiPct14)}% last week (−${dropPct}%). This could mean ~€${value} in lost AI-handled revenue.`,
          estimated_value: value,
          confidence: "medium",
        });
      }
    }

    // 3. LOW CONVERSION RATE
    if (conv30.length >= 10 && convRate < 30) {
      const potentialExtra = Math.round(conv30.length * 0.15); // 15% more could convert
      const value = Math.round(potentialExtra * avgParty * avgSpend);
      if (value > 0) {
        insights.push({
          type: "ai_optimization",
          title: "Low AI conversation-to-booking rate",
          description: `AI converts only ${Math.round(convRate)}% of conversations into bookings. Improving prompts could add ~${potentialExtra} bookings/month (~€${value}).`,
          estimated_value: value,
          confidence: conv30.length >= 20 ? "high" : "medium",
        });
      }
    }

    // 4. NO-SHOW ISSUE
    if (total30 >= 10 && noShowPct > noShowBaseline) {
      const excessNoShows = Math.round((noShowPct - noShowBaseline) / 100 * total30);
      const value = Math.round(excessNoShows * avgParty * avgSpend);
      if (value > 0) {
        insights.push({
          type: "loss_prevention",
          title: "No-show rate above baseline",
          description: `No-show rate is ${Math.round(noShowPct)}% (baseline: ${noShowBaseline}%). Stronger confirmations or deposits could save ~€${value}/month.`,
          estimated_value: value,
          confidence: total30 >= 20 ? "high" : "medium",
        });
      }
    }

    // 5. OUT-OF-HOURS VALUE
    if (oohBookings.length >= 3 && oohPct >= 25) {
      const oohRevenue = oohBookings.reduce((s: number, r: any) => s + r.party_size * avgSpend, 0);
      insights.push({
        type: "hidden_value",
        title: "High out-of-hours booking activity",
        description: `${oohPct}% of AI bookings happen outside opening hours (€${oohRevenue} this month). Promoting 24/7 availability could grow this further.`,
        estimated_value: Math.round(oohRevenue * 0.2), // 20% growth potential
        confidence: oohBookings.length >= 8 ? "high" : "medium",
      });
    }

    // 6. CONVERSATION RATE IMPROVEMENT vs previous period
    if (conv30.length >= 5 && conv60.length >= 5 && convRate > prevConvRate + 10) {
      insights.push({
        type: "ai_optimization",
        title: "AI conversion rate improving",
        description: `Booking conversion improved from ${Math.round(prevConvRate)}% to ${Math.round(convRate)}%. Keep current prompt strategy — it's working.`,
        estimated_value: 0,
        confidence: "high",
      });
    }

    // Sort by value, take top 3
    insights.sort((a, b) => b.estimated_value - a.estimated_value);
    const top3 = insights.slice(0, 3);

    return NextResponse.json({
      insights: top3,
      all_insights: insights,
      meta: {
        total30, ai_count: ai30.length, noShows: noShows30,
        cancellations: cancellations30, waitlist_recovered: wlRecovered,
        conversations: conv30.length, conversion_rate: Math.round(convRate),
        ooh_pct: oohPct,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
