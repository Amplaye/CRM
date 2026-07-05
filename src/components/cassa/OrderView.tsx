"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Minus,
  X,
  Search,
  Send,
  Printer,
  Percent,
  StickyNote,
  ArrowRightLeft,
  Trash2,
  PencilLine,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { MenuCategory, MenuItem, MenuItemVariant } from "@/lib/types";
import { computeTotals, fmtEur, isActiveLine, toCents, fromCents } from "@/lib/cassa/totals";
import type { CassaDraftLine, CassaOrderFull, CassaOrderItemRow } from "@/lib/cassa/types";
import type { CassaTable } from "./SalaView";

// The comanda composer: ticket on the left (sent lines + new drafts + totals),
// menu on the right (course selector, category chips, searchable dish grid).
// Everything is sized for fingers on a tablet at a busy pass.

interface OrderViewProps {
  order: CassaOrderFull;
  drafts: CassaDraftLine[];
  categories: MenuCategory[];
  items: MenuItem[];
  freeTables: CassaTable[];
  busy: boolean;
  onBack: () => void;
  onAddItem: (item: MenuItem, course: number, variants?: MenuItemVariant[]) => void;
  onAddFree: (name: string, price: number, course: number) => void;
  onDraftQty: (key: string, delta: number) => void;
  onDraftCourse: (key: string) => void;
  onDraftNotes: (key: string, notes: string | null) => void;
  onRemoveDraft: (key: string) => void;
  onSendComanda: () => void;
  onPrintComanda: () => void;
  onStorno: (item: CassaOrderItemRow) => void;
  onSetCovers: (covers: number) => void;
  onSetDiscount: (type: "percent" | "amount" | null, value: number) => void;
  onPreconto: () => void;
  onCharge: () => void;
  onMoveTable: (table: CassaTable) => void;
  onCancelOrder: () => void;
}

export function OrderView({
  order,
  drafts,
  categories,
  items,
  freeTables,
  busy,
  onBack,
  onAddItem,
  onAddFree,
  onDraftQty,
  onDraftCourse,
  onDraftNotes,
  onRemoveDraft,
  onSendComanda,
  onPrintComanda,
  onStorno,
  onSetCovers,
  onSetDiscount,
  onPreconto,
  onCharge,
  onMoveTable,
  onCancelOrder,
}: OrderViewProps) {
  const { t } = useLanguage();
  const [course, setCourse] = useState(1);
  const [search, setSearch] = useState("");
  const [catId, setCatId] = useState<string | "all">("all");
  const [showDiscount, setShowDiscount] = useState(false);
  const [showFree, setShowFree] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [discType, setDiscType] = useState<"percent" | "amount">("percent");
  const [discValue, setDiscValue] = useState("");
  const [freeName, setFreeName] = useState("");
  const [freePrice, setFreePrice] = useState("");
  // Variant picker: the tapped menu item (when it has variants) + toggled indexes.
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [variantSel, setVariantSel] = useState<Set<number>>(new Set());

  const sentItems = order.items.filter((i) => i.status !== "cancelled");
  const totals = useMemo(
    () => computeTotals(order, [...order.items, ...drafts]),
    [order, drafts],
  );

  const sellable = useMemo(
    () => items.filter((i) => i.available && i.price != null),
    [items],
  );
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return sellable.filter((i) => i.name.toLowerCase().includes(q));
    if (catId === "all") return sellable;
    return sellable.filter((i) => i.category_id === catId);
  }, [sellable, search, catId]);

  const hasActive = order.items.some(isActiveLine) || drafts.length > 0;

  const lineRow = (
    label: string,
    qty: number,
    price: number,
    opts: {
      notes?: string | null;
      course: number;
      variants?: MenuItemVariant[] | null;
      draft?: CassaDraftLine;
      sent?: CassaOrderItemRow;
    },
  ) => (
    <div
      key={opts.draft?.key || opts.sent?.id}
      className={`rounded-lg border px-2.5 py-2 ${opts.draft ? "border-dashed" : ""}`}
      style={{ borderColor: "#c4956a", background: opts.draft ? "rgba(196,149,106,0.12)" : "rgba(255,255,255,0.55)" }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => (opts.draft ? onDraftCourse(opts.draft.key) : undefined)}
          className={`shrink-0 w-7 h-7 rounded-md border text-[11px] font-bold text-black ${opts.draft ? "cursor-pointer hover:bg-[#c4956a]/15" : "opacity-70"}`}
          style={{ borderColor: "#c4956a" }}
          title={t("cassa_course")}
        >
          {opts.course}ª
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-black truncate">{label}</p>
          {(opts.variants || []).map((v, i) => (
            <p key={i} className="text-xs text-black truncate">
              + {v.name}
              {v.price_delta ? ` (${v.price_delta > 0 ? "+" : ""}${fmtEur(v.price_delta)})` : ""}
            </p>
          ))}
          {opts.notes ? <p className="text-xs italic text-black truncate">» {opts.notes}</p> : null}
        </div>
        <span className="text-sm font-bold text-black whitespace-nowrap">{fmtEur(qty * price)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {opts.draft ? (
          <>
            <button
              onClick={() => onDraftQty(opts.draft!.key, -1)}
              className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer hover:bg-[#c4956a]/10"
              style={{ borderColor: "#c4956a" }}
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-black">{qty}</span>
            <button
              onClick={() => onDraftQty(opts.draft!.key, +1)}
              className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer hover:bg-[#c4956a]/10"
              style={{ borderColor: "#c4956a" }}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setNoteKey(opts.draft!.key);
                setNoteText(opts.draft!.notes || "");
              }}
              className="ml-1 w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer hover:bg-[#c4956a]/10"
              style={{ borderColor: "#c4956a" }}
              title={t("cassa_line_note")}
            >
              <PencilLine className="w-4 h-4" />
            </button>
            <span className="flex-1" />
            <button
              onClick={() => onRemoveDraft(opts.draft!.key)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 cursor-pointer hover:bg-red-600/10"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-black">
              {qty}× · {fmtEur(price)} · ✓ {t("cassa_sent")} ({opts.sent!.comanda_no}ª)
            </span>
            <span className="flex-1" />
            <button
              onClick={() => {
                if (window.confirm(`${t("cassa_storno_confirm")} — ${label}?`)) onStorno(opts.sent!);
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 cursor-pointer hover:bg-red-600/10"
              title={t("cassa_storno")}
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">
      {/* ---------------- ticket ---------------- */}
      <div
        className="w-full lg:w-[380px] shrink-0 flex flex-col rounded-xl border-2 min-h-0 max-h-[70vh] lg:max-h-none"
        style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.75)" }}
      >
        <div className="px-3 py-2.5 border-b-2 flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-[#c4956a]/10 cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-black" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-black truncate">{order.table_name}</p>
            <p className="text-[11px] text-black">
              {new Date(order.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {order.opened_by_name ? ` · ${order.opened_by_name}` : ""}
            </p>
          </div>
          {/* covers stepper */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSetCovers(Math.max(0, order.covers - 1))}
              className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer hover:bg-[#c4956a]/10"
              style={{ borderColor: "#c4956a" }}
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-10 text-center text-sm font-bold text-black">{order.covers}👤</span>
            <button
              onClick={() => onSetCovers(order.covers + 1)}
              className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer hover:bg-[#c4956a]/10"
              style={{ borderColor: "#c4956a" }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {sentItems.length === 0 && drafts.length === 0 && (
            <p className="text-center text-sm text-black py-8">{t("cassa_empty_order_hint")}</p>
          )}
          {sentItems.map((i) =>
            lineRow(i.name, i.qty, i.unit_price, { notes: i.notes, course: i.course, variants: i.variants, sent: i }),
          )}
          {drafts.map((d) =>
            lineRow(d.name, d.qty, d.unit_price, { notes: d.notes, course: d.course, variants: d.variants, draft: d }),
          )}
        </div>

        {/* totals */}
        <div className="px-3 py-2 border-t-2 space-y-0.5" style={{ borderColor: "#c4956a" }}>
          <div className="flex justify-between text-sm text-black">
            <span>{t("cassa_subtotal")}</span>
            <span>{fmtEur(totals.subtotal)}</span>
          </div>
          {totals.coverTotal > 0 && (
            <div className="flex justify-between text-sm text-black">
              <span>
                {t("cassa_cover_charge")} ({order.covers} × {fmtEur(order.cover_unit)})
              </span>
              <span>{fmtEur(totals.coverTotal)}</span>
            </div>
          )}
          <button onClick={() => setShowDiscount(true)} className="w-full flex justify-between text-sm text-black cursor-pointer hover:bg-[#c4956a]/10 rounded px-0.5">
            <span className="inline-flex items-center gap-1">
              <Percent className="w-3.5 h-3.5" /> {t("cassa_discount")}
              {order.discount_type ? (order.discount_type === "percent" ? ` ${order.discount_value}%` : "") : ""}
            </span>
            <span>{totals.discountAmount > 0 ? `-${fmtEur(totals.discountAmount)}` : "—"}</span>
          </button>
          <div className="flex justify-between text-lg font-bold text-black pt-1">
            <span>{t("cassa_total").toUpperCase()}</span>
            <span>{fmtEur(totals.total)}</span>
          </div>
        </div>

        {/* actions */}
        <div className="p-2.5 border-t-2 space-y-2" style={{ borderColor: "#c4956a" }}>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onSendComanda}
              disabled={busy || drafts.length === 0}
              className="h-11 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Send className="w-4 h-4" /> {t("cassa_send_order")}
            </button>
            <button
              onClick={onCharge}
              disabled={busy || !hasActive}
              className="h-11 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer"
              style={{ background: "linear-gradient(135deg, #8fa573, #768a61)" }}
            >
              {t("cassa_charge")} · {fmtEur(totals.total)}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onPrintComanda}
              disabled={sentItems.length === 0}
              className="h-9 px-2.5 rounded-lg border-2 text-xs font-bold text-black hover:bg-[#c4956a]/10 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
              style={{ borderColor: "#c4956a" }}
            >
              <Printer className="w-3.5 h-3.5" /> {t("cassa_comanda")}
            </button>
            <button
              onClick={onPreconto}
              disabled={!hasActive}
              className="h-9 px-2.5 rounded-lg border-2 text-xs font-bold text-black hover:bg-[#c4956a]/10 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
              style={{ borderColor: "#c4956a" }}
            >
              <Printer className="w-3.5 h-3.5" /> {t("cassa_preconto")}
            </button>
            {order.table_id !== null || freeTables.length > 0 ? (
              <button
                onClick={() => setShowMove(true)}
                className="h-9 px-2.5 rounded-lg border-2 text-xs font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer inline-flex items-center gap-1.5"
                style={{ borderColor: "#c4956a" }}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" /> {t("cassa_move_table")}
              </button>
            ) : null}
            <span className="flex-1" />
            <button
              onClick={() => {
                if (window.confirm(t("cassa_cancel_order_confirm"))) onCancelOrder();
              }}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-red-600 hover:bg-red-600/10 cursor-pointer"
              title={t("cassa_cancel_order")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- menu picker ---------------- */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-black absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cassa_search_items")}
              className="w-full h-11 pl-9 pr-3 rounded-xl border-2 text-sm text-black bg-white/70"
              style={{ borderColor: "#c4956a" }}
            />
          </div>
          {/* course selector for NEW lines */}
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((c) => (
              <button
                key={c}
                onClick={() => setCourse(c)}
                className={`h-11 min-w-11 px-2 rounded-xl border-2 text-sm font-bold cursor-pointer ${course === c ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                style={course === c ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                title={`${t("cassa_course")} ${c}`}
              >
                {c}ª
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 pb-2">
          <button
            onClick={() => setCatId("all")}
            className={`shrink-0 h-9 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer ${catId === "all" && !search ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
            style={catId === "all" && !search ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
          >
            {t("cassa_all_categories")}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCatId(c.id);
                setSearch("");
              }}
              className={`shrink-0 h-9 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer ${catId === c.id && !search ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
              style={catId === c.id && !search ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleItems.length === 0 ? (
            <p className="text-center text-sm text-black py-10">{t("cassa_no_items")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 pb-3">
              {visibleItems.map((it) => (
                <button
                  key={it.id}
                  onClick={() => {
                    if (it.variants && it.variants.length > 0) {
                      setVariantSel(new Set());
                      setVariantItem(it);
                    } else {
                      onAddItem(it, course);
                    }
                  }}
                  className="h-20 rounded-xl border-2 p-2.5 text-left cursor-pointer transition-transform active:scale-95 hover:bg-[#c4956a]/10 flex flex-col justify-between"
                  style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.6)" }}
                >
                  <span className="text-sm font-bold text-black leading-tight line-clamp-2">{it.name}</span>
                  <span className="text-sm font-bold text-black inline-flex items-center justify-between w-full">
                    {fmtEur(it.price ?? 0)}
                    {it.variants && it.variants.length > 0 ? (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                        style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.12)" }}
                      >
                        {it.variants.length}▾
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setShowFree(true)}
          className="self-start mt-1 h-9 px-3 rounded-lg border-2 text-xs font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer inline-flex items-center gap-1.5"
          style={{ borderColor: "#c4956a" }}
        >
          <Plus className="w-3.5 h-3.5" /> {t("cassa_free_item")}
        </button>
      </div>

      {/* ---------------- modals ---------------- */}
      {showDiscount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowDiscount(false)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black">{t("cassa_discount")}</h3>
            <div className="grid grid-cols-2 gap-2">
              {(["percent", "amount"] as const).map((ty) => (
                <button
                  key={ty}
                  onClick={() => setDiscType(ty)}
                  className={`h-10 rounded-lg border-2 text-sm font-bold cursor-pointer ${discType === ty ? "text-white" : "text-black"}`}
                  style={discType === ty ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                >
                  {ty === "percent" ? "%" : "€"}
                </button>
              ))}
            </div>
            <input
              inputMode="decimal"
              autoFocus
              value={discValue}
              onChange={(e) => setDiscValue(e.target.value)}
              placeholder={discType === "percent" ? "10" : "5.00"}
              className="w-full px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
              style={{ borderColor: "#c4956a" }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onSetDiscount(null, 0);
                  setShowDiscount(false);
                  setDiscValue("");
                }}
                className="flex-1 h-10 rounded-lg border-2 text-sm font-bold text-black cursor-pointer hover:bg-[#c4956a]/10"
                style={{ borderColor: "#c4956a" }}
              >
                {t("cassa_remove")}
              </button>
              <button
                onClick={() => {
                  const v = Number(discValue.replace(",", "."));
                  if (Number.isFinite(v) && v > 0) {
                    onSetDiscount(discType, v);
                    setShowDiscount(false);
                  }
                }}
                className="flex-1 h-10 rounded-lg text-sm font-bold text-white cursor-pointer"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showFree && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowFree(false)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black">{t("cassa_free_item")}</h3>
            <input
              autoFocus
              value={freeName}
              onChange={(e) => setFreeName(e.target.value)}
              placeholder={t("cassa_free_item_name")}
              className="w-full px-3 py-2.5 text-sm text-black border-2 rounded-lg bg-white"
              style={{ borderColor: "#c4956a" }}
            />
            <input
              inputMode="decimal"
              value={freePrice}
              onChange={(e) => setFreePrice(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
              style={{ borderColor: "#c4956a" }}
            />
            <button
              onClick={() => {
                const p = Number(freePrice.replace(",", "."));
                if (freeName.trim() && Number.isFinite(p) && p >= 0) {
                  onAddFree(freeName.trim(), p, course);
                  setShowFree(false);
                  setFreeName("");
                  setFreePrice("");
                }
              }}
              className="w-full h-10 rounded-lg text-sm font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {t("cassa_add")}
            </button>
          </div>
        </div>
      )}

      {showMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowMove(false)}>
          <div className="w-full max-w-sm rounded-2xl border-2 p-4 space-y-3 max-h-[70vh] overflow-y-auto" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black">{t("cassa_move_table")}</h3>
            {freeTables.length === 0 ? (
              <p className="text-sm text-black">{t("cassa_no_free_tables")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {freeTables.map((tb) => (
                  <button
                    key={tb.id}
                    onClick={() => {
                      onMoveTable(tb);
                      setShowMove(false);
                    }}
                    className="h-14 rounded-xl border-2 text-sm font-bold text-black cursor-pointer hover:bg-[#c4956a]/10"
                    style={{ borderColor: "#c4956a" }}
                  >
                    {tb.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {variantItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setVariantItem(null)}>
          <div
            className="w-full max-w-sm rounded-2xl border-2 p-4 space-y-3 max-h-[70vh] overflow-y-auto"
            style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-black">{variantItem.name}</h3>
            <p className="text-xs text-black">{t("cassa_choose_variants")}</p>
            <div className="space-y-1.5">
              {(variantItem.variants || []).map((v, idx) => {
                const active = variantSel.has(idx);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      const next = new Set(variantSel);
                      if (active) next.delete(idx);
                      else next.add(idx);
                      setVariantSel(next);
                    }}
                    className={`w-full h-11 px-3 rounded-lg border-2 text-sm font-bold cursor-pointer flex items-center justify-between ${active ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                    style={active ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                  >
                    <span className="truncate">{v.name}</span>
                    <span className="whitespace-nowrap">
                      {v.price_delta ? `${v.price_delta > 0 ? "+" : ""}${fmtEur(v.price_delta)}` : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-sm font-bold text-black">
              <span>{t("cassa_total")}</span>
              <span>
                {fmtEur(
                  fromCents(
                    toCents(variantItem.price ?? 0) +
                      (variantItem.variants || []).reduce(
                        (s, v, idx) => (variantSel.has(idx) ? s + toCents(v.price_delta) : s),
                        0,
                      ),
                  ),
                )}
              </span>
            </div>
            <button
              onClick={() => {
                onAddItem(
                  variantItem,
                  course,
                  (variantItem.variants || []).filter((_, idx) => variantSel.has(idx)),
                );
                setVariantItem(null);
              }}
              className="w-full h-10 rounded-lg text-sm font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {t("cassa_add")}
            </button>
          </div>
        </div>
      )}

      {noteKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setNoteKey(null)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black inline-flex items-center gap-2">
              <StickyNote className="w-4 h-4" /> {t("cassa_line_note")}
            </h3>
            <input
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("cassa_line_note_placeholder")}
              className="w-full px-3 py-2.5 text-sm text-black border-2 rounded-lg bg-white"
              style={{ borderColor: "#c4956a" }}
            />
            <button
              onClick={() => {
                onDraftNotes(noteKey, noteText.trim() || null);
                setNoteKey(null);
              }}
              className="w-full h-10 rounded-lg text-sm font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
