"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Package,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Loader2,
  Link2,
  Trash2,
  ShoppingCart,
  Copy,
  MessageCircle,
  TrendingDown,
  Wand2,
  Search,
  X,
  Banknote,
  ScanBarcode,
} from "lucide-react";
import { CameraScanner } from "@/components/scanner/CameraScanner";
import { InfoHotspot } from "@/components/ui/InfoHotspot";
import { ManagementLocked } from "@/components/management/ManagementLocked";
import { InventoryMovements } from "@/components/management/InventoryMovements";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFeatures } from "@/lib/types/tenant-settings";
import {
  reorderList,
  suggestParLevels,
  shrinkageSummary,
  type MovementLite,
} from "@/lib/management/inventory-analysis";
import { InvoiceCapture } from "@/components/management/InvoiceCapture";
import { isRetailBarcode } from "@/lib/management/barcode";
import { suggestShelfLife } from "@/lib/inventory/shelf-life-presets";
import {
  INGREDIENT_CATEGORIES,
  categoryLabelKey,
  classifyIngredient,
} from "@/lib/management/ingredient-categories";
import { CategorySelect, UnitSelect } from "@/components/management/UnitSelect";
import { convertQty, convertUnitCost } from "@/lib/management/units";

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  /** Warehouse category slug — what the product IS (see ingredient-categories). */
  category: string | null;
  current_unit_cost: number;
  stock_qty: number;
  par_level: number;
  supplier_name: string | null;
  expiry_date: string | null;
  /** Days the product keeps once received. Set once → expiry auto-fills on every goods-in. */
  shelf_life_days: number | null;
  pos_external_product_id: string | null;
  /** EAN/UPC on the package — what the phone camera scans to find this product. */
  barcode: string | null;
}

/** An open delivery batch with its own expiry — a reminder, not a stock source. */
interface Lot {
  id: string;
  ingredient_id: string;
  qty: number | null;
  expiry_date: string;
  received_on: string | null;
}

interface PosProduct {
  externalProductId: string;
  name: string;
  category: string | null;
  price: number | null;
}

type SaveState = { status: "idle" | "saving" | "ok" | "error"; msg?: string };
type Filter = "all" | "low" | "expiring" | "reorder";

const EXPIRY_SOON_DAYS = 5;

/** Category-chip sentinels: "every category" and "stock no recipe uses". */
const ALL_CATS = "__all";
const NO_CAT = "__none";

// Shared visual language of the management restyle: one soft card surface,
// traffic-light status colors, no heavy double borders.
const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#d9c3a3" } as const;
const BRONZE_BTN =
  "inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-60";
const BRONZE_BG = { background: "linear-gradient(135deg, #d4a574, #c4956a)" } as const;

/** Human quantity: 12 kg, 3,5 l, 0,25 kg — decimals only when they matter. */
const fmtQty = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2)).replace(".", ",");
const fmtEur = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 0 });

const isLow = (r: IngredientRow) => Number(r.par_level) > 0 && Number(r.stock_qty) <= Number(r.par_level);
const daysToExpiry = (r: IngredientRow): number | null => {
  if (!r.expiry_date) return null;
  const ms = new Date(r.expiry_date + "T00:00:00").getTime() - Date.now();
  return Math.floor(ms / 86400000);
};
const isExpiringSoon = (r: IngredientRow) => {
  const d = daysToExpiry(r);
  return d != null && d <= EXPIRY_SOON_DAYS;
};

export default function InventoryPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const enabled = getFeatures(activeTenant?.settings).management_enabled;

  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [posProducts, setPosProducts] = useState<PosProduct[] | null>(null);
  // Which till feeds this tenant — decides whether the "link to a till product"
  // control is even relevant. The built-in till ("cassa") depletes stock from
  // recipes automatically, so it needs no manual link (see the card below).
  const [posProvider, setPosProvider] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>(ALL_CATS);
  const [page, setPage] = useState(0); // 0-based; PER_PAGE rows per page
  // Barcode scan, two jobs from the same camera:
  //   • LOOKUP (scanTarget = null, from the toolbar): find the product carrying
  //     that code — or, when nothing does, put the digits in the search box so
  //     the owner can add it. The scan is never a dead end.
  //   • ASSIGN (scanTarget = an ingredient id, from that row's scan button):
  //     write the scanned code onto that product, so future lookups find it.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const openScanFor = useCallback((id: string) => {
    setScanMsg(null);
    setScanTarget(id);
    setScanOpen(true);
  }, []);

  // Inline stock edit (the headline editable field, with POS write-back).
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [draftStock, setDraftStock] = useState("");

  // Mirror of `rows` for stable callbacks: row cards are memoized, so their
  // handlers must not close over `rows` (a new identity per load would defeat
  // the memo and re-render every card on each keystroke/expand).
  const rowsRef = useRef<IngredientRow[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Last 30 days of the stock ledger — feeds the automatic par levels and the
  // waste/shrinkage panel. Loaded together with the ingredients.
  const [movements, setMovements] = useState<MovementLite[]>([]);
  // Open lots grouped by ingredient — the per-batch expiry list.
  const [lotsByIng, setLotsByIng] = useState<Record<string, Lot[]>>({});

  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled) return;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ data }, { data: mv }, { data: lotsRaw }] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id, name, unit, category, current_unit_cost, stock_qty, par_level, supplier_name, expiry_date, shelf_life_days, pos_external_product_id, barcode")
        .eq("tenant_id", activeTenant.id)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("stock_movements")
        .select("ingredient_id, qty_delta, kind, created_at")
        .eq("tenant_id", activeTenant.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("stock_lots")
        .select("id, ingredient_id, qty, expiry_date, received_on")
        .eq("tenant_id", activeTenant.id)
        .eq("status", "open")
        .order("expiry_date"),
    ]);
    const ingredients = (data || []) as IngredientRow[];
    setRows(ingredients);

    // Stock that predates the category column (or arrived from an invoice
    // import) has no category yet. File it from its name and persist the guess,
    // so the shelf is never half-empty and the owner only fixes the misses.
    const uncategorised = ingredients.filter((r) => !r.category);
    if (uncategorised.length > 0) {
      // Unit matters: "Limone" held in ml is juice, not fruit.
      const guesses = uncategorised.map((r) => ({ id: r.id, category: classifyIngredient(r.name, r.unit) }));
      setRows((rs) => {
        const m = new Map(guesses.map((g) => [g.id, g.category]));
        return rs.map((r) => (m.has(r.id) ? { ...r, category: m.get(r.id)! } : r));
      });
      // Best-effort: a failed backfill just means the chips show it next reload.
      await Promise.all(
        guesses.map((g) => supabase.from("ingredients").update({ category: g.category }).eq("id", g.id)),
      );
    }

    const lotMap: Record<string, Lot[]> = {};
    for (const l of (lotsRaw || []) as Lot[]) (lotMap[l.ingredient_id] ||= []).push(l);
    setLotsByIng(lotMap);
    setMovements(
      ((mv || []) as Array<{ ingredient_id: string; qty_delta: number; kind: string; created_at: string }>).map((m) => ({
        ingredientId: m.ingredient_id,
        qtyDelta: Number(m.qty_delta),
        kind: m.kind,
        createdAt: m.created_at,
      })),
    );
    setLoading(false);
  }, [activeTenant?.id, enabled, supabase]);

  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    const channel = supabase
      .channel(`inventory-${activeTenant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ingredients", filter: `tenant_id=eq.${activeTenant.id}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeTenant?.id, enabled, supabase, load]);

  // Lazy-load the till catalogue the first time a row is expanded (so the link
  // picker has options). Empty list when on mock / not connected — handled by UI.
  const ensurePosProducts = useCallback(async () => {
    if (posProducts !== null || !activeTenant?.id) return;
    try {
      const res = await fetch(`/api/pos/products?tenant_id=${activeTenant.id}`);
      const data = await res.json();
      setPosProducts(Array.isArray(data?.products) ? data.products : []);
      if (typeof data?.provider === "string") setPosProvider(data.provider);
    } catch {
      setPosProducts([]);
    }
  }, [posProducts, activeTenant?.id]);

  const lowCount = useMemo(() => rows.filter(isLow).length, [rows]);
  const expiringCount = useMemo(() => rows.filter(isExpiringSoon).length, [rows]);
  const stockValue = useMemo(
    () => rows.reduce((s, r) => s + Number(r.stock_qty) * Number(r.current_unit_cost), 0),
    [rows],
  );

  // Reorder suggestions: items at/below par, topped up to 2× par (pure helper).
  const reorder = useMemo(
    () =>
      reorderList(
        rows.map((r) => ({
          ingredientId: r.id,
          name: r.name,
          unit: r.unit,
          stockQty: Number(r.stock_qty),
          parLevel: Number(r.par_level),
          unitCost: Number(r.current_unit_cost),
        })),
      ),
    [rows],
  );
  const reorderTotal = reorder.reduce((s, l) => s + l.estimatedCost, 0);
  const reorderIds = useMemo(() => new Set(reorder.map((l) => l.ingredientId)), [reorder]);

  // Reorder lines grouped by supplier → each group becomes a ready-to-send
  // order (copy / WhatsApp), so "fare l'ordine" is one tap, not a transcription.
  const reorderBySupplier = useMemo(() => {
    const supplierOf = new Map(rows.map((r) => [r.id, r.supplier_name?.trim() || ""]));
    const groups = new Map<string, typeof reorder>();
    for (const l of reorder) {
      const key = supplierOf.get(l.ingredientId) || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(l);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reorder, rows]);

  const orderText = useCallback(
    (supplier: string, lines: typeof reorder) => {
      const header =
        (supplier ? `${t("inventory_order_for")} ${supplier}` : t("inventory_order_generic")) +
        (activeTenant?.name ? ` — ${activeTenant.name}` : "");
      const body = lines.map((l) => `• ${fmtQty(l.suggestedQty)} ${l.unit} ${l.name}`).join("\n");
      return `${header}\n${body}`;
    },
    [activeTenant?.name, t],
  );

  const [copiedSupplier, setCopiedSupplier] = useState<string | null>(null);
  const copyOrder = async (supplier: string, lines: typeof reorder) => {
    try {
      await navigator.clipboard.writeText(orderText(supplier, lines));
      setCopiedSupplier(supplier);
      setTimeout(() => setCopiedSupplier(null), 2500);
    } catch {
      /* clipboard unavailable — the WhatsApp button still works */
    }
  };

  // Automatic par levels: what the kitchen actually consumed in the last 30 days
  // (POS sales + waste) → suggested minimum stock covering 3 days of usage.
  const parSuggestions = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of suggestParLevels(movements, { now: new Date() })) map.set(s.ingredientId, s.suggestedPar);
    return map;
  }, [movements]);

  // Only suggest when it changes something: par never set, or drifted >25%.
  const actionablePar = useMemo(
    () =>
      rows.filter((r) => {
        const s = parSuggestions.get(r.id);
        if (!s || !(s > 0)) return false;
        const cur = Number(r.par_level);
        return cur <= 0 || Math.abs(s - cur) / cur > 0.25;
      }),
    [rows, parSuggestions],
  );

  const [applyingPar, setApplyingPar] = useState(false);
  const applyAllPar = async () => {
    if (applyingPar || actionablePar.length === 0) return;
    setApplyingPar(true);
    const updates = actionablePar.map((r) => ({ id: r.id, par: parSuggestions.get(r.id)! }));
    setRows((rs) => rs.map((r) => { const u = updates.find((x) => x.id === r.id); return u ? { ...r, par_level: u.par } : r; }));
    await Promise.all(
      updates.map((u) =>
        supabase.from("ingredients").update({ par_level: u.par, updated_at: new Date().toISOString() }).eq("id", u.id),
      ),
    );
    setApplyingPar(false);
  };

  // Waste & count corrections of the month, valued in € — where money leaks.
  const shrinkage = useMemo(
    () =>
      shrinkageSummary(
        movements,
        rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, unitCost: Number(r.current_unit_cost) })),
        { now: new Date() },
      ),
    [movements, rows],
  );
  const [showShrinkage, setShowShrinkage] = useState(false);
  const [showOrders, setShowOrders] = useState(false);

  // ── Stable per-row handlers (row cards are React.memo) ────────────────────
  const toggleRow = useCallback((id: string) => {
    void ensurePosProducts();
    setExpanded((cur) => (cur === id ? null : id));
  }, [ensurePosProducts]);

  const startStockEdit = useCallback((id: string) => {
    const cur = rowsRef.current.find((r) => r.id === id);
    setDraftStock(cur ? String(cur.stock_qty) : "");
    setEditingStock(id);
  }, []);

  const cancelStockEdit = useCallback(() => setEditingStock(null), []);

  // Save stock: optimistic local update → POST (CRM + POS write-back when linked).
  const commitStock = useCallback(async (id: string, value: string) => {
    const qty = Number(value.replace(",", "."));
    setEditingStock(null);
    if (!Number.isFinite(qty) || qty < 0) return;
    const prev = rowsRef.current.find((r) => r.id === id)?.stock_qty ?? null;
    if (prev != null && Math.abs(Number(prev) - qty) < 0.0005) return;

    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stock_qty: qty } : r)));
    setSaveStates((s) => ({ ...s, [id]: { status: "saving" } }));
    try {
      const res = await fetch("/api/pos/push-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredient_id: id, stock_qty: qty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "save failed");
      setSaveStates((s) => ({ ...s, [id]: { status: "ok", msg: data?.pos?.detail || t("settings_saved") } }));
      setTimeout(() => setSaveStates((s) => ({ ...s, [id]: { status: "idle" } })), 4000);
    } catch (e: any) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stock_qty: Number(prev) } : r)));
      setSaveStates((s) => ({ ...s, [id]: { status: "error", msg: e?.message || "Errore" } }));
    }
  }, [t]);

  // Patch any other ingredient field directly (CRM-only — no POS write needed).
  const patchIngredient = useCallback(async (id: string, patch: Partial<IngredientRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("ingredients").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setSaveStates((s) => ({ ...s, [id]: { status: "error", msg: error.message } }));
    } else {
      setSaveStates((s) => ({ ...s, [id]: { status: "ok" } }));
      setTimeout(() => setSaveStates((s) => ({ ...s, [id]: { status: "idle" } })), 1500);
    }
  }, [supabase]);

  // Close a lot (the batch is used up or discarded): clears the expiry reminder.
  // The DB trigger moves ingredients.expiry_date to the next open lot. Stock is
  // NOT touched here — sales already depleted it, or the owner books a "Scarto".
  const closeLot = useCallback(async (lotId: string, ingredientId: string) => {
    setLotsByIng((m) => ({ ...m, [ingredientId]: (m[ingredientId] || []).filter((l) => l.id !== lotId) }));
    await supabase.from("stock_lots").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", lotId);
  }, [supabase]);

  const handleScan = useCallback((code: string) => {
    setScanOpen(false);
    const target = scanTarget;
    setScanTarget(null);
    const value = code.trim();
    if (!value) return;

    // ASSIGN: the scan came from a specific product's row.
    if (target) {
      void patchIngredient(target, { barcode: value });
      setScanMsg(t("inventory_barcode_saved"));
      return;
    }

    // LOOKUP: open the product that already carries this code…
    const hit = rowsRef.current.find((r) => r.barcode === value);
    if (hit) {
      setQuery("");
      setFilter("all");
      setExpanded(hit.id);
      setScanMsg(null);
      return;
    }
    // …or work out why it missed. Suppliers print a barcode on the delivery
    // note itself, and scanning that can never match a product — so say so
    // instead of inviting the owner to create an ingredient out of a DDT number.
    if (!isRetailBarcode(value)) {
      setScanMsg(t("inventory_barcode_not_a_product"));
      return;
    }
    // A genuine package code we simply don't have yet: hand the digits to the
    // search box so the owner can add the product.
    setQuery(value);
    setScanMsg(t("inventory_barcode_unknown"));
  }, [scanTarget, patchIngredient, t]);

  const archiveIngredient = useCallback(async (id: string) => {
    if (!confirm(t("inventory_confirm_delete"))) return;
    setExpanded(null);
    setRows((rs) => rs.filter((r) => r.id !== id));
    await supabase.from("ingredients").update({ archived: true, updated_at: new Date().toISOString() }).eq("id", id);
  }, [supabase, t]);

  // Fill an empty warehouse with the default catalogue, in the tenant's CRM
  // language. Idempotent server-side, so a double-click can't duplicate stock.
  async function seedDefaults() {
    if (!activeTenant?.id || seeding) return;
    setSeeding(true);
    try {
      const res = await fetch("/api/management/seed-ingredients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: activeTenant.id }),
      });
      if (res.ok) await load();
    } finally {
      setSeeding(false);
    }
  }

  async function createIngredient(name: string, unit: string, category: string) {
    if (!activeTenant?.id || !name.trim()) return;
    setCreating(false);
    const { error } = await supabase.from("ingredients").insert({
      tenant_id: activeTenant.id,
      name: name.trim(),
      unit: unit.trim() || "kg",
      category: category || classifyIngredient(name, unit),
      current_unit_cost: 0,
      stock_qty: 0,
      par_level: 0,
      archived: false,
    });
    if (!error) await load();
  }

  // Visible list = search + active filter chip.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !(r.supplier_name || "").toLowerCase().includes(q) &&
        // Searching by barcode too: after an unrecognised scan the digits land
        // in this box, and once the code is saved the same scan finds the product.
        !(r.barcode || "").toLowerCase().includes(q)
      )
        return false;
      // Category chip: the WAREHOUSE category — what the product is (Carne,
      // Verdura, Vino…), so the shelf is browsed the way it's actually stocked.
      if (catFilter !== ALL_CATS && (r.category || "other") !== catFilter) return false;
      if (filter === "low") return isLow(r);
      if (filter === "expiring") return isExpiringSoon(r);
      if (filter === "reorder") return reorderIds.has(r.id);
      return true;
    });
  }, [rows, query, filter, reorderIds, catFilter]);

  // Chips: the warehouse categories that actually hold stock, in catalogue
  // order. Empty categories are hidden — a chip that filters to nothing is
  // noise, and the picker on each row is what fills them.
  const catChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const c = r.category || "other";
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return INGREDIENT_CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
      id: c as string,
      name: t(categoryLabelKey(c) as keyof Dictionary),
      count: counts.get(c)!,
    }));
  }, [rows, t]);

  // 20 rows a page: the whole shelf at once is a wall of cards nobody scrolls,
  // and the category chips are what make a page-at-a-time navigable.
  const PER_PAGE = 20;
  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  // Any change to what's being filtered puts you back on page 1 — otherwise
  // narrowing a 5-page list while on page 4 shows an empty screen.
  useEffect(() => { setPage(0); }, [query, filter, catFilter]);

  // Stable identity for the InvoiceCapture prop (it re-renders on every parent
  // render otherwise).
  const captureIngredients = useMemo(
    () => rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit })),
    [rows],
  );

  if (!enabled) {
    return <ManagementLocked section="inventory" />;
  }

  const chips: Array<{ key: Filter; label: string; count: number; tone?: "red" | "amber" }> = [
    { key: "all", label: t("inventory_filter_all"), count: rows.length },
    { key: "low", label: t("inventory_low"), count: lowCount, tone: "red" },
    { key: "expiring", label: t("inventory_expiring"), count: expiringCount, tone: "amber" },
    { key: "reorder", label: t("inventory_reorder"), count: reorder.length, tone: "amber" },
  ];

  const allGood = !loading && reorder.length === 0 && actionablePar.length === 0 && lowCount === 0 && expiringCount === 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Package className="w-6 h-6" /> {t("nav_inventory")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#000" }}>
            {t("inventory_subtitle_v2")}
          </p>
        </div>
        {/* No shrink-0: it kept this group at its full intrinsic width, pushing
            past the row on a phone instead of letting the buttons wrap. */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {activeTenant?.id && (
            <InvoiceCapture tenantId={activeTenant.id} ingredients={captureIngredients} onDone={load} />
          )}
          <button onClick={() => setCreating((v) => !v)} className={BRONZE_BTN} style={BRONZE_BG}>
            <Plus className="w-4 h-4" /> {t("inventory_new")}
          </button>
        </div>
      </div>

      {creating && <NewIngredientForm onCreate={createIngredient} onCancel={() => setCreating(false)} t={t} />}

      {/* ── Smart strip: everything the system worked out on its own ───────── */}
      {allGood ? (
        <div className={`${CARD} px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1`} style={{ ...CARD_STYLE, background: "rgba(16,185,129,0.07)", borderColor: "rgba(5,150,105,0.3)" }}>
          <span className="flex items-center gap-2 text-sm font-bold text-emerald-700">
            <Check className="w-5 h-5 shrink-0" /> {t("inventory_all_good")}
          </span>
          {stockValue > 0 && (
            <span className="text-sm text-black">
              {t("inventory_value_title")}: <strong className="tabular-nums">€ {fmtEur(stockValue)}</strong>
            </span>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* Reorder card */}
          <SmartCard
            icon={<ShoppingCart className="w-5 h-5" />}
            active={reorder.length > 0}
            tone="amber"
            title={t("inventory_reorder")}
            big={reorder.length > 0 ? `${reorder.length}` : "0"}
            sub={
              reorder.length > 0
                ? t("inventory_reorder_est_short").replace("{total}", fmtEur(reorderTotal))
                : t("inventory_nothing")
            }
            action={
              reorder.length > 0
                ? { label: showOrders ? t("close") : t("inventory_prepare_orders"), onClick: () => setShowOrders((v) => !v) }
                : undefined
            }
          />
          {/* Auto par card */}
          <SmartCard
            icon={<Wand2 className="w-5 h-5" />}
            active={actionablePar.length > 0}
            tone="bronze"
            title={t("inventory_autopar_short")}
            big={`${actionablePar.length}`}
            sub={actionablePar.length > 0 ? t("inventory_autopar_sub") : t("inventory_uptodate")}
            action={
              actionablePar.length > 0
                ? { label: applyingPar ? "…" : t("inventory_autopar_apply"), onClick: () => void applyAllPar() }
                : undefined
            }
            info={{ title: t("inventory_autopar_short"), body: t("inventory_autopar_body") }}
          />
          {/* Shrinkage card */}
          <SmartCard
            icon={<TrendingDown className="w-5 h-5" />}
            active={shrinkage.lines.length > 0 && shrinkage.totalCost < 0}
            tone="red"
            title={t("inventory_shrinkage_short")}
            big={`€ ${fmtEur(Math.abs(shrinkage.totalCost))}`}
            sub={shrinkage.lines.length > 0 ? t("inventory_shrinkage_sub") : t("inventory_nothing")}
            action={
              shrinkage.lines.length > 0
                ? { label: showShrinkage ? t("close") : t("details"), onClick: () => setShowShrinkage((v) => !v) }
                : undefined
            }
          />
          {/* Stock value card — always informative, never a to-do */}
          <SmartCard
            icon={<Banknote className="w-5 h-5" />}
            active={false}
            tone="bronze"
            title={t("inventory_value_title")}
            big={`€ ${fmtEur(stockValue)}`}
            sub={t("inventory_value_sub")}
          />
        </div>
      )}

      {/* Ready-to-send supplier orders */}
      {showOrders && reorder.length > 0 && (
        <div className={`${CARD} p-4 space-y-4`} style={CARD_STYLE}>
          <div className="text-sm font-bold text-black flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            {t("inventory_reorder_title")
              .replace("{n}", String(reorder.length))
              .replace("{total}", fmtEur(reorderTotal))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {reorderBySupplier.map(([supplier, lines]) => (
              <div key={supplier || "__none__"} className="rounded-xl border p-3" style={{ borderColor: "#d9c3a3", background: "rgba(252,246,237,0.6)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-bold text-black">
                    {supplier || t("inventory_no_supplier")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => void copyOrder(supplier, lines)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border cursor-pointer text-black bg-white"
                      style={{ borderColor: "#c4956a" }}
                    >
                      {copiedSupplier === supplier ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSupplier === supplier ? t("inventory_order_copied") : t("inventory_order_copy")}
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(orderText(supplier, lines))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer text-white"
                      style={{ background: "#059669" }}
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </a>
                  </span>
                </div>
                <ul className="space-y-1">
                  {lines.map((l) => (
                    <li key={l.ingredientId} className="text-sm text-black flex items-center justify-between gap-2">
                      <span>{l.name}</span>
                      <span className="tabular-nums">
                        <strong>{fmtQty(l.suggestedQty)} {l.unit}</strong>
                        <span style={{ color: "#000" }}> · € {l.estimatedCost.toFixed(0)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shrinkage detail */}
      {showShrinkage && shrinkage.lines.length > 0 && (
        <div className={`${CARD} p-4`} style={CARD_STYLE}>
          <p className="text-xs mb-2" style={{ color: "#000" }}>
            {t("inventory_shrinkage_help")}
          </p>
          <ul className="space-y-1.5">
            {shrinkage.lines.slice(0, 10).map((l) => (
              <li key={l.ingredientId} className="text-sm text-black flex items-center justify-between gap-2">
                <span>{l.name}</span>
                <span className="tabular-nums">
                  {fmtQty(Math.abs(l.qty))} {l.unit} · <span className={l.cost < 0 ? "text-red-600 font-bold" : "text-emerald-700"}>{l.cost.toFixed(2)} €</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Search + filter chips ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* Search + scan: one input group, kept together */}
        {/* basis-0 + min-w-0: a non-zero flex-basis (w-64/basis-64) is a floor
            this group cannot shrink under, so it still overflowed the row at
            768px once the category chips claimed their share. Let flex-1 alone
            decide the width, capped by max-w-md. */}
        <div className="flex items-center gap-2 flex-1 basis-0 min-w-0 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#000" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("inventory_search_ph")}
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border bg-white/70 text-black outline-none focus:border-[#c4956a]"
              style={{ borderColor: "#d9c3a3" }}
            />
            {query && (
              <button onClick={() => { setQuery(""); setScanMsg(null); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer" aria-label="clear">
                <X className="w-4 h-4" style={{ color: "#000" }} />
              </button>
            )}
          </div>

          {/* Scan a package instead of typing its name. The label is long in
              several languages ("Scansiona codice a barre" ≈ 220px), which as a
              shrink-0 sibling starved the search input down to ~70px. It now
              truncates, and drops to the icon alone below lg. */}
          <button
            onClick={() => { setScanMsg(null); setScanTarget(null); setScanOpen(true); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl border bg-white/70 text-black cursor-pointer max-w-[45%]"
            style={{ borderColor: "#d9c3a3" }}
            title={t("scan_barcode_btn")}
          >
            <ScanBarcode className="w-4 h-4 shrink-0" /> <span className="hidden lg:inline truncate">{t("scan_barcode_btn")}</span>
          </button>
        </div>

        {/* Filter chips: their own cluster, pushed to the right */}
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = filter === c.key;
            const toneColor = c.tone === "red" ? "#dc2626" : c.tone === "amber" ? "#d97706" : "#c4956a";
            return (
              <button
                key={c.key}
                onClick={() => setFilter(active && c.key !== "all" ? "all" : c.key)}
                className="px-3 py-1.5 text-sm font-bold rounded-full border cursor-pointer transition-colors"
                style={
                  active
                    ? { background: "#c4956a", borderColor: "#c4956a", color: "#fff" }
                    : { borderColor: "#d9c3a3", background: "rgba(255,255,255,0.7)", color: "#000" }
                }
              >
                {c.label}
                {c.count > 0 && c.key !== "all" && (
                  <span
                    className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full text-white tabular-nums"
                    style={{ background: active ? "rgba(255,255,255,0.3)" : toneColor }}
                  >
                    {c.count}
                  </span>
                )}
                {c.key === "all" && <span className="ml-1.5 text-xs tabular-nums" style={{ color: active ? "#fff" : "#000" }}>{c.count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category jump bar — browse the stock the way the menu is organised */}
      {catChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ id: ALL_CATS, name: t("inventory_filter_all"), count: rows.length }, ...catChips].map((c) => {
            const active = catFilter === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCatFilter(c.id)}
                className="px-3 py-1.5 text-sm font-bold rounded-full border cursor-pointer transition-colors"
                style={
                  active
                    ? { background: "#c4956a", borderColor: "#c4956a", color: "#fff" }
                    : { borderColor: "#d9c3a3", background: "rgba(255,255,255,0.7)", color: "#000" }
                }
              >
                {c.name}
                <span
                  className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full tabular-nums"
                  style={active ? { background: "rgba(255,255,255,0.3)", color: "#fff" } : { color: "#000" }}
                >
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {scanMsg && (
        <div className="rounded-xl border px-4 py-2.5 text-sm font-bold text-black bg-white/70 flex items-center justify-between gap-3" style={{ borderColor: "#c4956a" }}>
          <span>{scanMsg}</span>
          <button onClick={() => setScanMsg(null)} className="cursor-pointer text-black/50 hover:text-black" aria-label="dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {scanOpen && (
        <CameraScanner
          mode="barcode"
          onClose={() => { setScanOpen(false); setScanTarget(null); }}
          onResult={handleScan}
          strings={{
            title: t("scan_barcode_title"),
            hint: t("scan_barcode_hint"),
            cancel: t("scan_cancel"),
            retry: t("scan_retry"),
            errPermission: t("scan_err_permission"),
            errNoCamera: t("scan_err_no_camera"),
            errInsecure: t("scan_err_insecure"),
            errGeneric: t("scan_err_generic"),
          }}
        />
      )}

      {/* ── Ingredient list ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className={`${CARD} h-16 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
          ))
        ) : visible.length === 0 ? (
          <div className={`${CARD} p-8 text-center text-sm text-black`} style={CARD_STYLE}>
            {rows.length === 0 ? t("inventory_empty") : t("inventory_no_match")}
            {/* An empty warehouse makes Food Cost unusable, so offer the stocked
                storeroom instead of leaving the owner to type 130 rows. */}
            {rows.length === 0 && (
              <div className="mt-4">
                <button
                  onClick={seedDefaults}
                  disabled={seeding}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                >
                  {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("inventory_seed_defaults")}
                </button>
                <p className="mt-2 text-xs" style={{ color: "#7a6a55" }}>
                  {t("inventory_seed_defaults_hint")}
                </p>
              </div>
            )}
          </div>
        ) : (
          pageRows.map((r) => (
            <IngredientCard
              key={r.id}
              r={r}
              isOpen={expanded === r.id}
              editing={editingStock === r.id}
              draft={editingStock === r.id ? draftStock : ""}
              saveState={saveStates[r.id]}
              posProducts={posProducts}
              posProvider={posProvider}
              parSuggestion={parSuggestions.get(r.id)}
              lots={lotsByIng[r.id]}
              onToggle={toggleRow}
              onStartEdit={startStockEdit}
              onDraftChange={setDraftStock}
              onCommit={commitStock}
              onCancel={cancelStockEdit}
              onPatch={patchIngredient}
              onCloseLot={closeLot}
              onArchive={archiveIngredient}
              onScanFor={openScanFor}
              t={t}
            />
          ))
        )}
      </div>

      {visible.length > PER_PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-black">
            {t("food_cost_pagination")
              .replace("{from}", String(safePage * PER_PAGE + 1))
              .replace("{to}", String(Math.min((safePage + 1) * PER_PAGE, visible.length)))
              .replace("{total}", String(visible.length))}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-white/70"
              style={{ borderColor: "#c4956a", color: "#000" }}
            >
              <ChevronLeft className="w-4 h-4" /> {t("back")}
            </button>
            <span className="text-black tabular-nums">{safePage + 1} / {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-white/70"
              style={{ borderColor: "#c4956a", color: "#000" }}
            >
              {t("next")} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact automation tile: icon, headline number, one-tap action. */
function SmartCard({
  icon, title, big, sub, action, active, tone, info,
}: {
  icon: React.ReactNode;
  title: string;
  big: string;
  sub: string;
  action?: { label: string; onClick: () => void };
  active: boolean;
  tone: "amber" | "bronze" | "red";
  info?: { title: string; body: string };
}) {
  const tones = {
    amber: { fg: "#d97706", bg: "rgba(217,119,6,0.09)", border: "rgba(217,119,6,0.35)" },
    bronze: { fg: "#c4956a", bg: "rgba(196,149,106,0.10)", border: "rgba(196,149,106,0.4)" },
    red: { fg: "#dc2626", bg: "rgba(220,38,38,0.07)", border: "rgba(220,38,38,0.3)" },
  }[tone];
  return (
    <div
      className="rounded-2xl border p-4 flex items-center gap-3"
      style={active ? { background: tones.bg, borderColor: tones.border } : { background: "rgba(255,255,255,0.6)", borderColor: "#d9c3a3" }}
    >
      <div className="p-2.5 rounded-xl shrink-0" style={{ background: active ? tones.bg : "rgba(196,149,106,0.12)", color: active ? tones.fg : "#000" }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: "#000" }}>
          {title}
          {info && <InfoHotspot side="top" title={info.title} body={info.body} />}
        </div>
        <div className="text-xl font-bold tabular-nums" style={{ color: active ? tones.fg : "#000" }}>{big}</div>
        <div className="text-xs truncate" style={{ color: "#000" }}>{sub}</div>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer text-white"
          style={{ background: tone === "red" ? "#dc2626" : tone === "amber" ? "#d97706" : "#c4956a" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Stock gauge: fill vs 2×par, red at/below par, amber within 30% above, green otherwise. */
function StockBar({ stock, par }: { stock: number; par: number }) {
  if (!(par > 0)) return null;
  const pct = Math.max(3, Math.min(100, (stock / (par * 2)) * 100));
  const color = stock <= par ? "#dc2626" : stock <= par * 1.3 ? "#d97706" : "#059669";
  return (
    <div className="relative h-1.5 rounded-full w-full overflow-hidden" style={{ background: "rgba(196,149,106,0.18)" }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
      {/* par marker at the 50% mark (par = half of the 2×par scale) */}
      <div className="absolute inset-y-0" style={{ left: "50%", width: 2, background: "rgba(0,0,0,0.25)" }} />
    </div>
  );
}

// One ingredient card: status dot + name + supplier, visual stock gauge, tappable
// quantity (POS write-back), expiry badge; expands into the full editor.
// Memoized — all handlers are id-based and referentially stable, so expanding or
// typing in one card never re-renders the rest of the list.
const IngredientCard = memo(function IngredientCard({
  r, isOpen, editing, draft, saveState, posProducts, posProvider, parSuggestion, lots,
  onToggle, onStartEdit, onDraftChange, onCommit, onCancel, onPatch, onCloseLot, onArchive, onScanFor, t,
}: {
  r: IngredientRow;
  isOpen: boolean;
  editing: boolean;
  draft: string;
  saveState?: SaveState;
  posProducts: PosProduct[] | null;
  posProvider: string | null;
  parSuggestion?: number;
  lots?: Lot[];
  onToggle: (id: string) => void;
  onStartEdit: (id: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: (id: string, value: string) => void;
  onCancel: () => void;
  onPatch: (id: string, patch: Partial<IngredientRow>) => void;
  onCloseLot: (lotId: string, ingredientId: string) => void;
  onArchive: (id: string) => void;
  /** Open the camera to assign a barcode TO THIS ingredient. */
  onScanFor: (id: string) => void;
  t: (k: keyof Dictionary) => string;
}) {
  const low = isLow(r);
  const days = daysToExpiry(r);
  const soon = days != null && days <= EXPIRY_SOON_DAYS;
  const hasLots = (lots?.length ?? 0) > 0;
  const statusColor = low ? "#dc2626" : soon ? "#d97706" : "#059669";
  const inputCls = "px-2.5 py-1.5 text-sm border rounded-lg text-black bg-white";
  const inputStyle = { borderColor: "#cbb492" };

  return (
    <div className={CARD} style={{ ...CARD_STYLE, borderColor: isOpen ? "#c4956a" : low ? "rgba(220,38,38,0.35)" : "#d9c3a3" }}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 cursor-pointer select-none" onClick={() => onToggle(r.id)}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-black truncate">{r.name}</span>
            {r.pos_external_product_id && (
              <span title={t("inventory_linked_hint")}>
                <Link2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-24 sm:w-36">
              <StockBar stock={Number(r.stock_qty)} par={Number(r.par_level)} />
            </div>
            <span className="text-xs truncate" style={{ color: "#000" }}>
              {r.supplier_name || (Number(r.par_level) > 0 ? `min ${fmtQty(Number(r.par_level))} ${r.unit}` : "")}
            </span>
          </div>
        </div>

        {/* Expiry badge */}
        {soon && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full shrink-0" style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }}>
            <Clock className="w-3 h-3" />
            {days! <= 0 ? t("inventory_expired") : `${days} ${t("pl_days_short")}`}
          </span>
        )}
        {low && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full shrink-0" style={{ background: "rgba(220,38,38,0.1)", color: "#dc2626" }}>
            <AlertTriangle className="w-3 h-3" /> {t("inventory_low_badge")}
          </span>
        )}

        {/* Quantity — the headline tappable value */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          {editing ? (
            <input
              autoFocus
              type="number"
              step="0.01"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onBlur={() => onCommit(r.id, draft)}
              onKeyDown={(e) => { if (e.key === "Enter") onCommit(r.id, draft); if (e.key === "Escape") onCancel(); }}
              className="w-24 px-2 py-1.5 text-right text-sm font-bold border-2 rounded-lg text-black"
              style={{ borderColor: "#c4956a" }}
            />
          ) : (
            <button
              onClick={() => onStartEdit(r.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-[#c4956a]/10"
              title={t("inventory_edit_stock_hint")}
            >
              {saveState?.status === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
              {saveState?.status === "ok" && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              <span className={`text-base font-bold tabular-nums ${low ? "text-red-600" : "text-black"}`}>
                {fmtQty(Number(r.stock_qty))}
              </span>
              <span className="text-xs" style={{ color: "#000" }}>{r.unit}</span>
            </button>
          )}
        </div>

        {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-black" /> : <ChevronRight className="w-4 h-4 shrink-0 text-black" />}
      </div>

      {saveState && (saveState.status === "ok" || saveState.status === "error") && saveState.msg && (
        <div className={`px-4 pb-2 text-xs ${saveState.status === "error" ? "text-red-600" : "text-emerald-700"}`}>{saveState.msg}</div>
      )}

      {/* Expanded editor */}
      {isOpen && (
        <div className="px-3 sm:px-4 pb-4 space-y-4 border-t pt-4" style={{ borderColor: "#e0d0b8" }}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_name")}</span>
              <input defaultValue={r.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) onPatch(r.id, { name: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_category")}</span>
              <CategorySelect
                value={r.category}
                onChange={(c) => { if (c !== (r.category || "other")) onPatch(r.id, { category: c }); }}
                t={t}
                className={inputCls + " cursor-pointer"}
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_unit")}</span>
              <UnitSelect
                value={r.unit}
                onChange={(v) => {
                  if (!v || v === r.unit) return;
                  // Switching unit must carry the NUMBERS with it: 2 kg of stock
                  // at €8/kg is 2000 g at €0.008/g, not 2 g at €8/g. Without the
                  // conversion, one dropdown change silently rewrites the
                  // warehouse value and every food cost that depends on it.
                  const qty = convertQty(Number(r.stock_qty), r.unit, v);
                  const par = convertQty(Number(r.par_level), r.unit, v);
                  const cost = convertUnitCost(Number(r.current_unit_cost), r.unit, v);
                  onPatch(r.id, {
                    unit: v,
                    // Incompatible dimensions (kg → l) have no conversion: keep
                    // the raw figures and let the owner restate them.
                    ...(qty != null ? { stock_qty: Math.round(qty * 1000) / 1000 } : {}),
                    ...(par != null ? { par_level: Math.round(par * 1000) / 1000 } : {}),
                    ...(cost != null ? { current_unit_cost: Math.round(cost * 10000) / 10000 } : {}),
                  });
                }}
                t={t}
                className={inputCls + " cursor-pointer"}
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_par")}</span>
              <input type="number" step="0.01" defaultValue={r.par_level} onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v) && v !== Number(r.par_level)) onPatch(r.id, { par_level: v }); }} className={inputCls} style={inputStyle} />
              {parSuggestion != null && Math.abs(parSuggestion - Number(r.par_level)) > 0.0005 && (
                <button
                  onClick={() => onPatch(r.id, { par_level: parSuggestion })}
                  className="text-left text-xs cursor-pointer underline decoration-dotted underline-offset-2"
                  style={{ color: "#000" }}
                >
                  {t("inventory_autopar_row")
                    .replace("{v}", fmtQty(parSuggestion))
                    .replace("{unit}", r.unit)}
                </button>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_unit_cost")}</span>
              <input type="number" step="0.0001" defaultValue={r.current_unit_cost} onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v) && v !== Number(r.current_unit_cost)) onPatch(r.id, { current_unit_cost: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_supplier")}</span>
              <input defaultValue={r.supplier_name || ""} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== r.supplier_name) onPatch(r.id, { supplier_name: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_expiry")}</span>
              {hasLots ? (
                <span className={inputCls + " flex items-center"} style={{ ...inputStyle, background: "rgba(196,149,106,0.06)" }}>
                  {r.expiry_date || "—"}
                </span>
              ) : (
                <input key={r.expiry_date || "none"} type="date" defaultValue={r.expiry_date || ""} onBlur={(e) => { const v = e.target.value || null; if (v !== r.expiry_date) onPatch(r.id, { expiry_date: v }); }} className={inputCls} style={inputStyle} />
              )}
              {hasLots && <span className="text-[11px]" style={{ color: "#000" }}>{t("inventory_lots_managed")}</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_shelf_life")}</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="—"
                defaultValue={r.shelf_life_days ?? ""}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const v = raw === "" ? null : Math.max(0, Math.round(Number(raw)));
                  if ((v ?? null) !== (r.shelf_life_days ?? null) && (raw === "" || Number.isFinite(v))) onPatch(r.id, { shelf_life_days: v });
                }}
                className={inputCls}
                style={inputStyle}
              />
              {r.shelf_life_days == null && (() => {
                const s = suggestShelfLife(r.name);
                return s != null ? (
                  <button
                    onClick={() => onPatch(r.id, { shelf_life_days: s })}
                    className="text-left text-xs cursor-pointer underline decoration-dotted underline-offset-2"
                    style={{ color: "#000" }}
                  >
                    {t("inventory_shelf_life_suggest").replace("{n}", String(s))}
                  </button>
                ) : (
                  <span className="text-[11px]" style={{ color: "#000" }}>{t("inventory_shelf_life_hint")}</span>
                );
              })()}
              {r.shelf_life_days != null && (
                <span className="text-[11px]" style={{ color: "#000" }}>{t("inventory_shelf_life_hint")}</span>
              )}
            </label>
            {/* Barcode: type it, or scan the package once and every later scan
                jumps straight to this product. */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_barcode")}</span>
              <div className="flex items-center gap-1.5">
                <input
                  key={r.barcode || "none"}
                  defaultValue={r.barcode || ""}
                  placeholder={t("inventory_barcode_ph")}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== r.barcode) onPatch(r.id, { barcode: v });
                  }}
                  className={inputCls}
                  style={inputStyle}
                  inputMode="numeric"
                />
                <button
                  onClick={() => onScanFor(r.id)}
                  className="p-2 rounded-lg border cursor-pointer text-black shrink-0"
                  style={{ borderColor: "#d9c3a3" }}
                  title={t("scan_barcode_btn")}
                  aria-label={t("scan_barcode_btn")}
                >
                  <ScanBarcode className="w-4 h-4" />
                </button>
              </div>
            </label>
          </div>

          {/* Lots — per-delivery expiry reminders. Each row is a batch received on
              a date; "fatto" closes it (the DB trigger moves the badge to the next). */}
          {hasLots && (
            <div className="pt-2 border-t" style={{ borderColor: "#e0d0b8" }}>
              <div className="text-xs font-bold text-black mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" style={{ color: "#000" }} /> {t("inventory_lots_title")}
              </div>
              <div className="space-y-1.5">
                {lots!.map((lot) => {
                  const ld = Math.floor((new Date(lot.expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000);
                  const col = ld <= 0 ? "#dc2626" : ld <= EXPIRY_SOON_DAYS ? "#b45309" : "#059669";
                  return (
                    <div key={lot.id} className="flex items-center gap-2 text-sm rounded-lg px-2.5 py-1.5" style={{ background: "rgba(196,149,106,0.06)" }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} aria-hidden />
                      <span className="font-bold tabular-nums shrink-0" style={{ color: col }}>
                        {ld <= 0 ? t("inventory_expired") : `${ld} ${t("pl_days_short")}`}
                      </span>
                      <span className="text-black tabular-nums">{lot.expiry_date}</span>
                      <span className="text-xs truncate flex-1" style={{ color: "#000" }}>
                        {lot.qty != null ? `${fmtQty(Number(lot.qty))} ${r.unit}` : ""}
                        {lot.received_on ? ` · ${t("inventory_lot_received")} ${lot.received_on}` : ""}
                      </span>
                      <button
                        onClick={() => onCloseLot(lot.id, r.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-lg border cursor-pointer text-black bg-white shrink-0"
                        style={{ borderColor: "#d9c3a3" }}
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> {t("inventory_lot_done")}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px]" style={{ color: "#000" }}>{t("inventory_lots_hint")}</p>
            </div>
          )}

          {/* POS product link — connect this ingredient to a sellable till product so stock syncs.
              The built-in till ("cassa") depletes stock from recipes automatically, so there is
              nothing to link: we show a reassuring note instead of the (always-empty) picker. */}
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t" style={{ borderColor: "#e0d0b8" }}>
            {posProvider === "cassa" ? (
              <div className="flex items-start gap-2 min-w-[260px] flex-1 rounded-lg px-3 py-2" style={{ background: "rgba(16,185,129,0.08)" }}>
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                <span className="text-xs text-black">{t("inventory_pos_native_auto")}</span>
              </div>
            ) : (
              <label className="flex flex-col gap-1 min-w-[260px]">
                <span className="text-xs font-bold text-black flex items-center gap-1">
                  <Link2 className="w-3.5 h-3.5" /> {t("inventory_pos_link")}
                  <InfoHotspot
                    side="top"
                    title={t("inventory_pos_link")}
                    body={t("inventory_pos_link_help")}
                    example={t("inventory_pos_link_example")}
                  />
                </span>
                {posProducts === null ? (
                  <span className="text-xs text-black">…</span>
                ) : posProducts.length === 0 ? (
                  <span className="text-xs text-black">{t("inventory_pos_none")}</span>
                ) : (
                  <select
                    value={r.pos_external_product_id || ""}
                    onChange={(e) => onPatch(r.id, { pos_external_product_id: e.target.value || null })}
                    className={inputCls + " cursor-pointer"}
                    style={inputStyle}
                  >
                    <option value="">{t("inventory_pos_unlinked")}</option>
                    {posProducts.map((p) => (
                      <option key={p.externalProductId} value={p.externalProductId}>
                        {p.name}{p.price != null ? ` (€${p.price})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}
            <button
              onClick={() => onArchive(r.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg border cursor-pointer text-red-600 bg-white"
              style={{ borderColor: "rgba(220,38,38,0.5)" }}
            >
              <Trash2 className="w-4 h-4" /> {t("delete")}
            </button>
          </div>

          {/* Audited stock actions + recent movement history. */}
          <InventoryMovements ingredientId={r.id} unit={r.unit} currentUnitCost={Number(r.current_unit_cost)} />
        </div>
      )}
    </div>
  );
});

function NewIngredientForm({ onCreate, onCancel, t }: { onCreate: (name: string, unit: string, category: string) => void; onCancel: () => void; t: (k: keyof Dictionary) => string }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  // The category follows the name until the owner overrides it: type "Pomodori"
  // and the picker lands on Verdura by itself. Once they choose, their choice
  // sticks — further typing must never yank it back.
  const [category, setCategory] = useState("other");
  const [catTouched, setCatTouched] = useState(false);
  const inputCls = "px-3 py-2 text-sm border rounded-lg text-black bg-white";
  const inputStyle = { borderColor: "#cbb492" };

  const onName = (v: string) => {
    setName(v);
    if (!catTouched) setCategory(classifyIngredient(v));
  };
  const submit = () => onCreate(name, unit, category);

  return (
    <div className={`${CARD} p-4 flex flex-wrap items-end gap-3`} style={CARD_STYLE}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_col_name")}</span>
        <input autoFocus value={name} onChange={(e) => onName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className={inputCls} style={inputStyle} placeholder={t("inventory_new_name_ph")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_category")}</span>
        <CategorySelect
          value={category}
          onChange={(c) => { setCategory(c); setCatTouched(true); }}
          t={t}
          className={inputCls + " w-44 cursor-pointer"}
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_unit")}</span>
        <UnitSelect value={unit} onChange={setUnit} t={t} className={inputCls + " w-44 cursor-pointer"} style={inputStyle} />
      </label>
      <button onClick={submit} disabled={!name.trim()} className={BRONZE_BTN + " disabled:cursor-not-allowed disabled:opacity-40"} style={BRONZE_BG}>
        {t("save")}
      </button>
      <button onClick={onCancel} className="px-4 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white" style={{ borderColor: "#cbb492" }}>
        {t("cancel")}
      </button>
    </div>
  );
}
