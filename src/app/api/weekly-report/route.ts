import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { ownerLangFromSettings, type OwnerLang } from "@/lib/owner-locale";
import { apiError } from "@/lib/api-error";

interface TimeSlot { open: string; close: string }
type OpeningHours = Record<string, TimeSlot[]>;

// Owner-facing copy per language. The owner reads the weekly value report in the
// tenant's primary language (Oraz → Italian, etc.), not Spanish. `n(v)` plural
// helper picks singular/plural; `cur` is the number locale for thousands.
const REPORT_I18N: Record<OwnerLang, {
  cur: string;
  header: (v: string) => string;
  perPerson: (s: number) => string;
  breakdown: string;
  outOfHours: (v: string) => string;
  voice: (v: string) => string;
  waitlist: (v: string) => string;
  chat: (v: string) => string;
  prevented: (n: number, v: string) => string;
  notPrevented: (n: number) => string;
  handled: (pct: number) => string;
  staffSaved: (h: number) => string;
  moreBookings: (pct: number) => string;
  fewerBookings: (pct: number) => string;
  insight: (d: string) => string;
  footer: string;
}> = {
  es: {
    cur: "es-ES",
    header: (v) => `💰 Esta semana, tu IA generó €${v}\n`,
    perPerson: (s) => `_Calculado con €${s} por persona (ajustable en Configuración → Gasto medio por cubierto)._\n`,
    breakdown: `\nAquí el desglose:\n`,
    outOfHours: (v) => `\n🌙 €${v} de reservas fuera de horario`,
    voice: (v) => `\n📞 €${v} de llamadas gestionadas por IA`,
    waitlist: (v) => `\n🔁 €${v} de lista de espera recuperada`,
    chat: (v) => `\n💬 €${v} de reservas por WhatsApp`,
    prevented: (n, v) => `\n\n🛡️ ${n} no-show${n > 1 ? "s" : ""} evitado${n > 1 ? "s" : ""} (€${v} recuperados)`,
    notPrevented: (n) => `\n⚠️ ${n} no-show${n > 1 ? "s" : ""} no evitado${n > 1 ? "s" : ""} esta semana`,
    handled: (pct) => `\n\n⚙️ La IA gestionó el ${pct}% de tus reservas`,
    staffSaved: (h) => `\n👩‍🍳 ~${h}h de tiempo de staff ahorrado`,
    moreBookings: (pct) => `\n\n📈 +${pct}% más reservas que la semana pasada`,
    fewerBookings: (pct) => `\n\n📉 ${pct}% reservas vs semana pasada`,
    insight: (d) => `\n\n💡 ${d}`,
    footer: `\n\n👉 Ver detalles en Analítica`,
  },
  it: {
    cur: "it-IT",
    header: (v) => `💰 Questa settimana la tua IA ha generato €${v}\n`,
    perPerson: (s) => `_Calcolato con €${s} a persona (modificabile in Impostazioni → Spesa media per coperto)._\n`,
    breakdown: `\nEcco il dettaglio:\n`,
    outOfHours: (v) => `\n🌙 €${v} da prenotazioni fuori orario`,
    voice: (v) => `\n📞 €${v} da chiamate gestite dall'IA`,
    waitlist: (v) => `\n🔁 €${v} recuperati dalla lista d'attesa`,
    chat: (v) => `\n💬 €${v} da prenotazioni via WhatsApp`,
    prevented: (n, v) => `\n\n🛡️ ${n} no-show evitat${n > 1 ? "i" : "o"} (€${v} recuperati)`,
    notPrevented: (n) => `\n⚠️ ${n} no-show non evitat${n > 1 ? "i" : "o"} questa settimana`,
    handled: (pct) => `\n\n⚙️ L'IA ha gestito il ${pct}% delle tue prenotazioni`,
    staffSaved: (h) => `\n👩‍🍳 ~${h}h di tempo dello staff risparmiate`,
    moreBookings: (pct) => `\n\n📈 +${pct}% prenotazioni rispetto alla settimana scorsa`,
    fewerBookings: (pct) => `\n\n📉 ${pct}% prenotazioni rispetto alla settimana scorsa`,
    insight: (d) => `\n\n💡 ${d}`,
    footer: `\n\n👉 Vedi i dettagli in Analisi`,
  },
  en: {
    cur: "en-GB",
    header: (v) => `💰 This week your AI generated €${v}\n`,
    perPerson: (s) => `_Calculated at €${s} per person (adjustable in Settings → Average spend per cover)._\n`,
    breakdown: `\nHere's the breakdown:\n`,
    outOfHours: (v) => `\n🌙 €${v} from out-of-hours bookings`,
    voice: (v) => `\n📞 €${v} from AI-handled calls`,
    waitlist: (v) => `\n🔁 €${v} recovered from the waitlist`,
    chat: (v) => `\n💬 €${v} from WhatsApp bookings`,
    prevented: (n, v) => `\n\n🛡️ ${n} no-show${n > 1 ? "s" : ""} prevented (€${v} recovered)`,
    notPrevented: (n) => `\n⚠️ ${n} no-show${n > 1 ? "s" : ""} not prevented this week`,
    handled: (pct) => `\n\n⚙️ The AI handled ${pct}% of your bookings`,
    staffSaved: (h) => `\n👩‍🍳 ~${h}h of staff time saved`,
    moreBookings: (pct) => `\n\n📈 +${pct}% more bookings than last week`,
    fewerBookings: (pct) => `\n\n📉 ${pct}% bookings vs last week`,
    insight: (d) => `\n\n💡 ${d}`,
    footer: `\n\n👉 See details in Analytics`,
  },
  de: {
    cur: "de-DE",
    header: (v) => `💰 Diese Woche hat deine KI €${v} generiert\n`,
    perPerson: (s) => `_Berechnet mit €${s} pro Person (anpassbar unter Einstellungen → Durchschnittsausgabe pro Gedeck)._\n`,
    breakdown: `\nHier die Aufschlüsselung:\n`,
    outOfHours: (v) => `\n🌙 €${v} aus Buchungen außerhalb der Öffnungszeiten`,
    voice: (v) => `\n📞 €${v} aus KI-bearbeiteten Anrufen`,
    waitlist: (v) => `\n🔁 €${v} aus der Warteliste zurückgewonnen`,
    chat: (v) => `\n💬 €${v} aus WhatsApp-Buchungen`,
    prevented: (n, v) => `\n\n🛡️ ${n} No-Show${n > 1 ? "s" : ""} verhindert (€${v} zurückgewonnen)`,
    notPrevented: (n) => `\n⚠️ ${n} No-Show${n > 1 ? "s" : ""} diese Woche nicht verhindert`,
    handled: (pct) => `\n\n⚙️ Die KI hat ${pct}% deiner Buchungen bearbeitet`,
    staffSaved: (h) => `\n👩‍🍳 ~${h}h Personalzeit gespart`,
    moreBookings: (pct) => `\n\n📈 +${pct}% mehr Buchungen als letzte Woche`,
    fewerBookings: (pct) => `\n\n📉 ${pct}% Buchungen ggü. letzter Woche`,
    insight: (d) => `\n\n💡 ${d}`,
    footer: `\n\n👉 Details in Analyse ansehen`,
  },
};

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

    // Build message in the OWNER's language (Oraz → Italian, etc.), not Spanish.
    const T = REPORT_I18N[ownerLangFromSettings(tenant.settings)];
    const money = (v: number) => v.toLocaleString(T.cur);
    let msg = T.header(money(totalValue));
    msg += T.perPerson(avgSpend);
    msg += T.breakdown;

    if (outOfHoursRevenue > 0) msg += T.outOfHours(money(outOfHoursRevenue));
    if (voiceRevenue > 0) msg += T.voice(money(voiceRevenue));
    if (waitlistRevenue > 0) msg += T.waitlist(money(waitlistRevenue));
    if (chatRevenue > 0) msg += T.chat(money(chatRevenue));

    if (noShowsPrevented > 0) msg += T.prevented(noShowsPrevented, money(noShowValue));
    if (noShows > 0) msg += T.notPrevented(noShows);

    msg += T.handled(aiHandledPct);
    if (staffHoursSaved > 0) msg += T.staffSaved(staffHoursSaved);

    if (bookingChange !== 0 && prevTotal > 0) {
      msg += bookingChange > 0 ? T.moreBookings(bookingChange) : T.fewerBookings(bookingChange);
    }

    // Fetch top insight
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://crm.baliflowagency.com";
      const insightRes = await fetch(`${baseUrl}/api/insights?tenant_id=${tenant_id}`);
      const insightData = await insightRes.json();
      const topInsight = (insightData.insights || [])[0];
      if (topInsight && topInsight.estimated_value > 0) {
        msg += T.insight(topInsight.description);
      }
    } catch { /* insights are optional */ }

    msg += T.footer;

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
    return apiError(err, { route: "weekly-report", publicMessage: "operation_failed", status: 500 });
  }
}
