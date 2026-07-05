"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package,
  AlertTriangle,
  Clock,
  ChevronDown,
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
} from "lucide-react";
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

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  current_unit_cost: number;
  stock_qty: number;
  par_level: number;
  supplier_name: string | null;
  expiry_date: string | null;
  pos_external_product_id: string | null;
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

// Shared visual language of the management restyle: one soft card surface,
// traffic-light status colors, no heavy double borders.
const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#eaddcb" } as const;
const BRONZE_BTN =
  "inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-60";
const BRONZE_BG = { background: "linear-gradient(135deg, #d4a574, #c4956a)" } as const;

/** Human quantity: 12 kg, 3,5 l, 0,25 kg — decimals only when they matter. */
const fmtQty = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2)).replace(".", ",");
const fmtEur = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 0 });

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
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Inline stock edit (the headline editable field, with POS write-back).
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [draftStock, setDraftStock] = useState("");

  // Last 30 days of the stock ledger — feeds the automatic par levels and the
  // waste/shrinkage panel. Loaded together with the ingredients.
  const [movements, setMovements] = useState<MovementLite[]>([]);

  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled) return;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ data }, { data: mv }] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id, name, unit, current_unit_cost, stock_qty, par_level, supplier_name, expiry_date, pos_external_product_id")
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
    ]);
    setRows((data || []) as IngredientRow[]);
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
    } catch {
      setPosProducts([]);
    }
  }, [posProducts, activeTenant?.id]);

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

  const lowCount = rows.filter(isLow).length;
  const expiringCount = rows.filter(isExpiringSoon).length;

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
        (supplier ? `${t("inventory_order_for" as keyof Dictionary) || "Ordine per"} ${supplier}` : t("inventory_order_generic" as keyof Dictionary) || "Ordine fornitore") +
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

  // Save stock: optimistic local update → POST (CRM + POS write-back when linked).
  async function saveStock(id: string, value: string) {
    const qty = Number(value.replace(",", "."));
    setEditingStock(null);
    if (!Number.isFinite(qty) || qty < 0) return;
    const prev = rows.find((r) => r.id === id)?.stock_qty ?? null;
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
      setSaveStates((s) => ({ ...s, [id]: { status: "ok", msg: data?.pos?.detail || (t("settings_saved" as keyof Dictionary) || "Salvato") } }));
      setTimeout(() => setSaveStates((s) => ({ ...s, [id]: { status: "idle" } })), 4000);
    } catch (e: any) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stock_qty: Number(prev) } : r)));
      setSaveStates((s) => ({ ...s, [id]: { status: "error", msg: e?.message || "Errore" } }));
    }
  }

  // Patch any other ingredient field directly (CRM-only — no POS write needed).
  async function patchIngredient(id: string, patch: Partial<IngredientRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("ingredients").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setSaveStates((s) => ({ ...s, [id]: { status: "error", msg: error.message } }));
    } else {
      setSaveStates((s) => ({ ...s, [id]: { status: "ok" } }));
      setTimeout(() => setSaveStates((s) => ({ ...s, [id]: { status: "idle" } })), 1500);
    }
  }

  async function archiveIngredient(id: string) {
    if (!confirm(t("inventory_confirm_delete" as keyof Dictionary) || "Eliminare questo ingrediente?")) return;
    setExpanded(null);
    setRows((rs) => rs.filter((r) => r.id !== id));
    await supabase.from("ingredients").update({ archived: true, updated_at: new Date().toISOString() }).eq("id", id);
  }

  async function createIngredient(name: string, unit: string) {
    if (!activeTenant?.id || !name.trim()) return;
    setCreating(false);
    const { error } = await supabase.from("ingredients").insert({
      tenant_id: activeTenant.id,
      name: name.trim(),
      unit: unit.trim() || "kg",
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
      if (q && !r.name.toLowerCase().includes(q) && !(r.supplier_name || "").toLowerCase().includes(q)) return false;
      if (filter === "low") return isLow(r);
      if (filter === "expiring") return isExpiringSoon(r);
      if (filter === "reorder") return reorderIds.has(r.id);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filter, reorderIds]);

  if (!enabled) {
    return <ManagementLocked section="inventory" />;
  }

  const chips: Array<{ key: Filter; label: string; count: number; tone?: "red" | "amber" }> = [
    { key: "all", label: t("inventory_filter_all" as keyof Dictionary) || "Tutti", count: rows.length },
    { key: "low", label: t("inventory_low" as keyof Dictionary) || "Scorta bassa", count: lowCount, tone: "red" },
    { key: "expiring", label: t("inventory_expiring" as keyof Dictionary) || "In scadenza", count: expiringCount, tone: "amber" },
    { key: "reorder", label: t("inventory_reorder" as keyof Dictionary) || "Da riordinare", count: reorder.length, tone: "amber" },
  ];

  const allGood = !loading && reorder.length === 0 && actionablePar.length === 0 && lowCount === 0 && expiringCount === 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Package className="w-6 h-6" /> {t("nav_inventory" as keyof Dictionary) || "Inventario"}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#8b6540" }}>
            {t("inventory_subtitle_v2" as keyof Dictionary) ||
              "Si aggiorna da solo con le vendite della cassa e le fatture fotografate. Tocca una quantità per correggerla."}
          </p>
        </div>
        <div className="shrink-0 flex flex-wrap items-center gap-2 justify-end">
          {activeTenant?.id && (
            <InvoiceCapture
              tenantId={activeTenant.id}
              ingredients={rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit }))}
              onDone={() => void load()}
            />
          )}
          <button onClick={() => setCreating((v) => !v)} className={BRONZE_BTN} style={BRONZE_BG}>
            <Plus className="w-4 h-4" /> {t("inventory_new" as keyof Dictionary) || "Nuovo ingrediente"}
          </button>
        </div>
      </div>

      {creating && <NewIngredientForm onCreate={createIngredient} onCancel={() => setCreating(false)} t={t} />}

      {/* ── Smart strip: everything the system worked out on its own ───────── */}
      {allGood ? (
        <div className={`${CARD} px-4 py-3 flex items-center gap-2`} style={{ ...CARD_STYLE, background: "rgba(16,185,129,0.07)", borderColor: "rgba(5,150,105,0.3)" }}>
          <Check className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-sm font-bold text-emerald-700">
            {t("inventory_all_good" as keyof Dictionary) || "Tutto a posto: niente da riordinare, nessuna scadenza vicina."}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Reorder card */}
          <SmartCard
            icon={<ShoppingCart className="w-5 h-5" />}
            active={reorder.length > 0}
            tone="amber"
            title={t("inventory_reorder" as keyof Dictionary) || "Da riordinare"}
            big={reorder.length > 0 ? `${reorder.length}` : "0"}
            sub={
              reorder.length > 0
                ? (t("inventory_reorder_est_short" as keyof Dictionary) || "stima € {total}").replace("{total}", fmtEur(reorderTotal))
                : t("inventory_nothing" as keyof Dictionary) || "niente da fare"
            }
            action={
              reorder.length > 0
                ? { label: showOrders ? (t("close" as keyof Dictionary) || "Chiudi") : (t("inventory_prepare_orders" as keyof Dictionary) || "Prepara ordini"), onClick: () => setShowOrders((v) => !v) }
                : undefined
            }
          />
          {/* Auto par card */}
          <SmartCard
            icon={<Wand2 className="w-5 h-5" />}
            active={actionablePar.length > 0}
            tone="bronze"
            title={t("inventory_autopar_short" as keyof Dictionary) || "Scorte minime auto"}
            big={`${actionablePar.length}`}
            sub={
              actionablePar.length > 0
                ? t("inventory_autopar_sub" as keyof Dictionary) || "calcolate dai consumi reali"
                : t("inventory_uptodate" as keyof Dictionary) || "già aggiornate"
            }
            action={
              actionablePar.length > 0
                ? {
                    label: applyingPar ? "…" : t("inventory_autopar_apply" as keyof Dictionary) || "Applica tutte",
                    onClick: () => void applyAllPar(),
                  }
                : undefined
            }
            info={{
              title: t("inventory_autopar_short" as keyof Dictionary) || "Scorte minime automatiche",
              body:
                t("inventory_autopar_body" as keyof Dictionary) ||
                "Calcolate dai consumi reali degli ultimi 30 giorni (coprono 3 giorni di lavoro).",
            }}
          />
          {/* Shrinkage card */}
          <SmartCard
            icon={<TrendingDown className="w-5 h-5" />}
            active={shrinkage.lines.length > 0 && shrinkage.totalCost < 0}
            tone="red"
            title={t("inventory_shrinkage_short" as keyof Dictionary) || "Sprechi 30 gg"}
            big={`€ ${fmtEur(Math.abs(shrinkage.totalCost))}`}
            sub={
              shrinkage.lines.length > 0
                ? t("inventory_shrinkage_sub" as keyof Dictionary) || "scarti, rettifiche e differenze"
                : t("inventory_nothing" as keyof Dictionary) || "niente da fare"
            }
            action={
              shrinkage.lines.length > 0
                ? { label: showShrinkage ? (t("close" as keyof Dictionary) || "Chiudi") : (t("details" as keyof Dictionary) || "Dettagli"), onClick: () => setShowShrinkage((v) => !v) }
                : undefined
            }
          />
        </div>
      )}

      {/* Ready-to-send supplier orders */}
      {showOrders && reorder.length > 0 && (
        <div className={`${CARD} p-4 space-y-4`} style={CARD_STYLE}>
          <div className="text-sm font-bold text-black flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            {(t("inventory_reorder_title" as keyof Dictionary) || "Lista riordino ({n} articoli · stima € {total})")
              .replace("{n}", String(reorder.length))
              .replace("{total}", fmtEur(reorderTotal))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {reorderBySupplier.map(([supplier, lines]) => (
              <div key={supplier || "__none__"} className="rounded-xl border p-3" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.6)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-bold text-black">
                    {supplier || (t("inventory_no_supplier" as keyof Dictionary) || "Senza fornitore")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => void copyOrder(supplier, lines)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border cursor-pointer text-black bg-white"
                      style={{ borderColor: "#c4956a" }}
                    >
                      {copiedSupplier === supplier ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSupplier === supplier
                        ? (t("inventory_order_copied" as keyof Dictionary) || "Copiato!")
                        : (t("inventory_order_copy" as keyof Dictionary) || "Copia")}
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
                        <span style={{ color: "#8b6540" }}> · € {l.estimatedCost.toFixed(0)}</span>
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
          <p className="text-xs mb-2" style={{ color: "#8b6540" }}>
            {t("inventory_shrinkage_help" as keyof Dictionary) ||
              "Somma di scarti, rettifiche e differenze delle conte fisiche: qui si vede quanto magazzino sparisce senza essere venduto."}
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#8b6540" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("inventory_search_ph" as keyof Dictionary) || "Cerca ingrediente o fornitore…"}
            className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border bg-white/70 text-black outline-none focus:border-[#c4956a]"
            style={{ borderColor: "#eaddcb" }}
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer" aria-label="clear">
              <X className="w-4 h-4" style={{ color: "#8b6540" }} />
            </button>
          )}
        </div>
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
                    : { borderColor: "#eaddcb", background: "rgba(255,255,255,0.7)", color: "#000" }
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
                {c.key === "all" && <span className="ml-1.5 text-xs tabular-nums" style={{ color: active ? "#fff" : "#8b6540" }}>{c.count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Ingredient list ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className={`${CARD} h-16 animate-pulse`} style={{ ...CARD_STYLE, background: "rgba(252,246,237,0.6)" }} />
          ))
        ) : visible.length === 0 ? (
          <div className={`${CARD} p-8 text-center text-sm text-black`} style={CARD_STYLE}>
            {rows.length === 0
              ? t("inventory_empty" as keyof Dictionary) || "Nessun ingrediente. Fotografa una fattura o aggiungine uno."
              : t("inventory_no_match" as keyof Dictionary) || "Nessun risultato con questi filtri."}
          </div>
        ) : (
          visible.map((r) => (
            <IngredientCard
              key={r.id}
              r={r}
              isOpen={expanded === r.id}
              onToggle={() => { const open = expanded === r.id; setExpanded(open ? null : r.id); if (!open) void ensurePosProducts(); }}
              low={isLow(r)}
              daysToExpiry={daysToExpiry(r)}
              editingStock={editingStock === r.id}
              draftStock={draftStock}
              setDraftStock={setDraftStock}
              onStartStockEdit={() => { setEditingStock(r.id); setDraftStock(String(r.stock_qty)); }}
              onCommitStock={() => saveStock(r.id, draftStock)}
              onCancelStock={() => setEditingStock(null)}
              saveState={saveStates[r.id]}
              posProducts={posProducts}
              parSuggestion={parSuggestions.get(r.id)}
              onPatch={(patch) => patchIngredient(r.id, patch)}
              onArchive={() => archiveIngredient(r.id)}
              t={t}
            />
          ))
        )}
      </div>
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
      style={active ? { background: tones.bg, borderColor: tones.border } : { background: "rgba(255,255,255,0.6)", borderColor: "#eaddcb" }}
    >
      <div className="p-2.5 rounded-xl shrink-0" style={{ background: active ? tones.bg : "rgba(196,149,106,0.12)", color: active ? tones.fg : "#8b6540" }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: "#8b6540" }}>
          {title}
          {info && <InfoHotspot side="top" title={info.title} body={info.body} />}
        </div>
        <div className="text-xl font-bold tabular-nums" style={{ color: active ? tones.fg : "#000" }}>{big}</div>
        <div className="text-xs truncate" style={{ color: "#8b6540" }}>{sub}</div>
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
function IngredientCard({
  r, isOpen, onToggle, low, daysToExpiry, editingStock, draftStock, setDraftStock,
  onStartStockEdit, onCommitStock, onCancelStock, saveState, posProducts, parSuggestion, onPatch, onArchive, t,
}: {
  r: IngredientRow;
  isOpen: boolean;
  onToggle: () => void;
  low: boolean;
  daysToExpiry: number | null;
  editingStock: boolean;
  draftStock: string;
  setDraftStock: (v: string) => void;
  onStartStockEdit: () => void;
  onCommitStock: () => void;
  onCancelStock: () => void;
  saveState?: SaveState;
  posProducts: PosProduct[] | null;
  parSuggestion?: number;
  onPatch: (patch: Partial<IngredientRow>) => void;
  onArchive: () => void;
  t: (k: keyof Dictionary) => string;
}) {
  const soon = daysToExpiry != null && daysToExpiry <= EXPIRY_SOON_DAYS;
  const statusColor = low ? "#dc2626" : soon ? "#d97706" : "#059669";
  const inputCls = "px-2.5 py-1.5 text-sm border rounded-lg text-black bg-white";
  const inputStyle = { borderColor: "#dfcdb4" };

  return (
    <div className={CARD} style={{ ...CARD_STYLE, borderColor: isOpen ? "#c4956a" : low ? "rgba(220,38,38,0.35)" : "#eaddcb" }}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 cursor-pointer select-none" onClick={onToggle}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-black truncate">{r.name}</span>
            {r.pos_external_product_id && (
              <span title={t("inventory_linked_hint" as keyof Dictionary) || "Collegato a un prodotto della cassa"}>
                <Link2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-24 sm:w-36">
              <StockBar stock={Number(r.stock_qty)} par={Number(r.par_level)} />
            </div>
            <span className="text-xs truncate" style={{ color: "#8b6540" }}>
              {r.supplier_name || (Number(r.par_level) > 0 ? `min ${fmtQty(Number(r.par_level))} ${r.unit}` : "")}
            </span>
          </div>
        </div>

        {/* Expiry badge */}
        {soon && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full shrink-0" style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }}>
            <Clock className="w-3 h-3" />
            {daysToExpiry! <= 0
              ? t("inventory_expired" as keyof Dictionary) || "scaduto"
              : `${daysToExpiry} ${t("pl_days_short" as keyof Dictionary) || "gg"}`}
          </span>
        )}
        {low && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full shrink-0" style={{ background: "rgba(220,38,38,0.1)", color: "#dc2626" }}>
            <AlertTriangle className="w-3 h-3" /> {t("inventory_low_badge" as keyof Dictionary) || "bassa"}
          </span>
        )}

        {/* Quantity — the headline tappable value */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          {editingStock ? (
            <input
              autoFocus
              type="number"
              step="0.01"
              value={draftStock}
              onChange={(e) => setDraftStock(e.target.value)}
              onBlur={onCommitStock}
              onKeyDown={(e) => { if (e.key === "Enter") onCommitStock(); if (e.key === "Escape") onCancelStock(); }}
              className="w-24 px-2 py-1.5 text-right text-sm font-bold border-2 rounded-lg text-black"
              style={{ borderColor: "#c4956a" }}
            />
          ) : (
            <button
              onClick={onStartStockEdit}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-[#c4956a]/10"
              title={t("inventory_edit_stock_hint" as keyof Dictionary) || "Modifica giacenza"}
            >
              {saveState?.status === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
              {saveState?.status === "ok" && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              <span className={`text-base font-bold tabular-nums ${low ? "text-red-600" : "text-black"}`}>
                {fmtQty(Number(r.stock_qty))}
              </span>
              <span className="text-xs" style={{ color: "#8b6540" }}>{r.unit}</span>
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
        <div className="px-3 sm:px-4 pb-4 space-y-4 border-t pt-4" style={{ borderColor: "#f0e5d4" }}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_name" as keyof Dictionary) || "Ingrediente"}</span>
              <input defaultValue={r.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) onPatch({ name: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_unit" as keyof Dictionary) || "Unità (kg, l, pz)"}</span>
              <input defaultValue={r.unit} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.unit) onPatch({ unit: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_par" as keyof Dictionary) || "Scorta min."}</span>
              <input type="number" step="0.01" defaultValue={r.par_level} onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v) && v !== Number(r.par_level)) onPatch({ par_level: v }); }} className={inputCls} style={inputStyle} />
              {parSuggestion != null && Math.abs(parSuggestion - Number(r.par_level)) > 0.0005 && (
                <button
                  onClick={() => onPatch({ par_level: parSuggestion })}
                  className="text-left text-xs cursor-pointer underline decoration-dotted underline-offset-2"
                  style={{ color: "#8b6540" }}
                >
                  {(t("inventory_autopar_row" as keyof Dictionary) || "Dai consumi: {v} {unit} — usa")
                    .replace("{v}", fmtQty(parSuggestion))
                    .replace("{unit}", r.unit)}
                </button>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_unit_cost" as keyof Dictionary) || "Costo unitario €"}</span>
              <input type="number" step="0.0001" defaultValue={r.current_unit_cost} onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v) && v !== Number(r.current_unit_cost)) onPatch({ current_unit_cost: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_supplier" as keyof Dictionary) || "Fornitore"}</span>
              <input defaultValue={r.supplier_name || ""} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== r.supplier_name) onPatch({ supplier_name: v }); }} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inventory_col_expiry" as keyof Dictionary) || "Scadenza"}</span>
              <input type="date" defaultValue={r.expiry_date || ""} onBlur={(e) => { const v = e.target.value || null; if (v !== r.expiry_date) onPatch({ expiry_date: v }); }} className={inputCls} style={inputStyle} />
            </label>
          </div>

          {/* POS product link — connect this ingredient to a sellable till product so stock syncs. */}
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t" style={{ borderColor: "#f0e5d4" }}>
            <label className="flex flex-col gap-1 min-w-[260px]">
              <span className="text-xs font-bold text-black flex items-center gap-1">
                <Link2 className="w-3.5 h-3.5" /> {t("inventory_pos_link" as keyof Dictionary) || "Prodotto cassa collegato (per sincronizzare la giacenza)"}
                <InfoHotspot
                  side="top"
                  title={t("inventory_pos_link" as keyof Dictionary) || "Prodotto cassa collegato"}
                  body={t("inventory_pos_link_help" as keyof Dictionary) || "Collega questo articolo di magazzino allo stesso prodotto sulla cassa, così la giacenza resta sincronizzata: quando viene venduto alla cassa scala da sola, e se la correggi qui si aggiorna anche sulla cassa. Utile per i prodotti venduti così come sono (una bottiglia, una lattina, un prodotto confezionato)."}
                  example={t("inventory_pos_link_example" as keyof Dictionary) || "Es: «Vino rosso (bottiglia)» collegato al prodotto cassa «Vino rosso». Vendi 2 bottiglie alla cassa → la giacenza passa da 10 a 8 da sola, senza scriverlo a mano."}
                />
              </span>
              {posProducts === null ? (
                <span className="text-xs text-black">…</span>
              ) : posProducts.length === 0 ? (
                <span className="text-xs text-black">{t("inventory_pos_none" as keyof Dictionary) || "Nessuna cassa collegata (vai in Impostazioni → Cassa)."}</span>
              ) : (
                <select
                  value={r.pos_external_product_id || ""}
                  onChange={(e) => onPatch({ pos_external_product_id: e.target.value || null })}
                  className={inputCls + " cursor-pointer"}
                  style={inputStyle}
                >
                  <option value="">{t("inventory_pos_unlinked" as keyof Dictionary) || "— Non collegato —"}</option>
                  {posProducts.map((p) => (
                    <option key={p.externalProductId} value={p.externalProductId}>
                      {p.name}{p.price != null ? ` (€${p.price})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <button
              onClick={onArchive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg border cursor-pointer text-red-600 bg-white"
              style={{ borderColor: "rgba(220,38,38,0.5)" }}
            >
              <Trash2 className="w-4 h-4" /> {t("delete" as keyof Dictionary) || "Elimina"}
            </button>
          </div>

          {/* Audited stock actions + recent movement history. */}
          <InventoryMovements ingredientId={r.id} unit={r.unit} currentUnitCost={Number(r.current_unit_cost)} />
        </div>
      )}
    </div>
  );
}

function NewIngredientForm({ onCreate, onCancel, t }: { onCreate: (name: string, unit: string) => void; onCancel: () => void; t: (k: keyof Dictionary) => string }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const inputCls = "px-3 py-2 text-sm border rounded-lg text-black bg-white";
  const inputStyle = { borderColor: "#dfcdb4" };
  return (
    <div className={`${CARD} p-4 flex flex-wrap items-end gap-3`} style={CARD_STYLE}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_col_name" as keyof Dictionary) || "Ingrediente"}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onCreate(name, unit); }} className={inputCls} style={inputStyle} placeholder={t("inventory_new_name_ph" as keyof Dictionary) || "Es. Farina 00"} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_unit" as keyof Dictionary) || "Unità (kg, l, pz)"}</span>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls + " w-28"} style={inputStyle} />
      </label>
      <button onClick={() => onCreate(name, unit)} disabled={!name.trim()} className={BRONZE_BTN + " disabled:cursor-not-allowed disabled:opacity-40"} style={BRONZE_BG}>
        {t("save" as keyof Dictionary) || "Salva"}
      </button>
      <button onClick={onCancel} className="px-4 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white" style={{ borderColor: "#dfcdb4" }}>
        {t("cancel" as keyof Dictionary) || "Annulla"}
      </button>
    </div>
  );
}
