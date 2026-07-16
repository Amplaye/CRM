import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { assertActivePlan } from "@/lib/billing/guard";
import { ownerLangFromSettings, type OwnerLang } from "@/lib/owner-locale";
import { apiError } from "@/lib/api-error";

interface Insight {
  type: "revenue_opportunity" | "performance_drop" | "ai_optimization" | "loss_prevention" | "hidden_value";
  title: string;
  description: string;
  estimated_value: number;
  confidence: "low" | "medium" | "high";
}

interface TimeSlot { open: string; close: string }
type OpeningHours = Record<string, TimeSlot[]>;

// Insight copy per language. Both consumers — the analytics dashboard (fixed to
// the tenant's crm_locale) and the weekly report (owner language) — want the
// tenant's primary language, not hardcoded English. Each entry returns
// {title, description} from the computed values.
const INSIGHT_I18N: Record<OwnerLang, {
  waitlist: (cancellations: number, recovered: number, value: number) => { title: string; description: string };
  aiDrop: (pct7: number, pct14: number, drop: number, value: number) => { title: string; description: string };
  lowConv: (rate: number, extra: number, value: number) => { title: string; description: string };
  noShow: (pct: number, baseline: number, value: number) => { title: string; description: string };
  outOfHours: (pct: number, revenue: number) => { title: string; description: string };
  convUp: (prev: number, now: number) => { title: string; description: string };
}> = {
  es: {
    waitlist: (c, r, v) => ({ title: "Oportunidad de lista de espera", description: `${c} cancelaciones el mes pasado pero solo ${r} recuperadas de la lista de espera. Mejorar su uso podría recuperar ~€${v}/mes.` }),
    aiDrop: (p7, p14, d, v) => ({ title: "Bajó la tasa de reservas por IA", description: `La IA gestionó el ${p7}% de las reservas esta semana frente al ${p14}% la semana pasada (−${d}%). Podría suponer ~€${v} de ingresos perdidos gestionados por IA.` }),
    lowConv: (rate, e, v) => ({ title: "Baja conversión de conversación a reserva", description: `La IA convierte solo el ${rate}% de las conversaciones en reservas. Mejorar los prompts podría añadir ~${e} reservas/mes (~€${v}).` }),
    noShow: (pct, b, v) => ({ title: "No-shows por encima de lo normal", description: `La tasa de no-show es del ${pct}% (referencia: ${b}%). Confirmaciones más fuertes o depósitos podrían ahorrar ~€${v}/mes.` }),
    outOfHours: (pct, rev) => ({ title: "Mucha actividad fuera de horario", description: `El ${pct}% de las reservas por IA ocurren fuera del horario (€${rev} este mes). Promocionar la disponibilidad 24/7 podría hacerlo crecer.` }),
    convUp: (prev, now) => ({ title: "La conversión por IA está mejorando", description: `La conversión a reserva mejoró del ${prev}% al ${now}%. Mantén la estrategia de prompts actual — está funcionando.` }),
  },
  it: {
    waitlist: (c, r, v) => ({ title: "Opportunità lista d'attesa", description: `${c} cancellazioni il mese scorso ma solo ${r} recuperate dalla lista d'attesa. Usarla meglio potrebbe recuperare ~€${v}/mese.` }),
    aiDrop: (p7, p14, d, v) => ({ title: "Calata la quota di prenotazioni via IA", description: `L'IA ha gestito il ${p7}% delle prenotazioni questa settimana contro il ${p14}% la scorsa (−${d}%). Potrebbe significare ~€${v} di ricavi persi gestiti dall'IA.` }),
    lowConv: (rate, e, v) => ({ title: "Bassa conversione conversazione → prenotazione", description: `L'IA converte solo il ${rate}% delle conversazioni in prenotazioni. Migliorare i prompt potrebbe aggiungere ~${e} prenotazioni/mese (~€${v}).` }),
    noShow: (pct, b, v) => ({ title: "No-show sopra la norma", description: `Il tasso di no-show è del ${pct}% (riferimento: ${b}%). Conferme più decise o caparre potrebbero far risparmiare ~€${v}/mese.` }),
    outOfHours: (pct, rev) => ({ title: "Molta attività fuori orario", description: `Il ${pct}% delle prenotazioni via IA avviene fuori orario (€${rev} questo mese). Promuovere la disponibilità 24/7 potrebbe farla crescere.` }),
    convUp: (prev, now) => ({ title: "La conversione via IA sta migliorando", description: `La conversione in prenotazione è salita dal ${prev}% al ${now}%. Mantieni l'attuale strategia di prompt — funziona.` }),
  },
  en: {
    waitlist: (c, r, v) => ({ title: "Waitlist recovery opportunity", description: `${c} cancellations last month but only ${r} recovered from waitlist. Improving waitlist usage could recover ~€${v}/month.` }),
    aiDrop: (p7, p14, d, v) => ({ title: "AI booking rate dropped", description: `AI handled ${p7}% of bookings this week vs ${p14}% last week (−${d}%). This could mean ~€${v} in lost AI-handled revenue.` }),
    lowConv: (rate, e, v) => ({ title: "Low AI conversation-to-booking rate", description: `AI converts only ${rate}% of conversations into bookings. Improving prompts could add ~${e} bookings/month (~€${v}).` }),
    noShow: (pct, b, v) => ({ title: "No-show rate above baseline", description: `No-show rate is ${pct}% (baseline: ${b}%). Stronger confirmations or deposits could save ~€${v}/month.` }),
    outOfHours: (pct, rev) => ({ title: "High out-of-hours booking activity", description: `${pct}% of AI bookings happen outside opening hours (€${rev} this month). Promoting 24/7 availability could grow this further.` }),
    convUp: (prev, now) => ({ title: "AI conversion rate improving", description: `Booking conversion improved from ${prev}% to ${now}%. Keep current prompt strategy — it's working.` }),
  },
  de: {
    waitlist: (c, r, v) => ({ title: "Chance bei der Warteliste", description: `${c} Stornierungen letzten Monat, aber nur ${r} über die Warteliste zurückgewonnen. Bessere Nutzung könnte ~€${v}/Monat zurückholen.` }),
    aiDrop: (p7, p14, d, v) => ({ title: "KI-Buchungsquote gesunken", description: `Die KI hat diese Woche ${p7}% der Buchungen bearbeitet, letzte Woche ${p14}% (−${d}%). Das könnte ~€${v} entgangenen KI-Umsatz bedeuten.` }),
    lowConv: (rate, e, v) => ({ title: "Niedrige Konversation-zu-Buchung-Rate", description: `Die KI wandelt nur ${rate}% der Konversationen in Buchungen um. Bessere Prompts könnten ~${e} Buchungen/Monat bringen (~€${v}).` }),
    noShow: (pct, b, v) => ({ title: "No-Show-Rate über dem Normalwert", description: `Die No-Show-Rate liegt bei ${pct}% (Referenz: ${b}%). Stärkere Bestätigungen oder Anzahlungen könnten ~€${v}/Monat sparen.` }),
    outOfHours: (pct, rev) => ({ title: "Viel Buchungsaktivität außerhalb der Öffnungszeiten", description: `${pct}% der KI-Buchungen erfolgen außerhalb der Öffnungszeiten (€${rev} diesen Monat). Werbung für 24/7-Verfügbarkeit könnte das steigern.` }),
    convUp: (prev, now) => ({ title: "KI-Konversionsrate verbessert sich", description: `Die Buchungskonversion stieg von ${prev}% auf ${now}%. Behalte die aktuelle Prompt-Strategie bei — sie funktioniert.` }),
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

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenant_id");
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });
    }

    // This is a dashboard endpoint exposing a tenant's revenue/PII insights.
    // Require a session that is a member of tenantId (or a platform admin).
    const member = await verifyTenantMembership(tenantId);
    if (!member) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const noPlan = await assertActivePlan(tenantId);
    if (noPlan) return noPlan;

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
    const I = INSIGHT_I18N[ownerLangFromSettings(s)];
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
          ...I.waitlist(cancellations30, wlRecovered, value),
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
          ...I.aiDrop(Math.round(aiPct7), Math.round(aiPct14), dropPct, value),
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
          ...I.lowConv(Math.round(convRate), potentialExtra, value),
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
          ...I.noShow(Math.round(noShowPct), noShowBaseline, value),
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
        ...I.outOfHours(oohPct, oohRevenue),
        estimated_value: Math.round(oohRevenue * 0.2), // 20% growth potential
        confidence: oohBookings.length >= 8 ? "high" : "medium",
      });
    }

    // 6. CONVERSATION RATE IMPROVEMENT vs previous period
    if (conv30.length >= 5 && conv60.length >= 5 && convRate > prevConvRate + 10) {
      insights.push({
        type: "ai_optimization",
        ...I.convUp(Math.round(prevConvRate), Math.round(convRate)),
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
    return apiError(err, { route: "insights", publicMessage: "operation_failed", status: 500 });
  }
}
