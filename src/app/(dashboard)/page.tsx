"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Users, UserX, Bot, Clock, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, XCircle, Sparkles, ShieldCheck, Timer, MessageSquare } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";

interface DayCount { date: string; label: string; count: number; guests: number; }
interface SourceCount { name: string; value: number; }

const PIE_COLORS = ["#fb7740", "#c4956a", "#3f3f46", "#94a3b8", "#22c55e"];

export default function DashboardPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [totalReservations, setTotalReservations] = useState(0);
  const [aiCount, setAiCount] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [totalGuests, setTotalGuests] = useState(0);
  const [noShows, setNoShows] = useState(0);
  const [sourceData, setSourceData] = useState<SourceCount[]>([]);
  const [waitlistConverted, setWaitlistConverted] = useState(0);
  const [remindersNoShows, setRemindersNoShows] = useState({ reminded: 0, noShows: 0 });
  const [aiHandledPct, setAiHandledPct] = useState(0);
  const [totalCovers, setTotalCovers] = useState(0);

  // Timeline data
  const [todayRes, setTodayRes] = useState<any[]>([]);
  const [weekData, setWeekData] = useState<DayCount[]>([]);
  const [monthTotal, setMonthTotal] = useState({ count: 0, guests: 0 });
  const [prevMonthTotal, setPrevMonthTotal] = useState({ count: 0, guests: 0 });
  const [yearTotal, setYearTotal] = useState({ count: 0, guests: 0 });

  // Selected period
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

  useEffect(() => {
    if (!tenant) return;
    const supabase = createClient();

    // Timezone-safe date formatting (avoids UTC shift from toISOString)
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const now = new Date();
    const todayStr = toDateStr(now);
    const monthStartDate = new Date(selectedYear, selectedMonth, 1);
    const monthEndDate = new Date(selectedYear, selectedMonth + 1, 0);
    const monthStart = toDateStr(monthStartDate);
    const monthEnd = toDateStr(monthEndDate);
    const prevMonthStart = toDateStr(new Date(selectedYear, selectedMonth - 1, 1));
    const prevMonthEnd = toDateStr(new Date(selectedYear, selectedMonth, 0));
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;

    const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();

    // For week chart: show next 7 days from today (current month) or first 7 days with data (past month)
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = isCurrentMonth ? new Date(now) : new Date(selectedYear, selectedMonth, 1);
      d.setDate(d.getDate() + i);
      return { date: toDateStr(d), label: dayNames[d.getDay()] };
    });

    // For "today" box: if viewing current month show today's data, otherwise show busiest day of month
    const todayQuery = isCurrentMonth ? todayStr : null;

    const fetchAll = async () => {
      const [resMonth, prevMonth, resYear, resToday, guestsCount, noShowCount] = await Promise.all([
        supabase.from("reservations").select("id, source, date, party_size").eq("tenant_id", tenant.id).gte("date", monthStart).lte("date", monthEnd),
        supabase.from("reservations").select("id, party_size").eq("tenant_id", tenant.id).gte("date", prevMonthStart).lte("date", prevMonthEnd),
        supabase.from("reservations").select("id, party_size").eq("tenant_id", tenant.id).gte("date", yearStart).lte("date", yearEnd),
        todayQuery
          ? supabase.from("reservations").select("*, guests(name)").eq("tenant_id", tenant.id).eq("date", todayQuery).in("status", ["confirmed", "seated", "completed", "escalated"]).order("time")
          : Promise.resolve({ data: [], error: null }),
        supabase.from("guests").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
        supabase.from("reservations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "no_show").gte("date", monthStart).lte("date", monthEnd),
      ]);

      // Fetch AI impact data in parallel
      const [waitlistData, conversationsData] = await Promise.all([
        supabase.from("waitlist_entries").select("id, status").eq("tenant_id", tenant.id).eq("status", "converted_to_booking").gte("created_at", monthStart).lte("created_at", monthEnd + "T23:59:59"),
        supabase.from("conversations").select("id, channel").eq("tenant_id", tenant.id).gte("created_at", monthStart).lte("created_at", monthEnd + "T23:59:59"),
      ]);

      setWaitlistConverted((waitlistData.data || []).length);

      const monthRes = resMonth.data || [];
      setTotalReservations(monthRes.length);

      let ai = 0, staff = 0;
      const sourceCounts: Record<string, number> = {};
      monthRes.forEach((r: any) => {
        if (r.source === "ai_chat" || r.source === "ai_voice") ai++; else staff++;
        sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
      });
      setAiCount(ai);
      setStaffCount(staff);
      setTotalGuests(guestsCount.count || 0);
      setNoShows(noShowCount.count || 0);

      const sourceLabels: Record<string, string> = { ai_voice: "AI Calls", ai_chat: "AI Chat", staff: "Staff", walk_in: "Walk-in", web: "Web" };
      setSourceData(Object.entries(sourceCounts).map(([name, value]) => ({ name: sourceLabels[name] || name, value })));

      // AI handled percentage
      const pct = monthRes.length > 0 ? Math.round((ai / monthRes.length) * 100) : 0;
      setAiHandledPct(pct);

      // Total covers (party_size sum)
      setTotalCovers(monthRes.reduce((s: number, r: any) => s + r.party_size, 0));

      // No-show vs reminded ratio
      const totalReminded = (conversationsData.data || []).length;
      setRemindersNoShows({ reminded: totalReminded, noShows: noShowCount.count || 0 });

      // Today (or busiest day if viewing past month)
      if (isCurrentMonth) {
        setTodayRes(resToday.data || []);
      } else {
        // Find busiest day of the selected month
        const dayTotals: Record<string, { count: number; guests: number }> = {};
        monthRes.forEach((r: any) => {
          if (!dayTotals[r.date]) dayTotals[r.date] = { count: 0, guests: 0 };
          dayTotals[r.date].count++;
          dayTotals[r.date].guests += r.party_size;
        });
        const busiest = Object.entries(dayTotals).sort((a, b) => b[1].count - a[1].count)[0];
        if (busiest) {
          const { data: busiestData } = await supabase.from("reservations").select("*, guests(name)").eq("tenant_id", tenant.id).eq("date", busiest[0]).in("status", ["confirmed", "seated", "completed", "escalated"]).order("time");
          setTodayRes(busiestData || []);
        } else {
          setTodayRes([]);
        }
      }

      // Week data — fetch directly for the 7-day range
      const weekStart = last7[0].date;
      const weekEnd = last7[6].date;
      const { data: weekRes } = await supabase.from("reservations").select("date, party_size").eq("tenant_id", tenant.id).gte("date", weekStart).lte("date", weekEnd);
      const weekCounts: Record<string, { count: number; guests: number }> = {};
      last7.forEach(d => weekCounts[d.date] = { count: 0, guests: 0 });
      (weekRes || []).forEach((r: any) => {
        if (weekCounts[r.date] !== undefined) {
          weekCounts[r.date].count++;
          weekCounts[r.date].guests += r.party_size;
        }
      });
      setWeekData(last7.map(d => ({ ...d, count: weekCounts[d.date].count, guests: weekCounts[d.date].guests })));

      // Month totals
      setMonthTotal({ count: monthRes.length, guests: monthRes.reduce((s: number, r: any) => s + r.party_size, 0) });
      const pm = prevMonth.data || [];
      setPrevMonthTotal({ count: pm.length, guests: pm.reduce((s: number, r: any) => s + r.party_size, 0) });

      // Year total
      const yr = resYear.data || [];
      setYearTotal({ count: yr.length, guests: yr.reduce((s: number, r: any) => s + r.party_size, 0) });
    };

    fetchAll();

    const channel = supabase.channel("dashboard-realtime")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${tenant.id}` }, () => fetchAll())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "guests", filter: `tenant_id=eq.${tenant.id}` }, () => fetchAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant, selectedMonth, selectedYear]);

  const isViewingCurrentMonth = selectedMonth === new Date().getMonth() && selectedYear === new Date().getFullYear();
  const nowHH = new Date().getHours() * 60 + new Date().getMinutes();
  const nextRes = isViewingCurrentMonth ? todayRes.find((r: any) => {
    const [h, m] = r.time.split(":").map(Number);
    return h * 60 + m > nowHH;
  }) : null;

  const monthChange = prevMonthTotal.count > 0
    ? Math.round(((monthTotal.count - prevMonthTotal.count) / prevMonthTotal.count) * 100)
    : monthTotal.count > 0 ? 100 : 0;

  const maxWeekCount = Math.max(...weekData.map(d => d.count), 1);

  const avgSpendPerCover = 50;
  const recoveredRevenue = waitlistConverted * 2 * avgSpendPerCover; // avg 2 covers per waitlist match

  const cards = [
    { label: t("dashboard_total_reservations"), value: totalReservations, icon: CalendarCheck, sub: `${totalCovers} covers` },
    { label: "AI Handled", value: `${aiHandledPct}%`, icon: Bot, sub: `${aiCount} AI / ${staffCount} Staff`, valueColor: "#22c55e" },
    { label: t("nav_guests"), value: totalGuests, icon: Users },
    { label: "No-Shows", value: noShows, icon: UserX },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-black tracking-tight">{t("nav_dashboard")}</h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-black">Monitor your AI agent&apos;s performance and restaurant operations.</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button onClick={() => navigateMonth(-1)} className="p-1.5 sm:p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
          </button>
          <div className="flex items-center gap-1 min-w-[120px] sm:min-w-[140px] justify-center">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            >
              {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border-2 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            >
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

      {/* AI Business Impact */}
      <div className="rounded-xl border-2 p-4 sm:p-6" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#c4956a]" />
            <h2 className="text-sm sm:text-base font-bold text-black">AI Business Impact</h2>
            <span className="text-xs text-black">vs Last Month</span>
          </div>
          <span className="text-xs font-bold px-3 py-1 rounded-full border" style={{ color: "#22c55e", borderColor: "#22c55e" }}>
            ESTIMATED ROI
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div>
            <p className="text-xs text-black font-medium">Recovered Revenue</p>
            <p className="text-xl sm:text-2xl font-bold text-[#22c55e]">€{recoveredRevenue.toLocaleString()}</p>
            <p className="text-xs text-black">{waitlistConverted} waitlist matches</p>
          </div>
          <div>
            <p className="text-xs text-black font-medium">No-Shows Prevented</p>
            <p className="text-xl sm:text-2xl font-bold text-black">{remindersNoShows.reminded > 0 ? Math.max(0, remindersNoShows.reminded - remindersNoShows.noShows) : 0}</p>
            <p className="text-xs text-black">via auto-reminders</p>
          </div>
          <div>
            <p className="text-xs text-black font-medium">AI Conversations</p>
            <p className="text-xl sm:text-2xl font-bold text-black">{remindersNoShows.reminded}</p>
            <p className="text-xs text-black">handled automatically</p>
          </div>
          <div>
            <p className="text-xs text-black font-medium">Total Covers</p>
            <p className="text-xl sm:text-2xl font-bold text-black">{totalCovers}</p>
            <p className="text-xs text-black">{totalReservations} reservations</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {cards.map((card: any) => (
          <div key={card.label} className="rounded-xl p-3 sm:p-5 border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-medium text-black truncate">{card.label}</p>
                <p className="text-lg sm:text-2xl font-bold mt-0.5 sm:mt-1" style={{ color: card.valueColor || "black" }}>{card.value}</p>
                {card.sub && <p className="text-xs text-black mt-0.5">{card.sub}</p>}
              </div>
              <card.icon className="h-6 w-6 sm:h-8 sm:w-8 text-[#c4956a] flex-shrink-0 ml-2" />
            </div>
          </div>
        ))}
      </div>

      {/* Timeline: Today → Month → Year */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* TODAY */}
        <div className="rounded-xl border-2 p-5" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-black uppercase tracking-wider">
              {isViewingCurrentMonth ? "Today" : "Top Day"}
            </h3>
            <span className="text-xs text-black">
              {isViewingCurrentMonth ? new Date().toLocaleDateString() : todayRes.length > 0 ? todayRes[0]?.date : monthNames[selectedMonth]}
            </span>
          </div>
          {isViewingCurrentMonth && new Date().getDay() === 1 ? (
            <div className="flex items-center gap-3 p-4 rounded-lg" style={{ background: "rgba(196,149,106,0.08)" }}>
              <XCircle className="w-6 h-6 text-black flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-black">No hay turno hoy</p>
                <p className="text-xs text-black">El restaurante está cerrado los lunes</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-3xl font-bold text-black">{todayRes.length}</span>
                <span className="text-sm text-black">reservas</span>
                <span className="text-lg font-bold text-[#c4956a] ml-2">{todayRes.reduce((s: number, r: any) => s + r.party_size, 0)}p</span>
              </div>
              {nextRes ? (
                <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.1)" }}>
                  <Clock className="w-4 h-4 text-[#c4956a]" />
                  <div>
                    <p className="text-xs text-black">Next</p>
                    <p className="text-sm font-bold text-black">{nextRes.time} — {nextRes.guests?.name || "Guest"} ({nextRes.party_size}p)</p>
                  </div>
                </div>
              ) : todayRes.length > 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.1)" }}>
                  <CalendarCheck className="w-4 h-4 text-[#c4956a]" />
                  <div>
                    <p className="text-xs text-black">First</p>
                    <p className="text-sm font-bold text-black">{todayRes[0]?.time} — {todayRes[0]?.guests?.name || "Guest"} ({todayRes[0]?.party_size}p)</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-black">No reservations</p>
              )}
            </>
          )}
        </div>

        {/* MONTH + YEAR */}
        <div className="rounded-xl border-2 p-5 flex flex-col justify-between" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          {/* Month */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-black uppercase tracking-wider">{monthNames[selectedMonth]} {selectedYear}</h3>
              {monthChange !== 0 && (
                <div className={`flex items-center gap-1 text-xs font-bold ${monthChange > 0 ? "text-green-600" : "text-red-500"}`}>
                  {monthChange > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {monthChange > 0 ? "+" : ""}{monthChange}%
                </div>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-black">{monthTotal.count}</span>
              <span className="text-sm text-black">reservas</span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-black">
              <span>{monthTotal.guests} personas</span>
              <span>·</span>
              <span>prev: {prevMonthTotal.count}</span>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t" style={{ borderColor: "rgba(196,149,106,0.3)" }} />

          {/* Year */}
          <div>
            <h3 className="text-sm font-bold text-black uppercase tracking-wider mb-2">{selectedYear}</h3>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-black">{yearTotal.count}</span>
              <span className="text-sm text-black">reservas</span>
            </div>
            <p className="text-xs text-black mt-1">{yearTotal.guests} personas total</p>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <div className="p-4 sm:p-6 rounded-2xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4 sm:mb-6">{isViewingCurrentMonth ? "Next 7 Days" : `${monthNames[selectedMonth]} ${selectedYear}`}</h3>
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#71717a" }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#71717a" }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #c4956a", fontSize: "13px" }} />
                <Bar dataKey="count" fill="#c4956a" radius={[4, 4, 0, 0]} maxBarSize={40} name="Reservations" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-4 sm:p-6 rounded-2xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-xs sm:text-sm font-bold text-black uppercase tracking-wider mb-4 sm:mb-6">{t("chart_source_title")}</h3>
          <div className="h-48 sm:h-64">
            {sourceData.length === 0 ? (
              <p className="text-sm text-black text-center pt-20">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value"
                    label={({ name, value }) => `${name} (${value})`}>
                    {sourceData.map((_entry, index) => (
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
    </div>
  );
}
