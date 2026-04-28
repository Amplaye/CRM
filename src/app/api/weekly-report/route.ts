import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";

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

export async function POST(req: NextRequest) {
  const unauth = assertAiSecret(req);
  if (unauth) return unauth;
  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) {
      return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Load tenant settings
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, settings")
      .eq("id", tenant_id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const s = (tenant.settings || {}) as any;
    const avgSpend = s.avg_spend || 50;
    const openingHours: OpeningHours = s.opening_hours || {};
    const tz = s.timezone || "Atlantic/Canary";

    // Date range: last 7 days
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const todayStr = toDateStr(now);
    const weekAgoStr = toDateStr(weekAgo);
    const twoWeeksAgoStr = toDateStr(twoWeeksAgo);

    // Fetch this week + previous week + waitlist
    const [thisWeekRes, prevWeekRes, waitlistRes, prevWaitlistRes] = await Promise.all([
      supabase.from("reservations")
        .select("id, source, date, party_size, status, cancellation_source, noshow_warning_responded, created_at")
        .eq("tenant_id", tenant_id)
        .gte("date", weekAgoStr).lte("date", todayStr),
      supabase.from("reservations")
        .select("id, source, date, party_size, status, created_at")
        .eq("tenant_id", tenant_id)
        .gte("date", twoWeeksAgoStr).lt("date", weekAgoStr),
      supabase.from("waitlist_entries")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("status", "converted_to_booking")
        .gte("created_at", weekAgoStr),
      supabase.from("waitlist_entries")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("status", "converted_to_booking")
        .gte("created_at", twoWeeksAgoStr)
        .lt("created_at", weekAgoStr),
    ]);

    const reservations = thisWeekRes.data || [];
    const prevReservations = prevWeekRes.data || [];
    const waitlistConverted = (waitlistRes.data || []).length;
    const prevWaitlistConverted = (prevWaitlistRes.data || []).length;

    const total = reservations.length;
    const prevTotal = prevReservations.length;

    const aiRes = reservations.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const prevAiRes = prevReservations.filter((r: any) => (r.source === "ai_chat" || r.source === "ai_voice") && r.status !== "no_show");

    // Revenue — exclude no_shows (cliente no apareció = no facturó)
    const aiResPaid = aiRes.filter((r: any) => r.status !== "no_show");
    const aiRevenue = aiResPaid.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

    // Out-of-hours
    const outOfHours = aiResPaid.filter((r: any) => r.created_at && isOutOfHours(r.created_at, openingHours, tz));
    const outOfHoursRevenue = outOfHours.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

    // Voice
    const voiceResPaid = reservations.filter((r: any) => r.source === "ai_voice" && r.status !== "no_show");
    const voiceRevenue = voiceResPaid.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

    // Chat
    const chatResPaid = reservations.filter((r: any) => r.source === "ai_chat" && r.status !== "no_show");
    const chatRevenue = chatResPaid.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);

    // Waitlist
    const avgParty = total > 0 ? reservations.reduce((s: number, r: any) => s + r.party_size, 0) / total : 2;
    const waitlistRevenue = Math.round(waitlistConverted * avgParty * avgSpend);

    // No-shows prevented — REAL tracking (matches analytics dashboard logic):
    // 1. Cancellations triggered by reminders/chat/voice (freed the table in time)
    // 2. Late arrivals who responded to the 15-min warning
    const preventedSources = ['reminder_24h', 'reminder_4h', 'chat_spontaneous', 'voice_spontaneous'];
    const cancelledPrevented = reservations.filter(
      (r: any) => r.status === 'cancelled' && r.cancellation_source && preventedSources.includes(r.cancellation_source)
    ).length;
    const warningResponded = reservations.filter((r: any) => r.noshow_warning_responded === true).length;
    const noShowsPrevented = cancelledPrevented + warningResponded;
    const noShows = reservations.filter((r: any) => r.status === "no_show").length;
    const noShowValue = Math.round(noShowsPrevented * avgParty * avgSpend);

    // Total value
    const totalValue = aiRevenue + waitlistRevenue + noShowValue;

    // Efficiency
    const aiHandledPct = total > 0 ? Math.round((aiRes.length / total) * 100) : 0;
    const staffHoursSaved = Math.round(aiRes.length * 5 / 60 * 10) / 10;

    // Week-over-week comparison
    const prevAiRevenue = prevAiRes.reduce((sum: number, r: any) => sum + r.party_size * avgSpend, 0);
    const bookingChange = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : (total > 0 ? 100 : 0);

    // Build message
    let msg = `💰 Esta semana, tu IA generó €${totalValue.toLocaleString("es-ES")}\n`;
    msg += `_Calculado con €${avgSpend} por persona (ajustable en Configuración → Gasto medio por cubierto)._\n`;
    msg += `\nAquí el desglose:\n`;

    if (outOfHoursRevenue > 0) {
      msg += `\n🌙 €${outOfHoursRevenue.toLocaleString("es-ES")} de reservas fuera de horario`;
    }
    if (voiceRevenue > 0) {
      msg += `\n📞 €${voiceRevenue.toLocaleString("es-ES")} de llamadas gestionadas por IA`;
    }
    if (waitlistRevenue > 0) {
      msg += `\n🔁 €${waitlistRevenue.toLocaleString("es-ES")} de lista de espera recuperada`;
    }
    if (chatRevenue > 0) {
      msg += `\n💬 €${chatRevenue.toLocaleString("es-ES")} de reservas por WhatsApp`;
    }

    if (noShowsPrevented > 0) {
      msg += `\n\n🛡️ ${noShowsPrevented} no-show${noShowsPrevented > 1 ? "s" : ""} evitado${noShowsPrevented > 1 ? "s" : ""} (€${noShowValue.toLocaleString("es-ES")} recuperados)`;
    }
    if (noShows > 0) {
      msg += `\n⚠️ ${noShows} no-show${noShows > 1 ? "s" : ""} no evitado${noShows > 1 ? "s" : ""} esta semana`;
    }

    msg += `\n\n⚙️ La IA gestionó el ${aiHandledPct}% de tus reservas`;
    if (staffHoursSaved > 0) {
      msg += `\n👩‍🍳 ~${staffHoursSaved}h de tiempo de staff ahorrado`;
    }

    if (bookingChange !== 0 && prevTotal > 0) {
      if (bookingChange > 0) {
        msg += `\n\n📈 +${bookingChange}% más reservas que la semana pasada`;
      } else {
        msg += `\n\n📉 ${bookingChange}% reservas vs semana pasada`;
      }
    }

    // Fetch top insight
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
        || "https://crm.baliflowagency.com";
      const insightRes = await fetch(`${baseUrl}/api/insights?tenant_id=${tenant_id}`);
      const insightData = await insightRes.json();
      const topInsight = (insightData.insights || [])[0];
      if (topInsight && topInsight.estimated_value > 0) {
        msg += `\n\n💡 ${topInsight.description}`;
      }
    } catch { /* insights are optional */ }

    msg += `\n\n👉 Ver detalles en Analítica`;

    return NextResponse.json({
      success: true,
      message: msg,
      kpis: {
        totalValue, aiRevenue, outOfHoursRevenue, voiceRevenue, chatRevenue,
        waitlistRevenue, noShowValue, noShowsPrevented, noShows,
        aiHandledPct, staffHoursSaved,
        total, aiCount: aiRes.length,
        bookingChange,
        outOfHoursCount: outOfHours.length,
        voiceCount: voiceResPaid.length,
        chatCount: chatResPaid.length,
        waitlistConverted,
        avgSpend,
      },
      restaurant: tenant.name,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
