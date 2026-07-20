"use client";

// The ordering layer that rides ON TOP of the four showcase menu templates.
//
// Why this exists: self-ordering used to render its own functional screen
// (SelfOrderMenu), so a guest who scanned the table QR saw a completely
// different menu from the one the owner designed. Now the template the owner
// picked IS what the guest sees — Immersive, Editorial, Cinematic or Classic —
// and this layer adds the verbs: an add button on each dish, the drinks-first
// cooldown, a docked cart, and the submit flow.
//
// Everything lives in ONE context so the four templates stay presentational:
// each of them only has to render <DishAddButton item={…} /> inside its own dish
// markup, styled to its own look. All cart state, cooldown maths and network
// calls are here. When self-ordering is off, the provider isn't mounted at all
// and DishAddButton renders nothing — the templates are then exactly the plain
// showcase menus they always were.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { MenuItemVariant } from "@/lib/types";

/** Per-dish ordering facts the server resolves (price/variants/drink-ness),
 * keyed by menu item id. The templates carry only display data, so they look a
 * dish up here by `it.id` when rendering the add button. */
export type OrderDish = {
  id: string;
  name: string;
  price: number;
  variants: MenuItemVariant[];
  isDrink: boolean;
};

export type OrderStrings = {
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
  drinksFirstTitle: string;
  drinksFirstBody: string;
  foodLockedBadge: string;
  foodUnlockedToast: string;
  foodLockedError: string;
  minutesShort: string;
};

type CartLine = {
  key: string;
  itemId: string;
  name: string;
  unitPrice: number; // display only — the server re-derives every price
  qty: number;
  variantNames: string[];
  notes: string;
};

type Ctx = {
  dishes: Map<string, OrderDish>;
  strings: OrderStrings;
  /** True while this table's food is still locked (drinks-first cooldown). */
  foodLocked: boolean;
  /** Seconds left on the lock, formatted "m:ss" — for the per-dish chip. */
  leftLabel: string;
  addDish: (dish: OrderDish) => void;
};

const OrderCtx = createContext<Ctx | null>(null);

/** Null when self-ordering is off — the templates use this to decide whether to
 * render an add button at all, with zero knowledge of the feature flag. */
export function useOrder(): Ctx | null {
  return useContext(OrderCtx);
}

const euro = (n: number) => `€ ${n.toFixed(2)}`;

/** "m:ss" — compact enough for a per-dish chip. */
function fmtLeft(secs: number): string {
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, "0")}`;
}

/** The add control every template renders inside its own dish markup. It stays
 * unstyled-by-default on purpose: each template passes its own className so the
 * button belongs to that design (gold pill on Cinematic, ink circle on Classic…)
 * rather than looking bolted on.
 *
 * Renders nothing when self-ordering is off, so the templates can drop it in
 * unconditionally and remain valid plain menus. */
export function DishAddButton({
  itemId,
  className,
  lockedClassName,
}: {
  itemId: string;
  className?: string;
  lockedClassName?: string;
}) {
  const ctx = useOrder();
  if (!ctx) return null;
  const dish = ctx.dishes.get(itemId);
  // A dish with no price can't be ordered (the server filters these out of the
  // order set), but it still shows on the menu — so no button for it.
  if (!dish) return null;

  const locked = ctx.foodLocked && !dish.isDrink;
  if (locked) {
    return (
      <span
        className={lockedClassName || className}
        aria-label={ctx.strings.foodLockedBadge}
        title={ctx.strings.foodLockedBadge}
      >
        <span aria-hidden>🔒</span> {ctx.leftLabel}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => ctx.addDish(dish)}
      aria-label={`${ctx.strings.add} ${dish.name}`}
    >
      +
    </button>
  );
}

export default function OrderLayer({
  slug,
  tableId,
  dishes,
  strings: s,
  cooldownActive,
  cooldownMin,
  initialFoodUnlockAt,
  children,
}: {
  slug: string;
  tableId: string;
  dishes: OrderDish[];
  strings: OrderStrings;
  /** False when the owner flagged no drink category — locking the WHOLE menu on
   * arrival would just block everyone, so the cooldown stays off entirely. */
  cooldownActive: boolean;
  cooldownMin: number;
  /** ISO unlock time when the table ALREADY has an open bill (a guest who
   * re-scans mid-cooldown sees the same countdown, not a fresh one). */
  initialFoodUnlockAt: string | null;
  children: React.ReactNode;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [picker, setPicker] = useState<OrderDish | null>(null);
  const [pickerVariants, setPickerVariants] = useState<string[]>([]);
  const [pickerNotes, setPickerNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const dishMap = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);

  // Portals need a DOM: two of the templates force `position: relative` on every
  // direct child of their root, which would defeat a fixed cart bar rendered
  // inline. Portalling to <body> sidesteps their stacking rules entirely.
  useEffect(() => setMounted(true), []);

  // ── Drinks-first cooldown ──
  // The clock starts on SCAN (mount) unless the table already has an open bill,
  // whose opened_at the server turned into initialFoodUnlockAt. A zero cooldown
  // never locks anything.
  const [foodUnlockAt, setFoodUnlockAt] = useState<number | null>(() => {
    if (!cooldownActive || cooldownMin <= 0) return null;
    if (initialFoodUnlockAt) return new Date(initialFoodUnlockAt).getTime();
    return Date.now() + cooldownMin * 60_000;
  });
  const [now, setNow] = useState(() => Date.now());
  const foodLocked = cooldownActive && foodUnlockAt != null && now < foodUnlockAt;
  const secsLeft = foodUnlockAt != null ? Math.max(0, Math.ceil((foodUnlockAt - now) / 1000)) : 0;
  const wasLocked = useRef(foodLocked);
  const [justUnlocked, setJustUnlocked] = useState(false);

  // Tick only while something is counting down — no idle timer once food is open.
  useEffect(() => {
    if (!foodLocked) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [foodLocked]);

  // Celebrate the unlock briefly so the guest doesn't have to re-read the menu
  // to notice the food went live.
  useEffect(() => {
    if (wasLocked.current && !foodLocked) {
      setJustUnlocked(true);
      const id = setTimeout(() => setJustUnlocked(false), 6000);
      return () => clearTimeout(id);
    }
    wasLocked.current = foodLocked;
  }, [foodLocked]);

  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + l.unitPrice * l.qty, 0);

  const addLine = useCallback((dish: OrderDish, variantNames: string[], notes: string) => {
    const unitPrice =
      dish.price +
      variantNames.reduce((sum, vn) => {
        const v = dish.variants.find((x) => x.name === vn);
        return sum + (v ? Number(v.price_delta) || 0 : 0);
      }, 0);
    const lineKey = `${dish.id}|${[...variantNames].sort().join(",")}|${notes}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === lineKey);
      if (existing) {
        return prev.map((l) => (l.key === lineKey ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
      }
      return [...prev, { key: lineKey, itemId: dish.id, name: dish.name, unitPrice, qty: 1, variantNames, notes }];
    });
  }, []);

  // A dish with options opens the variant sheet; a plain one drops straight in.
  const addDish = useCallback(
    (dish: OrderDish) => {
      setError(null);
      if (dish.variants.length > 0) {
        setPicker(dish);
        setPickerVariants([]);
        setPickerNotes("");
      } else {
        addLine(dish, [], "");
      }
    },
    [addLine],
  );

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
        if (body?.error === "food_locked") {
          // The server anchors the lock to the bill's real open time, which can
          // be a hair later than our on-scan estimate. Re-sync to its
          // authoritative unlock_at; the guest's drinks stay in the cart.
          if (body?.unlock_at) setFoodUnlockAt(new Date(body.unlock_at).getTime());
          setNow(Date.now());
          setError(s.foodLockedError);
        } else {
          setError(body?.error === "cassa_closed" ? s.closedBody : s.genericError);
        }
      }
    } catch {
      setError(s.genericError);
    } finally {
      setSending(false);
    }
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

  const ctx = useMemo<Ctx>(
    () => ({ dishes: dishMap, strings: s, foodLocked, leftLabel: fmtLeft(secsLeft), addDish }),
    [dishMap, s, foodLocked, secsLeft, addDish],
  );

  // Everything below the menu is portalled to <body>: banners, cart, sheets.
  // Keeps the templates' own stacking contexts untouched.
  const overlays = (
    <>
      {/* Drinks-first banner — explains WHY dishes are locked, with the live
          countdown, so a guest isn't left guessing. Hidden while a sheet is
          open: it would otherwise float over the cart the guest is reading. */}
      {foodLocked && !cartOpen && !picker && !sent && (
        <div className="ol-banner" role="status">
          <span className="ol-banner-emoji" aria-hidden>🍹</span>
          <div className="ol-banner-text">
            <p className="ol-banner-title">{s.drinksFirstTitle}</p>
            <p className="ol-banner-body">{s.drinksFirstBody}</p>
          </div>
          <span className="ol-banner-timer tabular-nums">{fmtLeft(secsLeft)}</span>
        </div>
      )}

      {justUnlocked && !cartOpen && !picker && !sent && (
        <div className="ol-toast" role="status">✓ {s.foodUnlockedToast}</div>
      )}

      {/* Docked cart bar. While it's up it publishes its own height so the bill
          pill (TableBill, bottom-right) floats above it instead of underneath. */}
      {cartCount > 0 && !cartOpen && !sent && (
        <>
          <style>{`:root { --ol-dock-h: 4.25rem; }`}</style>
          <button type="button" className="ol-dock" onClick={() => setCartOpen(true)}>
            <span>{cartCount} {s.items}</span>
            <span>{s.viewOrder} · {euro(cartTotal)}</span>
          </button>
        </>
      )}

      {/* Cart sheet */}
      {cartOpen && (
        <div className="ol-sheet-wrap" role="dialog" aria-modal="true" aria-label={s.yourOrder}>
          <div className="ol-scrim" onClick={() => setCartOpen(false)} />
          <div className="ol-sheet">
            <div className="ol-sheet-head">
              <h2 className="ol-sheet-title">{s.yourOrder}</h2>
              <button type="button" className="ol-x" onClick={() => setCartOpen(false)} aria-label={s.cancel}>×</button>
            </div>
            <div className="ol-lines">
              {cart.length === 0 && <p className="ol-empty">{s.empty}</p>}
              {cart.map((l) => (
                <div key={l.key} className="ol-line">
                  <div className="ol-line-main">
                    <p className="ol-line-name">{l.name}</p>
                    {l.variantNames.length > 0 && <p className="ol-line-var">{l.variantNames.join(", ")}</p>}
                    {l.notes && <p className="ol-line-note">“{l.notes}”</p>}
                    <p className="ol-line-price">{euro(l.unitPrice * l.qty)}</p>
                  </div>
                  <div className="ol-qty">
                    <button type="button" onClick={() => changeQty(l.key, -1)} aria-label="−">−</button>
                    <span className="tabular-nums">{l.qty}</span>
                    <button type="button" onClick={() => changeQty(l.key, +1)} aria-label="+">+</button>
                  </div>
                </div>
              ))}
            </div>
            {error && <p className="ol-error">{error}</p>}
            <div className="ol-sheet-foot">
              <div className="ol-total">
                <span>{s.total}</span>
                <strong className="tabular-nums">{euro(cartTotal)}</strong>
              </div>
              <button type="button" className="ol-send" onClick={submit} disabled={sending || cart.length === 0}>
                {sending ? s.sending : s.sendOrder}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant / notes picker */}
      {picker && (
        <div className="ol-sheet-wrap" role="dialog" aria-modal="true" aria-label={picker.name}>
          <div className="ol-scrim" onClick={() => setPicker(null)} />
          <div className="ol-sheet">
            <div className="ol-sheet-head ol-sheet-head-col">
              <p className="ol-sheet-title">{picker.name}</p>
              <p className="ol-pick-price">{euro(pickerPrice)}</p>
            </div>
            <div className="ol-variants">
              {picker.variants.map((v) => {
                const on = pickerVariants.includes(v.name);
                return (
                  <button
                    key={v.name}
                    type="button"
                    className={`ol-variant${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      setPickerVariants((prev) => (on ? prev.filter((x) => x !== v.name) : [...prev, v.name]))
                    }
                  >
                    <span>{v.name}</span>
                    {Number(v.price_delta) !== 0 && (
                      <span className="tabular-nums">
                        {Number(v.price_delta) > 0 ? "+" : "−"}€{Math.abs(Number(v.price_delta)).toFixed(2)}
                      </span>
                    )}
                  </button>
                );
              })}
              <input
                className="ol-notes"
                value={pickerNotes}
                onChange={(e) => setPickerNotes(e.target.value.slice(0, 200))}
                placeholder={s.notesPlaceholder}
              />
            </div>
            <div className="ol-sheet-foot ol-pick-foot">
              <button type="button" className="ol-cancel" onClick={() => setPicker(null)}>{s.cancel}</button>
              <button
                type="button"
                className="ol-send ol-send-inline"
                onClick={() => {
                  addLine(picker, pickerVariants, pickerNotes.trim());
                  setPicker(null);
                }}
              >
                {s.add} · {euro(pickerPrice)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sent confirmation — a full overlay rather than replacing the menu, so
          the guest lands back on the same template they were browsing. */}
      {sent && (
        <div className="ol-sent" role="dialog" aria-modal="true">
          <div className="ol-sent-mark" aria-hidden>✓</div>
          <h2 className="ol-sent-title">{s.sentTitle}</h2>
          <p className="ol-sent-body">{s.sentBody}</p>
          <button type="button" className="ol-send ol-sent-btn" onClick={() => setSent(false)}>
            {s.orderMore}
          </button>
        </div>
      )}

      <style>{overlayStyles}</style>
    </>
  );

  return (
    <OrderCtx.Provider value={ctx}>
      {/* No table-name strip: it pushed the templates' own sticky category bars
          off the top of the viewport, and the guest already knows which table
          they're sitting at. The table id still rides the order payload, so
          nothing functional depended on showing it. */}
      {children}
      {mounted && createPortal(overlays, document.body)}
    </OrderCtx.Provider>
  );
}

// Overlay styling. Deliberately neutral-dark rather than per-template: these are
// transient sheets over a dimmed page, and the guest reads them as "the app",
// not as part of the menu's art direction. --accent (owner brand colour) still
// drives every action surface so they stay on-brand.
const overlayStyles = `
/* The table bar is gone, so nothing offsets the top of the viewport any more.
   Kept at 0 (rather than deleted) because TableBill and the banners still read
   it — one place to reintroduce a top strip if we ever want one back. */
:root { --ol-topbar-h: 0rem; }

.ol-banner, .ol-toast, .ol-dock, .ol-sheet-wrap, .ol-sent {
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
}

.ol-banner {
  position: fixed; z-index: 70;
  left: 0.75rem; right: 0.75rem;
  top: calc(0.75rem + env(safe-area-inset-top, 0px));
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.8rem 0.9rem; border-radius: 16px;
  background: rgba(24,18,12,0.94);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 18px 40px -20px rgba(0,0,0,0.8);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  color: #f6efe3;
}
.ol-banner-emoji { font-size: 1.25rem; line-height: 1; }
.ol-banner-text { min-width: 0; flex: 1; }
.ol-banner-title { margin: 0; font-size: 0.86rem; font-weight: 700; }
.ol-banner-body { margin: 0.15rem 0 0; font-size: 0.76rem; line-height: 1.35; color: rgba(246,239,227,0.72); }
.ol-banner-timer {
  flex: 0 0 auto; font-size: 0.95rem; font-weight: 800; color: #17110a;
  background: var(--accent, #c89b5e); padding: 0.25rem 0.6rem; border-radius: 10px;
}

.ol-toast {
  position: fixed; z-index: 70;
  left: 0.75rem; right: 0.75rem;
  top: calc(0.75rem + env(safe-area-inset-top, 0px));
  padding: 0.8rem; border-radius: 14px; text-align: center;
  font-size: 0.86rem; font-weight: 700; color: #fff; background: #15803d;
  box-shadow: 0 18px 40px -20px rgba(0,0,0,0.8);
}

.ol-dock {
  position: fixed; z-index: 70;
  left: 0.75rem; right: 0.75rem; bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1rem 1.25rem; border: 0; border-radius: 18px; cursor: pointer;
  font-size: 0.92rem; font-weight: 700; color: #fff;
  background: var(--accent, #b45309);
  box-shadow: 0 20px 44px -18px rgba(0,0,0,0.7);
}
.ol-dock:active { transform: scale(0.99); }

.ol-sheet-wrap { position: fixed; inset: 0; z-index: 80; display: flex; flex-direction: column; justify-content: flex-end; }
.ol-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.45); }
.ol-sheet {
  position: relative; background: #fff; border-radius: 22px 22px 0 0;
  max-height: 84dvh; display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.ol-sheet-head {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1.1rem 1.25rem 0.75rem; border-bottom: 1px solid #f0eae2;
}
.ol-sheet-head-col { flex-direction: column; align-items: flex-start; gap: 0.15rem; }
.ol-sheet-title {
  margin: 0; font-family: var(--font-display), Georgia, serif;
  font-size: 1.15rem; font-weight: 600; color: #1c1917;
}
.ol-pick-price { margin: 0; font-size: 0.92rem; font-weight: 700; color: var(--accent, #b45309); }
.ol-x { border: 0; background: none; font-size: 1.6rem; line-height: 1; color: #a8a29e; cursor: pointer; padding: 0 0.25rem; }

.ol-lines { flex: 1; overflow-y: auto; padding: 0.85rem 1.25rem; display: flex; flex-direction: column; gap: 0.9rem; }
.ol-empty { text-align: center; color: #78716c; font-size: 0.88rem; padding: 1.5rem 0; margin: 0; }
.ol-line { display: flex; align-items: flex-start; gap: 0.85rem; }
.ol-line-main { min-width: 0; flex: 1; }
.ol-line-name { margin: 0; font-size: 0.94rem; font-weight: 600; color: #1c1917; line-height: 1.3; }
.ol-line-var { margin: 0.1rem 0 0; font-size: 0.76rem; color: #78716c; }
.ol-line-note { margin: 0.1rem 0 0; font-size: 0.76rem; font-style: italic; color: #a8a29e; }
.ol-line-price { margin: 0.15rem 0 0; font-size: 0.82rem; font-weight: 700; color: var(--accent, #b45309); }
.ol-qty { display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; }
.ol-qty button {
  height: 2rem; width: 2rem; border-radius: 999px; cursor: pointer;
  border: 1px solid #d6d3d1; background: #fff; color: #44403c; font-weight: 700; font-size: 1rem; line-height: 1;
}
.ol-qty span { width: 1.25rem; text-align: center; font-weight: 700; font-size: 0.88rem; color: #1c1917; }

.ol-error { margin: 0; padding: 0 1.25rem 0.35rem; font-size: 0.82rem; color: #dc2626; }
.ol-sheet-foot { padding: 0.9rem 1.25rem 1.1rem; border-top: 1px solid #f0eae2; }
.ol-total { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
.ol-total span { font-size: 0.86rem; font-weight: 600; color: #78716c; }
.ol-total strong { font-size: 1.1rem; font-weight: 700; color: #1c1917; }
.ol-send {
  width: 100%; padding: 0.95rem; border: 0; border-radius: 16px; cursor: pointer;
  font-size: 0.95rem; font-weight: 700; color: #fff; background: var(--accent, #b45309);
}
.ol-send:disabled { opacity: 0.6; cursor: default; }
.ol-pick-foot { display: flex; gap: 0.6rem; align-items: center; }
.ol-send-inline { width: auto; flex: 1; }
.ol-cancel {
  padding: 0.95rem 1.15rem; border-radius: 16px; cursor: pointer;
  border: 1px solid #d6d3d1; background: #fff; color: #44403c; font-size: 0.9rem; font-weight: 600;
}

.ol-variants { padding: 0.85rem 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; max-height: 46dvh; overflow-y: auto; }
.ol-variant {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  width: 100%; padding: 0.8rem 1rem; border-radius: 14px; cursor: pointer; text-align: left;
  border: 1px solid #e7e5e4; background: #fff; color: #292524; font-size: 0.9rem; font-weight: 600;
}
.ol-variant.is-on { border-color: transparent; background: var(--accent, #b45309); color: #fff; }
.ol-notes {
  width: 100%; padding: 0.8rem 1rem; border-radius: 14px; border: 1px solid #e7e5e4;
  font-size: 0.9rem; color: #1c1917; outline: none;
}

.ol-sent {
  position: fixed; inset: 0; z-index: 90;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.85rem; padding: 2rem; text-align: center; background: #faf6f0;
}
.ol-sent-mark {
  height: 4rem; width: 4rem; border-radius: 999px; display: grid; place-items: center;
  font-size: 1.9rem; color: #fff; background: var(--accent, #b45309);
}
.ol-sent-title { margin: 0; font-family: var(--font-display), Georgia, serif; font-size: 1.5rem; font-weight: 600; color: #1c1917; }
.ol-sent-body { margin: 0; max-width: 22rem; font-size: 0.9rem; line-height: 1.5; color: #57534e; }
.ol-sent-btn { width: auto; margin-top: 0.75rem; padding-inline: 2rem; border-radius: 999px; }

@media (prefers-reduced-motion: reduce) {
  .ol-dock:active { transform: none; }
}
`;
