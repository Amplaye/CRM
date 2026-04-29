"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download, TrendingUp, TrendingDown, Info, Sparkles,
  Users, Gauge, MessageCircle, AlertTriangle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";

/* ──────────────────────────────────────────────────────────
   Time-range helpers
   day   = today
   week  = last 7 days (including today)
   month = last 30 days
   year  = last 365 days
   all   = no filter
   ────────────────────────────────────────────────────────── */

type TimeRange = "day" | "week" | "month" | "year" | "all";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function rangeBounds(range: TimeRange): { startDate: string | null; endDate: string | null; days: number | null } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  if (range === "all") return { startDate: null, endDate: null, days: null };
  let days = 1;
  if (range === "day") days = 1;
  else if (range === "week") days = 7;
  else if (range === "month") days = 30;
  else if (range === "year") days = 365;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateStr(start), endDate: toDateStr(end), days };
}

// Bucket key for charts: day→hour; week/month→date; year/all→yyyy-mm
function bucketKey(range: TimeRange, dateStr: string, timeStr: string | null): string {
  if (range === "day") {
    // time like "HH:MM" or "HH:MM:SS"
    if (!timeStr) return "00";
    return timeStr.slice(0, 2);
  }
  if (range === "week" || range === "month") {
    return dateStr; // yyyy-mm-dd
  }
  // year / all
  return (dateStr || "").slice(0, 7); // yyyy-mm
}

function bucketLabel(range: TimeRange, key: string): string {
  if (range === "day") return `${key}h`;
  if (range === "week" || range === "month") {
    // show dd/mm
    const [, m, d] = key.split("-");
    return `${d}/${m}`;
  }
  // yyyy-mm → mm/yy
  const [y, m] = key.split("-");
  return `${m}/${y.slice(2)}`;
}

function buildBuckets(range: TimeRange, allDates: string[]): string[] {
  if (range === "day") {
    return Array.from({ length: 24 }, (_, h) => pad(h));
  }
  if (range === "week" || range === "month") {
    const { days } = rangeBounds(range);
    const keys: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = (days || 1) - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      keys.push(toDateStr(d));
    }
    return keys;
  }
  if (range === "year") {
    const keys: string[] = [];
    const now = new Date();
    now.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    }
    return keys;
  }
  // all: derive from actual data, sorted asc
  const uniq = Array.from(new Set(allDates.filter(Boolean).map((s) => s.slice(0, 7))));
  uniq.sort();
  return uniq;
}

/* ──────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────── */

const BRAND_BROWN = "#c4956a";
const BRAND_SAGE = "#7a8560";

const tooltipContentStyle = {
  borderRadius: "10px",
  border: `1px solid ${BRAND_BROWN}`,
  background: "rgba(252,246,237,0.98)",
  fontSize: "12px",
  fontFamily: "inherit",
  color: "#000",
  boxShadow: "0 4px 12px rgba(196,149,106,0.18)",
  padding: "8px 10px",
};
const tooltipLabelStyle = { color: "#000", fontWeight: 600, marginBottom: 2 };
const tooltipItemStyle = { color: "#000" };

type ReservationRow = {
  id: string;
  date: string;
  time: string | null;
  party_size: number;
  status: string;
  source: string;
  cancellation_source: string | null;
  noshow_warning_responded: boolean;
  created_at: string;
};

type WaitlistRow = {
  id: string;
  status: string;
  party_size: number;
  created_at: string;
};

type ConversationRow = {
  id: string;
  channel: string;
  status: string;
  sentiment: string;
  escalation_flag: boolean;
  created_at: string;
};

type IncidentRow = {
  id: string;
  type: string;
  status: string;
  severity: string;
  created_at: string;
};

type TenantSettings = {
  avg_spend?: number;
  ai_monthly_cost?: number;
  [k: string]: unknown;
};

export default function AnalyticsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [range, setRange] = useState<TimeRange>("month");
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Mounted flag — prevents hydration mismatch from Date()-derived values
  // and ensures Recharts containers measure non-zero dimensions before mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  /* Fetch all data for the active tenant + range. The only filter column
     used is reservations.date (YYYY-MM-DD) and created_at for waitlist,
     conversations, incidents — consistent across every KPI/chart. */
  useEffect(() => {
    if (!tenant) return;
    const supabase = createClient();
    const { startDate, endDate } = rangeBounds(range);

    const fetchAll = async () => {
      setLoading(true);

      let resQ = supabase
        .from("reservations")
        .select("id, date, time, party_size, status, source, cancellation_source, noshow_warning_responded, created_at")
        .eq("tenant_id", tenant.id);
      if (startDate && endDate) resQ = resQ.gte("date", startDate).lte("date", endDate);

      let wlQ = supabase
        .from("waitlist_entries")
        .select("id, status, party_size, created_at")
        .eq("tenant_id", tenant.id);
      if (startDate && endDate) {
        wlQ = wlQ.gte("created_at", `${startDate}T00:00:00`).lte("created_at", `${endDate}T23:59:59`);
      }

      let convQ = supabase
        .from("conversations")
        .select("id, channel, status, sentiment, escalation_flag, created_at")
        .eq("tenant_id", tenant.id);
      if (startDate && endDate) {
        convQ = convQ.gte("created_at", `${startDate}T00:00:00`).lte("created_at", `${endDate}T23:59:59`);
      }

      let incQ = supabase
        .from("incidents")
        .select("id, type, status, severity, created_at")
        .eq("tenant_id", tenant.id);
      if (startDate && endDate) {
        incQ = incQ.gte("created_at", `${startDate}T00:00:00`).lte("created_at", `${endDate}T23:59:59`);
      }

      const [resData, wlData, convData, incData] = await Promise.all([resQ, wlQ, convQ, incQ]);

      setReservations((resData.data as ReservationRow[] | null) || []);
      setWaitlist((wlData.data as WaitlistRow[] | null) || []);
      setConversations((convData.data as ConversationRow[] | null) || []);
      setIncidents((incData.data as IncidentRow[] | null) || []);
      setLoading(false);
    };

    fetchAll();
  }, [tenant, range]);

  /* ──────────────────────────────────────────────────────────
     KPI computation (all reactive to `range`)
     ────────────────────────────────────────────────────────── */

  const kpis = useMemo(() => {
    const s = (tenant?.settings || {}) as TenantSettings;
    const avgSpend: number = Number(s.avg_spend) || 50;
    const aiMonthlyCost: number = Number(s.ai_monthly_cost) || 0;

    // AI cost prorated to the selected range
    let periodCost = 0;
    const { days } = rangeBounds(range);
    if (days !== null) {
      periodCost = Math.round((aiMonthlyCost / 30) * days);
    } else {
      // "all" — we can't know lifetime cost without start date; show 0
      periodCost = 0;
    }

    // Reservations split
    const total = reservations.length;
    const avgParty = total > 0 ? reservations.reduce((a, r) => a + (r.party_size || 0), 0) / total : 2;

    const aiRes = reservations.filter((r) => r.source === "ai_chat" || r.source === "ai_voice");
    const aiResPaid = aiRes.filter((r) => r.status !== "no_show" && r.status !== "cancelled");
    const aiRevenue = aiResPaid.reduce((sum, r) => sum + (r.party_size || 0) * avgSpend, 0);

    // Waitlist matches — any entry that progressed past pure "waiting"
    // counts as a match created by the AI matching engine.
    const matchedStatuses = new Set(["match_found", "contacted", "accepted", "converted_to_booking"]);
    const waitlistMatches = waitlist.filter((w) => matchedStatuses.has(w.status));
    const waitlistMatchRevenue = waitlistMatches.reduce(
      (sum, w) => sum + (w.party_size || avgParty) * avgSpend,
      0
    );

    // No-shows
    const noShows = reservations.filter((r) => r.status === "no_show").length;
    const preventedSources = new Set([
      "reminder_24h",
      "reminder_4h",
      "chat_spontaneous",
      "voice_spontaneous",
    ]);
    const cancelledPrevented = reservations.filter(
      (r) => r.status === "cancelled" && r.cancellation_source && preventedSources.has(r.cancellation_source)
    ).length;
    const warningResponded = reservations.filter((r) => r.noshow_warning_responded === true).length;
    const noShowsPrevented = cancelledPrevented + warningResponded;

    // Reduction % = prevented / (prevented + actual). 0 when base is 0.
    const noShowBase = noShowsPrevented + noShows;
    const noShowReductionPct = noShowBase > 0 ? Math.round((noShowsPrevented / noShowBase) * 100) : 0;
    const noShowSaved = Math.round(noShowsPrevented * avgParty * avgSpend);

    // Net AI Value = gross − cost (floor at 0)
    const grossValue = Math.round(aiRevenue + waitlistMatchRevenue + noShowSaved);
    const netValue = Math.max(0, grossValue - periodCost);

    // Efficiency strip
    const totalCovers = reservations
      .filter((r) => r.status !== "cancelled" && r.status !== "no_show")
      .reduce((a, r) => a + (r.party_size || 0), 0);
    const aiHandledPct = total > 0 ? Math.round((aiRes.length / total) * 100) : 0;
    const totalConversations = conversations.length;
    const totalIncidents = incidents.length;

    /* ──────────── Chart data (same bucketing for both charts) ──────────── */
    const allDates = reservations.map((r) => r.date as string);
    const bucketKeys = buildBuckets(range, allDates);

    type Row = { key: string; label: string; covers: number; noShows: number; recovered: number };
    const rows: Record<string, Row> = {};
    for (const k of bucketKeys) {
      rows[k] = { key: k, label: bucketLabel(range, k), covers: 0, noShows: 0, recovered: 0 };
    }

    // Reservations → covers + no-shows
    reservations.forEach((r) => {
      const k = bucketKey(range, r.date, r.time);
      if (!rows[k]) return;
      if (r.status === "no_show") {
        rows[k].noShows += 1;
      } else if (r.status !== "cancelled") {
        rows[k].covers += r.party_size || 0;
      }
    });

    // Waitlist matches bucketed by created_at date
    waitlistMatches.forEach((w) => {
      const d = (w.created_at || "").slice(0, 10);
      const t = (w.created_at || "").slice(11, 16);
      const k = bucketKey(range, d, t);
      if (rows[k]) rows[k].recovered += 1;
    });

    const chartData = Object.values(rows);

    return {
      // Hero
      netValue,
      grossValue,
      periodCost,
      waitlistMatchCount: waitlistMatches.length,
      waitlistMatchRevenue: Math.round(waitlistMatchRevenue),
      noShowReductionPct,
      noShowSaved,
      noShowsPrevented,
      noShows,
      // Strip
      totalCovers,
      aiHandledPct,
      aiCount: aiRes.length,
      staffCount: total - aiRes.length,
      totalConversations,
      totalIncidents,
      // Charts
      chartData,
      avgSpend,
    };
  }, [reservations, waitlist, conversations, incidents, tenant, range]);

  /* ──────────── render ──────────── */

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  const rangeLabel = (r: TimeRange) => {
    const map: Record<TimeRange, string> = {
      day: t("analytics_range_day"),
      week: t("analytics_range_week"),
      month: t("analytics_range_month"),
      year: t("analytics_range_year"),
      all: t("analytics_all_time"),
    };
    return map[r];
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6 sm:space-y-8 lg:space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{t("analytics_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("analytics_subtitle")}</p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Range toggle: day / week / month / year / all */}
          <div
            className="inline-flex rounded-lg border-2 overflow-hidden flex-shrink-0"
            style={{ borderColor: "#c4956a" }}
          >
            {(["day", "week", "month", "year", "all"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className="px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors min-h-[36px]"
                style={{
                  background: range === r ? "#c4956a" : "rgba(252,246,237,0.6)",
                  color: range === r ? "#fff" : "#000",
                }}
              >
                {rangeLabel(r)}
              </button>
            ))}
          </div>

          <button
            className="inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
          >
            <Download className="-ml-1 mr-2 h-4 w-4" />
            {t("analytics_export")}
          </button>
        </div>
      </div>

      {/* Hero — 3 KPIs */}
      <div
        className="rounded-2xl p-6 sm:p-8 border-2 relative overflow-hidden"
        style={{
          background: "rgba(252,246,237,0.85)",
          borderColor: "#c4956a",
          boxShadow: "0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)",
        }}
      >
        <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-emerald-50 via-white to-transparent opacity-60 rounded-full blur-3xl pointer-events-none transform translate-x-10 -translate-y-10" />

        <div className="flex items-center mb-6 relative z-10 text-black">
          <Info className="h-4 w-4 mr-2" />
          <span className="text-sm font-medium">
            {t("analytics_factors_dynamic").replace("{spend}", String(kpis.avgSpend))}
          </span>
          <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-black/55">
            {rangeLabel(range)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 relative z-10">
          {/* Net AI Value */}
          <div className="border-l-2 border-emerald-100 pl-6">
            <p className="text-black font-semibold text-[13px] mb-2 uppercase tracking-widest flex items-center">
              <Sparkles className="h-4 w-4 mr-1.5 text-emerald-500" /> {t("analytics_net_value")}
            </p>
            <p className="text-5xl font-bold tracking-tight text-black tabular-nums">
              €{kpis.netValue.toLocaleString("es-ES")}
            </p>
            <div className="mt-4 flex items-center flex-wrap gap-2">
              <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-sm font-semibold flex items-center">
                <TrendingUp className="h-4 w-4 mr-1" />
                €{kpis.grossValue.toLocaleString("es-ES")} {t("analytics_gross")}
              </span>
              {kpis.periodCost > 0 && (
                <span className="text-xs font-medium text-black/60">
                  − €{kpis.periodCost.toLocaleString("es-ES")} {t("analytics_ai_cost")}
                </span>
              )}
            </div>
          </div>

          {/* Waitlist Matches */}
          <div className="border-l border-zinc-100 pl-6">
            <p className="text-black font-semibold text-[13px] mb-2 uppercase tracking-widest">
              {t("analytics_waitlist_matches")}
            </p>
            <p className="text-4xl font-bold tracking-tight text-black tabular-nums">
              €{kpis.waitlistMatchRevenue.toLocaleString("es-ES")}
            </p>
            <p className="text-black font-medium mt-3 text-sm">
              {kpis.waitlistMatchCount} {t("analytics_recovered_seats_dynamic")}
            </p>
          </div>

          {/* No-Show Reduction */}
          <div className="border-l border-zinc-100 pl-6">
            <p className="text-black font-semibold text-[13px] mb-2 uppercase tracking-widest">
              {t("analytics_noshow_reduction")}
            </p>
            <p className="text-4xl font-bold tracking-tight text-black tabular-nums">
              {kpis.noShowReductionPct > 0 ? `-${kpis.noShowReductionPct}%` : "—"}
            </p>
            <div className="mt-3 flex items-center text-sm font-medium text-emerald-600">
              <TrendingDown className="h-4 w-4 mr-1" />
              €{kpis.noShowSaved.toLocaleString("es-ES")} {t("analytics_saved_loss")}
            </div>
          </div>
        </div>
      </div>

      {/* Key metrics strip — reacts to range */}
      <div
        className="rounded-2xl border-2 overflow-hidden"
        style={cardStyle}
      >
        <div
          className="grid grid-cols-2 lg:grid-cols-4 divide-x-0 lg:divide-x-2 divide-y-2 lg:divide-y-0"
          style={{ borderColor: "#c4956a" }}
        >
          {[
            { icon: Users, label: t("analytics_total_covers"), value: String(kpis.totalCovers), sub: `${reservations.length} ${t("analytics_bookings")}` },
            { icon: Gauge, label: t("analytics_ai_handled"), value: `${kpis.aiHandledPct}%`, sub: `${kpis.aiCount} AI / ${kpis.staffCount} Staff` },
            { icon: MessageCircle, label: t("analytics_conversations"), value: String(kpis.totalConversations), sub: t("analytics_in_range") },
            { icon: AlertTriangle, label: t("analytics_incidents"), value: String(kpis.totalIncidents), sub: t("analytics_in_range") },
          ].map((m, i) => {
            const Icon = m.icon;
            return (
              <div
                key={i}
                className="p-4 sm:p-5 flex items-center gap-3 min-h-[96px]"
                style={{ borderColor: "#c4956a" }}
              >
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0"
                  style={{ background: "rgba(196,149,106,0.14)" }}
                >
                  <Icon className="w-5 h-5" style={{ color: BRAND_BROWN }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-black/65 leading-tight">
                    {m.label}
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-black tabular-nums leading-tight mt-0.5">
                    {m.value}
                  </p>
                  <p className="text-[10px] sm:text-[11px] text-black/55 leading-tight mt-0.5">{m.sub}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* Chart 1: No-Shows vs Recovered */}
        <div
          className="p-6 rounded-2xl border-2"
          style={{
            background: "rgba(252,246,237,0.85)",
            borderColor: "#c4956a",
            boxShadow: "0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)",
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[15px] font-semibold text-black">{t("analytics_chart_noshow_title")}</h3>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-black/55">
              {rangeLabel(range)}
            </span>
          </div>
          <div className="h-80">
            {!mounted || loading ? (
              <div className="h-full flex items-center justify-center text-sm text-black/60">…</div>
            ) : kpis.chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-black/60">
                {t("analytics_no_data")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} debounce={50}>
                <LineChart data={kpis.chartData} margin={{ top: 5, right: 30, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(196,149,106,0.22)" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b6258", fontSize: 11 }}
                    interval={Math.max(0, Math.floor(kpis.chartData.length / 10))}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#6b6258", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="noShows"
                    name={t("analytics_legend_noshows")}
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="recovered"
                    name={t("analytics_legend_recovered")}
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Chart 2: Total Covers trend */}
        <div
          className="p-6 rounded-2xl border-2"
          style={{
            background: "rgba(252,246,237,0.85)",
            borderColor: "#c4956a",
            boxShadow: "0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)",
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[15px] font-semibold text-black">{t("analytics_chart_covers_title")}</h3>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-black/55">
              {rangeLabel(range)}
            </span>
          </div>
          <div className="h-80">
            {!mounted || loading ? (
              <div className="h-full flex items-center justify-center text-sm text-black/60">…</div>
            ) : kpis.chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-black/60">
                {t("analytics_no_data")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} debounce={50}>
                <BarChart data={kpis.chartData} margin={{ top: 5, right: 30, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(196,149,106,0.22)" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b6258", fontSize: 11 }}
                    interval={Math.max(0, Math.floor(kpis.chartData.length / 10))}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#6b6258", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(196,149,106,0.08)" }}
                    contentStyle={tooltipContentStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                  <Bar
                    dataKey="covers"
                    name={t("analytics_legend_covers")}
                    fill={BRAND_SAGE}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={60}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
