"use client";

import { useLayoutEffect, useRef } from "react";
import { ClosePublicMenuButton } from "./ClosePublicMenuButton";
import { DishAddButton } from "./OrderLayer";
import { useCategoryTransition, useTagFilter } from "./useMenuFilters";

// Public hosted menu — Template 3 "SCURO" (cinematic).
//
// Direction: a candle-lit tasting room. Near-black velvet canvas, a thin gold
// rim-light, glass panels with real blur, dotted gold leaders running from
// dish to price like a bespoke carte des vins. One course on stage at a time:
// the sticky course bar filters with a soft crossfade. Photos are optional
// jewels — a small rounded thumb beside the entry, never a broken box when
// missing. Layout: one column on phones, a two-column glass spread on desktop.
//
// Server (page.tsx) hands us flat localized sections; we own presentation.
// Branding hooks: --accent, --font-display, --font-body.

export type MenuViewItem = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  tags: string[];
  allergens: string[];
  tagLabels: string[];
  allergenLabels: string[];
  image_url: string | null;
};

export type MenuViewSection = {
  key: string;
  prefix: string;
  title: string;
  featured: boolean;
  items: MenuViewItem[];
};

type Props = {
  restaurantName: string;
  menuLabel: string;
  emptyLabel: string;
  featuredLabel: string;
  /** "Filters" / "All" / "no dish matches" — localized on the server. */
  filterLabels: { all: string; noMatch: string };
  sections: MenuViewSection[];
  logoUrl?: string;
};

function priceText(it: MenuViewItem): string | null {
  if (it.price == null) return null;
  const cur = it.currency === "EUR" ? "€" : it.currency;
  return `${it.price.toFixed(2)} ${cur}`;
}

export default function MenuCinematic({
  restaurantName,
  menuLabel,
  emptyLabel,
  featuredLabel,
  filterLabels,
  sections,
  logoUrl,
}: Props) {
  const valid = sections.filter((s) => s.items.length > 0);
  const empty = valid.length === 0;

  const { activeKey, phase, swapKey, select: selectKey } = useCategoryTransition(valid[0]?.key ?? "");
  const { activeTags, availableTags, toggleTag, clearTags, matches } = useTagFilter(
    valid.map((s) => ({ key: s.key, items: s.items.map((it) => ({ tags: it.tagLabels })) })),
  );
  const barRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const activeIdx = Math.max(0, valid.findIndex((s) => s.key === activeKey));
  const active = valid[activeIdx] ?? valid[0];
  const shownItems = active ? active.items.filter((it) => matches(it.tagLabels)) : [];

  // Center the selected tab inside the bar (never scroll the page).
  useLayoutEffect(() => {
    const bar = barRef.current;
    const tab = tabRefs.current.get(activeKey);
    if (!bar || !tab) return;
    bar.scrollTo({
      left: tab.offsetLeft - bar.clientWidth / 2 + tab.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeKey]);

  // Scroll AFTER the swap, so the jump to the top happens while the panel is
  // invisible mid-crossfade rather than yanking the page under a visible one.
  const select = (key: string) => {
    selectKey(key, () => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  const onTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % valid.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + valid.length) % valid.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = valid.length - 1;
    if (next === -1) return;
    e.preventDefault();
    const key = valid[next].key;
    select(key);
    tabRefs.current.get(key)?.focus();
  };

  return (
    <div className="cin-root">
      <ClosePublicMenuButton />
      <div className="cin-atmos" aria-hidden />
      <div className="cin-grain" aria-hidden />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="cin-hero">
        {logoUrl && (
          <img className="cin-logo cin-in" src={logoUrl} alt="" style={{ animationDelay: "60ms" }} />
        )}
        <p className="cin-eyebrow cin-in" style={{ animationDelay: "140ms" }}>
          <span className="cin-eyebrow-line" aria-hidden />
          {menuLabel}
          <span className="cin-eyebrow-line" aria-hidden />
        </p>
        <h1 className="cin-title cin-in" style={{ animationDelay: "220ms" }}>
          {restaurantName}
        </h1>
        <div className="cin-orn cin-in" style={{ animationDelay: "360ms" }} aria-hidden>
          <span className="cin-orn-line" />
          <span className="cin-orn-diamond" />
          <span className="cin-orn-line" />
        </div>
      </header>

      {empty ? (
        <div className="cin-empty">{emptyLabel}</div>
      ) : (
        <>
          {/* ── Sticky course bar ──────────────────────────────────────────── */}
          <nav className="cin-nav" aria-label={menuLabel}>
            <div ref={barRef} role="tablist" className="cin-tabs">
              {valid.map((s, idx) => {
                const on = s.key === active.key;
                return (
                  <button
                    key={s.key}
                    ref={(el) => {
                      if (el) tabRefs.current.set(s.key, el);
                      else tabRefs.current.delete(s.key);
                    }}
                    id={`cin-tab-${s.key}`}
                    role="tab"
                    aria-selected={on}
                    aria-controls="cin-panel"
                    tabIndex={on ? 0 : -1}
                    onClick={() => select(s.key)}
                    onKeyDown={(e) => onTabKeyDown(e, idx)}
                    className={`cin-tab${on ? " is-on" : ""}`}
                  >
                    {s.featured && <span className="cin-tab-star" aria-hidden>✦</span>}
                    {s.title}
                  </button>
                );
              })}
            </div>

            {/* Tag filters — only rendered when the menu actually carries tags,
                so an untagged menu keeps its original clean chrome. */}
            {availableTags.length > 0 && (
              <div className="cin-tagbar" role="group" aria-label={filterLabels.all}>
                <button
                  type="button"
                  onClick={clearTags}
                  aria-pressed={activeTags.length === 0}
                  className={`cin-tagchip${activeTags.length === 0 ? " is-on" : ""}`}
                >
                  {filterLabels.all}
                </button>
                {availableTags.map((label) => {
                  const on = activeTags.includes(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleTag(label)}
                      aria-pressed={on}
                      className={`cin-tagchip${on ? " is-on" : ""}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </nav>

          {/* ── Active course ──────────────────────────────────────────────── */}
          <main
            key={swapKey}
            id="cin-panel"
            role="tabpanel"
            aria-labelledby={`cin-tab-${active.key}`}
            className={`cin-main${phase === "out" ? " is-out" : ""}`}
          >
            <div className="cin-course-head">
              <span className="cin-course-no" aria-hidden>
                {String(activeIdx + 1).padStart(2, "0")}
              </span>
              <h2 className="cin-course-title">{active.title}</h2>
              {active.featured && (
                <span className="cin-badge"><span aria-hidden>✦</span> {featuredLabel}</span>
              )}
              <span className="cin-course-rule" aria-hidden />
            </div>

            {shownItems.length === 0 && <p className="cin-nomatch">{filterLabels.noMatch}</p>}

            <ul className="cin-dishes">
              {shownItems.map((it, i) => {
                const price = priceText(it);
                return (
                  <li
                    key={`${active.prefix}:${it.id}`}
                    className="cin-dish"
                    style={{ ["--i" as string]: i }}
                  >
                    {it.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="cin-thumb" src={it.image_url} alt={it.name} loading="lazy" />
                    )}
                    <div className="cin-dish-body">
                      <div className="cin-dish-row">
                        <h3 className="cin-dish-name">{it.name}</h3>
                        <span className="cin-leader" aria-hidden />
                        {price && <span className="cin-price">{price}</span>}
                      </div>
                      {it.description && <p className="cin-desc">{it.description}</p>}
                      {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                        <div className="cin-pills">
                          {it.tagLabels.map((label, k) => (
                            <span key={`${active.prefix}:${it.id}:tag:${k}`} className="cin-pill cin-pill-tag">{label}</span>
                          ))}
                          {it.allergenLabels.map((label, k) => (
                            <span key={`${active.prefix}:${it.id}:al:${k}`} className="cin-pill cin-pill-al">{label}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Renders only in self-order mode (see OrderLayer). */}
                    <DishAddButton itemId={it.id} className="cin-add" lockedClassName="cin-add is-locked" />
                  </li>
                );
              })}
            </ul>
          </main>
        </>
      )}

      <footer className="cin-footer">
        <span className="cin-foot-line" aria-hidden />
        <span>Powered by <strong>BaliFlow</strong></span>
        <span className="cin-foot-line" aria-hidden />
      </footer>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = `
/* The app's global html,body overflow-x:hidden turns <body> into a scroll
   container, which silently kills every position:sticky on this page. Scoped
   override via :has(): clip still blocks sideways scroll but does NOT create
   a scroll container, so the sticky bars/rail work again. */
html:has(.cin-root), html:has(.cin-root) body {
  overflow-x: clip;
  overflow-y: visible;
}
.cin-root {
  --void: #0a0908;
  --velvet: #121009;
  --ivory: #f2e9d8;
  --ivory-dim: #a89c85;
  --gold: var(--accent, #d4af6a);
  --glass: rgba(255,255,255,0.035);
  --glass-line: rgba(212,175,106,0.16);
  position: relative;
  min-height: 100dvh;
  background:
    radial-gradient(110% 50% at 50% -6%, rgba(212,175,106,0.14), transparent 60%),
    linear-gradient(180deg, var(--void) 0%, var(--velvet) 100%);
  color: var(--ivory);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  overflow-x: clip;
  padding-bottom: env(safe-area-inset-bottom);
}
.cin-atmos {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(46% 30% at 18% 88%, rgba(212,175,106,0.05), transparent 70%),
    radial-gradient(40% 26% at 86% 12%, rgba(212,175,106,0.06), transparent 70%);
}
.cin-grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.35;
  background-image:
    radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1.4px),
    radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1.4px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 2px 3px;
}
.cin-root > *:not(.cin-atmos):not(.cin-grain):not(.cin-nav) { position: relative; z-index: 1; }

/* Hero */
.cin-hero {
  text-align: center;
  padding: clamp(3.6rem, 11vw, 6.5rem) 1.25rem clamp(2.2rem, 6vw, 3.6rem);
  max-width: 60rem; margin: 0 auto;
}
.cin-logo {
  display: block; height: clamp(2.8rem, 10vw, 4.2rem); width: auto; max-width: 70vw;
  object-fit: contain; margin: 0 auto clamp(1.1rem, 4vw, 1.8rem);
  filter: drop-shadow(0 8px 24px rgba(0,0,0,0.6));
}
.cin-eyebrow {
  display: inline-flex; align-items: center; gap: 0.9rem;
  font-size: clamp(0.6rem, 1.6vw, 0.7rem); letter-spacing: 0.5em; text-transform: uppercase;
  font-weight: 600; color: var(--gold); margin: 0 0 clamp(0.9rem, 3vw, 1.4rem);
  padding-left: 0.5em;
}
.cin-eyebrow-line { width: clamp(1.6rem, 8vw, 2.8rem); height: 1px; background: linear-gradient(90deg, transparent, var(--gold)); }
.cin-eyebrow-line:last-child { background: linear-gradient(90deg, var(--gold), transparent); }
.cin-title {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto; font-weight: 500;
  font-size: clamp(2.7rem, 11.5vw, 6rem);
  line-height: 1; letter-spacing: -0.02em; margin: 0;
  text-wrap: balance; padding-bottom: 0.12em;
  background: linear-gradient(180deg, #fdf7ea 0%, #d9bf8d 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 60px rgba(212,175,106,0.25);
}
.cin-orn { display: flex; align-items: center; justify-content: center; gap: 0.8rem; margin-top: clamp(1rem, 3.5vw, 1.6rem); }
.cin-orn-line { width: clamp(2.2rem, 14vw, 4.2rem); height: 1px; background: linear-gradient(90deg, transparent, rgba(212,175,106,0.6)); }
.cin-orn-line:last-child { background: linear-gradient(270deg, transparent, rgba(212,175,106,0.6)); }
.cin-orn-diamond {
  width: 7px; height: 7px; transform: rotate(45deg);
  background: var(--gold); box-shadow: 0 0 14px rgba(212,175,106,0.7);
}

/* Sticky course bar */
.cin-nav {
  position: sticky; top: 0; z-index: 20;
  background: rgba(10,9,8,0.72);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-block: 1px solid var(--glass-line);
}
.cin-tabs {
  display: flex; gap: 0.5rem; overflow-x: auto;
  max-width: 68rem; margin: 0 auto;
  padding: 0.65rem clamp(1rem, 4vw, 2rem);
  scroll-padding-inline: 1rem;
  scrollbar-width: none; -ms-overflow-style: none;
}
.cin-tabs::-webkit-scrollbar { display: none; }
.cin-tab {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body), sans-serif;
  font-size: 0.78rem; font-weight: 600; letter-spacing: 0.06em;
  padding: 0.5rem 1.05rem; border-radius: 999px;
  color: var(--ivory-dim); background: var(--glass);
  border: 1px solid rgba(255,255,255,0.08);
  transition: color .2s ease, background-color .2s ease, border-color .2s ease, box-shadow .2s ease, transform .12s ease;
}
.cin-tab:hover { color: var(--ivory); border-color: rgba(212,175,106,0.4); }
.cin-tab:active { transform: scale(0.95); }
.cin-tab.is-on {
  color: #151009; font-weight: 700;
  background: linear-gradient(135deg, #e9cf9c, var(--gold));
  border-color: transparent;
  box-shadow: 0 6px 22px -8px rgba(212,175,106,0.8);
}
.cin-tab-star { margin-right: 0.35em; font-size: 0.85em; }
.cin-tab:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* Tag filter row — visually secondary to the course tabs above it (smaller,
   hairline glass rather than filled) so the primary navigation stays obvious. */
.cin-tagbar {
  display: flex; gap: 0.4rem; overflow-x: auto;
  max-width: 68rem; margin: 0 auto;
  padding: 0 clamp(1rem, 4vw, 2rem) 0.6rem;
  scrollbar-width: none; -ms-overflow-style: none;
}
.cin-tagbar::-webkit-scrollbar { display: none; }
.cin-tagchip {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body), sans-serif;
  font-size: 0.64rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 0.3rem 0.7rem; border-radius: 999px;
  color: var(--ivory-dim); background: transparent;
  border: 1px solid var(--glass-line);
  transition: color .2s ease, background-color .2s ease, border-color .2s ease;
}
.cin-tagchip:hover { color: var(--ivory); border-color: rgba(212,175,106,0.5); }
.cin-tagchip.is-on { color: #151009; background: var(--gold); border-color: transparent; }
.cin-tagchip:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

.cin-nomatch {
  text-align: center; padding: 3rem 1rem; margin: 0; color: var(--ivory-dim);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.05rem;
}

/* Course head */
.cin-main {
  max-width: 68rem; margin: 0 auto;
  padding: clamp(2rem, 5.5vw, 3.4rem) clamp(1.1rem, 4vw, 2rem) clamp(3rem, 7vw, 5rem);
  animation: cinPanel 260ms ease both;
}
/* Fade-OUT half of the crossfade: the panel keeps this class for FADE_MS
   (useMenuFilters) before the new course mounts and fades in. Duration must
   stay in step with FADE_MS or the swap shows a flash of the old panel. */
.cin-main.is-out { animation: none; opacity: 0; transition: opacity 180ms ease; }
.cin-course-head { text-align: center; margin-bottom: clamp(1.6rem, 5vw, 2.6rem); }
.cin-course-no {
  display: block; font-family: var(--font-display), serif; font-style: italic; font-weight: 500;
  font-size: clamp(0.95rem, 2.8vw, 1.2rem); letter-spacing: 0.12em;
  color: var(--gold); margin-bottom: 0.35rem;
}
.cin-course-title {
  font-family: var(--font-display), Georgia, serif; font-weight: 500;
  font-size: clamp(1.9rem, 7vw, 3rem); line-height: 1.04; letter-spacing: -0.015em;
  margin: 0; text-wrap: balance; padding-bottom: 0.1em;
}
.cin-badge {
  display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 0.75rem;
  font-size: 0.58rem; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase;
  color: #151009; background: linear-gradient(135deg, #e9cf9c, var(--gold));
  padding: 0.32rem 0.75rem; border-radius: 999px;
}
.cin-course-rule {
  display: block; width: 3.6rem; height: 1px; margin: 1rem auto 0;
  background: linear-gradient(90deg, transparent, var(--gold) 35%, var(--gold) 65%, transparent);
}

/* Dishes — glass entries; 1 col phones, 2 cols ≥900px */
.cin-dishes {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: 1fr;
  gap: clamp(0.8rem, 2.5vw, 1.1rem);
}
@media (min-width: 900px) { .cin-dishes { grid-template-columns: 1fr 1fr; } }
.cin-dish {
  display: flex; gap: 1rem; align-items: flex-start; min-width: 0;
  background: var(--glass);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 18px;
  padding: clamp(1rem, 3vw, 1.3rem) clamp(1rem, 3.2vw, 1.4rem);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: cinDish 540ms cubic-bezier(0.16,1,0.3,1) both;
  animation-delay: calc(var(--i) * 55ms + 60ms);
  transition: border-color .25s ease, transform .25s cubic-bezier(0.16,1,0.3,1);
}
@media (hover: hover) {
  .cin-dish:hover { border-color: rgba(212,175,106,0.42); transform: translateY(-2px); }
}
.cin-thumb {
  flex: 0 0 auto; width: clamp(3.8rem, 11vw, 5rem); height: clamp(3.8rem, 11vw, 5rem);
  border-radius: 14px; object-fit: cover;
  border: 1px solid rgba(212,175,106,0.3);
  box-shadow: 0 10px 24px -12px rgba(0,0,0,0.8);
}
.cin-dish-body { flex: 1; min-width: 0; }
.cin-dish-row { display: flex; align-items: baseline; gap: 0.55rem; }
.cin-dish-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 500;
  font-size: clamp(1.1rem, 4.2vw, 1.3rem); line-height: 1.18; letter-spacing: -0.008em;
  margin: 0; min-width: 0;
}
.cin-leader {
  flex: 1 1 0.75rem; min-width: 0.75rem; height: 1px; align-self: center; margin-top: 0.4em;
  background-image: radial-gradient(circle, rgba(212,175,106,0.5) 1px, transparent 1.2px);
  background-size: 7px 1px; background-repeat: repeat-x; background-position: bottom;
}
.cin-price {
  flex: 0 0 auto; font-family: var(--font-display), serif;
  font-weight: 600; font-size: clamp(1rem, 3.6vw, 1.15rem);
  font-variant-numeric: tabular-nums; color: var(--gold);
}
/* Self-order add control — a gold-rimmed glass disc, matching the panel look.
   No hover transform: .cin-dish already lifts on hover and the two would fight. */
.cin-add {
  flex: 0 0 auto; align-self: flex-start; margin-top: 0.1rem;
  display: inline-grid; place-items: center; cursor: pointer;
  height: 2.05rem; min-width: 2.05rem; padding: 0 0.5rem; border-radius: 999px;
  border: 1px solid var(--glass-line); background: var(--glass); color: var(--gold);
  font-family: var(--font-body), sans-serif; font-size: 1.1rem; font-weight: 700; line-height: 1;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  transition: background-color .2s ease, border-color .2s ease;
}
@media (hover: hover) {
  .cin-add:hover { background: rgba(212,175,106,0.18); border-color: var(--gold); }
}
.cin-add:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.cin-add.is-locked {
  cursor: default; color: var(--ivory-dim); border-color: rgba(255,255,255,0.08);
  display: inline-flex; align-items: center; gap: 0.22rem;
  font-size: 0.68rem; font-weight: 700; font-variant-numeric: tabular-nums;
}

.cin-desc {
  margin: 0.45rem 0 0; max-width: 56ch;
  font-size: 0.9rem; line-height: 1.6; color: var(--ivory-dim);
}
.cin-pills { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.65rem; }
.cin-pill {
  font-size: 0.56rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 0.24rem 0.6rem; border-radius: 999px; border: 1px solid transparent;
}
.cin-pill-tag { color: #b9cf9f; background: rgba(150,180,110,0.1); border-color: rgba(150,180,110,0.25); }
.cin-pill-al  { color: #e2c188; background: rgba(212,175,106,0.1); border-color: rgba(212,175,106,0.3); }

.cin-empty {
  text-align: center; padding: 5rem 1.5rem 8rem; color: var(--ivory-dim);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.15rem;
}

.cin-footer {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  padding: 0 1.5rem calc(2.4rem + env(safe-area-inset-bottom));
  font-size: 0.82rem; color: var(--ivory-dim);
}
.cin-footer strong { color: var(--gold); font-weight: 700; }
.cin-foot-line { width: clamp(2rem, 8vw, 4rem); height: 1px; background: linear-gradient(90deg, transparent, var(--glass-line)); }
.cin-foot-line:last-child { background: linear-gradient(270deg, transparent, var(--glass-line)); }

/* Motion */
@keyframes cinIn { from { opacity: 0; transform: translateY(16px); filter: blur(5px); } to { opacity: 1; transform: none; filter: none; } }
.cin-in { animation: cinIn 800ms cubic-bezier(0.16,1,0.3,1) both; }
@keyframes cinPanel { from { opacity: 0; } to { opacity: 1; } }
@keyframes cinDish { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .cin-in, .cin-main, .cin-dish { animation: none !important; }
  .cin-dish, .cin-tab { transition: none !important; }
}
`;
