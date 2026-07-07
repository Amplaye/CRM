"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
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
import { OpenRegisterModal } from "@/components/cassa/OpenRegisterModal";
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
  const [session, setSession] = useState<CassaSessionRow | null>(null);
  const [lastSession, setLastSession] = useState<CassaSessionRow | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // Register-closed gate: non-null while the "open the day" modal is up;
  // `pending` is the action to resume once the session is open.
  const [gate, setGate] = useState<{ pending: (() => void) | null } | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [coverCharge, setCoverCharge] = useState(0);
  const [businessDate, setBusinessDate] = useState("");
  const [receipts, setReceipts] = useState<CassaOrderFull[]>([]);
  // Journal day being viewed — defaults to the business day, arrows go back.
  const [receiptsDate, setReceiptsDate] = useState("");
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
  // Mirrors for the realtime callback (avoid resubscribing the channel on
  // every tab switch / journal-day change).
  const viewRef = useRef<View>("sala");
  viewRef.current = view;
  const loadReceiptsRef = useRef<() => void>(() => {});
  // Fresh openOrders for async flows (an optimistic row can be edited while
  // its POST is still in flight — the closure's copy would miss those taps).
  const openOrdersRef = useRef<CassaOrderFull[]>([]);
  openOrdersRef.current = openOrders;

  const tenantId = activeTenant?.id;
  const venueName = activeTenant?.name || "";
  const activeOrder = useMemo(
    () => openOrders.find((o) => o.id === activeOrderId) || null,
    [openOrders, activeOrderId],
  );
  // The cart is no longer per-device React state: draft lines live in
  // cassa_order_items (status 'draft') so every device streams the same
  // carrello over realtime. This view of them keeps OrderView's props stable.
  const drafts = useMemo<CassaDraftLine[]>(
    () =>
      (activeOrder?.items || [])
        .filter((i) => i.status === "draft")
        .map((i) => ({
          key: i.id,
          menu_item_id: i.menu_item_id,
          name: i.name,
          unit_price: i.unit_price,
          qty: i.qty,
          course: i.course,
          notes: i.notes,
          vat_rate: Number(i.vat_rate ?? DEFAULT_VAT_RATE),
          station: i.station,
          variants: i.variants || [],
        })),
    [activeOrder],
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
        // Only what the picker uses — skipping description/allergens/images
        // keeps the payload light on tablets with a big menu.
        .select("id, category_id, name, price, available, sort_order, vat_rate, station, variants, created_at")
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
    // Server truth, EXCEPT optimistic rows still waiting for their POST ack:
    // this read may predate the in-flight insert, and blindly replacing state
    // would wipe the row the waiter just tapped (it then "flickers back" at
    // ack time — or worse, edits land on a ghost). Re-append local tmp- rows.
    setOpenOrders((prev) => {
      const next = (data || []) as CassaOrderFull[];
      const tmpByOrder = new Map<string, CassaOrderFull["items"]>();
      for (const o of prev) {
        const tmps = o.items.filter((i) => i.id.startsWith("tmp-"));
        if (tmps.length > 0) tmpByOrder.set(o.id, tmps);
      }
      if (tmpByOrder.size === 0) return next;
      return next.map((o) => {
        const tmps = tmpByOrder.get(o.id);
        return tmps ? { ...o, items: [...o.items, ...tmps] } : o;
      });
    });
  }, [supabase, tenantId]);

  const loadSession = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await api<{
        session: CassaSessionRow | null;
        summary: SessionSummary | null;
        last_session: CassaSessionRow | null;
        cover_charge: number;
        business_date: string;
      }>(`/api/cassa/session?tenant_id=${tenantId}`);
      setSession(data.session);
      setLastSession(data.last_session ?? null);
      setSummary(data.summary);
      setCoverCharge(data.cover_charge);
      setBusinessDate(data.business_date);
      setSessionLoaded(true);
    } catch {
      /* session panel simply stays empty (e.g. before the migration) */
    }
  }, [tenantId]);

  const loadReceipts = useCallback(async () => {
    const day = receiptsDate || businessDate;
    if (!tenantId || !day) return;
    try {
      const data = await api<{ orders: CassaOrderFull[] }>(
        `/api/cassa/orders?tenant_id=${tenantId}&scope=day&date=${day}`,
      );
      setReceipts(data.orders);
    } catch (err) {
      console.error("Cassa receipts load error:", err);
    }
  }, [tenantId, businessDate, receiptsDate]);
  loadReceiptsRef.current = loadReceipts;

  // ------------------------------------------------- shared state surgery
  const upsertOrder = useCallback((order: CassaOrderFull) => {
    setOpenOrders((prev) => {
      const rest = prev.filter((o) => o.id !== order.id);
      return order.status === "open"
        ? [...rest, order].sort((a, b) => a.opened_at.localeCompare(b.opened_at))
        : rest;
    });
  }, []);

  /** Insert-or-replace one line inside its order (idempotent: realtime echoes
   * of our own writes land here too). */
  const upsertItem = useCallback((row: CassaOrderItemRow) => {
    setOpenOrders((prev) =>
      prev.map((o) => {
        if (o.id !== row.order_id) return o;
        const exists = o.items.some((i) => i.id === row.id);
        return {
          ...o,
          items: exists ? o.items.map((i) => (i.id === row.id ? row : i)) : [...o.items, row],
        };
      }),
    );
  }, []);

  const removeItemById = useCallback((itemId: string) => {
    setOpenOrders((prev) =>
      prev.map((o) =>
        o.items.some((i) => i.id === itemId)
          ? { ...o, items: o.items.filter((i) => i.id !== itemId) }
          : o,
      ),
    );
  }, []);

  useEffect(() => {
    if (!tenantId || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Paint the sala as soon as tables+orders are in (direct supabase reads);
      // the session header hydrates in the background — /api/cassa/session is
      // a lambda and its cold start shouldn't hold the whole page hostage.
      await Promise.all([loadStatic(), loadOrders()]);
      if (!cancelled) setLoading(false);
    })();
    void loadSession();
    // Realtime, two layers:
    //  1. INSTANT — every payload is merged straight into state (no refetch
    //     round-trip), so a dish tapped on mobile appears on desktop in the
    //     time it takes the event to travel. Merges are idempotent by id, so
    //     the echoes of our own optimistic writes are harmless.
    //  2. RECONCILE — a debounced full refetch trails the burst as a safety
    //     net for anything a merge can't know (orders hydrated elsewhere,
    //     missed events after a reconnect) + the session money badge.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        loadOrders();
        loadSession();
        // Keep the journal live too when it's on screen (other devices
        // closing bills should show up without leaving the tab).
        if (viewRef.current === "receipts") loadReceiptsRef.current();
      }, 1000);
    };
    const channel = supabase
      .channel(`cassa-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cassa_orders", filter: `tenant_id=eq.${tenantId}` },
        (payload: RealtimePostgresChangesPayload<CassaOrderFull>) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setOpenOrders((prev) => prev.filter((o) => o.id !== oldId));
          } else {
            const row = payload.new as CassaOrderFull;
            // Merge PRESERVING the items we already hold — the row payload has
            // no relation data. A brand-new order lands with [] and the item
            // events / reconcile fill it.
            setOpenOrders((prev) => {
              const existing = prev.find((o) => o.id === row.id);
              if (row.status !== "open") return prev.filter((o) => o.id !== row.id);
              const rest = prev.filter((o) => o.id !== row.id);
              return [...rest, { ...existing, ...row, items: existing?.items || [] }].sort((a, b) =>
                a.opened_at.localeCompare(b.opened_at),
              );
            });
          }
          reconcile();
        },
      )
      // Dishes (drafts AND sent comande) write ONLY to cassa_order_items — the
      // parent row update from recomputeOrder trails it. Without this stream
      // the other device (desktop↔mobile, same account) never sees lines land.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cassa_order_items", filter: `tenant_id=eq.${tenantId}` },
        (payload: RealtimePostgresChangesPayload<CassaOrderItemRow>) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) removeItemById(oldId);
          } else {
            upsertItem(payload.new as CassaOrderItemRow);
          }
          reconcile();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [tenantId, enabled, supabase, loadStatic, loadOrders, loadSession, upsertItem, removeItemById]);

  // Fetch the journal as soon as the business day is known — not on first tab
  // switch — so opening "Scontrini" is instant; later switches just refresh
  // the cached list in the background (stale-while-revalidate).
  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    if (view === "receipts") void loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on tab switch only
  }, [view]);

  // ------------------------------------------------------------- order flow
  // Creating bills / charging requires an open day. Instead of the old silent
  // auto-open with a 0 float, we hold the action, ask for the opening float,
  // then resume exactly where the waiter left off.
  const needsOpen = sessionLoaded && !session;

  const openTable = (table: CassaTable, existing: CassaOrderFull | null) => {
    if (existing) {
      // Resuming an existing bill is always allowed — it was opened legally.
      setActiveOrderId(existing.id);
      setView("order");
      return;
    }
    if (needsOpen) {
      setGate({ pending: () => void createTableOrder(table) });
      return;
    }
    void createTableOrder(table);
  };

  const createTableOrder = async (table: CassaTable) => {
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

  const counterSale = (kind: "banco" | "asporto") => {
    if (needsOpen) {
      setGate({ pending: () => void createCounterSale(kind) });
      return;
    }
    void createCounterSale(kind);
  };

  const createCounterSale = async (kind: "banco" | "asporto") => {
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

  const enqueuePrint = (p: PrintPayload | PrintPayload[]) =>
    setPrintQueue((q) => [...q, ...(Array.isArray(p) ? p : [p])]);

  /** POST one draft line (shared cart). Optimistic tmp row → swapped for the
   * server row; the realtime echo is deduped by id inside the swap. */
  const insertDraft = async (line: Omit<CassaDraftLine, "key">) => {
    if (!activeOrderId || !tenantId) return;
    const orderId = activeOrderId;
    draftKeySeq.current += 1;
    const tmpId = `tmp-${draftKeySeq.current}`;
    upsertItem({
      id: tmpId,
      tenant_id: tenantId,
      order_id: orderId,
      menu_item_id: line.menu_item_id,
      name: line.name,
      unit_price: line.unit_price,
      qty: line.qty,
      course: line.course,
      comanda_no: 0,
      notes: line.notes,
      vat_rate: line.vat_rate,
      station: line.station,
      variants: line.variants,
      status: "draft",
      created_at: new Date().toISOString(),
    });
    try {
      const data = await api<{ items: CassaOrderItemRow[] }>(`/api/cassa/orders/${orderId}/items`, {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          draft: true,
          items: [
            {
              menu_item_id: line.menu_item_id,
              name: line.name,
              unit_price: line.unit_price,
              qty: line.qty,
              course: line.course,
              notes: line.notes,
              vat_rate: line.vat_rate,
              station: line.station,
              variants: line.variants,
            },
          ],
        }),
      });
      const real = data.items[0];
      // Fast taps can edit (or even delete) the optimistic row while the POST
      // is in flight: those edits landed on the tmp id and never reached the
      // server. Read the row's CURRENT state and carry the delta over.
      const orderNow = openOrdersRef.current.find((o) => o.id === orderId);
      const tmpNow = orderNow?.items.find((i) => i.id === tmpId);
      const merged =
        tmpNow && (tmpNow.qty !== real.qty || tmpNow.course !== real.course || tmpNow.notes !== real.notes)
          ? { ...real, qty: tmpNow.qty, course: tmpNow.course, notes: tmpNow.notes }
          : real;
      setOpenOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o;
          const rest = o.items.filter((i) => i.id !== tmpId && i.id !== real.id);
          // tmp row missing = deleted by the user OR displaced by a refetch
          // race — either way, keep the SERVER row (never destroy data on an
          // ambiguous state; a re-deleted line costs one extra tap).
          return { ...o, items: [...rest, merged] };
        }),
      );
      if (merged !== real) {
        api(`/api/cassa/orders/${orderId}/items`, {
          method: "PATCH",
          body: JSON.stringify({
            tenant_id: tenantId,
            action: "update",
            item_id: real.id,
            qty: merged.qty,
            course: merged.course,
            notes: merged.notes,
          }),
        }).catch(() => {});
      }
    } catch (err) {
      removeItemById(tmpId);
      fail(err);
    }
  };

  const addItem = (item: MenuItem, course: number, variants: MenuItemVariant[] = []) => {
    if (!activeOrderId) return;
    // Same dish, same course, plain (no notes/variants) → just bump the qty.
    const match = drafts.find(
      (d) => d.menu_item_id === item.id && d.course === course && !d.notes && d.variants.length === 0,
    );
    if (match && variants.length === 0) {
      draftQty(match.key, +1);
      return;
    }
    const priceC =
      toCents(item.price ?? 0) + variants.reduce((s, v) => s + toCents(v.price_delta), 0);
    void insertDraft({
      menu_item_id: item.id,
      name: item.name,
      unit_price: fromCents(priceC),
      qty: 1,
      course,
      notes: null,
      vat_rate: Number(item.vat_rate ?? DEFAULT_VAT_RATE),
      station: item.station ?? null,
      variants,
    });
  };

  const addFree = (name: string, price: number, course: number) => {
    if (!activeOrderId) return;
    void insertDraft({
      menu_item_id: null,
      name,
      unit_price: price,
      qty: 1,
      course,
      notes: null,
      vat_rate: DEFAULT_VAT_RATE,
      station: null,
      variants: [],
    });
  };

  /** Optimistically patch a draft line, then persist; rollback on failure.
   * Ops on a not-yet-acked tmp row apply locally only (the POST swap wins). */
  const patchDraft = (key: string, patch: Partial<Pick<CassaOrderItemRow, "qty" | "course" | "notes">>) => {
    const order = openOrders.find((o) => o.id === activeOrderId);
    const it = order?.items.find((i) => i.id === key && i.status === "draft");
    if (!order || !it) return;
    upsertItem({ ...it, ...patch });
    if (key.startsWith("tmp-")) return;
    api(`/api/cassa/orders/${order.id}/items`, {
      method: "PATCH",
      body: JSON.stringify({ tenant_id: tenantId, action: "update", item_id: key, ...patch }),
    }).catch((err) => {
      upsertItem(it); // rollback
      fail(err);
    });
  };

  const draftQty = (key: string, delta: number) => {
    const order = openOrders.find((o) => o.id === activeOrderId);
    const it = order?.items.find((i) => i.id === key && i.status === "draft");
    if (!it) return;
    const nextQty = Math.round((it.qty + delta) * 100) / 100;
    if (nextQty <= 0) {
      removeDraft(key);
      return;
    }
    patchDraft(key, { qty: nextQty });
  };

  const draftCourse = (key: string) => {
    const order = openOrders.find((o) => o.id === activeOrderId);
    const it = order?.items.find((i) => i.id === key && i.status === "draft");
    if (!it) return;
    patchDraft(key, { course: (it.course % 3) + 1 });
  };

  const draftNotes = (key: string, notes: string | null) => patchDraft(key, { notes });

  const removeDraft = (key: string) => {
    const order = openOrders.find((o) => o.id === activeOrderId);
    const it = order?.items.find((i) => i.id === key && i.status === "draft");
    if (!order || !it) return;
    removeItemById(key);
    if (key.startsWith("tmp-")) return;
    api(`/api/cassa/orders/${order.id}/items`, {
      method: "PATCH",
      body: JSON.stringify({ tenant_id: tenantId, action: "remove", item_id: key }),
    }).catch((err) => {
      upsertItem(it); // rollback
      fail(err);
    });
  };

  /** Fire the shared cart as the next comanda round; returns the refreshed
   * items or null on failure. The server flips ALL draft rows (including ones
   * added by other devices a moment ago). */
  const sendComanda = async (): Promise<CassaOrderItemRow[] | null> => {
    if (!activeOrder) return null;
    if (drafts.length === 0) return activeOrder.items;
    setBusy(true);
    try {
      const data = await api<{
        items: CassaOrderItemRow[];
        comanda_no: number | null;
        totals: { subtotal: number; total: number };
      }>(`/api/cassa/orders/${activeOrder.id}/items`, {
        method: "PATCH",
        body: JSON.stringify({ tenant_id: tenantId, action: "send" }),
      });
      const flipped = new Map((data.items || []).map((i) => [i.id, i]));
      const nextItems = activeOrder.items.map((i) => flipped.get(i.id) ?? i);
      upsertOrder({
        ...activeOrder,
        items: nextItems,
        subtotal: data.totals.subtotal,
        total: data.totals.total,
      });
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
    // Only FIRED lines: drafts (comanda_no 0) aren't a round yet and must
    // never reprint as one.
    const active = activeOrder.items.filter((i) => i.status === "sent");
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
    // Optimistic: reflect the change instantly (covers/discount felt laggy while
    // it waited on the API round-trip). Snapshot for rollback, then reconcile
    // with the server's canonical row — never block the UI on the request.
    const prev = activeOrder;
    upsertOrder({ ...activeOrder, ...patch });
    try {
      const data = await api<{ order: CassaOrderFull }>(`/api/cassa/orders/${activeOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tenant_id: tenantId, ...patch }),
      });
      upsertOrder({ ...prev, ...data.order, items: prev.items });
    } catch (err) {
      upsertOrder(prev); // roll back the optimistic change
      fail(err);
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

  const doCharge = async () => {
    if (!activeOrder) return;
    if (drafts.length > 0) {
      const sent = await sendComanda();
      if (!sent) return; // send failed — don't open the till on stale totals
    }
    setPayResult(null);
    setPaidOrder(null);
    setPayOpen(true);
  };

  const charge = () => {
    if (!activeOrder) return;
    if (needsOpen) {
      setGate({ pending: () => void doCharge() });
      return;
    }
    void doCharge();
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

  const confirmGate = async (openingFloat: number) => {
    const pending = gate?.pending ?? null;
    setGate(null);
    await openSession(openingFloat);
    pending?.();
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
      // Push the new coperto onto every OPEN sala bill too. Without this, orders
      // opened before the coperto was set stay frozen at their birth snapshot
      // (cover_unit) and the charge silently never appears on them.
      const openSala = openOrders.filter((o) => o.channel === "sala" && o.cover_unit !== value);
      if (openSala.length > 0) {
        openSala.forEach((o) => upsertOrder({ ...o, cover_unit: value }));
        await Promise.all(
          openSala.map((o) =>
            api(`/api/cassa/orders/${o.id}`, {
              method: "PATCH",
              body: JSON.stringify({ tenant_id: tenantId, cover_unit: value }),
            }).catch(() => {}),
          ),
        );
      }
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
        {/* Register status: unmissable, color-coded, tap → the day tab. */}
        <button
          onClick={() => setView("close")}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-full border-2 text-xs font-bold cursor-pointer"
          style={
            session
              ? { borderColor: "#059669", background: "rgba(16,185,129,0.12)", color: "#065f46" }
              : { borderColor: "#dc2626", background: "rgba(220,38,38,0.08)", color: "#991b1b" }
          }
          title={session ? t("cassa_day_running") : t("cassa_register_closed_title")}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: session ? "#059669" : "#dc2626" }}
          />
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
        </button>
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

      {/* Register closed → say it loudly on the sala, with the fix one tap away. */}
      {view === "sala" && !loading && needsOpen && (
        <div
          className="mb-4 rounded-xl border-2 p-4 flex flex-wrap items-center gap-3"
          style={{ borderColor: "#dc2626", background: "rgba(220,38,38,0.06)" }}
        >
          <Lock className="w-6 h-6 text-red-600 shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="font-bold text-black">{t("cassa_register_closed_title")}</p>
            <p className="text-sm text-black">{t("cassa_register_closed_body")}</p>
          </div>
          <button
            onClick={() => setGate({ pending: null })}
            className="h-11 px-5 rounded-xl text-sm font-bold text-white cursor-pointer inline-flex items-center gap-2"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <Unlock className="w-4 h-4" /> {t("cassa_open_session")}
          </button>
        </div>
      )}

      {/* In ORDER view, OrderView owns its own two scroll regions (ticket +
          dish grid). This wrapper must NOT also scroll, or the dish grid ends
          up nested inside THREE stacked overflow-y-auto containers and WebKit
          can't disambiguate the first tap-after-scroll into a click — the dish
          buttons then need two taps / feel unselectable. So it's a plain flex
          box in order view, and a scroller only for the other tabs. */}
      <div className={`flex-1 min-h-0${view === "order" ? "" : " overflow-y-auto overscroll-contain"}`}>
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
            onSetCover={(coverUnit) => void patchOrder({ cover_unit: coverUnit })}
            coverCharge={coverCharge}
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
            tenantId={tenantId || ""}
            receipts={receipts}
            businessDate={receiptsDate || businessDate}
            today={businessDate}
            isToday={!receiptsDate || receiptsDate === businessDate}
            onShiftDay={(delta) => {
              const cur = receiptsDate || businessDate;
              if (!cur) return;
              const d = new Date(`${cur}T12:00:00`);
              d.setDate(d.getDate() + delta);
              const next = d.toISOString().slice(0, 10);
              // Never navigate past the current business day.
              setReceiptsDate(next >= businessDate ? "" : next);
            }}
            onPickDay={(next) => setReceiptsDate(next >= businessDate ? "" : next)}
            canVoid={canManage && (!receiptsDate || receiptsDate === businessDate)}
            busy={busy}
            onReprint={(order) => enqueuePrint(buildReceiptPayload(order))}
            onVoid={voidReceipt}
          />
        ) : view === "close" ? (
          <SessionView
            tenantId={tenantId || ""}
            session={session}
            lastSession={lastSession}
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

      {/* Keep the sheet mounted after success: paying removes the order from
          openOrders (→ activeOrder null), so gate on paidOrder too or the
          "Incassato / resto / stampa" screen unmounts the instant it should show. */}
      {payOpen && (activeOrder || paidOrder) && (
        <PayModal
          total={
            activeOrder
              ? computeTotals(activeOrder, activeOrder.items).total
              : paidOrder!.total
          }
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

      {gate && (
        <OpenRegisterModal busy={busy} onConfirm={(f) => void confirmGate(f)} onClose={() => setGate(null)} />
      )}

      <PrintSheet payload={printQueue[0] ?? null} onDone={() => setPrintQueue((q) => q.slice(1))} />
    </div>
  );
}
