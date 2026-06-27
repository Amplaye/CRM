"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart as PieIcon, Users, Calculator, Wallet, TrendingUp, Layers, Download, Building2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { KPICard } from "@/components/ui/KPICard";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { WipComingSoon } from "@/components/management/WipComingSoon";
import { canSeeWip } from "@/lib/billing/wip";
import { plSummary, plByBand, periodFoodCost, plDelta } from "@/lib/management/pl";
import type { PlDelta, PlSummary, RecipeLine, SaleRow } from "@/lib/management/types";
import type { Shift } from "@/lib/management/time-buckets";

const PERIODS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIODS)[number];

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysInMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

// Fetch + aggregate one window's P&L (sales, food cost, labor, apportioned overhead).
async function loadWindow(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  from: string,
  to: string,
  overheadByMonth: Map<string, number>,
  tz: string,
): Promise<{ summary: PlSummary; bands: Record<Shift, PlSummary>; byDay: Map<string, number> }> {
  const [{ data: salesRaw }, { data: recipes }, { data: ings }, { data: labor }] = await Promise.all([
    supabase
      .from("pos_sales")
      .select("id, business_date, closed_at, channel, gross_total, net_total, fees_total, covers")
      .eq("tenant_id", tenantId)
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date"),
    supabase.from("recipe_items").select("menu_item_id, ingredient_id, qty, waste_pct").eq("tenant_id", tenantId),
    supabase.from("ingredients").select("id, current_unit_cost").eq("tenant_id", tenantId),
    supabase.from("labor_cost").select("work_date, shift, cost").eq("tenant_id", tenantId).gte("work_date", from).lte("work_date", to),
  ]);

  const sales: SaleRow[] = (salesRaw || []).map((s: any) => ({
    businessDate: s.business_date,
    closedAt: s.closed_at,
    channel: s.channel,
    grossTotal: Number(s.gross_total),
    netTotal: s.net_total != null ? Number(s.net_total) : null,
    feesTotal: Number(s.fees_total),
    covers: s.covers,
  }));

  const saleIds = (salesRaw || []).map((s: any) => s.id);
  let lines: Array<{ menuItemId: string | null; quantity: number }> = [];
  if (saleIds.length > 0) {
    const { data: items } = await supabase.from("pos_sale_items").select("menu_item_id, quantity").in("sale_id", saleIds);
    lines = (items || []).map((i: any) => ({ menuItemId: i.menu_item_id, quantity: Number(i.quantity) }));
  }
  const costs = new Map<string, number>();
  for (const i of ings || []) costs.set(i.id, Number(i.current_unit_cost));
  const recipesByMenuItem = new Map<string, RecipeLine[]>();
  for (const r of recipes || []) {
    const list = recipesByMenuItem.get(r.menu_item_id) || [];
    list.push({ ingredientId: r.ingredient_id, qty: Number(r.qty), wastePct: r.waste_pct != null ? Number(r.waste_pct) : 0 });
    recipesByMenuItem.set(r.menu_item_id, list);
  }
  const { foodCost } = periodFoodCost(lines, recipesByMenuItem, costs);

  let laborTotal = 0;
  const laborByShift: Record<Shift, number> = { lunch: 0, dinner: 0 };
  for (const l of labor || []) {
    const c = Number(l.cost);
    laborTotal += c;
    if (l.shift === "lunch") laborByShift.lunch += c;
    else if (l.shift === "dinner") laborByShift.dinner += c;
    else { laborByShift.lunch += c / 2; laborByShift.dinner += c / 2; }
  }

  // Overhead apportioned by day: each day carries (its month's overhead / days in
  // that month), summed across the window. So a 7-day window gets ~7/30 of a month.
  let overhead = 0;
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthTotal = overheadByMonth.get(key) || 0;
    if (monthTotal > 0) overhead += monthTotal / daysInMonth(d.getFullYear(), d.getMonth());
  }

  const summary = plSummary(sales, foodCost, laborTotal, overhead);
  const bands = plByBand(sales, foodCost, laborByShift, tz);
  const byDay = new Map<string, number>();
  for (const s of sales) byDay.set(s.businessDate, (byDay.get(s.businessDate) || 0) + (s.netTotal ?? s.grossTotal));
  return { summary, bands, byDay };
}

export default function PlPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const settings = activeTenant?.settings;
  const enabled = getFeatures(settings).management_enabled;
  const laborBudget = (settings as any)?.management?.labor_budget_monthly ?? null;
  const tz = (settings as any)?.timezone || "Europe/Rome";

  const [windowDays, setWindowDays] = useState<PeriodDays>(30);
  const [summary, setSummary] = useState<PlSummary | null>(null);
  const [prev, setPrev] = useState<PlSummary | null>(null);
  const [bands, setBands] = useState<Record<Shift, PlSummary> | null>(null);
  const [byDay, setByDay] = useState<Array<{ day: string; revenue: number; cost: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const now = new Date();
      const curFrom = new Date(now.getTime() - (windowDays - 1) * 86400000);
      const prevTo = new Date(curFrom.getTime() - 86400000);
      const prevFrom = new Date(prevTo.getTime() - (windowDays - 1) * 86400000);

      // Overhead for every month the two windows might touch.
      const { data: oh } = await supabase
        .from("overhead_costs")
        .select("period_month, amount")
        .eq("tenant_id", activeTenant.id)
        .gte("period_month", dateStr(new Date(prevFrom.getFullYear(), prevFrom.getMonth(), 1)));
      const overheadByMonth = new Map<string, number>();
      for (const r of oh || []) {
        const key = String(r.period_month).slice(0, 7);
        overheadByMonth.set(key, (overheadByMonth.get(key) || 0) + Number(r.amount));
      }

      const [cur, pre] = await Promise.all([
        loadWindow(supabase, activeTenant.id, dateStr(curFrom), dateStr(now), overheadByMonth, tz),
        loadWindow(supabase, activeTenant.id, dateStr(prevFrom), dateStr(prevTo), overheadByMonth, tz),
      ]);
      if (cancelled) return;

      setSummary(cur.summary);
      setPrev(pre.summary);
      setBands(cur.bands);

      const totalRev = cur.summary.revenue;
      const totalCost = cur.summary.foodCost + cur.summary.labor + cur.summary.overhead;
      const days = Array.from(cur.byDay.entries())
        .sort()
        .slice(-14)
        .map(([day, revenue]) => ({
          day: day.slice(5),
          revenue: Math.round(revenue * 100) / 100,
          cost: totalRev > 0 ? Math.round(totalCost * (revenue / totalRev) * 100) / 100 : 0,
        }));
      setByDay(days);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeTenant?.id, enabled, supabase, tz, windowDays]);

  // Work-in-progress: hidden for everyone but the WIP allowlist (incl. direct URL).
  if (!canSeeWip(activeTenant?.id)) return <WipComingSoon />;
  if (!enabled) return <ManagementLocked section="pl" />;

  const fmt = (n: number | null) => (n == null ? "—" : `€ ${n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

  // A small +/-% chip vs the previous period.
  const DeltaChip = ({ d, goodWhenUp = true }: { d: PlDelta | null; goodWhenUp?: boolean }) => {
    if (!d || d.pct == null) return null;
    const up = d.pct > 0;
    const good = up === goodWhenUp;
    return (
      <span className="text-xs font-bold ml-2" style={{ color: good ? "#059669" : "#dc2626" }}>
        {up ? "▲" : "▼"} {Math.abs(d.pct).toFixed(1)}%
      </span>
    );
  };

  const exportCsv = () => {
    if (!summary) return;
    const rows: Array<[string, string | number]> = [
      [t("pl_revenue" as keyof Dictionary) || "Ricavi", summary.revenue],
      [t("pl_covers" as keyof Dictionary) || "Coperti", summary.covers],
      [t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio", summary.avgTicket ?? ""],
      [t("pl_food_cost" as keyof Dictionary) || "Food cost", summary.foodCost],
      ["Food cost %", summary.foodCostPct ?? ""],
      [t("pl_labor" as keyof Dictionary) || "Costo personale", summary.labor],
      ["Labor %", summary.laborPct ?? ""],
      [t("pl_prime_cost" as keyof Dictionary) || "Prime cost", summary.primeCost],
      ["Prime cost %", summary.primeCostPct ?? ""],
      [t("pl_overhead" as keyof Dictionary) || "Costi fissi", summary.overhead],
      [t("pl_fees" as keyof Dictionary) || "Commissioni", summary.fees],
      [t("pl_operating_margin" as keyof Dictionary) || "Margine operativo", summary.operatingMargin],
      ["Margine %", summary.operatingMarginPct ?? ""],
    ];
    const csv = "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map((r) => `${r[0]};${r[1]}`).join("\n"));
    const a = document.createElement("a");
    a.href = csv;
    a.download = `conto-economico-${windowDays}gg-${dateStr(new Date())}.csv`;
    a.click();
  };

  const bandChart = bands
    ? [
        { band: t("pl_lunch" as keyof Dictionary) || "Pranzo", margin: bands.lunch.operatingMargin, revenue: bands.lunch.revenue },
        { band: t("pl_dinner" as keyof Dictionary) || "Cena", margin: bands.dinner.operatingMargin, revenue: bands.dinner.revenue },
      ]
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b pb-5 flex flex-wrap items-start justify-between gap-4" style={{ borderColor: "#c4956a" }}>
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <PieIcon className="w-6 h-6" /> {t("nav_pl" as keyof Dictionary) || "Conto economico"}
          </h1>
          <p className="mt-1 text-sm text-black">{t("pl_subtitle_compare" as keyof Dictionary) || "Confronto con il periodo precedente."}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border-2 overflow-hidden" style={{ borderColor: "#c4956a" }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setWindowDays(p)}
                className={`px-3 py-1.5 text-sm cursor-pointer ${windowDays === p ? "text-white font-bold" : "text-black"}`}
                style={windowDays === p ? { background: "#c4956a" } : undefined}
              >
                {p}{t("pl_days_short" as keyof Dictionary) || "gg"}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border-2 cursor-pointer text-black" style={{ borderColor: "#c4956a" }}>
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {/* Hero: revenue + operating margin, each with a vs-previous chip. */}
      <div className="rounded-xl border-2 p-6 grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}>
        <div>
          <div className="text-sm font-medium text-black">{t("pl_revenue" as keyof Dictionary) || "Ricavi"}</div>
          <div className="text-4xl font-bold text-black flex items-center">
            {fmt(summary?.revenue ?? null)}
            <DeltaChip d={summary && prev ? plDelta(summary.revenue, prev.revenue) : null} />
          </div>
        </div>
        <div>
          <div className="text-sm font-medium text-black">{t("pl_operating_margin" as keyof Dictionary) || "Margine operativo"}</div>
          <div className="text-4xl font-bold flex items-center" style={{ color: (summary?.operatingMargin ?? 0) >= 0 ? "#059669" : "#dc2626" }}>
            {fmt(summary?.operatingMargin ?? null)}
            {summary?.operatingMarginPct != null && <span className="text-lg ml-2">({summary.operatingMarginPct.toFixed(0)}%)</span>}
            <DeltaChip d={summary && prev ? plDelta(summary.operatingMargin, prev.operatingMargin) : null} />
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t("pl_covers" as keyof Dictionary) || "Coperti"} value={summary?.covers ?? 0} icon={<Users className="w-5 h-5" />} />
        <KPICard title={t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio"} value={summary?.avgTicket != null ? `€ ${summary.avgTicket.toFixed(2)}` : "—"} icon={<TrendingUp className="w-5 h-5" />} />
        <KPICard title={t("pl_food_cost_pct" as keyof Dictionary) || "Food cost %"} value={pct(summary?.foodCostPct ?? null)} icon={<Calculator className="w-5 h-5" />} />
        <KPICard
          title={t("pl_labor" as keyof Dictionary) || "Costo personale"}
          value={summary ? `€ ${summary.labor.toFixed(0)}${laborBudget ? ` / ${laborBudget}` : ""}` : "—"}
          icon={<Wallet className="w-5 h-5" />}
          valueClassName={laborBudget && summary && summary.labor > laborBudget ? "text-red-600" : undefined}
        />
      </div>

      {/* Prime cost / overhead / per-cover strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t("pl_prime_cost_pct" as keyof Dictionary) || "Prime cost %"} value={pct(summary?.primeCostPct ?? null)} icon={<Layers className="w-5 h-5" />} valueClassName={summary && summary.primeCostPct != null && summary.primeCostPct > 65 ? "text-red-600" : undefined} />
        <KPICard title={t("pl_overhead" as keyof Dictionary) || "Costi fissi"} value={fmt(summary?.overhead ?? null)} icon={<Building2 className="w-5 h-5" />} />
        <KPICard title={t("pl_food_per_cover" as keyof Dictionary) || "Food / coperto"} value={summary?.foodCostPerCover != null ? `€ ${summary.foodCostPerCover.toFixed(2)}` : "—"} icon={<Calculator className="w-5 h-5" />} />
        <KPICard title={t("pl_labor_per_cover" as keyof Dictionary) || "Personale / coperto"} value={summary?.laborPerCover != null ? `€ ${summary.laborPerCover.toFixed(2)}` : "—"} icon={<Wallet className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {byDay.length > 0 && (
          <div className="rounded-xl border-2 p-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
            <h2 className="text-sm font-bold text-black mb-3">{t("pl_chart_rev_cost" as keyof Dictionary) || "Ricavi vs costi (food + personale)"}</h2>
            <div style={{ height: 260 }}>
              <ChartFrame>
                <BarChart data={byDay} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7d8c5" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `€ ${Number(v).toFixed(0)}`} />
                  <Legend />
                  <Bar dataKey="revenue" name={t("pl_revenue" as keyof Dictionary) || "Ricavi"} fill="#c4956a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cost" name={t("pl_costs" as keyof Dictionary) || "Costi"} fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartFrame>
            </div>
          </div>
        )}

        {bandChart.length > 0 && (
          <div className="rounded-xl border-2 p-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
            <h2 className="text-sm font-bold text-black mb-3">{t("pl_chart_bands" as keyof Dictionary) || "Margine: pranzo vs cena"}</h2>
            <div style={{ height: 260 }}>
              <ChartFrame>
                <BarChart data={bandChart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7d8c5" />
                  <XAxis dataKey="band" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `€ ${Number(v).toFixed(0)}`} />
                  <Legend />
                  <Bar dataKey="revenue" name={t("pl_revenue" as keyof Dictionary) || "Ricavi"} fill="#c4956a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="margin" name={t("pl_operating_margin" as keyof Dictionary) || "Margine"} fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartFrame>
            </div>
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-black">…</p>}
    </div>
  );
}
