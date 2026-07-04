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
} from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
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

const EXPIRY_SOON_DAYS = 5;

/** Human quantity: 12 kg, 3,5 l, 0,25 kg — decimals only when they matter. */
const fmtQty = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2)).replace(".", ",");

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

  const isLow = (r: IngredientRow) => Number(r.stock_qty) <= Number(r.par_level);
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
  const [showReorder, setShowReorder] = useState(false);
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

  if (!enabled) {
    return <ManagementLocked section="inventory" />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b pb-5 flex items-start justify-between gap-4" style={{ borderColor: "#c4956a" }}>
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Package className="w-6 h-6" /> {t("nav_inventory" as keyof Dictionary) || "Inventario"}
          </h1>
          <p className="mt-1 text-sm text-black">
            {t("inventory_subtitle_editable" as keyof Dictionary) ||
              "Giacenze, scorta minima e scadenze. Tocca la giacenza per correggerla (si aggiorna anche sulla cassa se l'ingrediente è collegato), o espandi una riga per modificare tutto."}
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
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-bold rounded-lg cursor-pointer"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <Plus className="w-4 h-4" /> {t("inventory_new" as keyof Dictionary) || "Nuovo ingrediente"}
          </button>
        </div>
      </div>

      {creating && <NewIngredientForm onCreate={createIngredient} onCancel={() => setCreating(false)} t={t} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t("inventory_count" as keyof Dictionary) || "Ingredienti"} value={rows.length} icon={<Package className="w-5 h-5" />} />
        <KPICard title={t("inventory_low" as keyof Dictionary) || "Scorta bassa"} value={lowCount} icon={<AlertTriangle className="w-5 h-5" />} valueClassName={lowCount > 0 ? "text-red-600" : undefined} />
        <KPICard title={t("inventory_expiring" as keyof Dictionary) || "In scadenza"} value={expiringCount} icon={<Clock className="w-5 h-5" />} valueClassName={expiringCount > 0 ? "text-amber-600" : undefined} />
        <KPICard title={t("inventory_reorder" as keyof Dictionary) || "Da riordinare"} value={reorder.length} icon={<ShoppingCart className="w-5 h-5" />} valueClassName={reorder.length > 0 ? "text-amber-600" : undefined} />
      </div>

      {/* Reorder list — items at/below par, with a suggested top-up to 2× par. */}
      {reorder.length > 0 && (
        <div className="rounded-xl border-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
          <button
            onClick={() => setShowReorder((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 cursor-pointer"
          >
            <span className="text-sm font-bold text-black flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              {(t("inventory_reorder_title" as keyof Dictionary) || "Lista riordino ({n} articoli · stima € {total})")
                .replace("{n}", String(reorder.length))
                .replace("{total}", reorderTotal.toLocaleString("it-IT", { maximumFractionDigits: 0 }))}
            </span>
            {showReorder ? <ChevronDown className="w-4 h-4 text-black" /> : <ChevronRight className="w-4 h-4 text-black" />}
          </button>
          {showReorder && (
            <div className="px-4 pb-4 space-y-4">
              {reorderBySupplier.map(([supplier, lines]) => (
                <div key={supplier || "__none__"}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-bold text-black">
                      {supplier || (t("inventory_no_supplier" as keyof Dictionary) || "Senza fornitore")}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <button
                        onClick={() => void copyOrder(supplier, lines)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border-2 cursor-pointer text-black"
                        style={{ borderColor: "#c4956a" }}
                      >
                        {copiedSupplier === supplier ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedSupplier === supplier
                          ? (t("inventory_order_copied" as keyof Dictionary) || "Copiato!")
                          : (t("inventory_order_copy" as keyof Dictionary) || "Copia ordine")}
                      </button>
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(orderText(supplier, lines))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border-2 cursor-pointer"
                        style={{ borderColor: "#059669", color: "#047857" }}
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                      </a>
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-black">
                        <th className="py-1 font-bold">{t("inventory_col_name" as keyof Dictionary) || "Ingrediente"}</th>
                        <th className="py-1 font-bold text-right">{t("inventory_col_stock" as keyof Dictionary) || "Giacenza"}</th>
                        <th className="py-1 font-bold text-right">{t("inventory_reorder_suggested" as keyof Dictionary) || "Da ordinare"}</th>
                        <th className="py-1 font-bold text-right">{t("inventory_reorder_est" as keyof Dictionary) || "Stima €"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.ingredientId} className="border-t text-black" style={{ borderColor: "#eaddcb" }}>
                          <td className="py-1.5">{l.name}</td>
                          <td className="py-1.5 text-right tabular-nums">{l.stockQty} {l.unit}</td>
                          <td className="py-1.5 text-right tabular-nums font-bold">{l.suggestedQty} {l.unit}</td>
                          <td className="py-1.5 text-right tabular-nums">€ {l.estimatedCost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Automatic par levels — learned from the last 30 days of real usage. */}
      {actionablePar.length > 0 && (
        <div className="rounded-xl border-2 px-4 py-3 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
          <span className="text-sm text-black flex items-center gap-2">
            <Wand2 className="w-4 h-4" style={{ color: "#c4956a" }} />
            <span>
              <strong>
                {(t("inventory_autopar_title" as keyof Dictionary) || "Scorte minime automatiche: {n} da aggiornare").replace("{n}", String(actionablePar.length))}
              </strong>{" "}
              {t("inventory_autopar_body" as keyof Dictionary) || "— calcolate dai consumi reali degli ultimi 30 giorni (coprono 3 giorni di lavoro)."}
            </span>
          </span>
          <button
            onClick={() => void applyAllPar()}
            disabled={applyingPar}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-bold rounded-lg cursor-pointer disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {applyingPar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t("inventory_autopar_apply" as keyof Dictionary) || "Applica tutte"}
          </button>
        </div>
      )}

      {/* Shrinkage — waste, count corrections and adjustments of the month in €. */}
      {shrinkage.lines.length > 0 && (
        <div className="rounded-xl border-2" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.4)" }}>
          <button onClick={() => setShowShrinkage((v) => !v)} className="w-full flex items-center justify-between gap-2 px-4 py-3 cursor-pointer">
            <span className="text-sm font-bold text-black flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              {(t("inventory_shrinkage_title" as keyof Dictionary) || "Sprechi e differenze (30 gg): {total} €")
                .replace("{total}", shrinkage.totalCost.toLocaleString("it-IT", { maximumFractionDigits: 0 }))}
            </span>
            {showShrinkage ? <ChevronDown className="w-4 h-4 text-black" /> : <ChevronRight className="w-4 h-4 text-black" />}
          </button>
          {showShrinkage && (
            <div className="px-4 pb-4">
              <p className="text-xs text-black mb-2">
                {t("inventory_shrinkage_help" as keyof Dictionary) ||
                  "Somma di scarti, rettifiche e differenze delle conte fisiche: qui si vede quanto magazzino sparisce senza essere venduto."}
              </p>
              <ul className="space-y-1">
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
        </div>
      )}

      <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "#c4956a" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ background: "rgba(196,149,106,0.15)" }}>
              <th className="px-3 py-2 w-8" aria-hidden />
              <th className="px-4 py-2 font-bold text-black">{t("inventory_col_name" as keyof Dictionary) || "Ingrediente"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("inventory_col_stock" as keyof Dictionary) || "Giacenza"}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("inventory_col_par" as keyof Dictionary) || "Scorta min."}</th>
              <th className="px-4 py-2 font-bold text-black text-right">{t("inventory_col_cost" as keyof Dictionary) || "Costo"}</th>
              <th className="px-4 py-2 font-bold text-black">{t("inventory_col_supplier" as keyof Dictionary) || "Fornitore"}</th>
              <th className="px-4 py-2 font-bold text-black">{t("inventory_col_expiry" as keyof Dictionary) || "Scadenza"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-black">…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-black">{t("inventory_empty" as keyof Dictionary) || "Nessun ingrediente."}</td></tr>
            ) : (
              rows.map((r) => (
                <IngredientRowGroup
                  key={r.id}
                  r={r}
                  isOpen={expanded === r.id}
                  onToggle={() => { const open = expanded === r.id; setExpanded(open ? null : r.id); if (!open) void ensurePosProducts(); }}
                  low={isLow(r)}
                  soon={isExpiringSoon(r)}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One ingredient: the main row (expandable, with inline stock edit) + an expanded
// editor row for every other field, including the POS-product link picker.
function IngredientRowGroup({
  r, isOpen, onToggle, low, soon, editingStock, draftStock, setDraftStock,
  onStartStockEdit, onCommitStock, onCancelStock, saveState, posProducts, parSuggestion, onPatch, onArchive, t,
}: {
  r: IngredientRow;
  isOpen: boolean;
  onToggle: () => void;
  low: boolean;
  soon: boolean;
  editingStock: boolean;
  draftStock: string;
  setDraftStock: (v: string) => void;
  onStartStockEdit: () => void;
  onCommitStock: () => void;
  onCancelStock: () => void;
  saveState?: SaveState;
  posProducts: PosProduct[] | null;
  /** data-driven par level from the last 30 days of consumption, if any. */
  parSuggestion?: number;
  onPatch: (patch: Partial<IngredientRow>) => void;
  onArchive: () => void;
  t: (k: keyof Dictionary) => string;
}) {
  const inputCls = "px-2 py-1 text-sm border-2 rounded text-black";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  return (
    <>
      <tr className="border-t" style={{ borderColor: "#eaddcb", background: low ? "rgba(220,38,38,0.06)" : undefined }}>
        <td className="px-3 py-2 align-middle">
          <button onClick={onToggle} className="p-0.5 text-black hover:text-black cursor-pointer" aria-label="toggle editor" aria-expanded={isOpen}>
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>
        <td className="px-4 py-2 text-black font-medium">
          {r.name}
          {r.pos_external_product_id && (
            <span title={t("inventory_linked_hint" as keyof Dictionary) || "Collegato a un prodotto della cassa"}>
              <Link2 className="inline w-3.5 h-3.5 ml-1.5 text-emerald-600" />
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-right">
          {editingStock ? (
            <input
              autoFocus
              type="number"
              step="0.01"
              value={draftStock}
              onChange={(e) => setDraftStock(e.target.value)}
              onBlur={onCommitStock}
              onKeyDown={(e) => { if (e.key === "Enter") onCommitStock(); if (e.key === "Escape") onCancelStock(); }}
              className="w-24 px-2 py-1 text-right text-sm border-2 rounded"
              style={{ borderColor: "#c4956a" }}
            />
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              {saveState?.status === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
              {saveState?.status === "ok" && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              <button
                onClick={onStartStockEdit}
                className={`px-2 py-0.5 rounded hover:bg-[#c4956a]/15 cursor-pointer underline decoration-dotted underline-offset-2 ${low ? "text-red-600 font-bold" : "text-black"}`}
                title={t("inventory_edit_stock_hint" as keyof Dictionary) || "Modifica giacenza"}
              >
                {Number(r.stock_qty).toFixed(2)} {r.unit}
              </button>
              {low && <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t("inventory_low_badge" as keyof Dictionary) || "bassa"}</span>}
            </div>
          )}
        </td>
        <td className="px-4 py-2 text-right text-black">{Number(r.par_level).toFixed(2)} {r.unit}</td>
        <td className="px-4 py-2 text-right text-black">€ {Number(r.current_unit_cost).toFixed(4)}</td>
        <td className="px-4 py-2 text-black">{r.supplier_name || "—"}</td>
        <td className="px-4 py-2">
          {r.expiry_date ? (
            <span className={soon ? "text-amber-700 font-bold" : "text-black"}>
              {r.expiry_date}
              {soon && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{t("inventory_expiring_badge" as keyof Dictionary) || "in scadenza"}</span>}
            </span>
          ) : "—"}
        </td>
      </tr>

      {saveState && (saveState.status === "ok" || saveState.status === "error") && saveState.msg && (
        <tr style={{ background: saveState.status === "error" ? "rgba(220,38,38,0.06)" : "rgba(16,185,129,0.06)" }}>
          <td />
          <td colSpan={6} className={`px-4 pb-2 text-xs ${saveState.status === "error" ? "text-red-600" : "text-emerald-700"}`}>{saveState.msg}</td>
        </tr>
      )}

      {isOpen && (
        <tr>
          <td />
          <td colSpan={6} className="px-2 pb-4">
            <div className="rounded-lg border-2 p-4 space-y-4" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.5)" }}>
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
              <div className="flex flex-wrap items-end gap-3 pt-2 border-t" style={{ borderColor: "#eaddcb" }}>
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border-2 cursor-pointer text-red-600"
                  style={{ borderColor: "#dc2626" }}
                >
                  <Trash2 className="w-4 h-4" /> {t("delete" as keyof Dictionary) || "Elimina"}
                </button>
              </div>

              {/* Audited stock actions + recent movement history. */}
              <InventoryMovements ingredientId={r.id} unit={r.unit} currentUnitCost={Number(r.current_unit_cost)} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function NewIngredientForm({ onCreate, onCancel, t }: { onCreate: (name: string, unit: string) => void; onCancel: () => void; t: (k: keyof Dictionary) => string }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const inputCls = "px-3 py-2 text-sm border-2 rounded-lg text-black";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  return (
    <div className="rounded-lg border-2 p-4 flex flex-wrap items-end gap-3" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_col_name" as keyof Dictionary) || "Ingrediente"}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onCreate(name, unit); }} className={inputCls} style={inputStyle} placeholder={t("inventory_new_name_ph" as keyof Dictionary) || "Es. Farina 00"} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-black">{t("inventory_unit" as keyof Dictionary) || "Unità (kg, l, pz)"}</span>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls + " w-28"} style={inputStyle} />
      </label>
      <button onClick={() => onCreate(name, unit)} disabled={!name.trim()} className="px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
        {t("save" as keyof Dictionary) || "Salva"}
      </button>
      <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border-2 cursor-pointer text-black" style={{ borderColor: "#c4956a" }}>
        {t("cancel" as keyof Dictionary) || "Annulla"}
      </button>
    </div>
  );
}
