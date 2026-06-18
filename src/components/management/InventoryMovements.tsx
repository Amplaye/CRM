"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackagePlus, ClipboardCheck, Trash, History, TrendingUp, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { costTrend } from "@/lib/management/costing";

// Audited stock actions for one ingredient, shown in the inventory row editor:
// goods receipt (+qty, optional price), physical count (counted absolute → the
// server records the delta vs system), and waste (−qty). Each posts a movement to
// /api/inventory/movement; the trigger keeps stock_qty in sync and the page's
// realtime subscription on `ingredients` refreshes the headline number. A short
// recent-movements list gives the audit trail the inventory never had.

interface Movement {
  id: string;
  qty_delta: number;
  kind: string;
  reason: string | null;
  created_at: string;
}

type Action = "receipt" | "count" | "waste" | null;

export function InventoryMovements({
  ingredientId,
  unit,
  currentUnitCost,
}: {
  ingredientId: string;
  unit: string;
  currentUnitCost: number;
}) {
  const { t } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const [action, setAction] = useState<Action>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Movement[]>([]);
  const [prices, setPrices] = useState<Array<{ observedOn: string; unitCost: number }>>([]);

  const loadHistory = useCallback(async () => {
    const [{ data: mv }, { data: ph }] = await Promise.all([
      supabase
        .from("stock_movements")
        .select("id, qty_delta, kind, reason, created_at")
        .eq("ingredient_id", ingredientId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("ingredient_cost_history")
        .select("unit_cost, observed_on")
        .eq("ingredient_id", ingredientId)
        .order("observed_on", { ascending: false })
        .limit(12),
    ]);
    setHistory((mv || []) as Movement[]);
    setPrices((ph || []).map((p: any) => ({ observedOn: p.observed_on, unitCost: Number(p.unit_cost) })));
  }, [supabase, ingredientId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const trend = costTrend(prices);

  const submit = async () => {
    const n = Number(qty.replace(",", "."));
    if (!action || !Number.isFinite(n)) return;
    setBusy(true);
    setErr(null);
    try {
      const c = cost.trim() === "" ? undefined : Number(cost.replace(",", "."));
      const res = await fetch("/api/inventory/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredient_id: ingredientId, kind: action, qty: n, unit_cost: c }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "save failed");
      setQty("");
      setCost("");
      setAction(null);
      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "Errore");
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = (k: string) =>
    ({
      sale: t("inv_mv_sale" as keyof Dictionary) || "Vendita",
      receipt: t("inv_mv_receipt" as keyof Dictionary) || "Carico",
      count: t("inv_mv_count" as keyof Dictionary) || "Conta",
      waste: t("inv_mv_waste" as keyof Dictionary) || "Scarto",
      adjustment: t("inv_mv_adjustment" as keyof Dictionary) || "Rettifica",
    }[k] || k);

  const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border-2 cursor-pointer text-black";
  const inputCls = "w-24 px-2 py-1 text-sm border-2 rounded text-black";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="pt-3 border-t" style={{ borderColor: "#eaddcb" }}>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setAction(action === "receipt" ? null : "receipt")} className={btn} style={{ borderColor: "#059669", color: "#047857" }}>
          <PackagePlus className="w-4 h-4" /> {t("inv_mv_receipt" as keyof Dictionary) || "Carico merce"}
        </button>
        <button onClick={() => setAction(action === "count" ? null : "count")} className={btn} style={{ borderColor: "#c4956a", color: "#8b6540" }}>
          <ClipboardCheck className="w-4 h-4" /> {t("inv_mv_count_action" as keyof Dictionary) || "Conta fisica"}
        </button>
        <button onClick={() => setAction(action === "waste" ? null : "waste")} className={btn} style={{ borderColor: "#dc2626", color: "#dc2626" }}>
          <Trash className="w-4 h-4" /> {t("inv_mv_waste" as keyof Dictionary) || "Scarto"}
        </button>
      </div>

      {action && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-black">
              {action === "count"
                ? (t("inv_mv_counted_qty" as keyof Dictionary) || "Quantità contata") + ` (${unit})`
                : (t("inv_mv_qty" as keyof Dictionary) || "Quantità") + ` (${unit})`}
            </span>
            <input autoFocus type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} style={inputStyle} />
          </label>
          {action === "receipt" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">{t("inv_mv_unit_cost" as keyof Dictionary) || "Costo unitario € (opz.)"}</span>
              <input type="number" step="0.0001" placeholder={String(currentUnitCost)} value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} style={inputStyle} />
            </label>
          )}
          <button onClick={submit} disabled={busy || qty.trim() === ""} className="px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
            {t("save" as keyof Dictionary) || "Salva"}
          </button>
          {action === "count" && (
            <span className="text-xs text-black self-center">{t("inv_mv_count_help" as keyof Dictionary) || "Registra la differenza tra contato e sistema."}</span>
          )}
        </div>
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}

      {trend.changePct != null && (
        <div className="mt-3 flex items-center gap-2 text-xs text-black">
          <span className="font-bold flex items-center gap-1">
            {trend.changePct > 0 ? <TrendingUp className="w-3.5 h-3.5 text-red-600" /> : <TrendingDown className="w-3.5 h-3.5 text-emerald-600" />}
            {t("inv_price_trend" as keyof Dictionary) || "Andamento costo"}
          </span>
          <span>€ {trend.first?.toFixed(4)} → € {trend.last?.toFixed(4)}</span>
          <span className={`font-bold ${trend.changePct > 0 ? "text-red-600" : "text-emerald-700"}`}>
            ({trend.changePct > 0 ? "+" : ""}{trend.changePct.toFixed(1)}%)
          </span>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-bold text-black flex items-center gap-1.5 mb-1.5"><History className="w-3.5 h-3.5" /> {t("inv_mv_history" as keyof Dictionary) || "Ultimi movimenti"}</div>
          <ul className="space-y-1">
            {history.map((m) => (
              <li key={m.id} className="text-xs text-black flex items-center justify-between gap-2">
                <span>{m.created_at.slice(0, 10)} · {kindLabel(m.kind)}</span>
                <span className={`tabular-nums font-medium ${Number(m.qty_delta) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {Number(m.qty_delta) > 0 ? "+" : ""}{Number(m.qty_delta).toFixed(2)} {unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
