"use client";

import { useEffect, useState, useMemo } from "react";
import { CalendarCheck, Users, UserX, Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";

interface DayCount {
  date: string;
  count: number;
}

interface SourceCount {
  name: string;
  value: number;
}

const PIE_COLORS = ["#fb7740", "#c4956a", "#3f3f46", "#94a3b8"];

export default function DashboardPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [totalReservations, setTotalReservations] = useState(0);
  const [aiCount, setAiCount] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [totalGuests, setTotalGuests] = useState(0);
  const [noShows, setNoShows] = useState(0);
  const [dailyData, setDailyData] = useState<DayCount[]>([]);
  const [sourceData, setSourceData] = useState<SourceCount[]>([]);
  const [calView, setCalView] = useState<"month" | "year">("month");
  const [calDate, setCalDate] = useState(new Date());
  const [calData, setCalData] = useState<Record<string, { count: number; guests: number }>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedDayReservations, setSelectedDayReservations] = useState<any[]>([]);

  useEffect(() => {
    if (!tenant) return;

    const supabase = createClient();

    // Current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];

    // Last 7 days
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split("T")[0];
    });

    const fetchAll = async () => {
      const [resMonth, guestsCount, noShowCount, resWeek] = await Promise.all([
        // Reservations this month
        supabase
          .from("reservations")
          .select("id, source, date")
          .eq("tenant_id", tenant.id)
          .gte("date", monthStart)
          .lte("date", monthEnd),
        // Total guests
        supabase
          .from("guests")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
        // No-shows this month
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("status", "no_show")
          .gte("date", monthStart)
          .lte("date", monthEnd),
        // Reservations last 7 days (for bar chart)
        supabase
          .from("reservations")
          .select("id, date")
          .eq("tenant_id", tenant.id)
          .gte("date", last7[0])
          .lte("date", last7[6]),
      ]);

      // Stats cards
      const monthRes = resMonth.data || [];
      setTotalReservations(monthRes.length);

      let ai = 0;
      let staff = 0;
      const sourceCounts: Record<string, number> = {};
      monthRes.forEach((r: any) => {
        if (r.source === "ai_chat" || r.source === "ai_voice") ai++;
        else staff++;
        sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
      });
      setAiCount(ai);
      setStaffCount(staff);

      setTotalGuests(guestsCount.count || 0);
      setNoShows(noShowCount.count || 0);

      // Source pie chart with friendly labels
      const sourceLabels: Record<string, string> = {
        ai_voice: "AI Calls",
        ai_chat: "AI Chat",
        staff: "Staff",
        walk_in: "Walk-in",
        web: "Web",
      };
      const srcArr: SourceCount[] = Object.entries(sourceCounts).map(
        ([name, value]) => ({ name: sourceLabels[name] || name, value })
      );
      setSourceData(srcArr);

      // Daily bar chart
      const weekRes = resWeek.data || [];
      const dayCounts: Record<string, number> = {};
      last7.forEach((d) => (dayCounts[d] = 0));
      weekRes.forEach((r: any) => {
        if (dayCounts[r.date] !== undefined) dayCounts[r.date]++;
      });
      const dailyArr: DayCount[] = last7.map((d) => {
        const parts = d.split("-");
        const label = `${parts[1]}/${parts[2]}`;
        return { date: label, count: dayCounts[d] };
      });
      setDailyData(dailyArr);
    };

    fetchAll();

    const channel = supabase
      .channel("dashboard-realtime")
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => fetchAll()
      )
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "guests",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => fetchAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant]);

  // Calendar data fetch
  useEffect(() => {
    if (!tenant) return;
    const supabase = createClient();

    const fetchCalData = async () => {
      let start: string, end: string;
      if (calView === "month") {
        start = new Date(calDate.getFullYear(), calDate.getMonth(), 1).toISOString().split("T")[0];
        end = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).toISOString().split("T")[0];
      } else {
        start = `${calDate.getFullYear()}-01-01`;
        end = `${calDate.getFullYear()}-12-31`;
      }

      const { data } = await supabase
        .from("reservations")
        .select("date, party_size")
        .eq("tenant_id", tenant.id)
        .gte("date", start)
        .lte("date", end)
        .in("status", ["confirmed", "seated", "completed", "escalated"]);

      const map: Record<string, { count: number; guests: number }> = {};
      for (const r of (data || []) as any[]) {
        if (!map[r.date]) map[r.date] = { count: 0, guests: 0 };
        map[r.date].count++;
        map[r.date].guests += r.party_size;
      }
      setCalData(map);
    };
    fetchCalData();
  }, [tenant, calDate, calView]);

  // Fetch reservations for selected day
  useEffect(() => {
    if (!tenant || !selectedDay) { setSelectedDayReservations([]); return; }
    const supabase = createClient();
    const fetchDay = async () => {
      const { data } = await supabase
        .from("reservations")
        .select("*, guests(name, phone)")
        .eq("tenant_id", tenant.id)
        .eq("date", selectedDay)
        .in("status", ["confirmed", "seated", "completed", "escalated"])
        .order("time");
      setSelectedDayReservations(data || []);
    };
    fetchDay();
  }, [tenant, selectedDay]);

  // Calendar helpers
  const calMonthDays = useMemo(() => {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [calDate]);

  const calMonthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  const navigateCal = (dir: number) => {
    const d = new Date(calDate);
    if (calView === "month") d.setMonth(d.getMonth() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    setCalDate(d);
    setSelectedDay(null);
  };

  const getDayStr = (day: number) => {
    const m = String(calDate.getMonth() + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${calDate.getFullYear()}-${m}-${d}`;
  };

  const getMonthStr = (month: number) => {
    const m = String(month + 1).padStart(2, "0");
    return `${calDate.getFullYear()}-${m}`;
  };

  const getMonthTotal = (month: number) => {
    let count = 0, guests = 0;
    for (const [date, v] of Object.entries(calData)) {
      if (date.startsWith(getMonthStr(month))) {
        count += v.count;
        guests += v.guests;
      }
    }
    return { count, guests };
  };

  const cards = [
    {
      label: t("dashboard_total_reservations"),
      value: totalReservations,
      icon: CalendarCheck,
    },
    {
      label: "AI vs Staff",
      value: `${aiCount} AI / ${staffCount} Staff`,
      icon: Bot,
    },
    {
      label: t("nav_guests"),
      value: totalGuests,
      icon: Users,
    },
    {
      label: "No-Shows",
      value: noShows,
      icon: UserX,
    },
  ];

  return (
    <div className="p-8 w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-black tracking-tight">
          {t("nav_dashboard")}
        </h1>
        <p className="mt-1 text-sm text-black">{t("roi_subtitle")}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl p-5 border-2"
            style={{
              background: "rgba(252,246,237,0.85)",
              borderColor: "#c4956a",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">{card.label}</p>
                <p className="text-2xl font-bold text-black mt-1">
                  {card.value}
                </p>
              </div>
              <card.icon className="h-8 w-8 text-[#c4956a]" />
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Bar chart - Reservations by day */}
        <div
          className="p-6 rounded-2xl border-2"
          style={{
            background: "rgba(252,246,237,0.85)",
            borderColor: "#c4956a",
          }}
        >
          <h3 className="text-[15px] font-semibold text-black mb-6">
            Reservations (Last 7 Days)
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dailyData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e4e4e7"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#71717a" }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#71717a" }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #c4956a",
                    fontSize: "13px",
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#c4956a"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                  name="Reservations"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie chart - Source breakdown */}
        <div
          className="p-6 rounded-2xl border-2"
          style={{
            background: "rgba(252,246,237,0.85)",
            borderColor: "#c4956a",
          }}
        >
          <h3 className="text-[15px] font-semibold text-black mb-6">
            {t("chart_source_title")}
          </h3>
          <div className="h-72">
            {sourceData.length === 0 ? (
              <p className="text-sm text-black/60 text-center pt-20">
                No data yet
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name} (${value})`}
                  >
                    {sourceData.map((_entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "1px solid #c4956a",
                      fontSize: "13px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="rounded-2xl border-2 overflow-hidden" style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "#c4956a" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => navigateCal(-1)} className="p-1.5 hover:bg-[#c4956a]/10 rounded-lg"><ChevronLeft className="w-5 h-5 text-black" /></button>
            <h3 className="text-lg font-bold text-black min-w-[200px] text-center">
              {calView === "month"
                ? `${calMonthNames[calDate.getMonth()]} ${calDate.getFullYear()}`
                : calDate.getFullYear()}
            </h3>
            <button onClick={() => navigateCal(1)} className="p-1.5 hover:bg-[#c4956a]/10 rounded-lg"><ChevronRight className="w-5 h-5 text-black" /></button>
          </div>
          <div className="flex border-2 rounded-lg overflow-hidden" style={{ borderColor: "#c4956a" }}>
            <button onClick={() => { setCalView("month"); setSelectedDay(null); }} className={`px-3 py-1 text-sm font-semibold ${calView === "month" ? "text-white" : "text-black"}`} style={{ background: calView === "month" ? "#c4956a" : "rgba(252,246,237,0.6)" }}>Month</button>
            <button onClick={() => { setCalView("year"); setSelectedDay(null); }} className={`px-3 py-1 text-sm font-semibold ${calView === "year" ? "text-white" : "text-black"}`} style={{ background: calView === "year" ? "#c4956a" : "rgba(252,246,237,0.6)" }}>Year</button>
          </div>
        </div>

        {calView === "month" ? (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => (
                <div key={d} className="text-center text-xs font-bold text-black/40 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calMonthDays.map((day, i) => {
                if (day === null) return <div key={`e${i}`} />;
                const dayStr = getDayStr(day);
                const info = calData[dayStr];
                const isToday = dayStr === new Date().toISOString().split("T")[0];
                const isSelected = selectedDay === dayStr;
                return (
                  <button
                    key={dayStr}
                    onClick={() => setSelectedDay(isSelected ? null : dayStr)}
                    className={`rounded-lg p-2 text-left transition-all min-h-[70px] border ${
                      isSelected ? "border-[#c4956a] shadow-md" :
                      isToday ? "border-[#c4956a]/50" :
                      "border-transparent hover:border-[#c4956a]/30"
                    }`}
                    style={{ background: isSelected ? "rgba(196,149,106,0.15)" : undefined }}
                  >
                    <span className={`text-sm font-bold ${isToday ? "text-[#c4956a]" : "text-black"}`}>{day}</span>
                    {info && (
                      <div className="mt-1">
                        <div className="text-[10px] font-bold text-[#c4956a]">{info.count} res</div>
                        <div className="text-[10px] text-black/40">{info.guests}p</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
            {calMonthNames.map((name, i) => {
              const total = getMonthTotal(i);
              const isCurrent = i === new Date().getMonth() && calDate.getFullYear() === new Date().getFullYear();
              return (
                <button
                  key={i}
                  onClick={() => { setCalDate(new Date(calDate.getFullYear(), i, 1)); setCalView("month"); }}
                  className={`rounded-xl p-4 border-2 text-left transition-all hover:shadow-md ${isCurrent ? "border-[#c4956a]" : "border-transparent"}`}
                  style={{ background: "rgba(252,246,237,0.5)" }}
                >
                  <div className="text-sm font-bold text-black">{name}</div>
                  {total.count > 0 ? (
                    <div className="mt-2">
                      <div className="text-lg font-bold text-[#c4956a]">{total.count}</div>
                      <div className="text-[10px] text-black/40">{total.guests} personas</div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-black/20">—</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Selected day detail */}
        {selectedDay && (
          <div className="border-t px-6 py-4" style={{ borderColor: "#c4956a" }}>
            <h4 className="text-sm font-bold text-black mb-3">{selectedDay} — {calData[selectedDay]?.count || 0} reservas, {calData[selectedDay]?.guests || 0} personas</h4>
            {selectedDayReservations.length === 0 ? (
              <p className="text-xs text-black/40">No hay reservas este día</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {selectedDayReservations.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-black">{r.time}</span>
                      <span className="text-sm text-black">{r.guests?.name || "—"}</span>
                      <span className="text-xs text-black/40">{r.party_size}p</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      r.status === "confirmed" ? "bg-green-50 text-green-700" :
                      r.status === "escalated" ? "bg-orange-50 text-orange-700" :
                      r.status === "seated" ? "bg-blue-50 text-blue-700" :
                      "bg-zinc-100 text-zinc-600"
                    }`}>{r.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
