"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Users, UserX, Bot } from "lucide-react";
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

      // Source pie chart
      const srcArr: SourceCount[] = Object.entries(sourceCounts).map(
        ([name, value]) => ({ name, value })
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
    </div>
  );
}
