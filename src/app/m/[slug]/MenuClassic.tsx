"use client";

import { useState, useRef, useLayoutEffect } from "react";

// Public hosted menu, shared via a QR sticker — designed as a premium
// fine-dining card, not a list. The server (page.tsx) does all data work and
// hands us flat, localized sections; we own the presentation.
//
// Direction: "Maître" — a thick cream menu card resting on dark walnut. A
// high-contrast Fraunces serif carries the wordmark, course numbers and dish
// names; Manrope handles body. The CRM's bronze becomes brushed brass. Real
// depth: vignette, paper grain, gold hairline rules, an orchestrated load and
// a tactile tab switch.
//
// Tabs FILTER (they do not anchor-scroll): tapping a course swaps the visible
// section in place with a crossfade + staggered dish reveal. One section is
// mounted at a time.

export type MenuViewItem = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  tags: string[];
  allergens: string[];
  image_url: string | null;
  tagLabels: string[];
  allergenLabels: string[];
};

export type MenuViewSection = {
  key: string;
  prefix: string;
  title: string;
  /** True for collection sections (Consigliati, Specialità…) so we can badge them. */
  featured: boolean;
  items: MenuViewItem[];
};

type Props = {
  restaurantName: string;
  menuLabel: string;
  emptyLabel: string;
  featuredLabel: string;
  sections: MenuViewSection[];
};

function priceText(it: MenuViewItem): string | null {
  if (it.price == null) return null;
  const cur = it.currency === "EUR" ? "€" : it.currency;
  return `${it.price.toFixed(2)} ${cur}`;
}

function romanish(n: number): string {
  // Course index as a two-digit ordinal — quietly premium ("01", "02"…).
  return String(n + 1).padStart(2, "0");
}

export default function MenuClassic({
  restaurantName,
  menuLabel,
  emptyLabel,
  featuredLabel,
  sections,
}: Props) {
  const [activeKey, setActiveKey] = useState<string>(sections[0]?.key ?? "");
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [swapKey, setSwapKey] = useState(0);

  const activeIdx = Math.max(0, sections.findIndex((s) => s.key === activeKey));
  const active = sections[activeIdx] ?? sections[0];

  // Center the selected tab by moving the bar's own scrollLeft (never the
  // document), so selecting a tab can't jolt the page.
  useLayoutEffect(() => {
    const bar = tabBarRef.current;
    const tab = tabRefs.current.get(activeKey);
    if (!bar || !tab) return;
    bar.scrollTo({
      left: tab.offsetLeft - bar.clientWidth / 2 + tab.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeKey]);

  const select = (key: string) => {
    if (key === activeKey) return;
    setActiveKey(key);
    setSwapKey((n) => n + 1);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const onTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % sections.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + sections.length) % sections.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = sections.length - 1;
    if (next === -1) return;
    e.preventDefault();
    const key = sections[next].key;
    select(key);
    tabRefs.current.get(key)?.focus();
  };

  const empty = sections.length === 0;

  return (
    <div className="menu-root min-h-[100dvh]">
      {/* Atmosphere: warm vignette + fine paper grain over the sand canvas. */}
      <div className="menu-grain" aria-hidden />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <header className="menu-hero">
        <div className="menu-hero-inner">
          <p className="menu-eyebrow menu-reveal" style={{ animationDelay: "80ms" }}>
            <span className="menu-eyebrow-line" aria-hidden />
            {menuLabel}
            <span className="menu-eyebrow-line" aria-hidden />
          </p>
          <h1 className="menu-wordmark menu-reveal" style={{ animationDelay: "160ms" }}>
            {restaurantName}
          </h1>
          <div
            className="menu-crest menu-reveal"
            style={{ animationDelay: "300ms" }}
            aria-hidden
          >
            <span className="menu-crest-line" />
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l2.2 6.8H21l-5.5 4 2.1 6.8L12 15.6 6.4 19.6l2.1-6.8L3 8.8h6.8L12 2z"
                fill="currentColor"
                opacity="0.9"
              />
            </svg>
            <span className="menu-crest-line" />
          </div>
        </div>
      </header>

      {empty ? (
        <div className="menu-empty">{emptyLabel}</div>
      ) : (
        <>
          {/* ── Sticky course tabs ───────────────────────────────────────── */}
          <nav className="menu-nav" aria-label={menuLabel}>
            <div className="menu-nav-inner">
              <div ref={tabBarRef} role="tablist" className="menu-tabs">
                {sections.map((s, idx) => {
                  const on = s.key === active.key;
                  return (
                    <button
                      key={s.key}
                      ref={(el) => {
                        if (el) tabRefs.current.set(s.key, el);
                        else tabRefs.current.delete(s.key);
                      }}
                      id={`tab-${s.key}`}
                      role="tab"
                      aria-selected={on}
                      aria-controls="menu-panel"
                      tabIndex={on ? 0 : -1}
                      onClick={() => select(s.key)}
                      onKeyDown={(e) => onTabKeyDown(e, idx)}
                      className={`menu-tab${on ? " is-on" : ""}`}
                    >
                      {s.featured && <span className="menu-tab-star" aria-hidden>✦</span>}
                      {s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* ── Active course ────────────────────────────────────────────── */}
          <main className="menu-main">
            <section
              key={swapKey}
              id="menu-panel"
              role="tabpanel"
              aria-labelledby={`tab-${active.key}`}
              className="menu-panel"
            >
              <div className="menu-course-head">
                <span className="menu-course-no" aria-hidden>
                  {romanish(activeIdx)}
                </span>
                {active.featured && (
                  <span className="menu-badge">
                    <span aria-hidden>✦</span> {featuredLabel}
                  </span>
                )}
                <h2 className="menu-course-title">{active.title}</h2>
                <span className="menu-course-rule" aria-hidden />
              </div>

              <ul className="menu-dishes">
                {active.items.map((it, i) => {
                  const price = priceText(it);
                  return (
                    <li
                      key={`${active.prefix}:${it.id}`}
                      className="menu-dish"
                      style={{ ["--i" as string]: i }}
                    >
                      <div className="menu-dish-row">
                        <h3 className="menu-dish-name">{it.name}</h3>
                        {price && <span className="menu-price">{price}</span>}
                      </div>

                      {it.description && (
                        <p className="menu-dish-desc">{it.description}</p>
                      )}

                      {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                        <div className="menu-chips">
                          {it.tagLabels.map((label, idx2) => (
                            <span
                              key={`${active.prefix}:${it.id}:tag:${idx2}`}
                              className="menu-chip menu-chip-tag"
                            >
                              {label}
                            </span>
                          ))}
                          {it.allergenLabels.map((label, idx2) => (
                            <span
                              key={`${active.prefix}:${it.id}:al:${idx2}`}
                              className="menu-chip menu-chip-al"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </main>
        </>
      )}

      <footer className="menu-footer">
        <span className="menu-foot-rule" aria-hidden />
        Powered by <span className="menu-foot-brand">BaliFlow</span>
      </footer>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
// Kept inline so the public route ships its own self-contained look without
// touching the CRM's global stylesheet. Palette is the CRM's bronze/sand,
// pushed to a premium "brushed brass on cream paper" register.
const styles = `
.menu-root {
  --paper: #f7efe2;
  --paper-deep: #efe3cf;
  --ink: #1c150d;
  --ink-soft: #4a3f30;
  --brass: #b07a32;
  --brass-deep: #7e5226;
  --brass-soft: #d8b483;
  --walnut: #2a1d11;
  --olive: #5c6c4b;
  position: relative;
  color: var(--ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  background:
    radial-gradient(120% 60% at 50% -10%, rgba(176,122,50,0.10), transparent 60%),
    linear-gradient(180deg, #fbf4e8 0%, #f4e8d4 46%, #ecdcc4 100%);
  overflow-x: hidden;
}
.menu-grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5;
  background-image:
    radial-gradient(rgba(124,82,38,0.045) 1px, transparent 1.4px),
    radial-gradient(rgba(124,82,38,0.03) 1px, transparent 1.4px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 2px 3px;
  mix-blend-mode: multiply;
  mask-image: radial-gradient(140% 100% at 50% 0%, #000 55%, transparent 100%);
}
.menu-root > *:not(.menu-grain) { position: relative; z-index: 1; }

/* Hero — walnut band with a brass underglow, cream wordmark. */
.menu-hero {
  background:
    radial-gradient(80% 120% at 50% 120%, rgba(176,122,50,0.38), transparent 62%),
    linear-gradient(170deg, #34251600 0%, transparent 100%),
    linear-gradient(180deg, #2a1d11 0%, #20160c 100%);
  color: var(--paper);
  padding: clamp(2.6rem, 9vw, 4.6rem) 1.25rem clamp(2.2rem, 7vw, 3.4rem);
  text-align: center;
  border-bottom: 1px solid rgba(216,180,131,0.28);
  box-shadow: inset 0 -1px 0 rgba(216,180,131,0.18), 0 18px 40px -28px rgba(42,29,17,0.9);
}
.menu-hero-inner { max-width: 40rem; margin: 0 auto; }
.menu-eyebrow {
  display: flex; align-items: center; justify-content: center; gap: 0.85rem;
  font-size: 0.62rem; letter-spacing: 0.42em; text-transform: uppercase;
  font-weight: 600; color: var(--brass-soft); margin: 0 0 0.95rem;
  padding-left: 0.42em; /* optical balance for the tracking */
}
.menu-eyebrow-line { width: clamp(1.4rem, 8vw, 2.6rem); height: 1px; background: linear-gradient(90deg, transparent, var(--brass-soft)); }
.menu-eyebrow-line:last-child { background: linear-gradient(90deg, var(--brass-soft), transparent); }
.menu-wordmark {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto;
  font-weight: 600;
  font-size: clamp(2.5rem, 13vw, 4.6rem);
  line-height: 0.98;
  letter-spacing: -0.02em;
  margin: 0;
  text-wrap: balance;
  background: linear-gradient(180deg, #fbf1df 0%, #e9cd9f 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 1px 0 rgba(0,0,0,0.04);
}
.menu-crest { display: flex; align-items: center; justify-content: center; gap: 0.7rem; margin-top: 1.15rem; color: var(--brass-soft); }
.menu-crest-line { width: clamp(2rem, 16vw, 4rem); height: 1px; background: linear-gradient(90deg, transparent, rgba(216,180,131,0.7)); }
.menu-crest-line:last-child { background: linear-gradient(90deg, rgba(216,180,131,0.7), transparent); }

/* Sticky course tabs */
.menu-nav {
  position: sticky; top: 0; z-index: 20;
  background: rgba(247,239,226,0.86);
  backdrop-filter: saturate(1.5) blur(14px);
  -webkit-backdrop-filter: saturate(1.5) blur(14px);
  border-bottom: 1px solid rgba(176,122,50,0.22);
}
.menu-nav-inner { max-width: 42rem; margin: 0 auto; }
.menu-tabs {
  display: flex; gap: 0.5rem; overflow-x: auto;
  padding: 0.6rem 1rem; scroll-padding-inline: 1rem;
  scrollbar-width: none; -ms-overflow-style: none;
}
.menu-tabs::-webkit-scrollbar { display: none; }
.menu-tab {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body), sans-serif;
  font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em;
  padding: 0.5rem 0.95rem; border-radius: 999px;
  color: var(--ink-soft);
  background: rgba(176,122,50,0.08);
  border: 1px solid rgba(28,21,13,0.12);
  transition: color .22s ease, background-color .22s ease, border-color .22s ease, box-shadow .22s ease, transform .12s ease;
}
.menu-tab:hover { background: rgba(176,122,50,0.16); color: var(--ink); }
.menu-tab:active { transform: scale(0.95); }
.menu-tab.is-on {
  color: #fdf6ea;
  background: linear-gradient(135deg, #936125, #76491c);
  border-color: #6a431a;
  box-shadow: 0 6px 18px -6px rgba(126,82,38,0.7), inset 0 1px 0 rgba(255,255,255,0.18);
}
.menu-tab-star { margin-right: 0.3em; font-size: 0.82em; vertical-align: middle; color: var(--brass-soft); }
.menu-tab.is-on .menu-tab-star { color: #fdf0d6; }
.menu-tab:focus-visible { outline: 2px solid var(--brass-deep); outline-offset: 2px; }

/* Active course */
.menu-main { max-width: 42rem; margin: 0 auto; padding: clamp(2rem, 7vw, 3rem) clamp(1.25rem, 5vw, 2.5rem) 5rem; }
.menu-course-head { position: relative; text-align: center; margin-bottom: clamp(1.6rem, 5vw, 2.4rem); }
.menu-course-no {
  display: block; font-family: var(--font-display), serif; font-style: italic;
  font-weight: 600; font-size: 1rem; letter-spacing: 0.1em;
  color: var(--brass-deep); margin-bottom: 0.3rem;
}
.menu-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.6rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
  color: #fdf6ea; background: var(--olive); padding: 0.3rem 0.7rem; border-radius: 999px;
  margin-bottom: 0.7rem;
}
.menu-course-title {
  font-family: var(--font-display), Georgia, serif; font-optical-sizing: auto;
  font-weight: 600; font-size: clamp(1.7rem, 7vw, 2.5rem); line-height: 1.05;
  letter-spacing: -0.015em; margin: 0; text-wrap: balance;
}
.menu-course-rule {
  display: block; width: 3.4rem; height: 2px; margin: 0.9rem auto 0;
  background: linear-gradient(90deg, transparent, var(--brass) 35%, var(--brass) 65%, transparent);
}

/* Dishes */
.menu-dishes { list-style: none; margin: 0; padding: 0; }
.menu-dish { padding: clamp(1rem, 3.5vw, 1.35rem) 0; }
.menu-dish:first-child { padding-top: 0; }
.menu-dish-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.9rem; }
.menu-dish-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.08rem, 4.6vw, 1.3rem); line-height: 1.2; letter-spacing: -0.01em; margin: 0;
}
.menu-price {
  flex: 0 0 auto; font-family: var(--font-display), serif;
  font-weight: 600; font-size: clamp(1rem, 4vw, 1.18rem); font-variant-numeric: tabular-nums;
  color: var(--brass-deep);
}
.menu-dish-desc {
  margin: 0.45rem 0 0; max-width: 56ch;
  font-size: 0.92rem; line-height: 1.6; color: var(--ink-soft);
  font-style: italic;
}
.menu-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.7rem; }
.menu-chip {
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 0.22rem 0.6rem; border-radius: 999px;
}
.menu-chip-tag { background: rgba(92,108,75,0.14); color: var(--olive); }
.menu-chip-al { background: rgba(176,122,50,0.14); color: var(--brass-deep); font-weight: 600; }

.menu-empty { text-align: center; padding: 6rem 1.5rem; color: var(--brass-deep);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.1rem; }

.menu-footer {
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: 0.5rem 1rem 2.6rem; font-size: 0.68rem; color: rgba(28,21,13,0.4);
}
.menu-foot-rule { width: 1.6rem; height: 1px; background: rgba(124,82,38,0.35); }
.menu-foot-brand { font-weight: 700; color: var(--brass-deep); }

/* ── Motion ─────────────────────────────────────────────────────────────── */
@keyframes menuReveal { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.menu-reveal { animation: menuReveal 760ms cubic-bezier(0.16,1,0.3,1) both; }

@keyframes menuPanelIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes menuDishIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes menuHeadIn { from { opacity: 0; transform: translateY(8px) scale(0.99); } to { opacity: 1; transform: none; } }
.menu-panel { animation: menuPanelIn 240ms ease both; }
.menu-panel .menu-course-head { animation: menuHeadIn 480ms cubic-bezier(0.16,1,0.3,1) both; }
.menu-dish { animation: menuDishIn 520ms cubic-bezier(0.16,1,0.3,1) both; animation-delay: calc(var(--i) * 55ms + 80ms); }

@media (prefers-reduced-motion: reduce) {
  .menu-reveal, .menu-panel, .menu-dish, .menu-course-head { animation: none !important; }
  .menu-wordmark { filter: none; }
  .menu-tab { transition: none !important; }
}
`;
