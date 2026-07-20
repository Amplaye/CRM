"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PieChart as PieIcon, Users, Calculator, Wallet, TrendingUp, Download, AlertTriangle, Settings, Package } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
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
import { downloadCsv } from "@/lib/export/to-csv";
import { buildReportPdf, downloadPdf } from "@/lib/export/to-pdf";

const PERIODS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIODS)[number];

const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#eaddcb" } as const;

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
): Promise<{ summary: PlSummary; bands: Record<Shift, PlSummary>; byDay: Map<string, number>; purchases: number }> {
  const [{ data: salesRaw }, { data: recipes }, { data: ings }, { data: labor }, { data: invoices }] = await Promise.all([
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
    // Real goods purchased: confirmed supplier invoices dated inside the window
    // (ex-VAT net, falling back to gross). This is actual cash-out for merchandise,
    // shown alongside the theoretical food cost — it never feeds the margin.
    supabase
      .from("supplier_invoices")
      .select("net_total, gross_total")
      .eq("tenant_id", tenantId)
      .eq("status", "confirmed")
      .gte("invoice_date", from)
      .lte("invoice_date", to),
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
  const purchases = Math.round(
    (invoices || []).reduce((s: number, i: any) => s + Number(i.net_total ?? i.gross_total ?? 0), 0) * 100,
  ) / 100;
  return { summary, bands, byDay, purchases };
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
  const [purchases, setPurchases] = useState(0);
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
      setPurchases(cur.purchases);

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

  // A small +/-% chip vs the previous period.
  const DeltaChip = ({ d, goodWhenUp = true }: { d: PlDelta | null; goodWhenUp?: boolean }) => {
    if (!d || d.pct == null) return null;
    const up = d.pct > 0;
    const good = up === goodWhenUp;
    return (
      <span
        className="text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums"
        style={{ color: good ? "#047857" : "#dc2626", background: good ? "rgba(5,150,105,0.1)" : "rgba(220,38,38,0.08)" }}
      >
        {up ? "▲" : "▼"} {Math.abs(d.pct).toFixed(1)}%
      </span>
    );
  };

  // One builder for both CSV (raw values) and PDF (pretty values).
  const reportRows = () => {
    if (!summary) return null;
    const pctS = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
    return [
      { label: t("pl_revenue" as keyof Dictionary) || "Ricavi", raw: summary.revenue, pretty: fmt(summary.revenue) },
      { label: t("pl_covers" as keyof Dictionary) || "Coperti", raw: summary.covers, pretty: String(summary.covers) },
      { label: t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio", raw: summary.avgTicket ?? "", pretty: summary.avgTicket != null ? `€ ${summary.avgTicket.toFixed(2)}` : "—" },
      { label: t("pl_food_cost" as keyof Dictionary) || "Food cost", raw: summary.foodCost, pretty: fmt(summary.foodCost) },
      { label: "Food cost %", raw: summary.foodCostPct ?? "", pretty: pctS(summary.foodCostPct) },
      { label: t("pl_labor" as keyof Dictionary) || "Costo personale", raw: summary.labor, pretty: fmt(summary.labor) },
      { label: "Labor %", raw: summary.laborPct ?? "", pretty: pctS(summary.laborPct) },
      { label: t("pl_prime_cost" as keyof Dictionary) || "Prime cost", raw: summary.primeCost, pretty: fmt(summary.primeCost) },
      { label: "Prime cost %", raw: summary.primeCostPct ?? "", pretty: pctS(summary.primeCostPct) },
      { label: t("pl_overhead" as keyof Dictionary) || "Costi fissi", raw: summary.overhead, pretty: fmt(summary.overhead) },
      { label: t("pl_fees" as keyof Dictionary) || "Commissioni", raw: summary.fees, pretty: fmt(summary.fees) },
      { label: t("pl_operating_margin" as keyof Dictionary) || "Margine operativo", raw: summary.operatingMargin, pretty: fmt(summary.operatingMargin) },
      { label: "Margine %", raw: summary.operatingMarginPct ?? "", pretty: pctS(summary.operatingMarginPct) },
    ];
  };

  const exportCsv = () => {
    const rows = reportRows();
    if (!rows) return;
    downloadCsv(`conto-economico-${windowDays}gg-${dateStr(new Date())}.csv`, rows.map((r) => [r.label, r.raw]));
  };

  const exportPdf = async () => {
    const rows = reportRows();
    if (!rows) return;
    const bandRow = (s: PlSummary) => [fmt(s.revenue), fmt(s.operatingMargin)];
    const bytes = await buildReportPdf({
      title: t("nav_pl" as keyof Dictionary) || "Conto economico",
      subtitle: (t("pl_statement_title" as keyof Dictionary) || "Da ricavi a margine — ultimi {n} giorni").replace("{n}", String(windowDays)),
      business: activeTenant?.name || undefined,
      sections: [
        {
          title: t("export_section_summary" as keyof Dictionary) || "Riepilogo",
          columns: [t("export_col_metric" as keyof Dictionary) || "Voce", t("export_col_value" as keyof Dictionary) || "Valore"],
          rows: rows.map((r) => [r.label, r.pretty]),
        },
        ...(bands
          ? [{
              title: t("pl_chart_bands" as keyof Dictionary) || "Margine: pranzo vs cena",
              columns: ["", t("pl_revenue" as keyof Dictionary) || "Ricavi", t("pl_operating_margin" as keyof Dictionary) || "Margine operativo"],
              rows: [
                [t("pl_lunch" as keyof Dictionary) || "Pranzo", ...bandRow(bands.lunch)],
                [t("pl_dinner" as keyof Dictionary) || "Cena", ...bandRow(bands.dinner)],
              ],
            }]
          : []),
      ],
      footer: `${t("export_generated" as keyof Dictionary) || "Generato il"} ${dateStr(new Date())} — TableFlow`,
    });
    downloadPdf(`conto-economico-${windowDays}gg-${dateStr(new Date())}.pdf`, bytes);
  };

  const bandChart = bands
    ? [
        { band: t("pl_lunch" as keyof Dictionary) || "Pranzo", margin: bands.lunch.operatingMargin, revenue: bands.lunch.revenue },
        { band: t("pl_dinner" as keyof Dictionary) || "Cena", margin: bands.dinner.operatingMargin, revenue: bands.dinner.revenue },
      ]
    : [];

  const marginColor = (summary?.operatingMargin ?? 0) >= 0 ? "#059669" : "#dc2626";
  const laborOver = laborBudget != null && summary != null && summary.labor > laborBudget;

  // The statement rows: label, value, % of revenue, delta, semantics.
  const stmt = summary
    ? [
        {
          key: "revenue",
          label: t("pl_revenue" as keyof Dictionary) || "Ricavi",
          value: summary.revenue,
          pct: summary.revenue > 0 ? 100 : null,
          delta: prev ? plDelta(summary.revenue, prev.revenue) : null,
          goodWhenUp: true,
          kind: "revenue" as const,
        },
        {
          key: "food",
          label: t("pl_food_cost" as keyof Dictionary) || "Food cost",
          value: -summary.foodCost,
          pct: summary.foodCostPct,
          delta: prev ? plDelta(summary.foodCost, prev.foodCost) : null,
          goodWhenUp: false,
          kind: "cost" as const,
          warn: summary.foodCostPct != null && summary.foodCostPct > 35,
        },
        {
          key: "labor",
          label: t("pl_labor" as keyof Dictionary) || "Personale",
          value: -summary.labor,
          pct: summary.laborPct,
          delta: prev ? plDelta(summary.labor, prev.labor) : null,
          goodWhenUp: false,
          kind: "cost" as const,
          warn: laborOver,
        },
        {
          key: "prime",
          label: t("pl_prime_cost" as keyof Dictionary) || "Prime cost",
          value: -summary.primeCost,
          pct: summary.primeCostPct,
          delta: prev ? plDelta(summary.primeCost, prev.primeCost) : null,
          goodWhenUp: false,
          kind: "subtotal" as const,
          warn: summary.primeCostPct != null && summary.primeCostPct > 65,
        },
        {
          key: "fees",
          label: t("pl_fees" as keyof Dictionary) || "Commissioni",
          value: -summary.fees,
          pct: summary.revenue > 0 ? Math.round((summary.fees / summary.revenue) * 1000) / 10 : null,
          delta: prev ? plDelta(summary.fees, prev.fees) : null,
          goodWhenUp: false,
          kind: "cost" as const,
        },
        {
          key: "overhead",
          label: t("pl_overhead" as keyof Dictionary) || "Costi fissi",
          value: -summary.overhead,
          pct: summary.overheadPct,
          delta: prev ? plDelta(summary.overhead, prev.overhead) : null,
          goodWhenUp: false,
          kind: "cost" as const,
        },
        {
          key: "margin",
          label: t("pl_operating_margin" as keyof Dictionary) || "Margine operativo",
          value: summary.operatingMargin,
          pct: summary.operatingMarginPct,
          delta: prev ? plDelta(summary.operatingMargin, prev.operatingMargin) : null,
          goodWhenUp: true,
          kind: "result" as const,
        },
      ]
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <PieIcon className="w-6 h-6" /> {t("nav_pl" as keyof Dictionary) || "Conto economico"}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#8b6540" }}>
            {t("pl_subtitle_v2" as keyof Dictionary) || "Calcolato in automatico da cassa, ricette e costi. Confronto con il periodo precedente."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: "#c4956a" }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setWindowDays(p)}
                className={`px-3.5 py-2 text-sm cursor-pointer ${windowDays === p ? "text-white font-bold" : "text-black"}`}
                style={windowDays === p ? { background: "#c4956a" } : undefined}
              >
                {p}{t("pl_days_short" as keyof Dictionary) || "gg"}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70" style={{ borderColor: "#c4956a" }}>
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={exportPdf} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70" style={{ borderColor: "#c4956a" }}>
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {loading && !summary ? (
        <>
          <div className={`${CARD} h-28 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
          <div className={`${CARD} h-80 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
        </>
      ) : (
        <>
          {/* Hero: revenue + operating margin */}
          <div className={`${CARD} p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-5`} style={CARD_STYLE}>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "#8b6540" }}>
                {t("pl_revenue" as keyof Dictionary) || "Ricavi"}
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="text-4xl font-bold text-black tabular-nums">{fmt(summary?.revenue ?? null)}</span>
                <DeltaChip d={summary && prev ? plDelta(summary.revenue, prev.revenue) : null} />
              </div>
              <div className="mt-1 text-sm" style={{ color: "#8b6540" }}>
                {summary?.covers ?? 0} {t("pl_covers" as keyof Dictionary)?.toLowerCase() || "coperti"}
                {summary?.avgTicket != null && ` · € ${summary.avgTicket.toFixed(2)} ${t("pl_avg_ticket_short" as keyof Dictionary) || "a coperto"}`}
              </div>
            </div>
            <div className="sm:border-l sm:pl-6" style={{ borderColor: "#f0e5d4" }}>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "#8b6540" }}>
                {t("pl_operating_margin" as keyof Dictionary) || "Margine operativo"}
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="text-4xl font-bold tabular-nums" style={{ color: marginColor }}>{fmt(summary?.operatingMargin ?? null)}</span>
                {summary?.operatingMarginPct != null && (
                  <span className="text-lg font-bold" style={{ color: marginColor }}>({summary.operatingMarginPct.toFixed(0)}%)</span>
                )}
                <DeltaChip d={summary && prev ? plDelta(summary.operatingMargin, prev.operatingMargin) : null} />
              </div>
              <div className="mt-1 text-sm" style={{ color: "#8b6540" }}>
                {(t("pl_margin_hint" as keyof Dictionary) || "quello che resta dopo food, personale, commissioni e fissi")}
              </div>
            </div>
          </div>

          {/* The P&L only gets real when staff + fixed costs are in: point straight
              to the one place where they're entered. */}
          {summary && summary.revenue > 0 && (summary.labor === 0 || summary.overhead === 0) && (
            <Link
              href="/settings"
              className="rounded-xl border p-3 flex items-start gap-2 text-sm cursor-pointer"
              style={{ borderColor: "rgba(196,149,106,0.5)", background: "rgba(196,149,106,0.08)" }}
            >
              <Settings className="w-5 h-5 shrink-0" style={{ color: "#8b6540" }} />
              <span className="text-black">
                {t("pl_missing_costs")} <span className="font-bold underline underline-offset-2" style={{ color: "#8b6540" }}>{t("nav_settings")} →</span>
              </span>
            </Link>
          )}

          {laborOver && (
            <div className="rounded-xl border p-3 flex items-start gap-2 text-sm" style={{ borderColor: "rgba(220,38,38,0.4)", background: "rgba(220,38,38,0.06)" }}>
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
              <span className="text-black">
                {(t("pl_labor_over" as keyof Dictionary) || "Costo del personale € {n} oltre il budget mensile di € {b}.")
                  .replace("{n}", String(Math.round(summary!.labor)))
                  .replace("{b}", String(laborBudget))}
              </span>
            </div>
          )}

          {/* ── The statement: from revenue down to operating margin ─────────── */}
          <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
            <div className="px-4 sm:px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "#f0e5d4" }}>
              <span className="text-sm font-bold text-black">
                {(t("pl_statement_title" as keyof Dictionary) || "Da ricavi a margine — ultimi {n} giorni").replace("{n}", String(windowDays))}
              </span>
              <span className="text-xs" style={{ color: "#8b6540" }}>
                {t("pl_statement_hint" as keyof Dictionary) || "barre = % dei ricavi · △▽ = vs periodo precedente"}
              </span>
            </div>
            <div>
              {stmt.map((row) => {
                const isResult = row.kind === "result";
                const isRevenue = row.kind === "revenue";
                const isSubtotal = row.kind === "subtotal";
                const barPct = row.pct != null ? Math.min(100, Math.abs(row.pct)) : 0;
                const barColor = isRevenue
                  ? "#c4956a"
                  : isResult
                    ? row.value >= 0 ? "#059669" : "#dc2626"
                    : (row as any).warn
                      ? "#dc2626"
                      : isSubtotal
                        ? "#b45309"
                        : "#d4a574";
                const valueColor = isResult ? (row.value >= 0 ? "#059669" : "#dc2626") : (row as any).warn ? "#dc2626" : "#000";
                return (
                  <div
                    key={row.key}
                    className="px-4 sm:px-5 py-3 grid items-center gap-x-3"
                    style={{
                      gridTemplateColumns: "minmax(90px, 160px) 1fr auto",
                      borderTop: "1px solid #f6eee0",
                      background: isResult ? (row.value >= 0 ? "rgba(5,150,105,0.06)" : "rgba(220,38,38,0.05)") : isSubtotal ? "rgba(196,149,106,0.06)" : undefined,
                    }}
                  >
                    <span className={`text-sm ${isResult || isRevenue || isSubtotal ? "font-bold" : "font-medium"} text-black`}>
                      {!isRevenue && !isResult && <span style={{ color: "#8b6540" }}>{isSubtotal ? "= " : "− "}</span>}
                      {isResult && <span style={{ color: "#8b6540" }}>= </span>}
                      {row.label}
                      {(row as any).warn && <AlertTriangle className="inline w-3.5 h-3.5 ml-1 text-red-600" />}
                    </span>
                    <div className="hidden sm:block relative h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.13)" }}>
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${barPct}%`, background: barColor, opacity: isResult || isRevenue ? 1 : 0.85 }} />
                    </div>
                    <div className="flex items-center justify-end gap-2 min-w-[150px]">
                      {row.pct != null && !isRevenue && (
                        <span className="text-xs tabular-nums w-12 text-right" style={{ color: (row as any).warn ? "#dc2626" : "#8b6540" }}>
                          {Math.abs(row.pct).toFixed(0)}%
                        </span>
                      )}
                      <span className={`tabular-nums text-right ${isResult || isRevenue ? "text-base font-bold" : "text-sm font-bold"}`} style={{ color: valueColor, minWidth: 84 }}>
                        {row.value < 0 ? `− € ${Math.abs(row.value).toLocaleString("it-IT", { maximumFractionDigits: 0 })}` : fmt(row.value)}
                      </span>
                      <span className="w-16 text-right">
                        <DeltaChip d={row.delta} goodWhenUp={row.goodWhenUp} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Goods purchased (real invoices) vs theoretical food cost ─────── */}
          {purchases > 0 && summary && (() => {
            const variance = Math.round((purchases - summary.foodCost) * 100) / 100;
            const overBuy = variance > 0;
            return (
              <div className={`${CARD} p-4 sm:p-5`} style={CARD_STYLE}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-2 rounded-lg shrink-0" style={{ background: "rgba(196,149,106,0.12)", color: "#8b6540" }}>
                    <Package className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold text-black">{t("pl_purchases_title" as keyof Dictionary) || "Merce acquistata (fatture)"}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border p-3" style={{ borderColor: "#f0e5d4", background: "rgba(196,149,106,0.05)" }}>
                    <div className="text-xs" style={{ color: "#8b6540" }}>{t("pl_purchases_label" as keyof Dictionary) || "Acquisti nel periodo"}</div>
                    <div className="mt-1 text-2xl font-bold text-black tabular-nums">{fmt(purchases)}</div>
                  </div>
                  <div className="rounded-xl border p-3" style={{ borderColor: "#f0e5d4" }}>
                    <div className="text-xs" style={{ color: "#8b6540" }}>{t("pl_foodcost_theoretical" as keyof Dictionary) || "Food cost teorico (venduto)"}</div>
                    <div className="mt-1 text-2xl font-bold text-black tabular-nums">{fmt(summary.foodCost)}</div>
                  </div>
                  <div className="rounded-xl border p-3" style={{ borderColor: "#f0e5d4" }}>
                    <div className="text-xs" style={{ color: "#8b6540" }}>{t("pl_variance_label" as keyof Dictionary) || "Scostamento"}</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: overBuy ? "#b45309" : "#059669" }}>
                      {variance < 0 ? `− € ${Math.abs(variance).toLocaleString("it-IT", { maximumFractionDigits: 0 })}` : `+ € ${variance.toLocaleString("it-IT", { maximumFractionDigits: 0 })}`}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed" style={{ color: "#8b6540" }}>
                  {t("pl_purchases_hint" as keyof Dictionary) || "Fatture fornitore confermate con data in questo periodo. Il margine qui sopra usa comunque il food cost teorico."}
                </p>
              </div>
            );
          })()}

          {/* Per-cover tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MiniStat icon={<Users className="w-4 h-4" />} label={t("pl_covers" as keyof Dictionary) || "Coperti"} value={String(summary?.covers ?? 0)} />
            <MiniStat icon={<TrendingUp className="w-4 h-4" />} label={t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio"} value={summary?.avgTicket != null ? `€ ${summary.avgTicket.toFixed(2)}` : "—"} />
            <MiniStat icon={<Calculator className="w-4 h-4" />} label={t("pl_food_per_cover" as keyof Dictionary) || "Food / coperto"} value={summary?.foodCostPerCover != null ? `€ ${summary.foodCostPerCover.toFixed(2)}` : "—"} />
            <MiniStat icon={<Wallet className="w-4 h-4" />} label={t("pl_labor_per_cover" as keyof Dictionary) || "Personale / coperto"} value={summary?.laborPerCover != null ? `€ ${summary.laborPerCover.toFixed(2)}` : "—"} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {byDay.length > 0 && (
              <div className={`${CARD} p-4`} style={CARD_STYLE}>
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
              <div className={`${CARD} p-4`} style={CARD_STYLE}>
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
        </>
      )}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={`${CARD} px-4 py-3 flex items-center gap-3`} style={CARD_STYLE}>
      <div className="p-2 rounded-lg shrink-0" style={{ background: "rgba(196,149,106,0.12)", color: "#8b6540" }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs truncate" style={{ color: "#8b6540" }}>{label}</div>
        <div className="text-lg font-bold text-black tabular-nums">{value}</div>
      </div>
    </div>
  );
}
