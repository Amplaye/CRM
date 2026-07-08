"use client";

// Table self-ordering UI, rendered by /m/<slug>?table=<id> when the tenant has
// self_order_enabled. Deliberately FUNCTIONAL (not one of the four showcase
// templates): category chips, dish list with add buttons, a variant/notes
// sheet, and a docked cart that POSTs to /api/public/order. The server
// re-derives every price — the cart total here is display-only.

import { useMemo, useRef, useState } from "react";
import type { MenuItemVariant } from "@/lib/types";

export type SelfOrderItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  allergenLabels: string[];
  variants: MenuItemVariant[];
};

export type SelfOrderSection = {
  key: string;
  title: string;
  featured: boolean;
  items: SelfOrderItem[];
};

export type SelfOrderStrings = {
  table: string;
  add: string;
  yourOrder: string;
  empty: string;
  sendOrder: string;
  sending: string;
  viewOrder: string;
  items: string;
  notesPlaceholder: string;
  total: string;
  cancel: string;
  sentTitle: string;
  sentBody: string;
  orderMore: string;
  closedTitle: string;
  closedBody: string;
  genericError: string;
};

type CartLine = {
  key: string;
  itemId: string;
  name: string;
  unitPrice: number; // display only — server re-derives
  qty: number;
  variantNames: string[];
  notes: string;
};

const ACCENT = "var(--accent, #b45309)";
const euro = (n: number) => `€ ${n.toFixed(2)}`;

export default function SelfOrderMenu({
  slug,
  tableId,
  tableName,
  restaurantName,
  logoUrl,
  sections,
  strings: s,
  emptyLabel,
}: {
  slug: string;
  tableId: string;
  tableName: string;
  restaurantName: string;
  logoUrl?: string;
  sections: SelfOrderSection[];
  strings: SelfOrderStrings;
  emptyLabel: string;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [picker, setPicker] = useState<SelfOrderItem | null>(null);
  const [pickerVariants, setPickerVariants] = useState<string[]>([]);
  const [pickerNotes, setPickerNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(sections[0]?.key ?? "");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + l.unitPrice * l.qty, 0);

  const addLine = (item: SelfOrderItem, variantNames: string[], notes: string) => {
    const unitPrice =
      item.price +
      variantNames.reduce((sum, vn) => {
        const v = item.variants.find((x) => x.name === vn);
        return sum + (v ? Number(v.price_delta) || 0 : 0);
      }, 0);
    const lineKey = `${item.id}|${[...variantNames].sort().join(",")}|${notes}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === lineKey);
      if (existing) {
        return prev.map((l) => (l.key === lineKey ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
      }
      return [...prev, { key: lineKey, itemId: item.id, name: item.name, unitPrice, qty: 1, variantNames, notes }];
    });
  };

  const handleAdd = (item: SelfOrderItem) => {
    setError(null);
    if (item.variants.length > 0) {
      setPicker(item);
      setPickerVariants([]);
      setPickerNotes("");
    } else {
      addLine(item, [], "");
    }
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + delta) } : l))
        .filter((l) => l.qty > 0),
    );
  };

  const submit = async () => {
    if (cart.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/public/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          table_id: tableId,
          items: cart.map((l) => ({
            menu_item_id: l.itemId,
            qty: l.qty,
            variant_names: l.variantNames,
            notes: l.notes || undefined,
          })),
        }),
      });
      if (res.ok) {
        setCart([]);
        setCartOpen(false);
        setSent(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.error === "cassa_closed" ? s.closedBody : s.genericError);
      }
    } catch {
      setError(s.genericError);
    } finally {
      setSending(false);
    }
  };

  const scrollTo = (key: string) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pickerPrice = useMemo(() => {
    if (!picker) return 0;
    return (
      picker.price +
      pickerVariants.reduce((sum, vn) => {
        const v = picker.variants.find((x) => x.name === vn);
        return sum + (v ? Number(v.price_delta) || 0 : 0);
      }, 0)
    );
  }, [picker, pickerVariants]);

  // ── Success screen ──
  if (sent) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-8 text-center" style={{ background: "#faf6f0", fontFamily: "var(--font-body)" }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-3xl" style={{ background: ACCENT }}>✓</div>
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: "var(--font-display)" }}>{s.sentTitle}</h1>
        <p className="text-stone-600 text-sm max-w-xs">{s.sentBody}</p>
        <button
          onClick={() => setSent(false)}
          className="mt-4 px-6 py-3 rounded-full text-white text-sm font-semibold cursor-pointer"
          style={{ background: ACCENT }}
        >
          {s.orderMore}
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-dvh" style={{ background: "#faf6f0", fontFamily: "var(--font-body)" }}>
      {/* Header */}
      <header className="px-5 pt-6 pb-3">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={restaurantName} className="h-10 w-10 rounded-full object-cover" />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-stone-900 leading-tight truncate" style={{ fontFamily: "var(--font-display)" }}>
              {restaurantName}
            </h1>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
              {s.table} {tableName}
            </p>
          </div>
        </div>
      </header>

      {/* Category chips */}
      {sections.length > 1 && (
        <nav className="sticky top-0 z-20 px-3 py-2 overflow-x-auto whitespace-nowrap backdrop-blur border-b border-stone-200/60" style={{ background: "rgba(250,246,240,0.92)" }}>
          {sections.map((sec) => (
            <button
              key={sec.key}
              onClick={() => scrollTo(sec.key)}
              className="inline-block mx-1 px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors"
              style={
                activeSection === sec.key
                  ? { background: ACCENT, color: "#fff" }
                  : { background: "rgba(0,0,0,0.05)", color: "#44403c" }
              }
            >
              {sec.title}
            </button>
          ))}
        </nav>
      )}

      {/* Sections */}
      <div className="px-4 pb-40 pt-2">
        {sections.length === 0 && (
          <p className="text-center text-stone-500 text-sm mt-16">{emptyLabel}</p>
        )}
        {sections.map((sec) => (
          <div
            key={sec.key}
            ref={(el) => {
              sectionRefs.current[sec.key] = el;
            }}
            className="scroll-mt-14"
          >
            <h2 className="mt-6 mb-2 text-lg font-bold text-stone-900" style={{ fontFamily: "var(--font-display)" }}>
              {sec.title}
            </h2>
            <div className="space-y-2.5">
              {sec.items.map((item) => (
                <div key={`${sec.key}-${item.id}`} className="flex gap-3 items-start rounded-2xl bg-white p-3 shadow-sm border border-stone-100">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image_url} alt={item.name} className="h-16 w-16 rounded-xl object-cover shrink-0" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-stone-900 text-[15px] leading-snug">{item.name}</p>
                    {item.description ? (
                      <p className="text-[12.5px] text-stone-500 leading-snug mt-0.5 line-clamp-2">{item.description}</p>
                    ) : null}
                    {item.allergenLabels.length > 0 && (
                      <p className="text-[10.5px] text-stone-400 mt-1 truncate">{item.allergenLabels.join(" · ")}</p>
                    )}
                    <p className="text-sm font-bold mt-1" style={{ color: ACCENT }}>{euro(item.price)}</p>
                  </div>
                  <button
                    onClick={() => handleAdd(item)}
                    aria-label={`${s.add} ${item.name}`}
                    className="shrink-0 h-9 w-9 rounded-full text-white text-xl leading-none font-bold cursor-pointer self-center"
                    style={{ background: ACCENT }}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Docked cart bar */}
      {cartCount > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-4 left-4 right-4 z-30 rounded-2xl px-5 py-4 text-white font-semibold flex items-center justify-between shadow-xl cursor-pointer"
          style={{ background: ACCENT, paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px) / 2)" }}
        >
          <span>{cartCount} {s.items}</span>
          <span>{s.viewOrder} · {euro(cartTotal)}</span>
        </button>
      )}

      {/* Cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[80dvh] flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-stone-100">
              <h2 className="text-lg font-bold text-stone-900" style={{ fontFamily: "var(--font-display)" }}>{s.yourOrder}</h2>
              <button onClick={() => setCartOpen(false)} className="text-stone-400 text-2xl leading-none cursor-pointer" aria-label={s.cancel}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {cart.length === 0 && <p className="text-sm text-stone-500 py-6 text-center">{s.empty}</p>}
              {cart.map((l) => (
                <div key={l.key} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-stone-900 leading-snug">{l.name}</p>
                    {l.variantNames.length > 0 && (
                      <p className="text-[12px] text-stone-500">{l.variantNames.join(", ")}</p>
                    )}
                    {l.notes && <p className="text-[12px] italic text-stone-400 truncate">“{l.notes}”</p>}
                    <p className="text-[13px] font-bold mt-0.5" style={{ color: ACCENT }}>{euro(l.unitPrice * l.qty)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => changeQty(l.key, -1)} className="h-8 w-8 rounded-full border border-stone-300 text-stone-700 font-bold cursor-pointer">−</button>
                    <span className="w-5 text-center text-sm font-bold text-stone-900 tabular-nums">{l.qty}</span>
                    <button onClick={() => changeQty(l.key, +1)} className="h-8 w-8 rounded-full border border-stone-300 text-stone-700 font-bold cursor-pointer">+</button>
                  </div>
                </div>
              ))}
            </div>
            {error && <p className="px-5 pb-1 text-[13px] text-red-600">{error}</p>}
            <div className="px-5 py-4 border-t border-stone-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-stone-500">{s.total}</span>
                <span className="text-lg font-bold text-stone-900 tabular-nums">{euro(cartTotal)}</span>
              </div>
              <button
                onClick={submit}
                disabled={sending || cart.length === 0}
                className="w-full py-3.5 rounded-2xl text-white font-bold cursor-pointer disabled:opacity-60"
                style={{ background: ACCENT }}
              >
                {sending ? s.sending : s.sendOrder}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant / notes picker */}
      {picker && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPicker(null)} />
          <div className="relative bg-white rounded-t-3xl" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="px-5 pt-5 pb-3 border-b border-stone-100">
              <p className="text-lg font-bold text-stone-900 leading-snug" style={{ fontFamily: "var(--font-display)" }}>{picker.name}</p>
              <p className="text-sm font-bold mt-0.5" style={{ color: ACCENT }}>{euro(pickerPrice)}</p>
            </div>
            <div className="px-5 py-3 space-y-2 max-h-[45dvh] overflow-y-auto">
              {picker.variants.map((v) => {
                const on = pickerVariants.includes(v.name);
                return (
                  <button
                    key={v.name}
                    onClick={() =>
                      setPickerVariants((prev) => (on ? prev.filter((x) => x !== v.name) : [...prev, v.name]))
                    }
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left cursor-pointer"
                    style={on ? { borderColor: "transparent", background: ACCENT, color: "#fff" } : { borderColor: "#e7e5e4", color: "#292524" }}
                  >
                    <span className="text-sm font-semibold">{v.name}</span>
                    {Number(v.price_delta) !== 0 && (
                      <span className="text-[13px] font-bold tabular-nums">
                        {Number(v.price_delta) > 0 ? "+" : "−"}{euro(Math.abs(Number(v.price_delta))).replace("€ ", "€")}
                      </span>
                    )}
                  </button>
                );
              })}
              <input
                value={pickerNotes}
                onChange={(e) => setPickerNotes(e.target.value.slice(0, 200))}
                placeholder={s.notesPlaceholder}
                className="w-full px-4 py-3 rounded-xl border border-stone-200 text-sm text-stone-900 placeholder:text-stone-400 outline-none"
              />
            </div>
            <div className="px-5 py-4 border-t border-stone-100 flex gap-2">
              <button onClick={() => setPicker(null)} className="px-5 py-3 rounded-2xl border border-stone-300 text-sm font-semibold text-stone-700 cursor-pointer">
                {s.cancel}
              </button>
              <button
                onClick={() => {
                  addLine(picker, pickerVariants, pickerNotes.trim());
                  setPicker(null);
                }}
                className="flex-1 py-3 rounded-2xl text-white text-sm font-bold cursor-pointer"
                style={{ background: ACCENT }}
              >
                {s.add} · {euro(pickerPrice)}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
