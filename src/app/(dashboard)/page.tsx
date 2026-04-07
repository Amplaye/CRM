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

  // Month navigation
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const navigateMonth = (dir: number) => {
    let m = selectedMonth + dir;
    let y = selectedYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setSelectedMonth(m);
    setSelectedYear(y);
  };

  /* ─── data fetch ─── */

  useEffect(() => {
    if (!tenant) return;
    const supabase = createClient();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const monthStart = toDateStr(new Date(selectedYear, selectedMonth, 1));
    const monthEnd = toDateStr(new Date(selectedYear, selectedMonth + 1, 0));
    const prevMonthStart = toDateStr(new Date(selectedYear, selectedMonth - 1, 1));
    const prevMonthEnd = toDateStr(new Date(selectedYear, selectedMonth, 0));

    const fetchAll = async () => {
      const [resMonth, resPrev, waitlistData] = await Promise.all([
        supabase.from("reservations")
          .select("id, source, date, time, party_size, status, created_at")
          .eq("tenant_id", tenant.id)
          .gte("date", monthStart).lte("date", monthEnd),
        supabase.from("reservations")
          .select("id, source, date, party_size, status, created_at")
          .eq("tenant_id", tenant.id)
          .gte("date", prevMonthStart).lte("date", prevMonthEnd),
        supabase.from("waitlist_entries")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("status", "converted_to_booking")
          .gte("created_at", monthStart)
          .lte("created_at", monthEnd + "T23:59:59"),
      ]);

      setReservations(resMonth.data || []);
      setPrevMonthRes(resPrev.data || []);
      setWaitlistConverted((waitlistData.data || []).length);
    };

    fetchAll();

    const channel = supabase.channel("dashboard-realtime")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${tenant.id}` }, () => fetchAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant, selectedMonth, selectedYear]);

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

    // ROI
    const totalValue = aiRevenue + waitlistRevenue + noShowValue;
    const roi = aiMonthlyCost > 0 ? Math.round((totalValue / aiMonthlyCost) * 100) : 0;

    // Efficiency
    const aiHandledPct = total > 0 ? Math.round((aiRes.length / total) * 100) : 0;
    const staffHoursSaved = Math.round(aiRes.length * 5 / 60 * 10) / 10; // 5 min per booking

    // Previous month comparison
    const prevAi = prevMonthRes.filter(r => r.source === "ai_chat" || r.source === "ai_voice");
    const prevAiRevenue = prevAi.reduce((sum, r) => sum + r.party_size * avgSpend, 0);
    const revenueChange = prevAiRevenue > 0 ? Math.round(((aiRevenue - prevAiRevenue) / prevAiRevenue) * 100) : (aiRevenue > 0 ? 100 : 0);

    // Daily chart data (AI vs Staff per day)
    const dailyMap: Record<string, { date: string; ai: number; staff: number; revenue: number }> = {};
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      dailyMap[key] = { date: String(d), ai: 0, staff: 0, revenue: 0 };
    }
    reservations.forEach(r => {
      if (dailyMap[r.date]) {
        if (r.source === "ai_chat" || r.source === "ai_voice") {
          dailyMap[r.date].ai++;
          dailyMap[r.date].revenue += r.party_size * avgSpend;
        } else {
          dailyMap[r.date].staff++;
        }
      }
    });
    const dailyData = Object.values(dailyMap);

    // Source breakdown for pie
    const sourceCounts: Record<string, number> = {};
    reservations.forEach(r => { sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1; });
    const sourceLabels: Record<string, string> = { ai_voice: "AI Voice", ai_chat: "AI Chat", staff: "Staff", walk_in: "Walk-in", web: "Web" };
    const sourceData = Object.entries(sourceCounts).map(([name, value]) => ({ name: sourceLabels[name] || name, value }));

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
      avgParty: Math.round(avgParty * 10) / 10,
    };
  }, [reservations, prevMonthRes, waitlistConverted, tenant, selectedMonth, selectedYear]);

  /* ─── render ─── */

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-black tracking-tight">{t("nav_dashboard")}</h1>
          <p className="mt-0.5 text-xs sm:text-sm text-black/60">AI performance &amp; business impact</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button onClick={() => navigateMonth(-1)} className="p-1.5 sm:p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
          </button>
          <div className="flex items-center gap-1 min-w-[120px] sm:min-w-[140px] justify-center">
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
              {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button onClick={() => navigateMonth(1)} className="p-1.5 sm:p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 1 — HERO: AI Generated Value
          ══════════════════════════════════════════════ */}
      <div className="rounded-xl border-2 p-4 sm:p-6" style={cardStyle}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#c4956a]" />
            <h2 className="text-sm sm:text-base font-bold text-black">AI Generated Value</h2>
            <span className="text-xs text-black/50">{monthNames[selectedMonth]} {selectedYear}</span>
          </div>
          {kpis.roi > 0 && (
            <span className="text-xs font-bold px-3 py-1 rounded-full border" style={{ color: "#22c55e", borderColor: "#22c55e" }}>
              +{kpis.roi}% ROI
            </span>
          )}
        </div>

        {/* Big number */}
        <div className="mb-6">
          <p className="text-3xl sm:text-4xl font-bold text-[#22c55e]">€{kpis.totalValue.toLocaleString()}</p>
          {kpis.revenueChange !== 0 && (
            <div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${kpis.revenueChange > 0 ? "text-green-600" : "text-red-500"}`}>
              {kpis.revenueChange > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {kpis.revenueChange > 0 ? "+" : ""}{kpis.revenueChange}% vs prev month
            </div>
          )}
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Moon className="w-3.5 h-3.5 text-indigo-500" />
              <p className="text-xs text-black/70 font-medium">Out-of-Hours</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.outOfHoursRevenue.toLocaleString()}</p>
            <p className="text-xs text-black/50">{kpis.outOfHoursCount} bookings while closed</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Phone className="w-3.5 h-3.5 text-[#fb7740]" />
              <p className="text-xs text-black/70 font-medium">AI Voice Calls</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.voiceRevenue.toLocaleString()}</p>
            <p className="text-xs text-black/50">{kpis.voiceCount} calls converted</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />
              <p className="text-xs text-black/70 font-medium">Waitlist Recovered</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.waitlistRevenue.toLocaleString()}</p>
            <p className="text-xs text-black/50">{kpis.waitlistConverted} recoveries</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Bot className="w-3.5 h-3.5 text-[#c4956a]" />
              <p className="text-xs text-black/70 font-medium">AI Chat</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-black">€{kpis.chatRevenue.toLocaleString()}</p>
            <p className="text-xs text-black/50">{kpis.chatCount} WhatsApp bookings</p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 2 — DRIVERS
          ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Bookings While Closed", value: kpis.outOfHoursCount, icon: Moon, color: "#6366f1", sub: "out-of-hours" },
          { label: "Calls Converted", value: kpis.voiceCount, icon: Phone, color: "#fb7740", sub: "by AI voice" },
          { label: "Waitlist Recoveries", value: kpis.waitlistConverted, icon: RefreshCw, color: "#22c55e", sub: "auto-filled" },
          { label: "No-Shows Prevented", value: kpis.noShowsPrevented, icon: ShieldCheck, color: "#c4956a", sub: `${kpis.noShows} actual no-shows` },
        ].map(card => (
          <div key={card.label} className="rounded-xl p-3 sm:p-5 border-2" style={cardStyle}>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-medium text-black/70 truncate">{card.label}</p>
                <p className="text-xl sm:text-2xl font-bold mt-0.5 sm:mt-1" style={{ color: card.color }}>{card.value}</p>
                <p className="text-xs text-black/50 mt-0.5">{card.sub}</p>
              </div>
              <card.icon className="h-6 w-6 sm:h-8 sm:w-8 flex-shrink-0 ml-2" style={{ color: card.color, opacity: 0.6 }} />
            </div>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 3 — EFFICIENCY
          ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl p-3 sm:p-5 border-2" style={cardStyle}>
          <div className="flex items-center gap-1.5 mb-1">
            <Gauge className="w-4 h-4 text-[#c4956a]" />
            <p className="text-xs font-medium text-black/70">AI Handled</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-black">{kpis.aiHandledPct}%</p>
          <p className="text-xs text-black/50">{kpis.aiCount} AI / {kpis.staffCount} Staff</p>
        </div>
        <div className="rounded-xl p-3 sm:p-5 border-2" style={cardStyle}>
          <div className="flex items-center gap-1.5 mb-1">
            <Timer className="w-4 h-4 text-[#c4956a]" />
            <p className="text-xs font-medium text-black/70">Staff Hours Saved</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-black">{kpis.staffHoursSaved}h</p>
          <p className="text-xs text-black/50">~5 min per AI booking</p>
        </div>
        <div className="rounded-xl p-3 sm:p-5 border-2" style={cardStyle}>
          <div className="flex items-center gap-1.5 mb-1">
            <UsersRound className="w-4 h-4 text-[#c4956a]" />
            <p className="text-xs font-medium text-black/70">Total Bookings</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-black">{kpis.total}</p>
          <p className="text-xs text-black/50">avg {kpis.avgParty} covers each</p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          SECTION 4 — CHARTS
          ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        {/* AI vs Staff bookings over time */}
        <div className="p-4 sm:p-6 rounded-xl border-2" style={cardStyle}>
          <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4">AI vs Staff Bookings</h3>
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kpis.dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#71717a" }}
                  interval={Math.max(0, Math.floor(kpis.dailyData.length / 10))} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#71717a" }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="ai" stackId="a" fill="#fb7740" radius={[0, 0, 0, 0]} name="AI" />
                <Bar dataKey="staff" stackId="a" fill="#c4956a" radius={[4, 4, 0, 0]} name="Staff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Channel breakdown pie */}
        <div className="p-4 sm:p-6 rounded-xl border-2" style={cardStyle}>
          <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4">Channel Breakdown</h3>
          <div className="h-48 sm:h-64">
            {kpis.sourceData.length === 0 ? (
              <p className="text-sm text-black/50 text-center pt-20">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={kpis.sourceData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value"
                    label={({ name, value }) => `${name} (${value})`}>
                    {kpis.sourceData.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Revenue over time (line chart) */}
      <div className="p-4 sm:p-6 rounded-xl border-2" style={cardStyle}>
        <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4">AI Revenue Over Time</h3>
        <div className="h-48 sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={kpis.dailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#71717a" }}
                interval={Math.max(0, Math.floor(kpis.dailyData.length / 10))} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#71717a" }}
                tickFormatter={(v: number) => `€${v}`} />
              <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }}
                formatter={(value) => [`€${value}`, "AI Revenue"]} />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
