"use client";

import { useEffect, useMemo, useState } from "react";
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
  Users,
  ShoppingCart,
  ChevronDown,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { MenuCategory, MenuItem, MenuItemVariant } from "@/lib/types";
import { computeTotals, fmtEur, isActiveLine, toCents, fromCents } from "@/lib/cassa/totals";
import type { CassaDraftLine, CassaOrderFull, CassaOrderItemRow } from "@/lib/cassa/types";
import type { CassaTable } from "./SalaView";

// The comanda composer. Two layouts share the same render fragments:
//   • Desktop (lg+): ticket panel on the left, menu picker on the right.
//   • Mobile: the menu fills the screen (one scroll region → reliable taps on
//     iOS), a sticky cart bar sits at the bottom, and the ticket opens as a
//     slide-up bottom sheet. Only ever ONE scroller live at a time — competing
//     nested scrollers were what made dish taps miss on touch devices.
// Everything is sized for fingers on a tablet/phone at a busy pass.

// One color per course so "which portata is this line?" reads at a glance:
// 1ª bronze (brand), 2ª olive, 3ª terracotta.
const COURSE_COLORS: Record<number, string> = { 1: "#c4956a", 2: "#768a61", 3: "#b3654a" };
const courseColor = (c: number) => COURSE_COLORS[c] || "#c4956a";

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
  /** Set the per-order coperto (cover price). Defaults to `coverCharge` if unset. */
  onSetCover: (coverUnit: number) => void;
  /** Live tenant coperto from settings — used to pre-fill a bill that has none. */
  coverCharge: number;
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
  onSetCover,
  coverCharge,
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
  const [showCovers, setShowCovers] = useState(false);
  const [coversDraft, setCoversDraft] = useState(0);
  // Per-order coperto, editable from the covers modal. Seeds from the order's
  // own snapshot, falling back to the live tenant setting when the bill has none.
  const [coverStr, setCoverStr] = useState("");
  // Mobile: is the ticket bottom-sheet open? `closing` drives the slide-out.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);

  const sentItems = order.items.filter((i) => i.status !== "cancelled");
  const totals = useMemo(
    () => computeTotals(order, [...order.items, ...drafts]),
    [order, drafts],
  );

  // Show every available dish, even one with no price set yet: the menu editor
  // allows null prices, and hiding those made them "disappear" from the till
  // while still showing in the Menu page. A null-price dish adds at €0 (addItem
  // already coalesces price ?? 0) — the cashier can adjust or it's a variable
  // "market price" item — which is far better than it silently going missing.
  const sellable = useMemo(
    () => items.filter((i) => i.available),
    [items],
  );
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return sellable.filter((i) => i.name.toLowerCase().includes(q));
    if (catId === "all") return sellable;
    return sellable.filter((i) => i.category_id === catId);
  }, [sellable, search, catId]);

  const hasActive = order.items.some(isActiveLine) || drafts.length > 0;
  const lineCount = sentItems.length + drafts.length;

  const closeSheet = () => {
    setSheetClosing(true);
    setTimeout(() => {
      setSheetOpen(false);
      setSheetClosing(false);
    }, 260);
  };

  // When the sheet is open the page underneath must not scroll (iOS bleed).
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  // ---------------------------------------------------------------- line row
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
          className={`shrink-0 h-8 px-2 rounded-md border-2 text-[11px] font-bold text-white ${opts.draft ? "cursor-pointer" : "opacity-80"}`}
          style={{ background: courseColor(opts.course), borderColor: courseColor(opts.course) }}
          title={`${t("cassa_course")} ${opts.course}${opts.draft ? " — tap ↻" : ""}`}
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
              className="w-11 h-11 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
              style={{ borderColor: "#c4956a" }}
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-black">{qty}</span>
            <button
              onClick={() => onDraftQty(opts.draft!.key, +1)}
              className="w-11 h-11 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
              style={{ borderColor: "#c4956a" }}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setNoteKey(opts.draft!.key);
                setNoteText(opts.draft!.notes || "");
              }}
              className="ml-1 w-11 h-11 rounded-lg border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
              style={{ borderColor: "#c4956a" }}
              title={t("cassa_line_note")}
            >
              <PencilLine className="w-4 h-4" />
            </button>
            <span className="flex-1" />
            <button
              onClick={() => onRemoveDraft(opts.draft!.key)}
              className="w-11 h-11 rounded-lg flex items-center justify-center text-red-600 cursor-pointer active:bg-red-600/20"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-black">
              {qty}× · {fmtEur(price)} · ✓ {t("cassa_comanda")} #{opts.sent!.comanda_no}
            </span>
            <span className="flex-1" />
            <button
              onClick={() => {
                if (window.confirm(`${t("cassa_storno_confirm")} — ${label}?`)) onStorno(opts.sent!);
              }}
              className="w-11 h-11 rounded-lg flex items-center justify-center text-red-600 cursor-pointer active:bg-red-600/20"
              title={t("cassa_storno")}
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ------------------------------------------------------------- ticket header
  const ticketHeader = (onClose: () => void, closeIcon: "back" | "down") => (
    <div className="px-3 py-2.5 border-b-2 flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
      <button onClick={onClose} className="p-1.5 rounded-lg active:bg-[#c4956a]/20 cursor-pointer">
        {closeIcon === "back" ? (
          <ArrowLeft className="w-5 h-5 text-black" />
        ) : (
          <ChevronDown className="w-5 h-5 text-black" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-black truncate">{order.table_name}</p>
        <p className="text-[11px] text-black">
          {new Date(order.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {order.opened_by_name ? ` · ${order.opened_by_name}` : ""}
        </p>
      </div>
      {/* covers: one labeled button → picker modal (was a cryptic bare stepper) */}
      <button
        onClick={() => {
          setCoversDraft(order.covers);
          const cu = order.cover_unit > 0 ? order.cover_unit : coverCharge;
          setCoverStr(cu > 0 ? String(cu) : "");
          setShowCovers(true);
        }}
        className="h-10 px-3 rounded-xl border-2 inline-flex items-center gap-1.5 text-black cursor-pointer active:bg-[#c4956a]/20"
        style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.6)" }}
        title={t("cassa_covers_hint")}
      >
        <Users className="w-4 h-4" />
        <span className="text-base font-bold">{order.covers}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide hidden sm:inline">
          {t("cassa_covers")}
        </span>
      </button>
    </div>
  );

  // -------------------------------------------------------------- ticket lines
  const ticketLines = (
    <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-1.5">
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
  );

  // ------------------------------------------------------------- ticket totals
  const ticketTotals = (
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
      <button onClick={() => setShowDiscount(true)} className="w-full flex justify-between text-sm text-black cursor-pointer active:bg-[#c4956a]/20 rounded px-0.5">
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
  );

  // ------------------------------------------------------------ ticket actions
  const ticketActions = (
    <div className="p-2.5 border-t-2 space-y-2" style={{ borderColor: "#c4956a" }}>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onSendComanda}
          disabled={busy || drafts.length === 0}
          className="h-12 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
        >
          <Send className="w-4 h-4" /> {t("cassa_send_order")}
        </button>
        <button
          onClick={onCharge}
          disabled={busy || !hasActive}
          className="h-12 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer"
          style={{ background: "linear-gradient(135deg, #8fa573, #768a61)" }}
        >
          {t("cassa_charge")} · {fmtEur(totals.total)}
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {/* re-print the LAST sent comanda — icon only, so it no longer reads as a
            second "Comanda" button next to Send. */}
        <button
          onClick={onPrintComanda}
          disabled={sentItems.length === 0}
          className="h-11 w-11 rounded-lg border-2 text-black active:bg-[#c4956a]/20 disabled:opacity-40 cursor-pointer inline-flex items-center justify-center"
          style={{ borderColor: "#c4956a" }}
          title={t("cassa_reprint_comanda")}
        >
          <Printer className="w-4 h-4" />
        </button>
        <button
          onClick={onPreconto}
          disabled={!hasActive}
          className="h-11 px-3 rounded-lg border-2 text-xs font-bold text-black active:bg-[#c4956a]/20 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
          style={{ borderColor: "#c4956a" }}
        >
          <Printer className="w-3.5 h-3.5" /> {t("cassa_preconto")}
        </button>
        {order.table_id !== null || freeTables.length > 0 ? (
          <button
            onClick={() => setShowMove(true)}
            className="h-11 px-3 rounded-lg border-2 text-xs font-bold text-black active:bg-[#c4956a]/20 cursor-pointer inline-flex items-center gap-1.5"
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
          className="h-11 w-11 rounded-lg flex items-center justify-center text-red-600 active:bg-red-600/20 cursor-pointer"
          title={t("cassa_cancel_order")}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- dish grid
  // course selector for NEW lines: joined segments, number + word, color-coded.
  // On mobile it sits on its OWN row (full width) so the three segments never
  // overflow next to the search field — that clipping was the "3ª cut off" bug.
  const courseSelector = (
    <div
      className="flex rounded-xl border-2 overflow-hidden shrink-0"
      style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.7)" }}
      title={t("cassa_course_hint")}
    >
      {[1, 2, 3].map((c) => (
        <button
          key={c}
          onClick={() => setCourse(c)}
          className={`h-11 flex-1 lg:flex-none lg:w-16 flex flex-col items-center justify-center cursor-pointer ${c > 1 ? "border-l-2" : ""} ${course === c ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
          style={{
            borderColor: "#c4956a",
            ...(course === c ? { background: courseColor(c) } : {}),
          }}
        >
          <span className="text-sm font-bold leading-none">{c}ª</span>
          <span className={`text-[9px] font-bold uppercase tracking-wide leading-none mt-1 ${course === c ? "opacity-90" : "opacity-60"}`}>
            {t("cassa_course")}
          </span>
        </button>
      ))}
    </div>
  );

  const menuPicker = (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-black absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("cassa_search_items")}
            className="w-full h-11 pl-9 pr-3 rounded-xl border-2 text-base text-black bg-white/70"
            style={{ borderColor: "#c4956a" }}
          />
        </div>
        {courseSelector}
      </div>

      <div className="flex gap-1.5 pb-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setCatId("all")}
          className={`shrink-0 h-10 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer ${catId === "all" && !search ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
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
            className={`shrink-0 h-10 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer ${catId === c.id && !search ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
            style={catId === c.id && !search ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {visibleItems.length === 0 ? (
          <p className="text-center text-sm text-black py-10">{t("cassa_no_items")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 pb-3">
            {visibleItems.map((it) => {
              const hasVariants = !!(it.variants && it.variants.length > 0);
              return (
                <button
                  key={it.id}
                  onClick={() => {
                    if (hasVariants) {
                      setVariantSel(new Set());
                      setVariantItem(it);
                    } else {
                      onAddItem(it, course);
                    }
                  }}
                  className="relative h-24 rounded-2xl border-2 p-3 text-left cursor-pointer transition-transform active:scale-95 flex flex-col justify-between shadow-sm"
                  style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.72)" }}
                >
                  <span className="text-[15px] font-bold text-black leading-tight line-clamp-2">{it.name}</span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="text-base font-bold" style={{ color: "#a9713f" }}>
                      {fmtEur(it.price ?? 0)}
                    </span>
                    {hasVariants ? (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border"
                        style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.14)", color: "#a9713f" }}
                      >
                        {it.variants!.length}▾
                      </span>
                    ) : (
                      // an explicit + affordance so it's obvious the card adds a dish
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0"
                        style={{ background: "#c4956a" }}
                      >
                        <Plus className="w-4 h-4" />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => setShowFree(true)}
        className="self-start mt-1 h-10 px-3 rounded-lg border-2 text-xs font-bold text-black active:bg-[#c4956a]/20 cursor-pointer inline-flex items-center gap-1.5"
        style={{ borderColor: "#c4956a" }}
      >
        <Plus className="w-3.5 h-3.5" /> {t("cassa_free_item")}
      </button>
    </div>
  );

  return (
    <div className="h-full min-h-0 flex flex-col lg:flex-row lg:gap-4">
      {/* ============ DESKTOP: ticket panel (left) ============ */}
      <div
        className="hidden lg:flex w-[380px] shrink-0 flex-col rounded-xl border-2 min-h-0"
        style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.75)" }}
      >
        {ticketHeader(onBack, "back")}
        {ticketLines}
        {ticketTotals}
        {ticketActions}
      </div>

      {/* ============ MENU PICKER (both layouts) ============ */}
      {/* On mobile it fills the screen and leaves room for the cart bar; the
          menu grid is the ONLY scroller, which is what fixes iOS dish taps. */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Mobile-only header: back to sala + table name */}
        <div className="lg:hidden flex items-center gap-2 mb-2">
          <button onClick={onBack} className="p-1.5 rounded-lg active:bg-[#c4956a]/20 cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-black" />
          </button>
          <p className="font-bold text-black truncate flex-1">{order.table_name}</p>
        </div>
        {menuPicker}
        {/* spacer so the sticky cart bar never covers the "Voce libera" button */}
        <div className="lg:hidden h-16 shrink-0" />
      </div>

      {/* ============ MOBILE: sticky cart bar ============ */}
      {/* Reserves right padding (pr-[4.75rem]) so its content — "Vedi comanda" —
          never slides under the floating assistant bubble that sits bottom-right;
          the bubble keeps its own z-40 layer and stays tappable over the padded
          gap. */}
      <button
        onClick={() => setSheetOpen(true)}
        className="lg:hidden cart-bar fixed left-0 right-0 bottom-0 z-40 h-16 pl-4 pr-[4.75rem] flex items-center gap-3 border-t-2 cursor-pointer text-white"
        style={{
          borderColor: "#a9713f",
          background: "linear-gradient(135deg, #d4a574, #c4956a)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <span className="relative">
          <ShoppingCart className="w-6 h-6" />
          {lineCount > 0 && (
            <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-white text-[11px] font-bold flex items-center justify-center" style={{ color: "#a9713f" }}>
              {lineCount}
            </span>
          )}
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[11px] font-bold uppercase tracking-wide opacity-90">
            {lineCount > 0
              ? `${lineCount} ${lineCount === 1 ? t("cassa_item") : t("cassa_items")}`
              : t("cassa_empty_order_short")}
          </span>
          <span className="text-lg font-bold">{fmtEur(totals.total)}</span>
        </span>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 text-sm font-bold">
          {t("cassa_view_order")}
          <ArrowLeft className="w-4 h-4 rotate-180" />
        </span>
      </button>

      {/* ============ MOBILE: ticket bottom sheet ============ */}
      {sheetOpen && (
        <div
          className={`lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/40 ${sheetClosing ? "drawer-backdrop--closing" : "drawer-backdrop"}`}
          onClick={closeSheet}
        >
          <div
            className={`flex flex-col rounded-t-2xl border-t-2 border-x-2 max-h-[92dvh] ${sheetClosing ? "sheet-panel--closing" : "sheet-panel"}`}
            style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
            onClick={(e) => e.stopPropagation()}
          >
            {ticketHeader(closeSheet, "down")}
            {ticketLines}
            {ticketTotals}
            <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>{ticketActions}</div>
          </div>
        </div>
      )}

      {/* ---------------- modals ---------------- */}
      {showDiscount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowDiscount(false)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3 max-h-[85dvh] overflow-y-auto" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
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
                className="flex-1 h-10 rounded-lg border-2 text-sm font-bold text-black cursor-pointer active:bg-[#c4956a]/20"
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowFree(false)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3 max-h-[85dvh] overflow-y-auto" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black">{t("cassa_free_item")}</h3>
            <input
              autoFocus
              value={freeName}
              onChange={(e) => setFreeName(e.target.value)}
              placeholder={t("cassa_free_item_name")}
              className="w-full px-3 py-2.5 text-base text-black border-2 rounded-lg bg-white"
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowMove(false)}>
          <div className="w-full max-w-sm rounded-2xl border-2 p-4 space-y-3 max-h-[80dvh] overflow-y-auto" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
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
                    className="h-14 rounded-xl border-2 text-sm font-bold text-black cursor-pointer active:bg-[#c4956a]/20"
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setVariantItem(null)}>
          <div
            className="w-full max-w-sm rounded-2xl border-2 p-4 space-y-3 max-h-[80dvh] overflow-y-auto"
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
                    className={`w-full h-12 px-3 rounded-lg border-2 text-sm font-bold cursor-pointer flex items-center justify-between ${active ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
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
              className="w-full h-11 rounded-lg text-sm font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {t("cassa_add")}
            </button>
          </div>
        </div>
      )}

      {noteKey && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setNoteKey(null)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3 max-h-[85dvh] overflow-y-auto" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black inline-flex items-center gap-2">
              <StickyNote className="w-4 h-4" /> {t("cassa_line_note")}
            </h3>
            <input
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("cassa_line_note_placeholder")}
              className="w-full px-3 py-2.5 text-base text-black border-2 rounded-lg bg-white"
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

      {showCovers && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowCovers(false)}>
          <div className="w-full max-w-xs rounded-2xl border-2 p-4 space-y-3 max-h-[85dvh] overflow-y-auto" style={{ borderColor: "#c4956a", background: "#FCF6ED" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-black inline-flex items-center gap-2">
              <Users className="w-4 h-4" /> {t("cassa_covers")}
            </h3>
            <p className="text-xs text-black">{t("cassa_covers_hint")}</p>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => setCoversDraft(n)}
                  className={`h-12 rounded-xl border-2 text-lg font-bold cursor-pointer ${coversDraft === n ? "text-white" : "text-black active:bg-[#c4956a]/20"}`}
                  style={coversDraft === n ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCoversDraft(Math.max(0, coversDraft - 1))}
                className="w-11 h-11 rounded-xl border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
                style={{ borderColor: "#c4956a" }}
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="flex-1 text-center text-xl font-bold text-black">{coversDraft}</span>
              <button
                onClick={() => setCoversDraft(coversDraft + 1)}
                className="w-11 h-11 rounded-xl border-2 flex items-center justify-center text-black cursor-pointer active:bg-[#c4956a]/20"
                style={{ borderColor: "#c4956a" }}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {/* coperto per persona — editable so a bill opened before the coperto
                was set can still be charged for it */}
            <div>
              <label className="text-xs font-bold text-black">{t("cassa_cover_charge")} (€ / {t("cassa_covers").toLowerCase()})</label>
              <input
                inputMode="decimal"
                value={coverStr}
                onChange={(e) => setCoverStr(e.target.value)}
                placeholder="0.00"
                className="w-full mt-1 px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
                style={{ borderColor: "#c4956a" }}
              />
            </div>
            <button
              onClick={() => {
                onSetCovers(coversDraft);
                const cu = Number(coverStr.replace(",", "."));
                const nextCover = Number.isFinite(cu) && cu >= 0 ? cu : 0;
                if (nextCover !== order.cover_unit) onSetCover(nextCover);
                setShowCovers(false);
              }}
              className="w-full h-11 rounded-xl text-sm font-bold text-white cursor-pointer"
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
