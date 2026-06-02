"use client";

import { useState, useRef, useLayoutEffect } from "react";

// ── Design 3 — "CINEMATIC / Dark Materic Glass" ─────────────────────────────
// A nocturnal chef's-table register: a near-black, hand-finished canvas with
// fine grain, a deep vignette and warm brass underglows that breathe. Dishes
// arrive as luminous frosted-glass objects floating on the dark — each photo
// dissolves into the void through a gradient mask, ringed by a gold rim-light;
// dishes without a photo become engraved glass plaques, beautiful on their own.
//
// Conventions mirror MenuView.tsx: "use client", inline `styles` string, the
// same price formatter, tabs that FILTER (swap one section in place with a
// staggered reveal — never anchor-scroll), full a11y on the tablist, and a
// strict prefers-reduced-motion path. Everything is self-contained; the only
// import is React, and the palette is pure brass-on-black, no new deps.

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
  /** True for collection sections (Selezione, Consigliati…) so we can badge them. */
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

function courseNo(n: number): string {
  return String(n + 1).padStart(2, "0");
}

export default function MenuCinematic({
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  const activeIdx = Math.max(0, sections.findIndex((s) => s.key === activeKey));
  const active = sections[activeIdx] ?? sections[0];

  // Center the selected tab inside its own scroller (never the document), so
  // switching courses can't jolt the page.
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
    <div className="cin-root" ref={rootRef}>
      {/* Atmosphere — layered glows, vignette and grain over the near-black. */}
      <div className="cin-atmos" aria-hidden>
        <span className="cin-glow cin-glow-a" />
        <span className="cin-glow cin-glow-b" />
        <span className="cin-vignette" />
        <span className="cin-grain" />
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <header className="cin-hero">
        <div className="cin-hero-inner">
          <p className="cin-eyebrow cin-reveal" style={{ animationDelay: "80ms" }}>
            <span className="cin-eyebrow-line" aria-hidden />
            {menuLabel}
            <span className="cin-eyebrow-line" aria-hidden />
          </p>
          <h1 className="cin-wordmark cin-reveal" style={{ animationDelay: "180ms" }}>
            {restaurantName}
          </h1>
          <div className="cin-crest cin-reveal" style={{ animationDelay: "340ms" }} aria-hidden>
            <span className="cin-crest-line" />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l2.2 6.8H21l-5.5 4 2.1 6.8L12 15.6 6.4 19.6l2.1-6.8L3 8.8h6.8L12 2z"
                fill="currentColor"
                opacity="0.95"
              />
            </svg>
            <span className="cin-crest-line" />
          </div>
        </div>
      </header>

      {empty ? (
        <div className="cin-empty">{emptyLabel}</div>
      ) : (
        <>
          {/* ── Sticky course tabs ─────────────────────────────────────────── */}
          <nav className="cin-nav" aria-label={menuLabel}>
            <div className="cin-nav-inner">
              <div ref={tabBarRef} role="tablist" className="cin-tabs">
                {sections.map((s, idx) => {
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
                      {s.featured && (
                        <span className="cin-tab-star" aria-hidden>
                          ✦
                        </span>
                      )}
                      {s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* ── Active course ──────────────────────────────────────────────── */}
          <main className="cin-main">
            <section
              key={swapKey}
              id="cin-panel"
              role="tabpanel"
              aria-labelledby={`cin-tab-${active.key}`}
              className="cin-panel"
            >
              <div className="cin-course-head">
                <span className="cin-course-no" aria-hidden>
                  {courseNo(activeIdx)}
                </span>
                {active.featured && (
                  <span className="cin-badge">
                    <span aria-hidden>✦</span> {featuredLabel}
                  </span>
                )}
                <h2 className="cin-course-title">{active.title}</h2>
                <span className="cin-course-rule" aria-hidden />
              </div>

              <ul className="cin-grid">
                {active.items.map((it, i) => {
                  const price = priceText(it);
                  const hasImg = !!it.image_url;
                  const hasChips =
                    it.tagLabels.length > 0 || it.allergenLabels.length > 0;
                  return (
                    <li
                      key={`${active.prefix}:${it.id}`}
                      className={`cin-card${hasImg ? " has-img" : " no-img"}`}
                      style={{ ["--i" as string]: i }}
                    >
                      <article className="cin-card-inner" tabIndex={0}>
                        <span className="cin-rim" aria-hidden />

                        <div className="cin-media" aria-hidden={!hasImg}>
                          {hasImg ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                className="cin-photo"
                                src={it.image_url as string}
                                alt={it.name}
                                loading="lazy"
                                decoding="async"
                              />
                              <span className="cin-media-fade" aria-hidden />
                            </>
                          ) : (
                            <span className="cin-engrave" aria-hidden>
                              <span className="cin-engrave-mono">
                                {it.name.slice(0, 1).toUpperCase()}
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="cin-body">
                          <div className="cin-row">
                            <h3 className="cin-name">{it.name}</h3>
                            {price && <span className="cin-price">{price}</span>}
                          </div>

                          {it.description && (
                            <p className="cin-desc">{it.description}</p>
                          )}

                          {hasChips && (
                            <div className="cin-chips">
                              {it.tagLabels.map((label, idx2) => (
                                <span
                                  key={`${active.prefix}:${it.id}:tag:${idx2}`}
                                  className="cin-chip cin-chip-tag"
                                >
                                  {label}
                                </span>
                              ))}
                              {it.allergenLabels.map((label, idx2) => (
                                <span
                                  key={`${active.prefix}:${it.id}:al:${idx2}`}
                                  className="cin-chip cin-chip-al"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          </main>
        </>
      )}

      <footer className="cin-footer">
        <span className="cin-foot-by">Powered by</span>{" "}
        <span className="cin-foot-brand">BaliFlow</span>
      </footer>

      <div className="cin-foot-orn" aria-hidden>
        <span className="cin-foot-orn-line" />
        <span className="cin-foot-orn-star" />
        <span className="cin-foot-orn-line" />
      </div>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
// Inline so this public route ships a self-contained look without touching the
// CRM's global stylesheet. Brass-on-black, glass with criterion-led blur.
const styles = `
.cin-root {
  --bg: #0a0805;
  --bg-2: #100b06;
  --panel: rgba(28,21,12,0.42);
  --panel-2: rgba(20,15,9,0.55);
  --line: rgba(217,182,128,0.16);
  --line-hi: rgba(233,205,159,0.42);
  --cream: #efe6d4;
  --cream-soft: #cfc2a6;
  --muted: #9b8e74;
  --brass: #d8b483;
  --brass-deep: #b07a32;
  --brass-lo: #8a5f28;
  --gold-text: #e9cd9f;
  position: relative;
  min-height: 100dvh;
  color: var(--cream);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  background:
    radial-gradient(130% 80% at 50% -10%, rgba(176,122,50,0.12), transparent 55%),
    linear-gradient(180deg, #0c0906 0%, #0a0805 40%, #080603 100%);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* Atmosphere ─────────────────────────────────────────────────────────────── */
/* The glows drift on their own slow loop (GPU transform only) instead of being
   driven by scroll — a scroll-linked blur(70px) repaint was the main source of
   jank on mobile. Static-feeling, cinematic, and cheap. */
.cin-atmos { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
.cin-glow { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.55; will-change: transform; }
.cin-glow-a {
  width: 60vmax; height: 60vmax; left: -18vmax; top: -22vmax;
  background: radial-gradient(circle, rgba(176,122,50,0.34), transparent 62%);
  animation: cinDriftA 26s ease-in-out infinite alternate;
}
.cin-glow-b {
  width: 52vmax; height: 52vmax; right: -20vmax; top: 42vmax;
  background: radial-gradient(circle, rgba(138,95,40,0.26), transparent 64%);
  animation: cinDriftB 32s ease-in-out infinite alternate;
}
@keyframes cinDriftA { from { transform: translate3d(0,0,0); } to { transform: translate3d(2vmax,3vmax,0); } }
@keyframes cinDriftB { from { transform: translate3d(0,0,0); } to { transform: translate3d(-2.5vmax,-2vmax,0); } }
.cin-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(120% 95% at 50% 32%, transparent 48%, rgba(0,0,0,0.62) 100%);
}
.cin-grain {
  position: absolute; inset: 0; opacity: 0.5; mix-blend-mode: soft-light;
  background-image:
    radial-gradient(rgba(233,205,159,0.10) 0.5px, transparent 0.9px),
    radial-gradient(rgba(255,255,255,0.05) 0.5px, transparent 0.9px);
  background-size: 3px 3px, 5px 5px;
  background-position: 0 0, 1px 2px;
}
.cin-root > *:not(.cin-atmos) { position: relative; z-index: 1; }

/* Hero ───────────────────────────────────────────────────────────────────── */
.cin-hero {
  text-align: center;
  padding: clamp(3.4rem, 13vw, 6rem) 1.25rem clamp(1.6rem, 6vw, 2.6rem);
}
.cin-hero-inner { max-width: 42rem; margin: 0 auto; }
.cin-eyebrow {
  display: flex; align-items: center; justify-content: center; gap: 0.85rem;
  font-size: 0.6rem; letter-spacing: 0.44em; text-transform: uppercase;
  font-weight: 600; color: var(--brass); margin: 0 0 1.05rem; padding-left: 0.44em;
}
.cin-eyebrow-line { width: clamp(1.3rem, 8vw, 2.6rem); height: 1px; background: linear-gradient(90deg, transparent, var(--brass)); }
.cin-eyebrow-line:last-child { background: linear-gradient(90deg, var(--brass), transparent); }
.cin-wordmark {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto; font-weight: 600;
  font-size: clamp(2.7rem, 14vw, 5.2rem); line-height: 0.96;
  letter-spacing: -0.022em; margin: 0; text-wrap: balance;
  background: linear-gradient(176deg, #fbf3e2 0%, #e9cd9f 52%, #b07a32 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 8px 30px rgba(176,122,50,0.28));
}
.cin-crest { display: flex; align-items: center; justify-content: center; gap: 0.7rem; margin-top: 1.2rem; color: var(--brass); }
.cin-crest-line { width: clamp(2rem, 16vw, 4rem); height: 1px; background: linear-gradient(90deg, transparent, rgba(216,180,131,0.7)); }
.cin-crest-line:last-child { background: linear-gradient(90deg, rgba(216,180,131,0.7), transparent); }

/* Sticky course tabs ─────────────────────────────────────────────────────── */
.cin-nav {
  position: sticky; top: 0; z-index: 20;
  background: linear-gradient(180deg, rgba(10,8,5,0.92), rgba(10,8,5,0.62));
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  border-bottom: 1px solid var(--line);
}
.cin-nav-inner { max-width: 64rem; margin: 0 auto; }
.cin-tabs {
  display: flex; gap: 0.5rem; overflow-x: auto;
  padding: 0.65rem 1rem; scroll-padding-inline: 1rem;
  scrollbar-width: none; -ms-overflow-style: none;
}
.cin-tabs::-webkit-scrollbar { display: none; }
.cin-tab {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body), sans-serif;
  font-size: 0.76rem; font-weight: 700; letter-spacing: 0.05em;
  padding: 0.5rem 0.95rem; border-radius: 999px; color: var(--cream-soft);
  background: rgba(217,182,128,0.05);
  border: 1px solid rgba(217,182,128,0.16);
  transition: color .24s ease, background-color .24s ease, border-color .24s ease, box-shadow .24s ease, transform .12s ease;
}
.cin-tab:hover { background: rgba(217,182,128,0.12); color: var(--cream); border-color: rgba(217,182,128,0.3); }
.cin-tab:active { transform: scale(0.95); }
.cin-tab.is-on {
  color: #1a1206;
  background: linear-gradient(135deg, #e9cd9f, #c89758 60%, #b07a32);
  border-color: rgba(233,205,159,0.7);
  box-shadow: 0 0 0 1px rgba(233,205,159,0.25), 0 8px 24px -8px rgba(176,122,50,0.7), 0 0 22px -4px rgba(216,180,131,0.45);
}
.cin-tab-star { margin-right: 0.32em; font-size: 0.82em; color: var(--brass); }
.cin-tab.is-on .cin-tab-star { color: #6b4518; }
.cin-tab:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }

/* Course head ────────────────────────────────────────────────────────────── */
.cin-main { max-width: 64rem; margin: 0 auto; padding: clamp(2rem, 6vw, 3.2rem) clamp(1rem, 4vw, 2rem) 4rem; }
.cin-course-head { position: relative; text-align: center; margin-bottom: clamp(1.8rem, 5vw, 2.8rem); }
.cin-course-no {
  display: block; font-family: var(--font-display), serif; font-style: italic;
  font-weight: 500; font-size: 1rem; letter-spacing: 0.12em; color: var(--brass); margin-bottom: 0.35rem;
}
.cin-badge {
  display: inline-flex; align-items: center; gap: 0.42rem;
  font-size: 0.58rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--gold-text); background: rgba(176,122,50,0.14);
  border: 1px solid rgba(217,182,128,0.32);
  padding: 0.3rem 0.72rem; border-radius: 999px; margin-bottom: 0.8rem;
}
.cin-course-title {
  font-family: var(--font-display), Georgia, serif; font-optical-sizing: auto;
  font-weight: 600; font-size: clamp(1.9rem, 7vw, 2.9rem); line-height: 1.04;
  letter-spacing: -0.018em; margin: 0; text-wrap: balance;
  background: linear-gradient(180deg, #f6efdd, #d3b988);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.cin-course-rule {
  display: block; width: 3.6rem; height: 1px; margin: 1rem auto 0;
  background: linear-gradient(90deg, transparent, var(--brass) 40%, var(--brass) 60%, transparent);
  box-shadow: 0 0 12px rgba(216,180,131,0.5);
}

/* Dish grid ──────────────────────────────────────────────────────────────── */
.cin-grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: clamp(0.9rem, 2.6vw, 1.3rem);
  grid-template-columns: 1fr;
}
@media (min-width: 680px) { .cin-grid { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1040px) { .cin-grid { grid-template-columns: 1fr 1fr 1fr; } }

.cin-card { position: relative; }
.cin-card-inner {
  position: relative; height: 100%; overflow: hidden;
  border-radius: 20px;
  background:
    linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
  border: 1px solid var(--line);
  box-shadow:
    0 1px 0 rgba(233,205,159,0.06) inset,
    0 24px 50px -28px rgba(0,0,0,0.85);
  backdrop-filter: blur(10px) saturate(1.05);
  -webkit-backdrop-filter: blur(10px) saturate(1.05);
  transition: transform .4s cubic-bezier(0.16,1,0.3,1), box-shadow .4s ease, border-color .4s ease;
  outline: none;
}
.cin-card-inner:hover,
.cin-card-inner:focus-visible {
  transform: translateY(-4px);
  border-color: var(--line-hi);
  box-shadow:
    0 1px 0 rgba(233,205,159,0.12) inset,
    0 0 0 1px rgba(217,182,128,0.18),
    0 30px 60px -26px rgba(0,0,0,0.9),
    0 0 38px -10px rgba(176,122,50,0.4);
}
/* Gold rim-light tracing the card edge, faint + breathing per-card. */
.cin-rim {
  position: absolute; inset: 0; border-radius: 20px; padding: 1px;
  background: linear-gradient(140deg, rgba(233,205,159,0.55), transparent 32%, transparent 66%, rgba(216,180,131,0.35));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  opacity: 0.48; pointer-events: none;
  transition: opacity .4s ease;
}
.cin-card-inner:hover .cin-rim,
.cin-card-inner:focus-visible .cin-rim { opacity: 0.95; }

/* Media — photo dissolving into the dark, or an engraved glass plaque. */
.cin-media { position: relative; aspect-ratio: 16 / 11; overflow: hidden; }
.has-img .cin-media { background: #0a0805; }
.cin-photo {
  width: 100%; height: 100%; object-fit: cover; display: block;
  filter: saturate(1.04) contrast(1.04) brightness(0.94);
  transform: scale(1.02);
  transition: transform .6s cubic-bezier(0.16,1,0.3,1), filter .5s ease;
}
.cin-card-inner:hover .cin-photo,
.cin-card-inner:focus-visible .cin-photo { transform: scale(1.07); filter: saturate(1.12) contrast(1.06) brightness(1); }
.cin-media-fade {
  position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(8,6,3,0) 38%, rgba(10,8,5,0.55) 78%, var(--panel-2) 100%),
    radial-gradient(120% 80% at 50% 0%, transparent 55%, rgba(8,6,3,0.4) 100%);
}
/* Engraved fallback — luminous monogram on textured glass. */
.no-img .cin-media { aspect-ratio: 16 / 9; display: grid; place-items: center;
  background:
    radial-gradient(80% 90% at 50% 20%, rgba(176,122,50,0.16), transparent 60%),
    repeating-linear-gradient(125deg, rgba(233,205,159,0.035) 0 2px, transparent 2px 9px),
    linear-gradient(180deg, rgba(24,18,10,0.6), rgba(12,9,5,0.7));
}
.cin-engrave-mono {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(3.2rem, 9vw, 4.4rem); line-height: 1;
  color: transparent;
  background: linear-gradient(180deg, #f3e8cf, #b07a32);
  -webkit-background-clip: text; background-clip: text;
  text-shadow: 0 1px 0 rgba(0,0,0,0.5);
  filter: drop-shadow(0 0 18px rgba(176,122,50,0.35));
  opacity: 0.92;
}

/* Body — name, price, description, chips. */
.cin-body { padding: clamp(0.95rem, 3vw, 1.2rem) clamp(1rem, 3.2vw, 1.3rem) clamp(1.1rem, 3.4vw, 1.35rem); }
.cin-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.7rem; }
.cin-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.12rem, 4.4vw, 1.32rem); line-height: 1.18; letter-spacing: -0.01em;
  margin: 0; color: var(--cream);
}
.cin-price {
  flex: 0 0 auto; font-family: var(--font-display), serif; font-weight: 500;
  font-size: clamp(0.98rem, 3.6vw, 1.14rem); font-variant-numeric: tabular-nums;
  color: var(--gold-text); white-space: nowrap;
}
.cin-desc {
  margin: 0.5rem 0 0; font-size: 0.88rem; line-height: 1.58; color: var(--cream-soft);
  font-style: italic;
}
.cin-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.85rem; }
.cin-chip {
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
  padding: 0.24rem 0.62rem; border-radius: 999px; border: 1px solid transparent;
}
.cin-chip-tag { background: rgba(217,182,128,0.1); color: var(--brass); border-color: rgba(217,182,128,0.22); }
.cin-chip-al { background: rgba(155,142,116,0.1); color: var(--muted); border-color: rgba(155,142,116,0.24); font-weight: 600; }

/* Empty + footer ─────────────────────────────────────────────────────────── */
.cin-empty {
  text-align: center; padding: 6rem 1.5rem; color: var(--brass);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.15rem;
}
.cin-footer {
  display: flex; align-items: center; justify-content: center; gap: 0.6rem;
  padding: 10px; font-size: 0.84rem;
}
.cin-foot-rule { width: 2rem; height: 1px; background: rgba(217,182,128,0.45); }
.cin-foot-by { color: #fff; font-weight: 500; }
.cin-foot-brand { font-weight: 700; color: var(--brass); }

/* Decorative star divider beneath "Powered by". */
.cin-foot-orn {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  width: min(360px, 78%); margin: -1rem auto 0; padding-bottom: 2.8rem;
}
.cin-foot-orn-line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(217,182,128,0.5) 70%, rgba(217,182,128,0.68));
}
.cin-foot-orn-line:last-child {
  background: linear-gradient(270deg, transparent, rgba(217,182,128,0.5) 70%, rgba(217,182,128,0.68));
}
.cin-foot-orn-star {
  width: 1.05rem; height: 1.05rem; flex: none; background: var(--brass-soft, #d8b483);
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

/* Motion ─────────────────────────────────────────────────────────────────── */
@keyframes cinReveal { from { opacity: 0; transform: translateY(16px); filter: blur(5px); } to { opacity: 1; transform: none; filter: none; } }
.cin-reveal { animation: cinReveal 820ms cubic-bezier(0.16,1,0.3,1) both; }

@keyframes cinPanelIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes cinHeadIn { from { opacity: 0; transform: translateY(10px) scale(0.99); } to { opacity: 1; transform: none; } }
@keyframes cinCardIn { from { opacity: 0; transform: translateY(22px) scale(0.985); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }

.cin-panel { animation: cinPanelIn 260ms ease both; }
.cin-panel .cin-course-head { animation: cinHeadIn 560ms cubic-bezier(0.16,1,0.3,1) both; }
.cin-card { animation: cinCardIn 640ms cubic-bezier(0.16,1,0.3,1) both; animation-delay: calc(var(--i) * 70ms + 90ms); }

@media (prefers-reduced-motion: reduce) {
  .cin-reveal, .cin-panel, .cin-card, .cin-course-head, .cin-rim, .cin-photo { animation: none !important; }
  .cin-wordmark { filter: none; }
  .cin-glow-a, .cin-glow-b { transform: none !important; }
  .cin-card-inner, .cin-photo, .cin-tab { transition: none !important; }
  .cin-card-inner:hover, .cin-card-inner:focus-visible { transform: none; }
}
`;
