"use client";

// Registro fatture + scadenzario. A payables register over supplier_invoices
// (already the store for OCR'd/XML invoices): list, filters, line detail, and the
// two columns that make it a scadenzario — due_date (scadenza) and paid_at (data
// pagamento). Answers the Monday-morning question "cosa devo pagare?".
// XML FatturaPA import drops in structured invoices (with their real due date).

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { FileText, Download, Upload, Search, Check, Clock, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { downloadCsv, type CsvCell } from "@/lib/export/to-csv";

const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#d9c3a3" } as const;
const BROWN = "#c4956a";
const PAGE_SIZE = 20;
const todayStr = () => new Date().toISOString().slice(0, 10);

type Invoice = {
  id: string;
  supplier_name: string | null;
  supplier_vat: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  net_total: number | null;
  tax_total: number | null;
  gross_total: number | null;
  status: string;
  source: string;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
};
type Line = { id: string; description: string | null; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null; kind: string | null };
type PayFilter = "all" | "unpaid" | "overdue" | "paid";
type StatusFilter = "all" | "parsed" | "confirmed";

export default function InvoicesPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const enabled = getFeatures(activeTenant?.settings).management_enabled;

  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useMemo(() => async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("supplier_invoices")
      .select("id, supplier_name, supplier_vat, invoice_number, invoice_date, net_total, tax_total, gross_total, status, source, due_date, paid_at, created_at")
      .eq("tenant_id", activeTenant.id)
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(2000);
    setRows((data as Invoice[]) || []);
    setLoading(false);
  }, [activeTenant?.id, supabase]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const today = todayStr();
  const isOverdue = (i: Invoice) => !i.paid_at && !!i.due_date && i.due_date < today;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((i) => {
      if (needle && !(`${i.supplier_name ?? ""} ${i.supplier_vat ?? ""} ${i.invoice_number ?? ""}`.toLowerCase().includes(needle))) return false;
      if (status !== "all" && i.status !== status) return false;
      if (pay === "paid" && !i.paid_at) return false;
      if (pay === "unpaid" && i.paid_at) return false;
      if (pay === "overdue" && !isOverdue(i)) return false;
      if (from && (i.invoice_date ?? "") < from) return false;
      if (to && (i.invoice_date ?? "") > to) return false;
      return true;
    });
  }, [rows, q, status, pay, from, to, today]);

  useEffect(() => { setPage(0); }, [q, status, pay, from, to]);

  const kpis = useMemo(() => {
    let unpaid = 0, overdue = 0, unpaidN = 0, overdueN = 0;
    for (const i of rows) {
      const amt = Number(i.gross_total ?? i.net_total ?? 0) || 0;
      if (!i.paid_at) { unpaid += amt; unpaidN++; if (isOverdue(i)) { overdue += amt; overdueN++; } }
    }
    return { unpaid: Math.round(unpaid * 100) / 100, overdue: Math.round(overdue * 100) / 100, unpaidN, overdueN };
  }, [rows, today]);

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  if (!enabled) return <ManagementLocked section="invoices" />;

  const fmt = (n: number | null) => (n == null ? "—" : `€ ${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    setLinesLoading(true);
    setLines([]);
    const { data } = await supabase
      .from("supplier_invoice_items")
      .select("id, description, quantity, unit, unit_price, line_total, kind")
      .eq("invoice_id", id)
      .eq("tenant_id", activeTenant!.id)
      .order("created_at");
    setLines((data as Line[]) || []);
    setLinesLoading(false);
  };

  const patch = async (id: string, fields: Partial<Invoice>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    await supabase.from("supplier_invoices").update(fields).eq("id", id).eq("tenant_id", activeTenant!.id);
  };

  const togglePaid = (i: Invoice) => patch(i.id, { paid_at: i.paid_at ? null : today });
  const setDue = (i: Invoice, v: string) => patch(i.id, { due_date: v || null });

  const confirmInvoice = async (i: Invoice) => {
    setBusyId(i.id);
    try {
      const res = await fetch("/api/invoices/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: activeTenant!.id, invoice_id: i.id, receive_stock: false }),
      });
      if (res.ok) { setRows((prev) => prev.map((r) => (r.id === i.id ? { ...r, status: "confirmed" } : r))); }
      else { setNotice(t("invoices_confirm_error" as keyof Dictionary) || "Conferma non riuscita."); }
    } finally { setBusyId(null); }
  };

  const importXml = async (files: FileList) => {
    if (!files.length) return;
    setImporting(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("tenant_id", activeTenant!.id);
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch("/api/invoices/import-xml", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice((t("invoices_import_done" as keyof Dictionary) || "Importate {n} · duplicate {d}")
          .replace("{n}", String(json.imported ?? 0)).replace("{d}", String(json.duplicates ?? 0)));
        await load();
      } else {
        setNotice((json.error as string) || t("invoices_import_error" as keyof Dictionary) || "Import non riuscito.");
      }
    } catch {
      setNotice(t("invoices_import_error" as keyof Dictionary) || "Import non riuscito.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportCsv = () => {
    const head = [
      t("invoices_col_date" as keyof Dictionary) || "Data",
      t("invoices_col_supplier" as keyof Dictionary) || "Fornitore",
      "P.IVA",
      t("invoices_col_number" as keyof Dictionary) || "Numero",
      t("invoices_col_net" as keyof Dictionary) || "Imponibile",
      t("invoices_col_tax" as keyof Dictionary) || "Imposta",
      t("invoices_col_total" as keyof Dictionary) || "Totale",
      t("invoices_col_status" as keyof Dictionary) || "Stato",
      t("invoices_col_due" as keyof Dictionary) || "Scadenza",
      t("invoices_col_payment" as keyof Dictionary) || "Pagamento",
    ];
    const body: CsvCell[][] = filtered.map((i) => [
      i.invoice_date ?? "", i.supplier_name ?? "", i.supplier_vat ?? "", i.invoice_number ?? "",
      i.net_total ?? "", i.tax_total ?? "", i.gross_total ?? "", i.status,
      i.due_date ?? "", i.paid_at ?? "",
    ]);
    downloadCsv(`fatture-${today}.csv`, [head, ...body]);
  };

  const payBadge = (i: Invoice) => {
    if (i.paid_at) return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: "#047857", background: "rgba(5,150,105,0.12)" }}><Check className="w-3 h-3" /> {t("invoices_pay_paid" as keyof Dictionary) || "Pagata"}</span>;
    if (isOverdue(i)) return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: "#b91c1c", background: "rgba(220,38,38,0.1)" }}><AlertTriangle className="w-3 h-3" /> {t("invoices_pay_overdue" as keyof Dictionary) || "Scaduta"}</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: "#92600a", background: "rgba(154,106,25,0.12)" }}><Clock className="w-3 h-3" /> {t("invoices_pay_unpaid" as keyof Dictionary) || "Da pagare"}</span>;
  };

  const btn = "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70";
  const segBtn = (active: boolean) => `px-3 py-1.5 text-sm cursor-pointer ${active ? "text-white font-bold" : "text-black"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <FileText className="w-6 h-6" /> {t("nav_invoices" as keyof Dictionary) || "Fatture"}
          </h1>
          <p className="mt-1 text-sm text-black">{t("invoices_subtitle" as keyof Dictionary) || "Registro fatture fornitore e scadenzario: cosa devi pagare e quando."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" multiple className="hidden" onChange={(e) => e.target.files && importXml(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={importing} className={btn} style={{ borderColor: BROWN }}>
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {t("invoices_import_xml" as keyof Dictionary) || "Importa XML"}
          </button>
          <button onClick={exportCsv} className={btn} style={{ borderColor: BROWN }}><Download className="w-4 h-4" /> CSV</button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border p-3 text-sm text-black" style={{ borderColor: BROWN, background: "rgba(196,149,106,0.08)" }}>{notice}</div>
      )}

      {/* Scadenzario KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi icon={<Clock className="w-4 h-4" />} label={t("invoices_kpi_unpaid" as keyof Dictionary) || "Da pagare"} value={fmt(kpis.unpaid)} sub={`${kpis.unpaidN} ${t("invoices_kpi_count" as keyof Dictionary) || "fatture"}`} />
        <Kpi icon={<AlertTriangle className="w-4 h-4" />} label={t("invoices_kpi_overdue" as keyof Dictionary) || "Scadute"} value={fmt(kpis.overdue)} sub={`${kpis.overdueN} ${t("invoices_kpi_count" as keyof Dictionary) || "fatture"}`} danger={kpis.overdue > 0} />
        <Kpi icon={<FileText className="w-4 h-4" />} label={t("invoices_kpi_total" as keyof Dictionary) || "Totale registro"} value={String(rows.length)} sub={t("invoices_kpi_count" as keyof Dictionary) || "fatture"} />
      </div>

      {/* Filters */}
      <div className={`${CARD} p-3 sm:p-4 flex flex-wrap items-center gap-x-4 gap-y-3`} style={CARD_STYLE}>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("invoices_search_ph" as keyof Dictionary) || "Cerca fornitore, P.IVA, numero…"} className="w-full rounded-lg border pl-9 pr-3 py-2 text-black bg-white/80 text-sm" style={{ borderColor: BROWN }} />
        </div>
        <div className="inline-flex rounded-lg border overflow-hidden bg-white/70" style={{ borderColor: BROWN }}>
          {(["all", "unpaid", "overdue", "paid"] as PayFilter[]).map((p) => (
            <button key={p} onClick={() => setPay(p)} className={segBtn(pay === p)} style={pay === p ? { background: BROWN } : undefined}>
              {t((`invoices_pay_${p === "all" ? "all" : p}`) as keyof Dictionary) || p}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border overflow-hidden bg-white/70" style={{ borderColor: BROWN }}>
          {(["all", "parsed", "confirmed"] as StatusFilter[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={segBtn(status === s)} style={status === s ? { background: BROWN } : undefined}>
              {t((`invoices_status_${s}`) as keyof Dictionary) || s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-black">
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 text-black bg-white/80" style={{ borderColor: BROWN }} />
          <span>–</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-lg border px-2 py-1.5 text-black bg-white/80" style={{ borderColor: BROWN }} />
        </div>
      </div>

      {/* Table */}
      <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 860 }}>
            <thead>
              <tr className="text-left" style={{ borderBottom: "1px solid #e0d0b8" }}>
                <th className="px-3 py-2.5 w-8"></th>
                <Th>{t("invoices_col_date" as keyof Dictionary) || "Data"}</Th>
                <Th>{t("invoices_col_supplier" as keyof Dictionary) || "Fornitore"}</Th>
                <Th>{t("invoices_col_number" as keyof Dictionary) || "Numero"}</Th>
                <Th right>{t("invoices_col_net" as keyof Dictionary) || "Imponibile"}</Th>
                <Th right>{t("invoices_col_tax" as keyof Dictionary) || "Imposta"}</Th>
                <Th right>{t("invoices_col_total" as keyof Dictionary) || "Totale"}</Th>
                <Th>{t("invoices_col_due" as keyof Dictionary) || "Scadenza"}</Th>
                <Th>{t("invoices_col_payment" as keyof Dictionary) || "Pagamento"}</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-black">…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-black">{t("invoices_no_rows" as keyof Dictionary) || "Nessuna fattura."}</td></tr>
              ) : pageRows.map((i) => (
                <Fragment key={i.id}>
                  <tr style={{ borderTop: "1px solid #efe3cf" }} className="align-middle">
                    <td className="px-3 py-2.5">
                      <button onClick={() => toggleExpand(i.id)} className="text-black cursor-pointer" aria-label="detail">
                        {expanded === i.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-black tabular-nums whitespace-nowrap">{i.invoice_date ?? "—"}</td>
                    <td className="px-3 py-2.5 text-black">
                      <div className="font-medium">{i.supplier_name || "—"}</div>
                      {i.supplier_vat && <div className="text-xs text-black/70">{i.supplier_vat}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-black whitespace-nowrap">
                      {i.invoice_number || "—"}
                      {i.source === "sdi_xml" && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: "#4d6d88", background: "rgba(77,109,136,0.12)" }}>XML</span>}
                      {i.status === "parsed" && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: "#92600a", background: "rgba(154,106,25,0.12)" }}>{t("invoices_status_parsed" as keyof Dictionary) || "da confermare"}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-black text-right tabular-nums whitespace-nowrap">{fmt(i.net_total)}</td>
                    <td className="px-3 py-2.5 text-black text-right tabular-nums whitespace-nowrap">{fmt(i.tax_total)}</td>
                    <td className="px-3 py-2.5 text-black text-right tabular-nums whitespace-nowrap font-bold">{fmt(i.gross_total ?? i.net_total)}</td>
                    <td className="px-3 py-2.5">
                      <input type="date" value={i.due_date ?? ""} onChange={(e) => setDue(i, e.target.value)} className="rounded-lg border px-2 py-1 text-black bg-white/80 text-xs" style={{ borderColor: isOverdue(i) ? "#dc2626" : BROWN }} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {payBadge(i)}
                        <button onClick={() => togglePaid(i)} className="text-xs underline underline-offset-2 text-black cursor-pointer" disabled={busyId === i.id}>
                          {i.paid_at ? (t("invoices_mark_unpaid" as keyof Dictionary) || "annulla") : (t("invoices_mark_paid" as keyof Dictionary) || "segna pagata")}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === i.id && (
                    <tr style={{ background: "rgba(196,149,106,0.05)" }}>
                      <td colSpan={9} className="px-6 py-3">
                        {linesLoading ? (
                          <div className="text-black text-sm">…</div>
                        ) : (
                          <div className="space-y-2">
                            {i.status === "parsed" && (
                              <button onClick={() => confirmInvoice(i)} disabled={busyId === i.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg text-white cursor-pointer" style={{ background: BROWN }}>
                                {busyId === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("invoices_confirm" as keyof Dictionary) || "Conferma fattura"}
                              </button>
                            )}
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-black/70">
                                  <th className="py-1 pr-3">{t("invoices_line_desc" as keyof Dictionary) || "Descrizione"}</th>
                                  <th className="py-1 pr-3 text-right">{t("invoices_line_qty" as keyof Dictionary) || "Q.tà"}</th>
                                  <th className="py-1 pr-3 text-right">{t("invoices_line_price" as keyof Dictionary) || "Prezzo"}</th>
                                  <th className="py-1 pr-3 text-right">{t("invoices_line_total" as keyof Dictionary) || "Totale"}</th>
                                  <th className="py-1">{t("invoices_line_kind" as keyof Dictionary) || "Tipo"}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.length === 0 ? (
                                  <tr><td colSpan={5} className="py-2 text-black">{t("invoices_no_lines" as keyof Dictionary) || "Nessuna riga."}</td></tr>
                                ) : lines.map((l) => (
                                  <tr key={l.id} className="text-black">
                                    <td className="py-1 pr-3">{l.description || "—"}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{l.quantity ?? "—"}{l.unit ? ` ${l.unit}` : ""}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{fmt(l.unit_price)}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{fmt(l.line_total)}</td>
                                    <td className="py-1">{l.kind || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-black" style={{ borderColor: "#e0d0b8" }}>
            <span>{filtered.length} {t("invoices_kpi_count" as keyof Dictionary) || "fatture"}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 rounded-lg border cursor-pointer disabled:opacity-40" style={{ borderColor: BROWN }}>‹</button>
              <span className="tabular-nums">{page + 1} / {pageCount}</span>
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="px-3 py-1 rounded-lg border cursor-pointer disabled:opacity-40" style={{ borderColor: BROWN }}>›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-black ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Kpi({ icon, label, value, sub, danger }: { icon: React.ReactNode; label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className={`${CARD} p-4`} style={CARD_STYLE}>
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg shrink-0" style={{ background: danger ? "rgba(220,38,38,0.1)" : "rgba(196,149,106,0.12)", color: danger ? "#b91c1c" : "#000" }}>{icon}</div>
        <div className="text-xs font-bold uppercase tracking-wide text-black">{label}</div>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: danger ? "#b91c1c" : "#000" }}>{value}</div>
      {sub && <div className="text-xs text-black mt-0.5">{sub}</div>}
    </div>
  );
}
