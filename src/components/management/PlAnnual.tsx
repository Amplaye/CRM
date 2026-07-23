"use client";

// Annual P&L — the 12-months-in-a-row income statement (iammi's "conto economico
// annuale"): Ricavi → materia prima (food/beverage/consumo) → personale →
// struttura → affitto → margine operativo. Each cell shows € and, below, % of
// that month's revenue. Cost rows expand into their categories; a ⓘ on each row
// explains the metric; IVA inclusa/esclusa reframes revenue; the bottom rows give
// trading days and sales/day so months of different length compare.
//
// Data comes from tables we already fill: pos_sales, labor_cost, overhead_costs
// and confirmed supplier_invoices (grouped by cost_category).

import { useEffect, useMemo, useState, Fragment } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevRight, Info, Download } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { buildPlYear, isRentCategory, type PlYear, type YearLeaf } from "@/lib/management/pl-annual";
import { downloadCsv, type CsvCell } from "@/lib/export/to-csv";

const CARD_STYLE = { borderColor: "#d9c3a3" } as const;
const BROWN = "#c4956a";
const LOCALE: Record<string, string> = { en: "en-GB", it: "it-IT", es: "es-ES", de: "de-DE" };
const monthOf = (d: string) => parseInt(d.slice(5, 7), 10) - 1;
const zero = () => new Array(12).fill(0);

export function PlAnnual() {
  const { t, language } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const nowYear = useMemo(() => new Date().getFullYear(), []);

  const [year, setYear] = useState(nowYear);
  const [vatIncl, setVatIncl] = useState(false); // P&L is ex-VAT by default
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["cogs", "structure"]));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PlYear | null>(null);

  useEffect(() => {
    if (!activeTenant?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const [{ data: sales }, { data: labor }, { data: overhead }, { data: invoices }] = await Promise.all([
        supabase.from("pos_sales").select("business_date, net_total, gross_total, covers").eq("tenant_id", activeTenant.id).gte("business_date", from).lte("business_date", to),
        supabase.from("labor_cost").select("work_date, cost").eq("tenant_id", activeTenant.id).gte("work_date", from).lte("work_date", to),
        supabase.from("overhead_costs").select("period_month, category, amount").eq("tenant_id", activeTenant.id).gte("period_month", from).lte("period_month", to),
        supabase.from("supplier_invoices").select("invoice_date, cost_category, goods_total, service_total, net_total, gross_total").eq("tenant_id", activeTenant.id).eq("status", "confirmed").gte("invoice_date", from).lte("invoice_date", to),
      ]);
      if (cancelled) return;

      const revenue = zero(), covers = zero(), laborArr = zero(), rent = zero();
      const daysByMonth: Array<Set<string>> = Array.from({ length: 12 }, () => new Set());
      const food = zero(), beverage = zero(), consumables = zero();
      const structureMap = new Map<string, number[]>();
      const struct = (label: string) => { let a = structureMap.get(label); if (!a) { a = zero(); structureMap.set(label, a); } return a; };

      for (const s of sales || []) {
        const m = monthOf(s.business_date);
        if (m < 0 || m > 11) continue;
        const gross = Number(s.gross_total) || 0;
        const net = s.net_total != null ? Number(s.net_total) : gross;
        revenue[m] += vatIncl ? gross : net;
        covers[m] += s.covers || 0;
        daysByMonth[m].add(s.business_date);
      }
      for (const l of labor || []) { const m = monthOf(l.work_date); if (m >= 0 && m <= 11) laborArr[m] += Number(l.cost) || 0; }
      for (const o of overhead || []) {
        const m = monthOf(String(o.period_month)); if (m < 0 || m > 11) continue;
        const amt = Number(o.amount) || 0;
        if (isRentCategory(o.category || "")) rent[m] += amt;
        else struct(o.category || (t("pl_year_structure" as keyof Dictionary) || "Struttura"))[m] += amt;
      }
      const UTENZE = t("pl_year_utilities" as keyof Dictionary) || "Utenze";
      const SERVIZI = t("pl_year_services" as keyof Dictionary) || "Servizi";
      for (const inv of invoices || []) {
        const m = monthOf(String(inv.invoice_date)); if (m < 0 || m > 11) continue;
        const cat = inv.cost_category as string | null;
        const total = (inv.net_total != null ? Number(inv.net_total) : Number(inv.gross_total)) || 0;
        const goods = inv.goods_total != null ? Number(inv.goods_total) : null;
        const service = inv.service_total != null ? Number(inv.service_total) : null;
        if (cat === "beverage") beverage[m] += goods ?? total;
        else if (cat === "consumables") consumables[m] += goods ?? total;
        else if (cat === "food") food[m] += goods ?? total;
        else if (cat === "rent") rent[m] += service ?? total;
        else if (cat === "utilities") struct(UTENZE)[m] += service ?? total;
        else if (cat === "structure" || cat === "other") struct(SERVIZI)[m] += service ?? total;
        else { // uncategorised → split by goods/service
          const g = goods ?? (service != null ? 0 : total);
          const s = service ?? 0;
          if (g) food[m] += g;
          if (s) struct(SERVIZI)[m] += s;
        }
      }

      const cogs: YearLeaf[] = [
        { key: "food", label: t("pl_year_food" as keyof Dictionary) || "Food", monthly: food },
        { key: "beverage", label: t("pl_year_beverage" as keyof Dictionary) || "Beverage", monthly: beverage },
        { key: "consumables", label: t("pl_year_consumables" as keyof Dictionary) || "Consumo", monthly: consumables },
      ].filter((l) => l.monthly.some((v) => v > 0));

      const structure: YearLeaf[] = [...structureMap.entries()]
        .map(([label, monthly], i) => ({ key: `s${i}`, label, monthly }))
        .filter((l) => l.monthly.some((v) => v > 0));

      setData(buildPlYear({
        revenue,
        covers,
        openDays: daysByMonth.map((s) => s.size),
        cogs,
        labor: laborArr,
        structure,
        rent,
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeTenant?.id, supabase, year, vatIncl, t]);

  const locale = LOCALE[language] || "it-IT";
  const monthLabels = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: "short" });
    return Array.from({ length: 12 }, (_, i) => f.format(new Date(year, i, 1)));
  }, [locale, year]);

  const fmt = (n: number | null) => (n == null ? "—" : `€ ${Math.round(n).toLocaleString("it-IT")}`);
  const pct = (n: number | null) => (n == null ? "" : `${n.toFixed(0)}%`);

  const ROW_META: Record<string, { label: string; tip: string }> = {
    revenue: { label: t("pl_revenue" as keyof Dictionary) || "Ricavi", tip: t("pl_tip_revenue" as keyof Dictionary) || "Totale incassato dalla cassa nel mese." },
    cogs: { label: t("pl_year_cogs" as keyof Dictionary) || "Costo materia prima", tip: t("pl_tip_cogs" as keyof Dictionary) || "Acquisti di merce (fatture confermate) divisi in food, beverage e consumo." },
    labor: { label: t("pl_labor" as keyof Dictionary) || "Costo del personale", tip: t("pl_tip_labor" as keyof Dictionary) || "Costo del lavoro dai turni pianificati." },
    structure: { label: t("pl_year_structure" as keyof Dictionary) || "Costi di struttura", tip: t("pl_tip_structure" as keyof Dictionary) || "Costi fissi e servizi (utenze, assistenza, canoni)." },
    rent: { label: t("pl_year_rent" as keyof Dictionary) || "Affitto", tip: t("pl_tip_rent" as keyof Dictionary) || "Canone di locazione del locale." },
    margin: { label: t("pl_operating_margin" as keyof Dictionary) || "Margine operativo", tip: t("pl_tip_margin" as keyof Dictionary) || "Quello che resta dopo materia prima, personale, struttura e affitto." },
  };

  const toggle = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const exportCsv = () => {
    if (!data) return;
    const head = ["", ...monthLabels, t("pl_year_total" as keyof Dictionary) || "Totale"];
    const rows: CsvCell[][] = [head];
    for (const r of data.rows) {
      rows.push([ROW_META[r.key]?.label || r.key, ...r.monthly.map((v) => Math.round(v)), Math.round(r.total)]);
      if (expanded.has(r.key) && r.children) for (const c of r.children) rows.push([`  ${c.label}`, ...c.monthly.map((v) => Math.round(v)), Math.round(c.total)]);
    }
    rows.push([t("pl_year_open_days" as keyof Dictionary) || "Giorni lavoro", ...data.openDays, ""]);
    rows.push([t("pl_year_sales_day" as keyof Dictionary) || "Vendite/giorno", ...data.salesPerDay.map((v) => Math.round(v)), ""]);
    downloadCsv(`conto-economico-${year}.csv`, rows);
  };

  const Tip = ({ text }: { text: string }) => (
    <span title={text} className="inline-flex align-middle cursor-help ml-1" tabIndex={0} aria-label={text}>
      <Info className="w-3.5 h-3.5" style={{ color: "#8d837a" }} />
    </span>
  );

  const cell = (v: number | null, p: number | null, opts?: { bold?: boolean; color?: string; sign?: boolean }) => (
    <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ borderLeft: "1px solid #f0ebe5" }}>
      <div className={`tabular-nums ${opts?.bold ? "font-bold" : ""}`} style={{ color: opts?.color || "#000", fontSize: 13 }}>
        {opts?.sign && v != null && v > 0 ? "−" : ""}{fmt(v)}
      </div>
      {p != null && <div className="tabular-nums" style={{ color: "#8d837a", fontSize: 10.5 }}>{pct(p)}</div>}
    </td>
  );

  return (
    <div className="space-y-4">
      {/* Year navigator + VAT + export */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: BROWN }}>
          <button onClick={() => setYear((y) => y - 1)} className="px-3 py-2 cursor-pointer text-black" aria-label="prev year"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-3 py-2 text-sm font-bold text-black tabular-nums min-w-[4rem] text-center">{year}</span>
          <button onClick={() => setYear((y) => Math.min(nowYear, y + 1))} disabled={year >= nowYear} className="px-3 py-2 cursor-pointer text-black disabled:opacity-40" aria-label="next year"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="inline-flex rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: BROWN }}>
          <button onClick={() => setVatIncl(false)} className={`px-3 py-2 text-sm cursor-pointer ${!vatIncl ? "text-white font-bold" : "text-black"}`} style={!vatIncl ? { background: BROWN } : undefined}>{t("incassi_vat_toggle_excl" as keyof Dictionary) || "IVA esclusa"}</button>
          <button onClick={() => setVatIncl(true)} className={`px-3 py-2 text-sm cursor-pointer ${vatIncl ? "text-white font-bold" : "text-black"}`} style={vatIncl ? { background: BROWN } : undefined}>{t("incassi_vat_toggle_incl" as keyof Dictionary) || "IVA inclusa"}</button>
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70 ml-auto" style={{ borderColor: BROWN }}>
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      {loading && !data ? (
        <div className="rounded-2xl border h-96 animate-pulse" style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
      ) : !data || data.revenueTotal === 0 ? (
        <div className="rounded-2xl border p-10 text-center text-black bg-white/70" style={CARD_STYLE}>
          {t("pl_year_no_data" as keyof Dictionary) || "Nessun dato per quest'anno."}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-white/70" style={CARD_STYLE}>
          <div className="overflow-x-auto">
            <table className="text-sm" style={{ minWidth: 1100, borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #191512" }}>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-black sticky left-0 bg-[#faf6ed]" style={{ minWidth: 190, zIndex: 2 }}>{year}</th>
                  {monthLabels.map((mo, i) => (
                    <th key={i} className="px-2.5 py-2.5 text-right text-xs font-bold uppercase text-black" style={{ borderLeft: "1px solid #f0ebe5" }}>{mo}</th>
                  ))}
                  <th className="px-2.5 py-2.5 text-right text-xs font-bold uppercase text-black" style={{ borderLeft: "2px solid #191512" }}>{t("pl_year_total" as keyof Dictionary) || "Totale"}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const meta = ROW_META[r.key];
                  const isRevenue = r.kind === "revenue";
                  const isResult = r.kind === "result";
                  const hasChildren = !!r.children && r.children.length > 0;
                  const isOpen = expanded.has(r.key);
                  const color = isResult ? (r.total >= 0 ? "#047857" : "#dc2626") : isRevenue ? "#000" : "#000";
                  const bg = isResult ? (r.total >= 0 ? "rgba(5,150,105,0.06)" : "rgba(220,38,38,0.05)") : isRevenue ? "rgba(196,149,106,0.06)" : undefined;
                  return (
                    <Fragment key={r.key}>
                      <tr style={{ borderTop: "1px solid #e5d6bf", background: bg }}>
                        <td className={`px-3 py-2 text-left sticky left-0 ${isResult || isRevenue ? "font-bold" : "font-medium"} text-black`} style={{ background: bg ? "#f6efe2" : "#faf6ed", zIndex: 1 }}>
                          <span className="inline-flex items-center gap-1">
                            {hasChildren ? (
                              <button onClick={() => toggle(r.key)} className="cursor-pointer text-black" aria-label="expand">
                                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevRight className="w-3.5 h-3.5" />}
                              </button>
                            ) : <span className="inline-block w-3.5" />}
                            {!isRevenue && !isResult && <span className="text-black/60">−</span>}
                            {isResult && <span className="text-black/60">=</span>}
                            {meta?.label || r.key}
                            {meta?.tip && <Tip text={meta.tip} />}
                          </span>
                        </td>
                        {r.monthly.map((v, i) => cell(v, r.pct[i], { bold: isResult || isRevenue, color, sign: !isRevenue && !isResult }))}
                        {cell(r.total, r.totalPct, { bold: true, color, sign: !isRevenue && !isResult })}
                      </tr>
                      {hasChildren && isOpen && r.children!.map((c) => (
                        <tr key={r.key + c.key} style={{ borderTop: "1px solid #f0ebe5", background: "rgba(196,149,106,0.03)" }}>
                          <td className="px-3 py-1.5 pl-9 text-left text-black/80 sticky left-0 bg-[#fbf8f1]" style={{ fontSize: 12.5, zIndex: 1 }}>{c.label}</td>
                          {c.monthly.map((v, i) => (
                            <td key={i} className="px-2.5 py-1.5 text-right tabular-nums text-black/80" style={{ borderLeft: "1px solid #f0ebe5", fontSize: 12 }}>{v > 0 ? fmt(v) : "—"}</td>
                          ))}
                          <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-black/80" style={{ borderLeft: "2px solid #191512", fontSize: 12 }}>{fmt(c.total)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}

                {/* Trading days + sales/day, so different-length months compare */}
                <tr style={{ borderTop: "2px solid #191512", background: "rgba(0,0,0,0.02)" }}>
                  <td className="px-3 py-2 text-left text-xs font-bold uppercase text-black sticky left-0 bg-[#f7f2e9]" style={{ zIndex: 1 }}>
                    {t("pl_year_open_days" as keyof Dictionary) || "Giorni lavoro"}<Tip text={t("pl_tip_open_days" as keyof Dictionary) || "Giorni con almeno una vendita nel mese."} />
                  </td>
                  {data.openDays.map((v, i) => <td key={i} className="px-2.5 py-2 text-right tabular-nums text-black" style={{ borderLeft: "1px solid #f0ebe5", fontSize: 12 }}>{v || "—"}</td>)}
                  <td style={{ borderLeft: "2px solid #191512" }} />
                </tr>
                <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                  <td className="px-3 py-2 text-left text-xs font-bold uppercase text-black sticky left-0 bg-[#f7f2e9]" style={{ zIndex: 1 }}>
                    {t("pl_year_sales_day" as keyof Dictionary) || "Vendite/giorno"}<Tip text={t("pl_tip_sales_day" as keyof Dictionary) || "Ricavi del mese diviso i giorni di lavoro."} />
                  </td>
                  {data.salesPerDay.map((v, i) => <td key={i} className="px-2.5 py-2 text-right tabular-nums text-black" style={{ borderLeft: "1px solid #f0ebe5", fontSize: 12 }}>{v > 0 ? fmt(v) : "—"}</td>)}
                  <td style={{ borderLeft: "2px solid #191512" }} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
