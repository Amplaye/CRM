"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Users, UserX, Bot, Clock, TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from "lucide-react";
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

    // For week chart: use last 7 days of selected month (or today if current month)
    const refDate = isCurrentMonth ? now : monthEndDate;
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(refDate); d.setDate(d.getDate() - (6 - i));
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

      // Week data
      const weekCounts: Record<string, { count: number; guests: number }> = {};
      last7.forEach(d => weekCounts[d.date] = { count: 0, guests: 0 });
      monthRes.forEach((r: any) => {
        if (weekCounts[r.date] !== undefined) {
          weekCounts[r.date].count++;
          weekCounts[r.date].guests += r.party_size;
        }
      });
      // Also check last 7 days that might be in prev month
      if (last7[0].date < monthStart) {
        const { data: extraWeek } = await supabase.from("reservations").select("date, party_size").eq("tenant_id", tenant.id).gte("date", last7[0].date).lt("date", monthStart);
        (extraWeek || []).forEach((r: any) => {
          if (weekCounts[r.date] !== undefined) {
            weekCounts[r.date].count++;
            weekCounts[r.date].guests += r.party_size;
          }
        });
      }
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

  const cards = [
    { label: t("dashboard_total_reservations"), value: totalReservations, icon: CalendarCheck },
    { label: "AI vs Staff", value: `${aiCount} AI / ${staffCount} Staff`, icon: Bot },
    { label: t("nav_guests"), value: totalGuests, icon: Users },
    { label: "No-Shows", value: noShows, icon: UserX },
  ];

  return (
    <div className="p-8 w-full space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{t("nav_dashboard")}</h1>
          <p className="mt-1 text-sm text-black/60">Performance overview</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateMonth(-1)} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-black" />
          </button>
          <div className="flex items-center gap-1 min-w-[140px] justify-center">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="border-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            >
              {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button onClick={() => navigateMonth(1)} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
            <ChevronRight className="w-5 h-5 text-black" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl p-5 border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black/60">{card.label}</p>
                <p className="text-2xl font-bold text-black mt-1">{card.value}</p>
              </div>
              <card.icon className="h-8 w-8 text-[#c4956a]" />
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
            <span className="text-xs text-black/40">
              {isViewingCurrentMonth ? new Date().toLocaleDateString() : todayRes.length > 0 ? todayRes[0]?.date : monthNames[selectedMonth]}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-bold text-black">{todayRes.length}</span>
            <span className="text-sm text-black/40">reservas</span>
            <span className="text-lg font-bold text-[#c4956a] ml-2">{todayRes.reduce((s: number, r: any) => s + r.party_size, 0)}p</span>
          </div>
          {nextRes ? (
            <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.1)" }}>
              <Clock className="w-4 h-4 text-[#c4956a]" />
              <div>
                <p className="text-xs text-black/40">Next</p>
                <p className="text-sm font-bold text-black">{nextRes.time} — {nextRes.guests?.name || "Guest"} ({nextRes.party_size}p)</p>
              </div>
            </div>
          ) : todayRes.length > 0 ? (
            <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.1)" }}>
              <CalendarCheck className="w-4 h-4 text-[#c4956a]" />
              <div>
                <p className="text-xs text-black/40">First</p>
                <p className="text-sm font-bold text-black">{todayRes[0]?.time} — {todayRes[0]?.guests?.name || "Guest"} ({todayRes[0]?.party_size}p)</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-black/30">No reservations</p>
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
              <span className="text-sm text-black/40">reservas</span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-black/40">
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
              <span className="text-sm text-black/40">reservas</span>
            </div>
            <p className="text-xs text-black/40 mt-1">{yearTotal.guests} personas total</p>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="p-6 rounded-2xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-sm font-bold text-black uppercase tracking-wider mb-6">{monthNames[selectedMonth]} — Last 7 Days</h3>
          <div className="h-64">
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

        <div className="p-6 rounded-2xl border-2" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
          <h3 className="text-sm font-bold text-black uppercase tracking-wider mb-6">{t("chart_source_title")}</h3>
          <div className="h-64">
            {sourceData.length === 0 ? (
              <p className="text-sm text-black/40 text-center pt-20">No data yet</p>
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
