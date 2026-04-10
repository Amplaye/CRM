"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Bot, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight, Sparkles, Moon, Phone, RefreshCw, ShieldCheck,
  Gauge, Timer, UsersRound,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";

/* ─── helpers ─── */

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
  if (daySlots.length === 0) return true; // closed day
  for (const slot of daySlots) {
    const [oh, om] = slot.open.split(":").map(Number);
    const [ch, cm] = slot.close.split(":").map(Number);
    if (minutes >= oh * 60 + om && minutes <= ch * 60 + cm) return false;
  }
  return true;
}

const PIE_COLORS = ["#fb7740", "#6366f1", "#3f3f46", "#94a3b8", "#22c55e"];

/* ─── component ─── */

export default function DashboardPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [reservations, setReservations] = useState<any[]>([]);
  const [waitlistConverted, setWaitlistConverted] = useState(0);
  const [prevMonthRes, setPrevMonthRes] = useState<any[]>([]);

  // Period navigation
  type ViewMode = "day" | "month" | "year";
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const today = new Date();
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const monthNames = [t("dash_month_jan"), t("dash_month_feb"), t("dash_month_mar"), t("dash_month_apr"), t("dash_month_may"), t("dash_month_jun"), t("dash_month_jul"), t("dash_month_aug"), t("dash_month_sep"), t("dash_month_oct"), t("dash_month_nov"), t("dash_month_dec")];

  const navigatePeriod = (dir: number) => {
    if (viewMode === "year") {
      setSelectedYear(selectedYear + dir);
      return;
    }
    if (viewMode === "month") {
      let m = selectedMonth + dir;
      let y = selectedYear;
      if (m > 11) { m = 0; y++; }
      if (m < 0) { m = 11; y--; }
      setSelectedMonth(m);
      setSelectedYear(y);
      return;
    }
    // day
    const d = new Date(selectedYear, selectedMonth, selectedDay);
    d.setDate(d.getDate() + dir);
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth());
    setSelectedDay(d.getDate());
  };

  /* ─── data fetch ─── */

  useEffect(() => {
    if (!tenant) return;
    const supabase = createClient();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    let periodStart: string, periodEnd: string, prevStart: string, prevEnd: string;
    if (viewMode === "day") {
      const d = new Date(selectedYear, selectedMonth, selectedDay);
      periodStart = periodEnd = toDateStr(d);
      const p = new Date(d); p.setDate(p.getDate() - 1);
      prevStart = prevEnd = toDateStr(p);
    } else if (viewMode === "year") {
      periodStart = toDateStr(new Date(selectedYear, 0, 1));
      periodEnd = toDateStr(new Date(selectedYear, 11, 31));
      prevStart = toDateStr(new Date(selectedYear - 1, 0, 1));
      prevEnd = toDateStr(new Date(selectedYear - 1, 11, 31));
    } else {
      periodStart = toDateStr(new Date(selectedYear, selectedMonth, 1));
      periodEnd = toDateStr(new Date(selectedYear, selectedMonth + 1, 0));
      prevStart = toDateStr(new Date(selectedYear, selectedMonth - 1, 1));
      prevEnd = toDateStr(new Date(selectedYear, selectedMonth, 0));
    }

    const fetchAll = async () => {
      const [resMonth, resPrev, waitlistData] = await Promise.all([
        supabase.from("reservations")
          .select("id, source, from_web, date, time, party_size, status, created_at")
          .eq("tenant_id", tenant.id)
          .gte("date", periodStart).lte("date", periodEnd),
        supabase.from("reservations")
          .select("id, source, date, party_size, status, created_at")
          .eq("tenant_id", tenant.id)
          .gte("date", prevStart).lte("date", prevEnd),
        supabase.from("waitlist_entries")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("status", "converted_to_booking")
          .gte("created_at", periodStart)
          .lte("created_at", periodEnd + "T23:59:59"),
      ]);

      setReservations(resMonth.data || []);
      setPrevMonthRes(resPrev.data || []);
      setWaitlistConverted((waitlistData.data || []).length);
    };

    fetchAll();

    const channel = supabase
      .channel("dashboard-reservations")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${tenant.id}` }, () => fetchAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant, viewMode, selectedDay, selectedMonth, selectedYear]);

  /* ─── KPI computation ─── */

  const kpis = useMemo(() => {
    const s = (tenant?.settings || {}) as any;
    const avgSpend = s.avg_spend || 50;
    const aiMonthlyCost = s.ai_monthly_cost || 0;
    const noShowBaseline = s.no_show_baseline_pct || 15;
    const openingHours: OpeningHours = s.opening_hours || {};
    const tz = s.timezone || "Atlantic/Canary";

    const total = reservations.length;
    const aiRes = reservations.filter(r => r.source === "ai_chat" || r.source === "ai_voice");
    const staffRes = reservations.filter(r => r.source !== "ai_chat" && r.source !== "ai_voice");

    // Revenue
    const aiRevenue = aiRes.reduce((sum, r) => sum + r.party_size * avgSpend, 0);

    // Out-of-hours
    const outOfHours = aiRes.filter(r => r.created_at && isOutOfHours(r.created_at, openingHours, tz));
    const outOfHoursRevenue = outOfHours.reduce((sum, r) => sum + r.party_size * avgSpend, 0);

    // Voice (missed calls captured)
    const voiceRes = reservations.filter(r => r.source === "ai_voice");
    const voiceRevenue = voiceRes.reduce((sum, r) => sum + r.party_size * avgSpend, 0);

    // Chat
    const chatRes = reservations.filter(r => r.source === "ai_chat");
    const chatRevenue = chatRes.reduce((sum, r) => sum + r.party_size * avgSpend, 0);

    // Waitlist
    const avgParty = total > 0 ? reservations.reduce((s, r) => s + r.party_size, 0) / total : 2;
    const waitlistRevenue = Math.round(waitlistConverted * avgParty * avgSpend);

    // No-shows prevented
    const noShows = reservations.filter(r => r.status === "no_show").length;
    const actualPct = total > 0 ? (noShows / total) * 100 : 0;
    const noShowsPrevented = Math.max(0, Math.round((noShowBaseline - actualPct) / 100 * total));
    const noShowValue = Math.round(noShowsPrevented * avgParty * avgSpend);

    // AI cost prorated to selected period (settings stores monthly cost)
    let periodCost = 0;
    if (viewMode === "day") periodCost = aiMonthlyCost / 30;
    else if (viewMode === "year") periodCost = aiMonthlyCost * 12;
    else periodCost = aiMonthlyCost;
    periodCost = Math.round(periodCost);

    // ROI — net value (gross revenue from AI minus operating cost)
    const grossValue = aiRevenue + waitlistRevenue + noShowValue;
    const totalValue = Math.max(0, grossValue - periodCost);
    const roi = periodCost > 0 ? Math.round((totalValue / periodCost) * 100) : 0;

    // Efficiency
    const aiHandledPct = total > 0 ? Math.round((aiRes.length / total) * 100) : 0;
    const staffHoursSaved = Math.round(aiRes.length * 5 / 60 * 10) / 10; // 5 min per booking

    // Previous month comparison
    const prevAi = prevMonthRes.filter(r => r.source === "ai_chat" || r.source === "ai_voice");
    const prevAiRevenue = prevAi.reduce((sum, r) => sum + r.party_size * avgSpend, 0);
    const revenueChange = prevAiRevenue > 0 ? Math.round(((aiRevenue - prevAiRevenue) / prevAiRevenue) * 100) : (aiRevenue > 0 ? 100 : 0);

    // Trend chart data — buckets adapt to viewMode
    // day: 1 bucket per hour | month: 1 per day | year: 1 per month
    const trendMap: Record<string, { date: string; ai: number; staff: number; revenue: number }> = {};
    if (viewMode === "day") {
      for (let h = 0; h < 24; h++) {
        const key = String(h).padStart(2, "0");
        trendMap[key] = { date: key + "h", ai: 0, staff: 0, revenue: 0 };
      }
      reservations.forEach((r: any) => {
        const hour = (r.time || "00:00").slice(0, 2);
        if (trendMap[hour]) {
          if (r.source === "ai_chat" || r.source === "ai_voice") {
            trendMap[hour].ai++;
            trendMap[hour].revenue += r.party_size * avgSpend;
          } else {
            trendMap[hour].staff++;
          }
        }
      });
    } else if (viewMode === "year") {
      for (let m = 0; m < 12; m++) {
        const key = `${selectedYear}-${String(m + 1).padStart(2, "0")}`;
        trendMap[key] = { date: monthNames[m], ai: 0, staff: 0, revenue: 0 };
      }
      reservations.forEach((r: any) => {
        const key = (r.date || "").slice(0, 7);
        if (trendMap[key]) {
          if (r.source === "ai_chat" || r.source === "ai_voice") {
            trendMap[key].ai++;
            trendMap[key].revenue += r.party_size * avgSpend;
          } else {
            trendMap[key].staff++;
          }
        }
      });
    } else {
      const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        trendMap[key] = { date: String(d), ai: 0, staff: 0, revenue: 0 };
      }
      reservations.forEach(r => {
        if (trendMap[r.date]) {
          if (r.source === "ai_chat" || r.source === "ai_voice") {
            trendMap[r.date].ai++;
            trendMap[r.date].revenue += r.party_size * avgSpend;
          } else {
            trendMap[r.date].staff++;
          }
        }
      });
    }
    const dailyData = Object.values(trendMap);

    // Source breakdown for pie — group into Chat IA / Voz IA / Staff
    const channelKeys = ["ai_chat", "ai_voice", "staff"] as const;
    const channelRaw: Record<string, number> = { ai_chat: 0, ai_voice: 0, staff: 0 };
    reservations.forEach(r => {
      if (r.source === "ai_chat") channelRaw.ai_chat++;
      else if (r.source === "ai_voice" || r.source === "web") channelRaw.ai_voice++;
      else channelRaw.staff++;
    });
    const sourceData = channelKeys
      .filter(k => channelRaw[k] > 0)
      .map(k => ({ name: k, value: channelRaw[k] }));

    // Web origin tracking — % of AI bookings that came from picnic.base44.app
    const aiResAll = reservations.filter((r: any) => r.source === "ai_chat" || r.source === "ai_voice");
    const fromWebCount = aiResAll.filter((r: any) => r.from_web === true).length;
    const fromWebPct = aiResAll.length > 0 ? Math.round((fromWebCount / aiResAll.length) * 100) : 0;

    return {
      totalValue, aiRevenue, roi, aiMonthlyCost,
      outOfHoursCount: outOfHours.length, outOfHoursRevenue,
      voiceCount: voiceRes.length, voiceRevenue,
      chatCount: chatRes.length, chatRevenue,
      waitlistConverted, waitlistRevenue,
      noShowsPrevented, noShowValue, noShows,
      aiHandledPct, staffHoursSaved, aiCount: aiRes.length, staffCount: staffRes.length,
      total, revenueChange,
      dailyData, sourceData,
      fromWebCount, fromWebPct,
      grossValue, periodCost,
      avgParty: Math.round(avgParty * 10) / 10,
    };
  }, [reservations, prevMonthRes, waitlistConverted, tenant, viewMode, selectedDay, selectedMonth, selectedYear]);

  /* ─── render ─── */

  const channelLabel = (key: string) => {
    const map: Record<string, string> = { ai_chat: t("dash_ai_chat"), ai_voice: t("dash_ai_voice_calls"), staff: t("dash_legend_staff") };
    return map[key] || key;
  };

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-black tracking-tight">{t("nav_dashboard")}</h1>
          <p className="mt-0.5 text-xs sm:text-sm text-black">{t("dash_ai_performance")}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* View mode toggle */}
          <div className="inline-flex rounded-lg border-2 overflow-hidden self-start sm:self-auto" style={{ borderColor: "#c4956a" }}>
            {(["day", "month", "year"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold transition-colors"
                style={{
                  background: viewMode === mode ? "#c4956a" : "rgba(252,246,237,0.6)",
                  color: viewMode === mode ? "#fff" : "#000",
                }}
              >
                {t(`dash_view_${mode}`)}
              </button>
            ))}
          </div>
          {/* Period navigator */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => navigatePeriod(-1)} className="p-1.5 sm:p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
            </button>
            <div className="flex items-center gap-1 justify-center">
              {viewMode === "day" && (
                <select value={selectedDay} onChange={(e) => setSelectedDay(Number(e.target.value))}
                  className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                  {Array.from({ length: new Date(selectedYear, selectedMonth + 1, 0).getDate() }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              )}
              {viewMode !== "year" && (
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                  {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              )}
              <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button onClick={() => navigatePeriod(1)} className="p-1.5 sm:p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 1 — HERO: AI Generated Value
          ══════════════════════════════════════════════ */}
      <div className="rounded-xl border-2 p-4 sm:p-6 text-center" style={cardStyle}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-[#c4956a]" />
          <h2 className="text-sm sm:text-base font-bold text-black">{t("dash_ai_generated_value")}</h2>
        </div>
        <p className="text-xs text-black mb-4">
          {viewMode === "day" && `${selectedDay} ${monthNames[selectedMonth]} ${selectedYear}`}
          {viewMode === "month" && `${monthNames[selectedMonth]} ${selectedYear}`}
          {viewMode === "year" && selectedYear}
        </p>

        {/* Big number */}
        <div className="mb-6">
          <p className="text-3xl sm:text-4xl font-bold text-[#22c55e]">€{kpis.totalValue.toLocaleString()}</p>
          {kpis.periodCost > 0 && (
            <p className="text-xs text-black/60 mt-1">
              €{kpis.grossValue.toLocaleString()} − €{kpis.periodCost.toLocaleString()} {t("dash_ai_cost")}
            </p>
          )}
          {kpis.roi > 0 && (
            <span className="inline-block mt-2 text-xs font-bold px-3 py-1 rounded-full border" style={{ color: "#22c55e", borderColor: "#22c55e" }}>
              +{kpis.roi}% ROI
            </span>
          )}
          {kpis.revenueChange !== 0 && (
            <div className={`flex items-center justify-center gap-1 mt-2 text-xs font-semibold ${kpis.revenueChange > 0 ? "text-green-600" : "text-red-500"}`}>
              {kpis.revenueChange > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {kpis.revenueChange > 0 ? "+" : ""}{kpis.revenueChange}% {t("dash_vs_prev_month")}
            </div>
          )}
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <Moon className="w-4 h-4 text-indigo-500 mx-auto mb-1" />
            <p className="text-xs text-black font-medium">{t("dash_out_of_hours")}</p>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.outOfHoursRevenue.toLocaleString()}</p>
            <p className="text-xs text-black">{kpis.outOfHoursCount} {t("dash_bookings_while_closed")}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <Phone className="w-4 h-4 text-[#fb7740] mx-auto mb-1" />
            <p className="text-xs text-black font-medium">{t("dash_ai_voice_calls")}</p>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.voiceRevenue.toLocaleString()}</p>
            <p className="text-xs text-black">{kpis.voiceCount} {t("dash_calls_converted")}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <RefreshCw className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
            <p className="text-xs text-black font-medium">{t("dash_waitlist_recovered")}</p>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.waitlistRevenue.toLocaleString()}</p>
            <p className="text-xs text-black">{kpis.waitlistConverted} {t("dash_recoveries")}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <Bot className="w-4 h-4 text-[#c4956a] mx-auto mb-1" />
            <p className="text-xs text-black font-medium">{t("dash_ai_chat")}</p>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.chatRevenue.toLocaleString()}</p>
            <p className="text-xs text-black">{kpis.chatCount} {t("dash_whatsapp_bookings")}</p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 2 — DRIVERS
          ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: t("dash_bookings_closed"), value: kpis.outOfHoursCount, icon: Moon, color: "#6366f1", sub: t("dash_out_of_hours_sub") },
          { label: t("dash_calls_converted_label"), value: kpis.voiceCount, icon: Phone, color: "#fb7740", sub: t("dash_by_ai_voice") },
          { label: t("dash_waitlist_recoveries"), value: kpis.waitlistConverted, icon: RefreshCw, color: "#22c55e", sub: t("dash_auto_filled") },
          { label: t("dash_noshows_prevented"), value: kpis.noShowsPrevented, icon: ShieldCheck, color: "#c4956a", sub: `${kpis.noShows} ${t("dash_actual_noshows")}` },
        ].map(card => (
          <div key={card.label} className="rounded-xl p-3 sm:p-5 border-2 text-center" style={cardStyle}>
            <card.icon className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1" style={{ color: card.color, opacity: 0.6 }} />
            <p className="text-xs sm:text-sm font-medium text-black">{card.label}</p>
            <p className="text-xl sm:text-2xl font-bold mt-0.5 sm:mt-1" style={{ color: card.color }}>{card.value}</p>
            <p className="text-xs text-black mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 3 — EFFICIENCY
          ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl p-3 sm:p-5 border-2 text-center" style={cardStyle}>
          <Gauge className="w-5 h-5 text-[#c4956a] mx-auto mb-1" />
          <p className="text-xs font-medium text-black">{t("dash_ai_handled")}</p>
          <p className="text-xl sm:text-2xl font-bold text-black">{kpis.aiHandledPct}%</p>
          <p className="text-xs text-black">{kpis.aiCount} AI / {kpis.staffCount} Staff</p>
        </div>
        <div className="rounded-xl p-3 sm:p-5 border-2 text-center" style={cardStyle}>
          <Timer className="w-5 h-5 text-[#c4956a] mx-auto mb-1" />
          <p className="text-xs font-medium text-black">{t("dash_staff_hours_saved")}</p>
          <p className="text-xl sm:text-2xl font-bold text-black">{kpis.staffHoursSaved}h</p>
          <p className="text-xs text-black">{t("dash_min_per_booking")}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-5 border-2 text-center" style={cardStyle}>
          <UsersRound className="w-5 h-5 text-[#c4956a] mx-auto mb-1" />
          <p className="text-xs font-medium text-black">{t("dash_total_bookings")}</p>
          <p className="text-xl sm:text-2xl font-bold text-black">{kpis.total}</p>
          <p className="text-xs text-black">{kpis.avgParty} {t("dash_avg_covers")}</p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 4 — CHARTS
          ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        {/* AI vs Staff bookings over time */}
        <div className="p-4 sm:p-6 rounded-xl border-2" style={cardStyle}>
          <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4">{t("dash_ai_vs_staff")}</h3>
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kpis.dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#71717a" }}
                  interval={Math.max(0, Math.floor(kpis.dailyData.length / 10))} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#71717a" }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="ai" stackId="a" fill="#fb7740" radius={[0, 0, 0, 0]} name={t("dash_legend_ai")} />
                <Bar dataKey="staff" stackId="a" fill="#c4956a" radius={[4, 4, 0, 0]} name={t("dash_legend_staff")} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Channel breakdown pie */}
        <div className="p-4 sm:p-6 rounded-xl border-2" style={cardStyle}>
          <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4">{t("dash_channel_breakdown")}</h3>
          <div className="h-48 sm:h-64">
            {kpis.sourceData.length === 0 ? (
              <p className="text-sm text-black text-center pt-20">{t("dash_no_data")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={kpis.sourceData.map(d => ({ ...d, label: channelLabel(d.name) }))} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" nameKey="label">
                    {kpis.sourceData.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} formatter={(value: string) => value} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {kpis.fromWebCount > 0 && (
            <p className="text-xs text-center text-black/70 mt-2">
              {t("dash_from_web")}: <span className="font-bold">{kpis.fromWebPct}%</span> ({kpis.fromWebCount})
            </p>
          )}
        </div>
      </div>

      {/* Revenue over time (line chart) */}
      <div className="p-4 sm:p-6 rounded-xl border-2" style={cardStyle}>
        <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4">{t("dash_ai_revenue_time")}</h3>
        <div className="h-48 sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={kpis.dailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#71717a" }}
                interval={Math.max(0, Math.floor(kpis.dailyData.length / 10))} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#71717a" }}
                tickFormatter={(v: number) => `€${v}`} />
              <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }}
                formatter={(value) => [`€${value}`, t("dash_ai_revenue")]} />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
