"use client";

import { useEffect, useMemo, useState } from "react";
import { allergenLabel, tagLabel, type MenuLocale } from "@/lib/menu/labels";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData, SiteMenuItem } from "@/lib/site/types";

// In-site menu layer shared by every demo template. One instance is injected at
// the page level (like the floating booking widget), so no template embeds it.
// It answers two global events dispatched by the templates:
//   • "open-dish"      → detail card for a single dish (photo, description,
//                         price, allergens, tags)
//   • "open-full-menu" → the WHOLE menu, grouped by category, in a scrollable
//                         overlay that reads like the site (same accent) instead
//                         of sending the guest to the differently-styled /m page.
// Both use a plain white card + the template accent so they're readable on top
// of any template (dark or light) yet visibly part of the same site.

type OverlayStrings = {
  /** "Menù completo" / "Full menu" — overlay title. */
  fullMenu: string;
  /** "Allergeni" caption. */
  allergens: string;
  /** aria-label for the close buttons. */
  close: string;
};

export function labelsForMenuLocale(locale: SiteData["locale"]): MenuLocale {
  return (["it", "es", "en", "de"].includes(locale) ? locale : "it") as MenuLocale;
}

/** Templates call these to open the in-site menu layer (mirrors how BookingCta
 * dispatches "open-booking"). A dish card wires openDish(it.id); the "full menu"
 * button wires openFullMenu — no navigation to the differently-styled /m page. */
export function openDish(id: string) {
  window.dispatchEvent(new CustomEvent("open-dish", { detail: id }));
}
export function openFullMenu() {
  window.dispatchEvent(new CustomEvent("open-full-menu"));
}

/** Decide what a delegated click should do, given the closest dish-id (if the
 * click landed on/inside a dish card), the closest anchor href (if any), the
 * page's own "/m/<slug>" menu path, and whether the dish id is known. Pure so
 * the href-matching + guard logic is unit-testable without a DOM. Returns the
 * action the overlay should take, or null to let the click through untouched. */
export function resolveMenuClick(args: {
  dishId: string | null;
  dishKnown: boolean;
  href: string | null;
  menuHref: string;
}): { type: "dish"; id: string } | { type: "full" } | null {
  const { dishId, dishKnown, href, menuHref } = args;
  if (dishId && dishKnown) return { type: "dish", id: dishId };
  if (href && (href === menuHref || href.startsWith(`${menuHref}?`) || href.startsWith(`${menuHref}#`))) {
    return { type: "full" };
  }
  return null;
}

/** Props to spread on a template's dish card so it opens the dish detail. The
 * click is handled by SiteMenuOverlay's delegated listener (via data-dish-id);
 * these add the pointer affordance + keyboard access without changing markup.
 * Enter/Space dispatch openDish since the delegated handler only sees clicks. */
export function dishCardProps(id: string): {
  "data-dish-id": string;
  role: "button";
  tabIndex: 0;
  onKeyDown: (e: React.KeyboardEvent) => void;
} {
  return {
    "data-dish-id": id,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDish(id);
      }
    },
  };
}

function DishChips({ item, locale, allergensCaption }: { item: SiteMenuItem; locale: MenuLocale; allergensCaption: string }) {
  if (!item.tags.length && !item.allergens.length) return null;
  return (
    <div className="smo-chips">
      {item.tags.map((t) => (
        <span key={`t-${t}`} className="smo-chip smo-chip-tag">
          {tagLabel(t, locale)}
        </span>
      ))}
      {item.allergens.length ? (
        <span className="smo-allergens">
          <span className="smo-allergens-cap">{allergensCaption}:</span>{" "}
          {item.allergens.map((a) => allergenLabel(a, locale)).join(", ")}
        </span>
      ) : null}
    </div>
  );
}

export default function SiteMenuOverlay({
  data,
  accent,
  strings,
}: {
  data: SiteData;
  accent: string;
  strings: OverlayStrings;
}) {
  const locale = labelsForMenuLocale(data.locale);
  const [dishId, setDishId] = useState<string | null>(null);
  const [fullOpen, setFullOpen] = useState(false);

  // Flat lookup so "open-dish" can resolve a dish by id from the full menu.
  const dishById = useMemo(() => {
    const m = new Map<string, SiteMenuItem>();
    for (const cat of data.fullMenu) for (const it of cat.items) m.set(it.id, it);
    // Teaser dishes are a subset of the full menu, but guard anyway.
    for (const it of data.menuItems) if (!m.has(it.id)) m.set(it.id, it);
    return m;
  }, [data.fullMenu, data.menuItems]);

  useEffect(() => {
    const onDish = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && dishById.has(id)) setDishId(id);
    };
    const onFull = () => setFullOpen(true);
    window.addEventListener("open-dish", onDish as EventListener);
    window.addEventListener("open-full-menu", onFull);
    return () => {
      window.removeEventListener("open-dish", onDish as EventListener);
      window.removeEventListener("open-full-menu", onFull);
    };
  }, [dishById]);

  // Delegated clicks so templates need no per-link/per-card wiring: any
  // "full menu" anchor (href → /m/<slug>) opens the in-site overlay instead of
  // navigating to the differently-styled hosted menu, and any element carrying
  // data-dish-id opens that dish's detail. Both degrade gracefully: with JS off
  // the anchors still navigate to /m as before.
  useEffect(() => {
    const menuHref = `/m/${data.slug}`;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const dishEl = target.closest<HTMLElement>("[data-dish-id]");
      const link = target.closest<HTMLAnchorElement>("a[href]");
      const action = resolveMenuClick({
        dishId: dishEl?.getAttribute("data-dish-id") ?? null,
        dishKnown: !!dishEl && dishById.has(dishEl.getAttribute("data-dish-id") || ""),
        href: link?.getAttribute("href") ?? null,
        menuHref,
      });
      if (!action) return;
      e.preventDefault();
      if (action.type === "dish") setDishId(action.id);
      else setFullOpen(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [data.slug, dishById]);

  // Esc closes the topmost layer (dish first, then the full menu).
  useEffect(() => {
    if (!dishId && !fullOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dishId) setDishId(null);
      else setFullOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dishId, fullOpen]);

  const dish = dishId ? dishById.get(dishId) ?? null : null;
  const accentVars = { ["--smo-accent" as string]: accent } as React.CSSProperties;

  if (!dish && !fullOpen) return null;

  return (
    <div className="smo-root" style={accentVars}>
      {/* Full-menu overlay (opened first; a dish detail can stack on top). */}
      {fullOpen ? (
        <div className="smo-scrim" role="dialog" aria-modal="true" aria-label={strings.fullMenu}>
          <button type="button" aria-label={strings.close} className="smo-scrim-hit" onClick={() => setFullOpen(false)} />
          <div className="smo-sheet smo-sheet-lg">
            <div className="smo-sheet-head">
              <span className="smo-sheet-title">{strings.fullMenu}</span>
              <button type="button" className="smo-x" aria-label={strings.close} onClick={() => setFullOpen(false)}>
                <XIcon />
              </button>
            </div>
            <div className="smo-sheet-body">
              {data.fullMenu.map((cat) => (
                <section key={cat.id} className="smo-cat">
                  <h3 className="smo-cat-title">{cat.name}</h3>
                  <ul className="smo-list">
                    {cat.items.map((it) => (
                      <li key={it.id}>
                        <button type="button" className="smo-row" onClick={() => setDishId(it.id)}>
                          {it.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.image_url} alt="" className="smo-row-img" loading="lazy" />
                          ) : (
                            <span className="smo-row-img smo-row-img-empty" aria-hidden />
                          )}
                          <span className="smo-row-main">
                            <span className="smo-row-name">{it.name}</span>
                            {it.description ? <span className="smo-row-desc">{it.description}</span> : null}
                            <DishChips item={it} locale={locale} allergensCaption={strings.allergens} />
                          </span>
                          {it.price != null ? (
                            <span className="smo-row-price">{formatSitePrice(it.price, it.currency)}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Single-dish detail. */}
      {dish ? (
        <div className="smo-scrim" role="dialog" aria-modal="true" aria-label={dish.name}>
          <button type="button" aria-label={strings.close} className="smo-scrim-hit" onClick={() => setDishId(null)} />
          <div className="smo-sheet smo-sheet-sm">
            <button type="button" className="smo-x smo-x-float" aria-label={strings.close} onClick={() => setDishId(null)}>
              <XIcon />
            </button>
            {dish.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dish.image_url} alt={dish.name} className="smo-dish-img" />
            ) : null}
            <div className="smo-dish-body">
              <div className="smo-dish-head">
                <h3 className="smo-dish-name">{dish.name}</h3>
                {dish.price != null ? (
                  <span className="smo-dish-price">{formatSitePrice(dish.price, dish.currency)}</span>
                ) : null}
              </div>
              {dish.description ? <p className="smo-dish-desc">{dish.description}</p> : null}
              <DishChips item={dish} locale={locale} allergensCaption={strings.allergens} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
