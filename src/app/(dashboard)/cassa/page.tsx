"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, LayoutGrid, ReceiptText, Lock, Unlock, AlertTriangle } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { getFeatures } from "@/lib/types/tenant-settings";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import type { MenuCategory, MenuItem, MenuItemVariant } from "@/lib/types";
import {
  computeTotals,
  comandaCourses,
  comandaStations,
  vatBreakdown,
  fmtEur,
  toCents,
  fromCents,
  isActiveLine,
  DEFAULT_VAT_RATE,
  type SessionSummary,
} from "@/lib/cassa/totals";
import type {
  CassaDraftLine,
  CassaOrderFull,
  CassaOrderItemRow,
  CassaSessionRow,
} from "@/lib/cassa/types";
import { SalaView, type CassaTable } from "@/components/cassa/SalaView";
import { OrderView } from "@/components/cassa/OrderView";
import { PayModal, type PayEntry } from "@/components/cassa/PayModal";
import { ReceiptsView } from "@/components/cassa/ReceiptsView";
import { SessionView } from "@/components/cassa/SessionView";
import { PrintSheet, type PrintPayload } from "@/components/cassa/PrintSheet";

// La cassa nativa: sala → comanda → conto → incasso → chiusura di giornata.
// Reads go straight to supabase under RLS (like every dashboard page); every
// write goes through /api/cassa/* where totals are recomputed server-side.

type View = "sala" | "order" | "receipts" | "close";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data as T;
}

export default function CassaPage() {
  const { activeTenant, activeRole, globalRole, refreshActiveTenant } = useTenant();
  const { t } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const enabled = getFeatures(activeTenant?.settings).management_enabled;
  const canManage =
    activeRole === "owner" || activeRole === "manager" || globalRole === "platform_admin";

  const [view, setView] = useState<View>("sala");
  const [tables, setTables] = useState<CassaTable[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [openOrders, setOpenOrders] = useState<CassaOrderFull[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [draftsMap, setDraftsMap] = useState<Record<string, CassaDraftLine[]>>({});
  const [session, setSession] = useState<CassaSessionRow | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [coverCharge, setCoverCharge] = useState(0);
  const [businessDate, setBusinessDate] = useState("");
  const [receipts, setReceipts] = useState<CassaOrderFull[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payResult, setPayResult] = useState<{ receiptNumber: number | null; receiptYear: number | null; change: number } | null>(null);
  const [paidOrder, setPaidOrder] = useState<CassaOrderFull | null>(null);
  // FIFO of sheets to print: a multi-station comanda queues one sheet per
  // reparto and PrintSheet consumes the head, one print dialog after the other.
  const [printQueue, setPrintQueue] = useState<PrintPayload[]>([]);
  const [busy, setBusy] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const draftKeySeq = useRef(0);

  const tenantId = activeTenant?.id;
  const venueName = activeTenant?.name || "";
  const activeOrder = useMemo(
    () => openOrders.find((o) => o.id === activeOrderId) || null,
    [openOrders, activeOrderId],
  );
  const drafts = useMemo(
    () => (activeOrderId ? draftsMap[activeOrderId] || [] : []),
    [draftsMap, activeOrderId],
  );

  const fail = useCallback(
    (err: unknown) => {
      console.error("Cassa error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`${t("cassa_error")}: ${msg}`);
    },
    [t],
  );

  // ------------------------------------------------------------------ loads
  const loadStatic = useCallback(async () => {
    if (!tenantId) return;
    const [{ data: tbs }, { data: cats }, { data: its }] = await Promise.all([
      supabase
        .from("restaurant_tables")
        .select("id, name, seats, zone")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("menu_categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("menu_items")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    setTables(
      ((tbs || []) as CassaTable[]).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    );
    setCategories((cats || []) as MenuCategory[]);
    setItems((its || []) as MenuItem[]);
  }, [supabase, tenantId]);

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("cassa_orders")
      .select("*, items:cassa_order_items(*)")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("opened_at", { ascending: true });
    if (error) {
      // Missing tables = the migration hasn't been applied yet on this DB.
      if (/cassa_orders/.test(error.message) || error.code === "42P01") setSetupNeeded(true);
      return;
    }
    setSetupNeeded(false);
    setOpenOrders((data || []) as CassaOrderFull[]);
  }, [supabase, tenantId]);

  const loadSession = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await api<{
        session: CassaSessionRow | null;
        summary: SessionSummary | null;
        cover_charge: number;
        business_date: string;
      }>(`/api/cassa/session?tenant_id=${tenantId}`);
      setSession(data.session);
      setSummary(data.summary);
      setCoverCharge(data.cover_charge);
      setBusinessDate(data.business_date);
    } catch {
      /* session panel simply stays empty (e.g. before the migration) */
    }
  }, [tenantId]);

  const loadReceipts = useCallback(async () => {
    if (!tenantId || !businessDate) return;
    try {
      const data = await api<{ orders: CassaOrderFull[] }>(
        `/api/cassa/orders?tenant_id=${tenantId}&scope=day&date=${businessDate}`,
      );
      setReceipts(data.orders);
    } catch (err) {
      console.error("Cassa receipts load error:", err);
    }
  }, [tenantId, businessDate]);

  useEffect(() => {
    if (!tenantId || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadStatic(), loadOrders(), loadSession()]);
      if (!cancelled) setLoading(false);
    })();
    const channel = supabase
      .channel(`cassa-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cassa_orders", filter: `tenant_id=eq.${tenantId}` },
        () => {
          loadOrders();
          loadSession();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tenantId, enabled, supabase, loadStatic, loadOrders, loadSession]);

  useEffect(() => {
    if (view === "receipts") loadReceipts();
  }, [view, loadReceipts]);

  // ------------------------------------------------------------- order flow
  const upsertOrder = useCallback((order: CassaOrderFull) => {
    setOpenOrders((prev) => {
      const rest = prev.filter((o) => o.id !== order.id);
      return order.status === "open"
        ? [...rest, order].sort((a, b) => a.opened_at.localeCompare(b.opened_at))
        : rest;
    });
  }, []);

  const openTable = async (table: CassaTable, existing: CassaOrderFull | null) => {
    if (existing) {
      setActiveOrderId(existing.id);
      setView("order");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const data = await api<{ order: CassaOrderFull }>("/api/cassa/orders", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          table_id: table.id,
          table_name: table.name,
          channel: "sala",
          covers: table.seats,
        }),
      });
      upsertOrder({ ...data.order, items: data.order.items || [] });
      setActiveOrderId(data.order.id);
      setView("order");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const counterSale = async (kind: "banco" | "asporto") => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api<{ order: CassaOrderFull }>("/api/cassa/orders", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          table_id: null,
          table_name: kind === "banco" ? t("cassa_counter_sale") : t("cassa_takeaway"),
          channel: kind === "banco" ? "sala" : "asporto",
          covers: 0,
        }),
      });
      upsertOrder({ ...data.order, items: data.order.items || [] });
      setActiveOrderId(data.order.id);
      setView("order");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const setDrafts = (orderId: string, next: CassaDraftLine[]) =>
    setDraftsMap((prev) => ({ ...prev, [orderId]: next }));

  const enqueuePrint = (p: PrintPayload | PrintPayload[]) =>
    setPrintQueue((q) => [...q, ...(Array.isArray(p) ? p : [p])]);

  const addItem = (item: MenuItem, course: number, variants: MenuItemVariant[] = []) => {
    if (!activeOrderId) return;
    const cur = draftsMap[activeOrderId] || [];
    // Same dish, same course, plain (no notes/variants) → just bump the qty.
    const match = cur.find(
      (d) => d.menu_item_id === item.id && d.course === course && !d.notes && d.variants.length === 0,
    );
    if (match && variants.length === 0) {
      setDrafts(
        activeOrderId,
        cur.map((d) => (d.key === match.key ? { ...d, qty: d.qty + 1 } : d)),
      );
    } else {
      draftKeySeq.current += 1;
      const priceC =
        toCents(item.price ?? 0) + variants.reduce((s, v) => s + toCents(v.price_delta), 0);
      setDrafts(activeOrderId, [
        ...cur,
        {
          key: `d${draftKeySeq.current}`,
          menu_item_id: item.id,
          name: item.name,
          unit_price: fromCents(priceC),
          qty: 1,
          course,
          notes: null,
          vat_rate: Number(item.vat_rate ?? DEFAULT_VAT_RATE),
          station: item.station ?? null,
          variants,
        },
      ]);
    }
  };

  const addFree = (name: string, price: number, course: number) => {
    if (!activeOrderId) return;
    draftKeySeq.current += 1;
    setDrafts(activeOrderId, [
      ...(draftsMap[activeOrderId] || []),
      {
        key: `d${draftKeySeq.current}`,
        menu_item_id: null,
        name,
        unit_price: price,
        qty: 1,
        course,
        notes: null,
        vat_rate: DEFAULT_VAT_RATE,
        station: null,
        variants: [],
      },
    ]);
  };

  const draftQty = (key: string, delta: number) => {
    if (!activeOrderId) return;
    const cur = draftsMap[activeOrderId] || [];
    setDrafts(
      activeOrderId,
      cur
        .map((d) => (d.key === key ? { ...d, qty: d.qty + delta } : d))
        .filter((d) => d.qty > 0),
    );
  };

  const draftCourse = (key: string) => {
    if (!activeOrderId) return;
    const cur = draftsMap[activeOrderId] || [];
    setDrafts(
      activeOrderId,
      cur.map((d) => (d.key === key ? { ...d, course: (d.course % 3) + 1 } : d)),
    );
  };

  const draftNotes = (key: string, notes: string | null) => {
    if (!activeOrderId) return;
    const cur = draftsMap[activeOrderId] || [];
    setDrafts(activeOrderId, cur.map((d) => (d.key === key ? { ...d, notes } : d)));
  };

  const removeDraft = (key: string) => {
    if (!activeOrderId) return;
    setDrafts(activeOrderId, (draftsMap[activeOrderId] || []).filter((d) => d.key !== key));
  };

  /** Fire the pending drafts as a comanda; returns the refreshed items or null. */
  const sendComanda = async (): Promise<CassaOrderItemRow[] | null> => {
    if (!activeOrder || drafts.length === 0) return activeOrder?.items ?? null;
    setBusy(true);
    try {
      const data = await api<{ items: CassaOrderItemRow[]; comanda_no: number; totals: { subtotal: number; total: number } }>(
        `/api/cassa/orders/${activeOrder.id}/items`,
        {
          method: "POST",
          body: JSON.stringify({
            tenant_id: tenantId,
            items: drafts.map((d) => ({
              menu_item_id: d.menu_item_id,
              name: d.name,
              unit_price: d.unit_price,
              qty: d.qty,
              course: d.course,
              notes: d.notes,
              vat_rate: d.vat_rate,
              station: d.station,
              variants: d.variants,
            })),
          }),
        },
      );
      const nextItems = [...activeOrder.items, ...data.items];
      upsertOrder({ ...activeOrder, items: nextItems, subtotal: data.totals.subtotal, total: data.totals.total });
      setDrafts(activeOrder.id, []);
      return nextItems;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const printLastComanda = () => {
    if (!activeOrder) return;
    const active = activeOrder.items.filter(isActiveLine);
    if (active.length === 0) return;
    const last = Math.max(...active.map((i) => i.comanda_no));
    const lines = active.filter((i) => i.comanda_no === last);
    // One sheet per reparto (cucina/bar/…): the bar shouldn't see the kitchen's
    // dishes. A single unassigned group prints the classic single sheet.
    const groups = comandaStations(lines);
    const soloSheet = groups.length === 1 && groups[0].station === null;
    enqueuePrint(
      groups.map(({ station, lines: ls }) => ({
        kind: "comanda" as const,
        venue: venueName,
        tableLabel: activeOrder.table_name,
        when: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        comandaNo: last,
        station: soloSheet ? null : station,
        covers: activeOrder.covers,
        courses: comandaCourses(ls).map((g) => ({
          course: g.course,
          lines: g.lines.map((l) => ({
            qty: l.qty,
            name: (l as CassaOrderItemRow).name,
            notes: (l as CassaOrderItemRow).notes,
            variants: ((l as CassaOrderItemRow).variants || []).map((v) => v.name),
            course: g.course,
          })),
        })),
      })),
    );
  };

  const storno = async (item: CassaOrderItemRow) => {
    if (!activeOrder) return;
    setBusy(true);
    try {
      const data = await api<{ totals: { subtotal: number; total: number } }>(
        `/api/cassa/orders/${activeOrder.id}/items`,
        {
          method: "PATCH",
          body: JSON.stringify({ tenant_id: tenantId, item_id: item.id, action: "cancel" }),
        },
      );
      upsertOrder({
        ...activeOrder,
        items: activeOrder.items.map((i) => (i.id === item.id ? { ...i, status: "cancelled" } : i)),
        subtotal: data.totals.subtotal,
        total: data.totals.total,
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const patchOrder = async (patch: Record<string, unknown>) => {
    if (!activeOrder) return;
    setBusy(true);
    try {
      const data = await api<{ order: CassaOrderFull }>(`/api/cassa/orders/${activeOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tenant_id: tenantId, ...patch }),
      });
      upsertOrder({ ...activeOrder, ...data.order, items: activeOrder.items });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!activeOrder) return;
    setBusy(true);
    try {
      await api(`/api/cassa/orders/${activeOrder.id}?tenant_id=${tenantId}`, { method: "DELETE" });
      setOpenOrders((prev) => prev.filter((o) => o.id !== activeOrder.id));
      setActiveOrderId(null);
      setView("sala");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const charge = async () => {
    if (!activeOrder) return;
    if (drafts.length > 0) {
      const sent = await sendComanda();
      if (!sent) return; // send failed — don't open the till on stale totals
    }
    setPayResult(null);
    setPaidOrder(null);
    setPayOpen(true);
  };

  const confirmPay = async (payments: PayEntry[]) => {
    if (!activeOrder) return;
    setBusy(true);
    try {
      const data = await api<{
        order: CassaOrderFull;
        receipt_number: number | null;
        receipt_year: number | null;
        change: number;
      }>(`/api/cassa/orders/${activeOrder.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, payments }),
      });
      setPaidOrder(data.order);
      setPayResult({ receiptNumber: data.receipt_number, receiptYear: data.receipt_year, change: data.change });
      setOpenOrders((prev) => prev.filter((o) => o.id !== activeOrder.id));
      loadSession();
      if (view === "receipts") loadReceipts();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const buildReceiptPayload = (order: CassaOrderFull): PrintPayload => {
    const active = order.items.filter(isActiveLine);
    const totals = computeTotals(order, order.items);
    const changeC = (order.payments || []).reduce(
      (s, p) => s + (p.received != null ? Math.max(0, toCents(p.received) - toCents(p.amount)) : 0),
      0,
    );
    return {
      kind: "bill",
      variant: "scontrino",
      venue: venueName,
      tableLabel: order.table_name,
      when: order.closed_at
        ? new Date(order.closed_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
        : "",
      covers: order.covers,
      lines: active.map((i) => ({
        qty: i.qty,
        name: i.name,
        variants: (i.variants || []).map((v) => v.name),
        total: fromCents(Math.round(i.qty * toCents(i.unit_price))),
      })),
      totals,
      vat: vatBreakdown(order, order.items),
      receipt: { number: order.receipt_number, year: order.receipt_year },
      payments: (order.payments || []).map((p) => ({ method: p.method, amount: p.amount, received: p.received })),
      change: fromCents(changeC),
    };
  };

  const preconto = async () => {
    if (!activeOrder) return;
    let itemsNow = activeOrder.items;
    if (drafts.length > 0) {
      const sent = await sendComanda();
      if (!sent) return;
      itemsNow = sent;
    }
    const order = { ...activeOrder, items: itemsNow };
    const active = itemsNow.filter(isActiveLine);
    enqueuePrint({
      kind: "bill",
      variant: "preconto",
      venue: venueName,
      tableLabel: order.table_name,
      when: new Date().toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
      covers: order.covers,
      lines: active.map((i) => ({
        qty: i.qty,
        name: i.name,
        variants: (i.variants || []).map((v) => v.name),
        total: fromCents(Math.round(i.qty * toCents(i.unit_price))),
      })),
      totals: computeTotals(order, itemsNow),
    });
  };

  const voidReceipt = async (order: CassaOrderFull, reason: string) => {
    setBusy(true);
    try {
      await api(`/api/cassa/orders/${order.id}/void`, {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, reason }),
      });
      await Promise.all([loadReceipts(), loadSession()]);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const openSession = async (openingFloat: number) => {
    setBusy(true);
    try {
      await api("/api/cassa/session", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, opening_float: openingFloat }),
      });
      await loadSession();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async (countedCash: number | null, notes: string | null) => {
    setBusy(true);
    try {
      await api("/api/cassa/session", {
        method: "PATCH",
        body: JSON.stringify({ tenant_id: tenantId, counted_cash: countedCash, notes }),
      });
      await loadSession();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const saveCoverCharge = async (value: number) => {
    setBusy(true);
    try {
      await api("/api/cassa/settings", {
        method: "PATCH",
        body: JSON.stringify({ tenant_id: tenantId, cover_charge: value }),
      });
      setCoverCharge(value);
      refreshActiveTenant?.();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ render
  if (!enabled) {
    return <ManagementLocked section="cassa" />;
  }

  const freeTables = tables.filter(
    (tb) => !openOrders.some((o) => o.table_id === tb.id && o.id !== activeOrderId),
  );

  const tabs: Array<{ id: View; label: string; icon: typeof LayoutGrid }> = [
    { id: "sala", label: t("cassa_tab_sala"), icon: LayoutGrid },
    { id: "receipts", label: t("cassa_tab_receipts"), icon: ReceiptText },
    { id: "close", label: t("cassa_tab_close"), icon: Lock },
  ];

  return (
    <div className="p-3 sm:p-4 lg:p-6 w-full h-full flex flex-col min-h-0">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap pb-3 border-b-2 mb-4" style={{ borderColor: "#c4956a" }}>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2">
          <Banknote className="w-6 h-6" /> {t("nav_cassa")}
        </h1>
        <span
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border-2 text-xs font-bold text-black"
          style={{ borderColor: "#c4956a", background: session ? "rgba(196,149,106,0.15)" : "transparent" }}
        >
          {session ? (
            <>
              <Unlock className="w-3.5 h-3.5" /> {t("cassa_session_open")} ·{" "}
              {new Date(session.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {summary ? ` · ${fmtEur(summary.gross)}` : ""}
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5" /> {t("cassa_session_closed")}
            </>
          )}
        </span>
        <span className="flex-1" />
        {view !== "order" && (
          <div className="flex items-center gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`h-10 px-3.5 rounded-xl border-2 text-sm font-bold cursor-pointer inline-flex items-center gap-1.5 ${view === tab.id ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                style={view === tab.id ? { background: "linear-gradient(135deg, #d4a574, #c4956a)", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {setupNeeded && (
        <div className="mb-4 rounded-xl border-2 border-red-600 bg-red-50 p-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-black">
            <p className="font-bold">{t("cassa_setup_needed_title")}</p>
            <p>
              {t("cassa_setup_needed_body")} <code>scripts/migrations/2026-07-04-cassa.sql</code>
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="py-16 text-center text-sm text-black">…</div>
        ) : view === "order" && activeOrder ? (
          <OrderView
            order={activeOrder}
            drafts={drafts}
            categories={categories}
            items={items}
            freeTables={freeTables}
            busy={busy}
            onBack={() => {
              setView("sala");
              setActiveOrderId(null);
            }}
            onAddItem={addItem}
            onAddFree={addFree}
            onDraftQty={draftQty}
            onDraftCourse={draftCourse}
            onDraftNotes={draftNotes}
            onRemoveDraft={removeDraft}
            onSendComanda={() => void sendComanda()}
            onPrintComanda={printLastComanda}
            onStorno={storno}
            onSetCovers={(covers) => void patchOrder({ covers })}
            onSetDiscount={(type, value) =>
              void patchOrder({ discount_type: type, discount_value: value })
            }
            onPreconto={() => void preconto()}
            onCharge={() => void charge()}
            onMoveTable={(tb) => void patchOrder({ table_id: tb.id, table_name: tb.name })}
            onCancelOrder={() => void cancelOrder()}
          />
        ) : view === "receipts" ? (
          <ReceiptsView
            receipts={receipts}
            businessDate={businessDate}
            canVoid={canManage}
            busy={busy}
            onReprint={(order) => enqueuePrint(buildReceiptPayload(order))}
            onVoid={voidReceipt}
          />
        ) : view === "close" ? (
          <SessionView
            session={session}
            summary={summary}
            coverCharge={coverCharge}
            canManage={canManage}
            openOrdersCount={openOrders.length}
            busy={busy}
            onOpenSession={openSession}
            onCloseSession={closeSession}
            onSaveCoverCharge={saveCoverCharge}
          />
        ) : (
          <SalaView
            tables={tables}
            openOrders={openOrders}
            onOpenTable={openTable}
            onCounterSale={counterSale}
            onResume={(order) => {
              setActiveOrderId(order.id);
              setView("order");
            }}
          />
        )}
      </div>

      {payOpen && activeOrder && (
        <PayModal
          total={computeTotals(activeOrder, activeOrder.items).total}
          busy={busy}
          result={payResult}
          onConfirm={confirmPay}
          onPrintReceipt={() => {
            if (paidOrder) enqueuePrint(buildReceiptPayload(paidOrder));
          }}
          onClose={() => {
            setPayOpen(false);
            if (payResult) {
              setActiveOrderId(null);
              setView("sala");
            }
            setPayResult(null);
            setPaidOrder(null);
          }}
        />
      )}

      <PrintSheet payload={printQueue[0] ?? null} onDone={() => setPrintQueue((q) => q.slice(1))} />
    </div>
  );
}
