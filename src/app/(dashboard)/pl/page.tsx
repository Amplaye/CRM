"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart as PieIcon, Users, Calculator, Wallet, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { KPICard } from "@/components/ui/KPICard";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { plSummary, plByBand, periodFoodCost } from "@/lib/management/pl";
import type { PlSummary, RecipeLine, SaleRow } from "@/lib/management/types";
import type { Shift } from "@/lib/management/time-buckets";

const WINDOW_DAYS = 30;

export default function PlPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const settings = activeTenant?.settings;
  const enabled = getFeatures(settings).management_enabled;
  const laborBudget = (settings as any)?.management?.labor_budget_monthly ?? null;
  const tz = (settings as any)?.timezone || "Europe/Rome";

  const [summary, setSummary] = useState<PlSummary | null>(null);
  const [bands, setBands] = useState<Record<Shift, PlSummary> | null>(null);
  const [byDay, setByDay] = useState<Array<{ day: string; revenue: number; cost: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const from = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

      const [{ data: salesRaw }, { data: recipes }, { data: ings }, { data: labor }] = await Promise.all([
        supabase
          .from("pos_sales")
          .select("id, business_date, closed_at, channel, gross_total, net_total, fees_total, covers")
          .eq("tenant_id", activeTenant.id)
          .gte("business_date", from)
          .order("business_date"),
        supabase.from("recipe_items").select("menu_item_id, ingredient_id, qty").eq("tenant_id", activeTenant.id),
        supabase.from("ingredients").select("id, current_unit_cost").eq("tenant_id", activeTenant.id),
        supabase.from("labor_cost").select("work_date, shift, cost").eq("tenant_id", activeTenant.id).gte("work_date", from),
      ]);
      if (cancelled) return;

      const sales: SaleRow[] = (salesRaw || []).map((s: any) => ({
        businessDate: s.business_date,
        closedAt: s.closed_at,
        channel: s.channel,
        grossTotal: Number(s.gross_total),
        netTotal: s.net_total != null ? Number(s.net_total) : null,
        feesTotal: Number(s.fees_total),
        covers: s.covers,
      }));

      // food cost: cost the sold lines (need pos_sale_items for this window)
      const saleIds = (salesRaw || []).map((s: any) => s.id);
      let lines: Array<{ menuItemId: string | null; quantity: number }> = [];
      if (saleIds.length > 0) {
        const { data: items } = await supabase
          .from("pos_sale_items")
          .select("menu_item_id, quantity")
          .in("sale_id", saleIds);
        lines = (items || []).map((i: any) => ({ menuItemId: i.menu_item_id, quantity: Number(i.quantity) }));
      }
      const costs = new Map<string, number>();
      for (const i of ings || []) costs.set(i.id, Number(i.current_unit_cost));
      const recipesByMenuItem = new Map<string, RecipeLine[]>();
      for (const r of recipes || []) {
        const list = recipesByMenuItem.get(r.menu_item_id) || [];
        list.push({ ingredientId: r.ingredient_id, qty: Number(r.qty) });
        recipesByMenuItem.set(r.menu_item_id, list);
      }
      const { foodCost } = periodFoodCost(lines, recipesByMenuItem, costs);

      // labor totals + by shift ('all' split 50/50)
      let laborTotal = 0;
      const laborByShift: Record<Shift, number> = { lunch: 0, dinner: 0 };
      for (const l of labor || []) {
        const c = Number(l.cost);
        laborTotal += c;
        if (l.shift === "lunch") laborByShift.lunch += c;
        else if (l.shift === "dinner") laborByShift.dinner += c;
        else {
          laborByShift.lunch += c / 2;
          laborByShift.dinner += c / 2;
        }
      }

      setSummary(plSummary(sales, foodCost, laborTotal));
      setBands(plByBand(sales, foodCost, laborByShift, tz));

      // per-day revenue + apportioned cost for the chart
      const totalRev = sales.reduce((a, s) => a + (s.netTotal ?? s.grossTotal), 0);
      const dayMap = new Map<string, number>();
      for (const s of sales) dayMap.set(s.businessDate, (dayMap.get(s.businessDate) || 0) + (s.netTotal ?? s.grossTotal));
      const totalCost = foodCost + laborTotal;
      const days = Array.from(dayMap.entries())
        .sort()
        .slice(-14)
        .map(([day, revenue]) => ({
          day: day.slice(5),
          revenue: Math.round(revenue * 100) / 100,
          cost: totalRev > 0 ? Math.round((totalCost * (revenue / totalRev)) * 100) / 100 : 0,
        }));
      setByDay(days);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTenant?.id, enabled, supabase, tz]);

  if (!enabled) {
    return <ManagementLocked />;
  }

  const fmt = (n: number | null) => (n == null ? "—" : `€ ${n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  const bandChart = bands
    ? [
        { band: t("pl_lunch" as keyof Dictionary) || "Pranzo", margin: bands.lunch.operatingMargin, revenue: bands.lunch.revenue },
        { band: t("pl_dinner" as keyof Dictionary) || "Cena", margin: bands.dinner.operatingMargin, revenue: bands.dinner.revenue },
      ]
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b pb-5" style={{ borderColor: "#c4956a" }}>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2">
          <PieIcon className="w-6 h-6" /> {t("nav_pl" as keyof Dictionary) || "Conto economico"}
        </h1>
        <p className="mt-1 text-sm text-black">{t("pl_subtitle" as keyof Dictionary) || `Ultimi ${WINDOW_DAYS} giorni.`}</p>
      </div>

      {/* Hero: revenue + operating margin */}
      <div className="rounded-xl border-2 p-6 grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}>
        <div>
          <div className="text-sm font-medium text-black">{t("pl_revenue" as keyof Dictionary) || "Ricavi"}</div>
          <div className="text-4xl font-bold text-black">{fmt(summary?.revenue ?? null)}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-black">{t("pl_operating_margin" as keyof Dictionary) || "Margine operativo"}</div>
          <div className="text-4xl font-bold" style={{ color: (summary?.operatingMargin ?? 0) >= 0 ? "#059669" : "#dc2626" }}>
            {fmt(summary?.operatingMargin ?? null)}
            {summary?.operatingMarginPct != null && <span className="text-lg ml-2">({summary.operatingMarginPct.toFixed(0)}%)</span>}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t("pl_covers" as keyof Dictionary) || "Coperti"} value={summary?.covers ?? 0} icon={<Users className="w-5 h-5" />} />
        <KPICard title={t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio"} value={summary?.avgTicket != null ? `€ ${summary.avgTicket.toFixed(2)}` : "—"} icon={<TrendingUp className="w-5 h-5" />} />
        <KPICard title={t("pl_food_cost_pct" as keyof Dictionary) || "Food cost %"} value={summary?.foodCostPct != null ? `${summary.foodCostPct.toFixed(1)}%` : "—"} icon={<Calculator className="w-5 h-5" />} />
        <KPICard
          title={t("pl_labor" as keyof Dictionary) || "Costo personale"}
          value={summary ? `€ ${summary.labor.toFixed(0)}${laborBudget ? ` / ${laborBudget}` : ""}` : "—"}
          icon={<Wallet className="w-5 h-5" />}
          valueClassName={laborBudget && summary && summary.labor > laborBudget ? "text-red-600" : undefined}
        />
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
