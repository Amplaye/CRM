"use client";

// Area incassi — the revenue dashboard. Reads the native till (pos_sales /
// pos_sale_items), which we already fill, and turns it into the view iammi calls
// "Area incassi": KPIs, takings per day, per menu category, per payment method,
// per hour band — plus a dimension they don't have: sala / asporto / delivery.
// No migration, no integration: everything here is a query over tables we own.

import { useEffect, useMemo, useState } from "react";
import { Banknote, Receipt, Users, Download, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { downloadCsv, type CsvCell } from "@/lib/export/to-csv";
import { buildReportPdf, downloadPdf } from "@/lib/export/to-pdf";

const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#d9c3a3" } as const;
const BROWN = "#c4956a";
const SAGE = "#7a8560";
// Donut slice palette — warm bronze → sage spread, readable in both charts.
const SLICE = ["#c4956a", "#7a8560", "#b3855c", "#9a6a19", "#4d6d88", "#a8574e", "#8b6540", "#5f7a52", "#caa06f", "#7d6b8a"];

const PRESETS = [7, 30, 90] as const;
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

type SaleRow = {
  id: string;
  businessDate: string;
  closedAt: string;
  channel: string;
  channelSource: string | null;
  paymentMethod: string | null;
  gross: number;
  net: number | null;
  covers: number | null;
};
type ItemRow = { saleId: string; category: string | null; gross: number; taxRate: number | null };

const PAY_KEY: Record<string, keyof Dictionary> = {
  cash: "incassi_pay_cash" as keyof Dictionary,
  card: "incassi_pay_card" as keyof Dictionary,
  online: "incassi_pay_online" as keyof Dictionary,
  meal_voucher: "incassi_pay_meal_voucher" as keyof Dictionary,
  bank_transfer: "incassi_pay_bank_transfer" as keyof Dictionary,
  other: "incassi_pay_other" as keyof Dictionary,
};
const CHANNEL_KEY: Record<string, keyof Dictionary> = {
  sala: "incassi_channel_sala" as keyof Dictionary,
  asporto: "incassi_channel_asporto" as keyof Dictionary,
  delivery: "incassi_channel_delivery" as keyof Dictionary,
};

export default function IncassiPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const settings = activeTenant?.settings;
  const enabled = getFeatures(settings).management_enabled;
  const tz = (settings as any)?.timezone || "Europe/Rome";

  const today = useMemo(() => dateStr(new Date()), []);
  const [from, setFrom] = useState(() => dateStr(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => dateStr(new Date()));
  const [vatIncl, setVatIncl] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: salesRaw } = await supabase
        .from("pos_sales")
        .select("id, business_date, closed_at, channel, channel_source, payment_method, gross_total, net_total, covers")
        .eq("tenant_id", activeTenant.id)
        .gte("business_date", from)
        .lte("business_date", to)
        .order("business_date");
      if (cancelled) return;
      const rows: SaleRow[] = (salesRaw || []).map((s: any) => ({
        id: s.id,
        businessDate: s.business_date,
        closedAt: s.closed_at,
        channel: s.channel || "sala",
        channelSource: s.channel_source,
        paymentMethod: s.payment_method,
        gross: Number(s.gross_total) || 0,
        net: s.net_total != null ? Number(s.net_total) : null,
        covers: s.covers,
      }));
      const ids = rows.map((r) => r.id);
      let itemRows: ItemRow[] = [];
      if (ids.length > 0) {
        const { data: it } = await supabase
          .from("pos_sale_items")
          .select("sale_id, category, gross_total, tax_rate")
          .in("sale_id", ids);
        itemRows = (it || []).map((i: any) => ({
          saleId: i.sale_id,
          category: i.category,
          gross: Number(i.gross_total) || 0,
          taxRate: i.tax_rate != null ? Number(i.tax_rate) : null,
        }));
      }
      if (cancelled) return;
      setSales(rows);
      setItems(itemRows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeTenant?.id, enabled, supabase, from, to]);

  const hourFmt = useMemo(
    () => new Intl.DateTimeFormat("it-IT", { hour: "2-digit", hour12: false, timeZone: tz }),
    [tz],
  );

  const model = useMemo(() => {
    const saleAmount = (s: SaleRow) => (vatIncl ? s.gross : s.net ?? s.gross);
    const itemAmount = (i: ItemRow) =>
      vatIncl ? i.gross : i.taxRate ? i.gross / (1 + i.taxRate / 100) : i.gross;

    let total = 0;
    let covers = 0;
    const byDay = new Map<string, number>();
    const byPay = new Map<string, number>();
    const byHour = new Map<number, number>();
    const byChannel = new Map<string, number>();
    for (const s of sales) {
      const amt = saleAmount(s);
      total += amt;
      covers += s.covers || 0;
      byDay.set(s.businessDate, (byDay.get(s.businessDate) || 0) + amt);
      const pk = s.paymentMethod || "__unknown";
      byPay.set(pk, (byPay.get(pk) || 0) + amt);
      const h = Number(hourFmt.format(new Date(s.closedAt)));
      byHour.set(h, (byHour.get(h) || 0) + amt);
      const chLabel = s.channel === "delivery" && s.channelSource
        ? `delivery:${s.channelSource}`
        : s.channel;
      byChannel.set(chLabel, (byChannel.get(chLabel) || 0) + amt);
    }
    const byCat = new Map<string, number>();
    for (const i of items) {
      const key = i.category || "__uncat";
      byCat.set(key, (byCat.get(key) || 0) + itemAmount(i));
    }

    const orders = sales.length;
    const dayRows = Array.from(byDay.entries()).sort().map(([day, v]) => ({ day: day.slice(5), value: round2(v) }));
    const hourRows = Array.from(byHour.entries()).sort((a, b) => a[0] - b[0])
      .map(([h, v]) => ({ hour: `${String(h).padStart(2, "0")}:00`, value: round2(v) }));
    const payRows = Array.from(byPay.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
      key: k,
      name: k === "__unknown" ? (t("incassi_pay_unknown" as keyof Dictionary) as string) : (t(PAY_KEY[k]) as string) || k,
      value: round2(v),
    }));
    const catRows = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({
      key: k,
      name: k === "__uncat" ? (t("incassi_uncategorized" as keyof Dictionary) as string) : k,
      value: round2(v),
    }));
    const channelRows = Array.from(byChannel.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const [base, src] = k.split(":");
      const label = src
        ? `${t(CHANNEL_KEY[base]) as string} · ${src}`
        : (t(CHANNEL_KEY[base]) as string) || base;
      return { key: k, name: label, value: round2(v) };
    });

    return {
      total: round2(total),
      covers,
      orders,
      avgTicket: orders > 0 ? round2(total / orders) : null,
      dayRows, hourRows, payRows, catRows, channelRows,
    };
  }, [sales, items, vatIncl, hourFmt, t]);

  if (!enabled) return <ManagementLocked section="incassi" />;

  const fmt = (n: number | null) =>
    n == null ? "—" : `€ ${n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmt2 = (n: number | null) =>
    n == null ? "—" : `€ ${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const setPreset = (days: number) => {
    setTo(dateStr(new Date()));
    setFrom(dateStr(new Date(Date.now() - (days - 1) * 86400000)));
  };
  const activePreset = (days: number) =>
    to === today && from === dateStr(new Date(Date.now() - (days - 1) * 86400000));

  const exportCsv = () => {
    const rows: CsvCell[][] = [
      [t("incassi_total" as keyof Dictionary) || "Incassato", model.total],
      [t("pl_covers" as keyof Dictionary) || "Coperti", model.covers],
      [t("incassi_orders" as keyof Dictionary) || "Scontrini", model.orders],
      [t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio", model.avgTicket ?? ""],
      [],
      [t("incassi_by_payment" as keyof Dictionary) || "Per pagamento"],
      ...model.payRows.map((r) => [r.name, r.value] as CsvCell[]),
      [],
      [t("incassi_by_category" as keyof Dictionary) || "Per categoria"],
      ...model.catRows.map((r) => [r.name, r.value] as CsvCell[]),
      [],
      [t("incassi_by_channel" as keyof Dictionary) || "Per canale"],
      ...model.channelRows.map((r) => [r.name, r.value] as CsvCell[]),
      [],
      [t("incassi_by_day" as keyof Dictionary) || "Per giorno"],
      ...model.dayRows.map((r) => [r.day, r.value] as CsvCell[]),
    ];
    downloadCsv(`incassi-${from}_${to}.csv`, rows);
  };

  const exportPdf = async () => {
    const bytes = await buildReportPdf({
      title: t("nav_incassi" as keyof Dictionary) || "Incassi",
      subtitle: `${from} → ${to}${vatIncl ? "" : " · " + (t("incassi_vat_toggle_excl" as keyof Dictionary) || "IVA esclusa")}`,
      business: activeTenant?.name || undefined,
      sections: [
        {
          title: t("export_section_summary" as keyof Dictionary) || "Riepilogo",
          columns: [t("export_col_metric" as keyof Dictionary) || "Voce", t("export_col_value" as keyof Dictionary) || "Valore"],
          rows: [
            [t("incassi_total" as keyof Dictionary) || "Incassato", fmt(model.total)],
            [t("pl_covers" as keyof Dictionary) || "Coperti", String(model.covers)],
            [t("incassi_orders" as keyof Dictionary) || "Scontrini", String(model.orders)],
            [t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio", fmt2(model.avgTicket)],
          ],
        },
        {
          title: t("incassi_by_payment" as keyof Dictionary) || "Per pagamento",
          columns: ["", t("export_col_value" as keyof Dictionary) || "Valore"],
          rows: model.payRows.map((r) => [r.name, fmt(r.value)]),
        },
        {
          title: t("incassi_by_category" as keyof Dictionary) || "Per categoria",
          columns: ["", t("export_col_value" as keyof Dictionary) || "Valore"],
          rows: model.catRows.map((r) => [r.name, fmt(r.value)]),
        },
      ],
      footer: `${t("export_generated" as keyof Dictionary) || "Generato il"} ${today} — TableFlow`,
    });
    downloadPdf(`incassi-${from}_${to}.pdf`, bytes);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Banknote className="w-6 h-6" /> {t("nav_incassi" as keyof Dictionary) || "Incassi"}
          </h1>
          <p className="mt-1 text-sm text-black">
            {t("incassi_subtitle" as keyof Dictionary) || "Ricavi dalla cassa: per giorno, categoria, pagamento, fascia oraria e canale."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70" style={{ borderColor: BROWN }}>
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={exportPdf} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70" style={{ borderColor: BROWN }}>
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* Controls: presets + free range + VAT toggle */}
      <div className={`${CARD} p-3 sm:p-4 flex flex-wrap items-center gap-x-4 gap-y-3`} style={CARD_STYLE}>
        <div className="inline-flex rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: BROWN }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3.5 py-2 text-sm cursor-pointer ${activePreset(p) ? "text-white font-bold" : "text-black"}`}
              style={activePreset(p) ? { background: BROWN } : undefined}
            >
              {p}{t("pl_days_short" as keyof Dictionary) || "gg"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-black">
          <label className="flex items-center gap-1.5">
            <span className="font-medium">{t("incassi_from" as keyof Dictionary) || "Dal"}</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 text-black bg-white/80" style={{ borderColor: BROWN }} />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-medium">{t("incassi_to" as keyof Dictionary) || "Al"}</span>
            <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="rounded-lg border px-2 py-1.5 text-black bg-white/80" style={{ borderColor: BROWN }} />
          </label>
        </div>
        <div className="inline-flex rounded-xl border overflow-hidden bg-white/70 ml-auto" style={{ borderColor: BROWN }}>
          <button onClick={() => setVatIncl(true)} className={`px-3 py-2 text-sm cursor-pointer ${vatIncl ? "text-white font-bold" : "text-black"}`} style={vatIncl ? { background: BROWN } : undefined}>
            {t("incassi_vat_toggle_incl" as keyof Dictionary) || "IVA inclusa"}
          </button>
          <button onClick={() => setVatIncl(false)} className={`px-3 py-2 text-sm cursor-pointer ${!vatIncl ? "text-white font-bold" : "text-black"}`} style={!vatIncl ? { background: BROWN } : undefined}>
            {t("incassi_vat_toggle_excl" as keyof Dictionary) || "IVA esclusa"}
          </button>
        </div>
      </div>

      {loading && sales.length === 0 ? (
        <>
          <div className={`${CARD} h-28 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
          <div className={`${CARD} h-80 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
        </>
      ) : sales.length === 0 ? (
        <div className={`${CARD} p-10 text-center text-black`} style={CARD_STYLE}>
          {t("incassi_no_data" as keyof Dictionary) || "Nessun incasso nel periodo selezionato."}
        </div>
      ) : (
        <>
          {/* KPI row with sparklines */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              icon={<Banknote className="w-4 h-4" />}
              label={t("incassi_total" as keyof Dictionary) || "Incassato"}
              value={fmt(model.total)}
              spark={model.dayRows.map((r) => r.value)}
            />
            <KpiCard
              icon={<Receipt className="w-4 h-4" />}
              label={t("pl_avg_ticket" as keyof Dictionary) || "Scontrino medio"}
              value={fmt2(model.avgTicket)}
              spark={model.dayRows.map((r) => r.value)}
              sub={`${model.orders} ${(t("incassi_orders" as keyof Dictionary) as string)?.toLowerCase() || "scontrini"}`}
            />
            <KpiCard
              icon={<Users className="w-4 h-4" />}
              label={t("pl_covers" as keyof Dictionary) || "Coperti"}
              value={String(model.covers)}
              spark={model.dayRows.map((r) => r.value)}
              sub={model.covers > 0 && model.total > 0 ? `${fmt2(round2(model.total / model.covers))} ${t("pl_avg_ticket_short" as keyof Dictionary) || "a coperto"}` : undefined}
            />
          </div>

          {/* Takings per day */}
          <div className={`${CARD} p-4`} style={CARD_STYLE}>
            <h2 className="text-sm font-bold text-black mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" /> {t("incassi_by_day" as keyof Dictionary) || "Incasso per giorno"}
            </h2>
            <div style={{ height: 260 }}>
              <ChartFrame>
                <BarChart data={model.dayRows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d3bd9c" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(model.dayRows.length / 12))} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  <Bar dataKey="value" name={t("incassi_total" as keyof Dictionary) || "Incassato"} fill={BROWN} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ChartFrame>
            </div>
          </div>

          {/* Donuts: category + payment method */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DonutCard title={t("incassi_by_category" as keyof Dictionary) || "Incasso per categoria"} rows={model.catRows} total={model.catRows.reduce((s, r) => s + r.value, 0)} fmt={fmt} />
            <DonutCard title={t("incassi_by_payment" as keyof Dictionary) || "Tipologia di pagamento"} rows={model.payRows} total={model.total} fmt={fmt} />
          </div>

          {/* Per hour + per channel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${CARD} p-4`} style={CARD_STYLE}>
              <h2 className="text-sm font-bold text-black mb-3">{t("incassi_by_hour" as keyof Dictionary) || "Incasso per fascia oraria"}</h2>
              <div style={{ height: 240 }}>
                <ChartFrame>
                  <BarChart data={model.hourRows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d3bd9c" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => fmt(Number(v))} />
                    <Bar dataKey="value" name={t("incassi_total" as keyof Dictionary) || "Incassato"} fill={SAGE} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ChartFrame>
              </div>
            </div>
            <div className={`${CARD} p-4`} style={CARD_STYLE}>
              <h2 className="text-sm font-bold text-black mb-3">{t("incassi_by_channel" as keyof Dictionary) || "Incasso per canale"}</h2>
              <div style={{ height: 240 }}>
                <ChartFrame>
                  <BarChart data={model.channelRows} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d3bd9c" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip formatter={(v: any) => fmt(Number(v))} />
                    <Bar dataKey="value" name={t("incassi_total" as keyof Dictionary) || "Incassato"} radius={[0, 4, 4, 0]} maxBarSize={34}>
                      {model.channelRows.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
                    </Bar>
                  </BarChart>
                </ChartFrame>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, spark, sub }: { icon: React.ReactNode; label: string; value: string; spark: number[]; sub?: string }) {
  return (
    <div className={`${CARD} p-4`} style={CARD_STYLE}>
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg shrink-0" style={{ background: "rgba(196,149,106,0.12)", color: "#000" }}>{icon}</div>
        <div className="text-xs font-bold uppercase tracking-wide text-black">{label}</div>
      </div>
      <div className="mt-2 text-3xl font-bold text-black tabular-nums">{value}</div>
      {sub && <div className="text-xs text-black mt-0.5">{sub}</div>}
      <div className="mt-2"><Sparkline data={spark} /></div>
    </div>
  );
}

// Dependency-free SVG sparkline (recharts is reserved for the full charts).
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-8" />;
  const w = 100, h = 28;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={BROWN} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DonutCard({ title, rows, total, fmt }: { title: string; rows: Array<{ key: string; name: string; value: number }>; total: number; fmt: (n: number | null) => string }) {
  return (
    <div className={`${CARD} p-4`} style={CARD_STYLE}>
      <h2 className="text-sm font-bold text-black mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
        <div className="relative" style={{ height: 200 }}>
          <ChartFrame>
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
                {rows.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
            </PieChart>
          </ChartFrame>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg font-bold text-black tabular-nums">{fmt(total)}</span>
          </div>
        </div>
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2 text-sm text-black">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: SLICE[i % SLICE.length] }} />
              <span className="flex-1 truncate">{r.name}</span>
              <span className="font-bold tabular-nums">{fmt(r.value)}</span>
              <span className="text-xs tabular-nums w-10 text-right text-black">{total > 0 ? `${Math.round((r.value / total) * 100)}%` : "—"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
