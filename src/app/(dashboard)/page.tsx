"use client";

import { KPICard } from "@/components/ui/KPICard";
import {
  CalendarCheck,
  TrendingUp,
  Clock,
  PhoneMissed,
  MessageSquare,
  Sparkles
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from "recharts";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Reservation, Conversation } from "@/lib/types";

export default function OverviewDashboard() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [data, setData] = useState([
    { name: "Mon", AI: 0, Staff: 0, Web: 0 }
  ]);

  const [metrics, setMetrics] = useState({
    totalRes: 0,
    aiBookings: 0,
    aiPercentage: "0%",
    recoveredRevenue: 0,
    noShowsPrevented: 0,
    hoursSaved: 0,
    missedCallsTurned: 0,
    lostCalls: 0,
  });

  useEffect(() => {
    if (!tenant) return;

    const supabase = createClient();

    const processReservations = (resDocs: Reservation[]) => {
      let aiCount = 0;
      let staffCount = 0;
      let webCount = 0;

      const dayCounts: Record<number, { AI: number, Staff: number, Web: number }> = {
        0: { AI: 0, Staff: 0, Web: 0 },
        1: { AI: 0, Staff: 0, Web: 0 },
        2: { AI: 0, Staff: 0, Web: 0 },
        3: { AI: 0, Staff: 0, Web: 0 },
        4: { AI: 0, Staff: 0, Web: 0 },
        5: { AI: 0, Staff: 0, Web: 0 },
        6: { AI: 0, Staff: 0, Web: 0 },
      };

      resDocs.forEach(r => {
        if (r.source === 'ai_chat' || r.source === 'ai_voice') aiCount++;
        else if (r.source === 'web') webCount++;
        else staffCount++;

        if (r.date) {
           const d = new Date(r.date);
           const day = d.getDay();
           if (r.source === 'ai_chat' || r.source === 'ai_voice') dayCounts[day].AI++;
           else if (r.source === 'web') dayCounts[day].Web++;
           else dayCounts[day].Staff++;
        }
      });

      const total = aiCount + staffCount + webCount;
      const pct = total > 0 ? Math.round((aiCount / total) * 100) : 0;

      const formatResCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: tenant.settings?.currency || 'USD' }).format(aiCount * 45);

      setMetrics(prev => ({
        ...prev,
        totalRes: total,
        aiBookings: aiCount,
        aiPercentage: `${pct}%`,
        recoveredRevenue: formatResCurrency as any,
        noShowsPrevented: Math.floor(aiCount * 0.15)
      }));

      setData([
        { name: t("dash_day_mon"), ...dayCounts[1] },
        { name: t("dash_day_tue"), ...dayCounts[2] },
        { name: t("dash_day_wed"), ...dayCounts[3] },
        { name: t("dash_day_thu"), ...dayCounts[4] },
        { name: t("dash_day_fri"), ...dayCounts[5] },
        { name: t("dash_day_sat"), ...dayCounts[6] },
        { name: t("dash_day_sun"), ...dayCounts[0] },
      ]);
    };

    const processConversations = (convDocs: Conversation[]) => {
      let hoursSaved = 0;
      let turned = 0;
      let lost = 0;

      convDocs.forEach(c => {
        hoursSaved += 5 / 60; // 5 mins per convo
        if (c.intent === "booking_request" && c.status === "resolved") turned++;
        if (c.status === "abandoned") lost++;
      });

      setMetrics(prev => ({
        ...prev,
        hoursSaved: Math.round(hoursSaved),
        missedCallsTurned: turned,
        lostCalls: lost
      }));
    };

    const fetchData = async () => {
      const [{ data: resDocs }, { data: convDocs }] = await Promise.all([
        supabase.from("reservations").select("*").eq("tenant_id", tenant.id),
        supabase.from("conversations").select("*").eq("tenant_id", tenant.id),
      ]);

      if (resDocs) processReservations(resDocs as Reservation[]);
      if (convDocs) processConversations(convDocs as Conversation[]);
    };

    fetchData();

    const channel = supabase.channel('dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${tenant.id}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenant.id}` }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant, t]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">{t("nav_overview")}</h1>
        <p className="mt-1 text-sm text-black">{t("roi_subtitle")}</p>
      </div>

      {/* Business Impact Panel (High Visibility) */}
      <div className="relative overflow-hidden rounded-2xl border-2 p-8" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
        <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-terracotta-50 via-white to-transparent opacity-60 rounded-full blur-3xl pointer-events-none transform translate-x-10 -translate-y-10"></div>
        <div className="flex items-center justify-between mb-8 relative z-10">
          <h2 className="text-xl font-bold text-zinc-900 flex items-center">
            <Sparkles className="mr-2 h-5 w-5 text-terracotta-500" />
            {t("roi_title")}
          </h2>
          <span className="text-[11px] font-bold uppercase tracking-widest text-terracotta-600 bg-terracotta-50 px-3 py-1.5 rounded-full ring-1 ring-terracotta-100/50">
            Estimated ROI
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative z-10">
          <div className="flex flex-col">
            <p className="text-sm font-medium text-black mb-1">{t("roi_recovered_revenue")}</p>
            <div className="flex items-end">
               <p className="text-4xl font-bold tracking-tight text-emerald-600">{metrics.recoveredRevenue || '$0'}</p>
            </div>
            <p className="text-xs text-black mt-2 font-medium bg-[#c4956a]/10 w-fit px-2 py-1 rounded">{t("roi_matches")}</p>
          </div>

          <div className="flex flex-col">
            <p className="text-sm font-medium text-black mb-1">{t("roi_no_shows_prevented")}</p>
            <div className="flex items-end">
               <p className="text-4xl font-bold tracking-tight text-zinc-900">{metrics.noShowsPrevented}</p>
            </div>
            <p className="text-xs text-black mt-2 font-medium bg-[#c4956a]/10 w-fit px-2 py-1 rounded">{t("roi_reminders")}</p>
          </div>

          <div className="flex flex-col">
            <p className="text-sm font-medium text-black mb-1">{t("roi_hours_saved")}</p>
            <div className="flex items-end">
               <p className="text-4xl font-bold tracking-tight text-zinc-900">{metrics.hoursSaved}<span className="text-2xl text-black">h</span></p>
            </div>
            <p className="text-xs text-black mt-2 font-medium bg-[#c4956a]/10 w-fit px-2 py-1 rounded">{t("roi_faqs")}</p>
          </div>

          <div className="flex flex-col">
            <p className="text-sm font-medium text-black mb-1">{t("roi_missed_calls")}</p>
            <div className="flex items-end">
               <p className="text-4xl font-bold tracking-tight text-zinc-900">{metrics.missedCallsTurned}</p>
            </div>
            <p className="text-xs font-semibold text-emerald-600 mt-2 bg-emerald-50 w-fit px-2 py-1 rounded">{t("roi_turned_bookings")}</p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title={t("dashboard_total_reservations")}
          value={metrics.totalRes.toString()}
          icon={<CalendarCheck className="h-5 w-5" />}
          className="border-[#c4956a]"
          trend={{ value: "+12.5%", isPositive: true }}
        />
        <KPICard
          title={t("dashboard_ai_bookings")}
          value={metrics.aiPercentage}
          valueClassName="text-terracotta-600"
          className="border-[#c4956a]"
          icon={<MessageSquare className="h-5 w-5" />}
          trend={{ value: "+5.2%", isPositive: true }}
        />
        <KPICard
          title={t("kpi_avg_response")}
          value="< 1m"
          className="border-[#c4956a]"
          icon={<Clock className="h-5 w-5" />}
          trend={{ value: "-4m", isPositive: true, label: t("kpi_vs_staff") }}
        />
        <KPICard
          title={t("kpi_lost_calls")}
          value={metrics.lostCalls.toString()}
          className="border-[#c4956a]"
          icon={<PhoneMissed className="h-5 w-5" />}
          trend={{ value: "-80%", isPositive: true, label: t("kpi_thanks_ai") }}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="p-6 rounded-2xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
          <h3 className="text-[15px] font-semibold text-zinc-900 mb-6">{t("chart_source_title")} <span className="text-black font-normal ml-1">{t("chart_source_subtitle")}</span></h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAI" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f45517" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#f45517" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorWeb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3f3f46" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#3f3f46" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#A1A1AA' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#A1A1AA' }} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: '13px' }}
                />
                <Area type="monotone" dataKey="Web" stroke="#71717a" strokeWidth={2} fillOpacity={1} fill="url(#colorWeb)" />
                <Area type="monotone" dataKey="AI" stroke="#fb7740" strokeWidth={2} fillOpacity={1} fill="url(#colorAI)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-6 rounded-2xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
          <h3 className="text-[15px] font-semibold text-zinc-900 mb-6">{t("chart_conversion_title")}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#A1A1AA' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#A1A1AA' }} />
                <Tooltip
                  cursor={{ fill: '#fafafa' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: '13px' }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }}
                  formatter={(value) => t(`dash_legend_${value.toLowerCase()}` as Extract<keyof typeof import("../../lib/i18n/dictionaries/en").en, string>) || value}
                />
                <Bar dataKey="AI" fill="#fb7740" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Staff" fill="#d4d4d8" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
}
