"use client";

import { useEffect, useRef, useState } from "react";
import { ClosePublicMenuButton } from "./ClosePublicMenuButton";

// Public hosted menu — Template 4 "CLASSICO".
//
// Direction: a real printed fine-dining carte. A thick cream paper card rests
// on dark walnut; brass hairlines, small-caps course titles with Roman-ish
// numerals, dotted leaders from dish to price, italic descriptions. The WHOLE
// menu flows on one card — like paper — with a slim sticky course index that
// anchor-scrolls and highlights the course being read. Photos stay discreet:
// a small round porthole beside the entry, only when present.
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
  sections: MenuViewSection[];
  logoUrl?: string;
};

function priceText(it: MenuViewItem): string | null {
  if (it.price == null) return null;
  const cur = it.currency === "EUR" ? "€" : it.currency;
  return `${it.price.toFixed(2)} ${cur}`;
}

export default function MenuClassic({
  restaurantName,
  menuLabel,
  emptyLabel,
  featuredLabel,
  sections,
  logoUrl,
}: Props) {
  const valid = sections.filter((s) => s.items.length > 0);
  const empty = valid.length === 0;

  const [activeKey, setActiveKey] = useState<string>(valid[0]?.key ?? "");
  const barRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<string, HTMLElement>>(new Map());
  const secRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Suppress the scrollspy while a tapped anchor is still smooth-scrolling.
  const clickLock = useRef<{ key: string; until: number } | null>(null);

  // Scrollspy: highlight the course crossing the upper third of the viewport.
  useEffect(() => {
    const els = Array.from(secRefs.current.entries());
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const key = (e.target as HTMLElement).dataset.seckey;
          if (!key) continue;
          const lock = clickLock.current;
          if (lock && Date.now() < lock.until && key !== lock.key) continue;
          setActiveKey(key);
        }
      },
      { rootMargin: "-18% 0px -72% 0px" },
    );
    els.forEach(([, el]) => io.observe(el));
    return () => io.disconnect();
  }, [valid.length]);

  // Keep the active chip centered in its own scroller (never the page).
  useEffect(() => {
    const bar = barRef.current;
    const chip = chipRefs.current.get(activeKey);
    if (!bar || !chip) return;
    bar.scrollTo({
      left: chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeKey]);

  const goTo = (key: string) => {
    const el = secRefs.current.get(key);
    if (!el) return;
    clickLock.current = { key, until: Date.now() + 900 };
    setActiveKey(key);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="cla-root">
      <ClosePublicMenuButton />
      <div className="cla-grain" aria-hidden />

      <div className="cla-stage">
        <div className="cla-paper">
          {/* ── Card head ─────────────────────────────────────────────────── */}
          <header className="cla-head">
            {logoUrl && (
              <img className="cla-logo cla-in" src={logoUrl} alt="" style={{ animationDelay: "40ms" }} />
            )}
            <p className="cla-eyebrow cla-in" style={{ animationDelay: "100ms" }}>
              <span className="cla-eyebrow-line" aria-hidden />
              {menuLabel}
              <span className="cla-eyebrow-line" aria-hidden />
            </p>
            <h1 className="cla-title cla-in" style={{ animationDelay: "180ms" }}>
              {restaurantName}
            </h1>
            <div className="cla-crest cla-in" style={{ animationDelay: "300ms" }} aria-hidden>
              <span className="cla-crest-line" />
              <span className="cla-crest-star" />
              <span className="cla-crest-line" />
            </div>
          </header>

          {empty ? (
            <div className="cla-empty">{emptyLabel}</div>
          ) : (
            <>
              {/* ── Sticky course index ─────────────────────────────────────── */}
              <nav className="cla-nav" aria-label={menuLabel}>
                <div ref={barRef} className="cla-chips">
                  {valid.map((s) => (
                    <button
                      key={s.key}
                      ref={(el) => {
                        if (el) chipRefs.current.set(s.key, el);
                        else chipRefs.current.delete(s.key);
                      }}
                      onClick={() => goTo(s.key)}
                      className={`cla-chip${s.key === activeKey ? " is-on" : ""}`}
                    >
                      {s.featured && <span className="cla-star" aria-hidden>✦ </span>}
                      {s.title}
                    </button>
                  ))}
                </div>
              </nav>

              {/* ── Courses — the whole carte flows like paper ──────────────── */}
              <main className="cla-main">
                {valid.map((s, si) => (
                  <section
                    key={s.key}
                    data-seckey={s.key}
                    ref={(el) => {
                      if (el) secRefs.current.set(s.key, el);
                      else secRefs.current.delete(s.key);
                    }}
                    className="cla-course"
                  >
                    <div className="cla-course-head">
                      <span className="cla-course-no" aria-hidden>
                        {String(si + 1).padStart(2, "0")}
                      </span>
                      <h2 className="cla-course-title">{s.title}</h2>
                      {s.featured && (
                        <span className="cla-badge"><span aria-hidden>✦</span> {featuredLabel}</span>
                      )}
                      <span className="cla-course-rule" aria-hidden />
                    </div>

                    <ul className="cla-dishes">
                      {s.items.map((it) => {
                        const price = priceText(it);
                        return (
                          <li key={`${s.prefix}:${it.id}`} className="cla-dish">
                            {it.image_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className="cla-thumb" src={it.image_url} alt={it.name} loading="lazy" />
                            )}
                            <div className="cla-dish-body">
                              <div className="cla-dish-row">
                                <h3 className="cla-dish-name">{it.name}</h3>
                                <span className="cla-leader" aria-hidden />
                                {price && <span className="cla-price">{price}</span>}
                              </div>
                              {it.description && <p className="cla-desc">{it.description}</p>}
                              {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                                <div className="cla-pills">
                                  {it.tagLabels.map((label, k) => (
                                    <span key={`${s.prefix}:${it.id}:tag:${k}`} className="cla-pill cla-pill-tag">{label}</span>
                                  ))}
                                  {it.allergenLabels.map((label, k) => (
                                    <span key={`${s.prefix}:${it.id}:al:${k}`} className="cla-pill cla-pill-al">{label}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {si < valid.length - 1 && (
                      <div className="cla-divider" aria-hidden>
                        <span className="cla-divider-line" />
                        <span className="cla-divider-star" />
                        <span className="cla-divider-line" />
                      </div>
                    )}
                  </section>
                ))}
              </main>
            </>
          )}

          <footer className="cla-footer">
            Powered by <strong>BaliFlow</strong>
          </footer>
        </div>
      </div>

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
html:has(.cla-root), html:has(.cla-root) body {
  overflow-x: clip;
  overflow-y: visible;
}
.cla-root {
  --walnut: #221710;
  --walnut-deep: #170f0a;
  --paper: #f8f1e3;
  --paper-edge: #eadfc8;
  --ink: #241b10;
  --ink-soft: #5a4c39;
  --brass: var(--accent, #a4762f);
  --brass-deep: #7c5622;
  --olive: #5c6c4b;
  position: relative;
  min-height: 100dvh;
  background:
    radial-gradient(90% 60% at 50% 0%, rgba(164,118,47,0.15), transparent 60%),
    linear-gradient(180deg, var(--walnut) 0%, var(--walnut-deep) 100%);
  color: var(--ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  overflow-x: clip;
}
.cla-grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.4;
  background-image:
    radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1.4px),
    radial-gradient(rgba(255,255,255,0.014) 1px, transparent 1.4px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 2px 3px;
}
.cla-root > *:not(.cla-grain) { position: relative; z-index: 1; }

/* The paper card resting on walnut. Full-bleed on phones, floating on md+. */
.cla-stage { padding: 0; }
@media (min-width: 700px) {
  .cla-stage { padding: clamp(1.6rem, 4vw, 3.4rem) clamp(1.25rem, 4vw, 3rem) calc(clamp(1.6rem, 4vw, 3.4rem) + env(safe-area-inset-bottom)); }
}
.cla-paper {
  position: relative;
  max-width: 50rem; margin: 0 auto;
  min-height: 100dvh;
  background:
    radial-gradient(120% 50% at 50% -6%, rgba(164,118,47,0.09), transparent 60%),
    linear-gradient(180deg, #fbf5e9 0%, var(--paper) 40%, var(--paper-edge) 100%);
  box-shadow: 0 40px 90px -40px rgba(0,0,0,0.9), 0 0 0 1px rgba(164,118,47,0.25);
  padding-bottom: calc(1rem + env(safe-area-inset-bottom));
}
@media (min-width: 700px) {
  .cla-paper { min-height: 0; border-radius: 8px; }
}
/* Paper grain */
.cla-paper::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  border-radius: inherit; opacity: 0.5; mix-blend-mode: multiply;
  background-image:
    radial-gradient(rgba(124,86,34,0.05) 1px, transparent 1.4px),
    radial-gradient(rgba(124,86,34,0.035) 1px, transparent 1.4px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 2px 3px;
}
/* Inner brass frame */
.cla-paper::after {
  content: ""; position: absolute; inset: clamp(0.55rem, 2vw, 0.9rem); pointer-events: none;
  border: 1px solid rgba(164,118,47,0.35); border-radius: 4px;
}

/* Card head */
.cla-head { text-align: center; padding: clamp(2.8rem, 9vw, 4.4rem) clamp(1.5rem, 6vw, 3.5rem) clamp(1.4rem, 4vw, 2.2rem); }
.cla-logo {
  display: block; height: clamp(2.6rem, 9vw, 3.8rem); width: auto; max-width: 66%;
  object-fit: contain; margin: 0 auto clamp(1rem, 3.5vw, 1.5rem);
}
.cla-eyebrow {
  display: inline-flex; align-items: center; gap: 0.85rem;
  font-size: 0.62rem; letter-spacing: 0.46em; text-transform: uppercase;
  font-weight: 700; color: var(--brass-deep); margin: 0 0 1rem;
  padding-left: 0.46em;
}
.cla-eyebrow-line { width: clamp(1.4rem, 8vw, 2.6rem); height: 1px; background: linear-gradient(90deg, transparent, var(--brass)); }
.cla-eyebrow-line:last-child { background: linear-gradient(90deg, var(--brass), transparent); }
.cla-title {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto; font-weight: 600;
  font-size: clamp(2.4rem, 10.5vw, 4.4rem);
  line-height: 1; letter-spacing: -0.02em; margin: 0;
  text-wrap: balance; padding-bottom: 0.12em;
  color: var(--ink);
}
.cla-crest { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-top: 1rem; }
.cla-crest-line { width: clamp(2rem, 14vw, 3.8rem); height: 1px; background: linear-gradient(90deg, transparent, rgba(164,118,47,0.7)); }
.cla-crest-line:last-child { background: linear-gradient(270deg, transparent, rgba(164,118,47,0.7)); }
.cla-crest-star {
  width: 0.95rem; height: 0.95rem; flex: none; background: var(--brass);
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

/* Sticky course index — cream glass, brass active state */
.cla-nav {
  position: sticky; top: 0; z-index: 20;
  background: rgba(248,241,227,0.92);
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  border-block: 1px solid rgba(164,118,47,0.28);
}
.cla-chips {
  display: flex; gap: 0.45rem; overflow-x: auto;
  padding: 0.55rem clamp(1rem, 4vw, 2rem);
  scroll-padding-inline: 1rem; scrollbar-width: none; -ms-overflow-style: none;
}
.cla-chips::-webkit-scrollbar { display: none; }
.cla-chip {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: inherit;
  font-size: 0.76rem; font-weight: 700; letter-spacing: 0.05em;
  padding: 0.46rem 0.95rem; border-radius: 999px;
  color: var(--ink-soft); background: rgba(164,118,47,0.07);
  border: 1px solid rgba(36,27,16,0.14);
  transition: color .2s ease, background-color .2s ease, border-color .2s ease, box-shadow .2s ease, transform .12s ease;
}
.cla-chip:hover { color: var(--ink); background: rgba(164,118,47,0.15); }
.cla-chip:active { transform: scale(0.95); }
.cla-chip.is-on {
  color: #fdf6ea;
  background: linear-gradient(135deg, #96662a, #74501e);
  border-color: #6a481b;
  box-shadow: 0 6px 18px -6px rgba(124,86,34,0.7);
}
.cla-chip:focus-visible { outline: 2px solid var(--brass-deep); outline-offset: 2px; }
.cla-star { color: var(--brass-deep); }
.cla-chip.is-on .cla-star { color: #f3ddb2; }

/* Courses */
.cla-main { padding: clamp(1.8rem, 6vw, 3rem) clamp(1.5rem, 6vw, 3.5rem) clamp(2rem, 6vw, 3rem); }
.cla-course { scroll-margin-top: 4rem; }
.cla-course-head { text-align: center; margin-bottom: clamp(1.4rem, 4.5vw, 2.2rem); }
.cla-course-no {
  display: block; font-family: var(--font-display), serif; font-style: italic; font-weight: 600;
  font-size: 1rem; letter-spacing: 0.1em; color: var(--brass-deep); margin-bottom: 0.3rem;
}
.cla-course-title {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.65rem, 6.5vw, 2.4rem); line-height: 1.05; letter-spacing: -0.015em;
  margin: 0; text-wrap: balance; padding-bottom: 0.12em;
}
.cla-badge {
  display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 0.6rem;
  font-size: 0.58rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
  color: #fdf6ea; background: var(--olive); padding: 0.3rem 0.7rem; border-radius: 999px;
}
.cla-course-rule {
  display: block; width: 3.4rem; height: 2px; margin: 0.9rem auto 0;
  background: linear-gradient(90deg, transparent, var(--brass) 35%, var(--brass) 65%, transparent);
}

/* Dishes — single elegant column; roomy 2-col only on wide desktop */
.cla-dishes {
  list-style: none; margin: 0 auto; padding: 0; max-width: 40rem;
  display: grid; grid-template-columns: 1fr; gap: clamp(1.15rem, 4vw, 1.6rem);
}
.cla-dish { display: flex; gap: 0.95rem; align-items: flex-start; min-width: 0; }
.cla-thumb {
  flex: 0 0 auto; width: clamp(3.4rem, 9vw, 4.2rem); height: clamp(3.4rem, 9vw, 4.2rem);
  border-radius: 50%; object-fit: cover;
  border: 2px solid rgba(164,118,47,0.4);
  box-shadow: 0 8px 18px -10px rgba(36,27,16,0.6);
}
.cla-dish-body { flex: 1; min-width: 0; }
.cla-dish-row { display: flex; align-items: baseline; gap: 0.55rem; }
.cla-dish-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.08rem, 4.4vw, 1.28rem); line-height: 1.2; letter-spacing: -0.01em;
  margin: 0; min-width: 0;
}
.cla-leader {
  flex: 1 1 0.75rem; min-width: 0.75rem; height: 1px; align-self: center; margin-top: 0.4em;
  background-image: radial-gradient(circle, rgba(124,86,34,0.55) 1px, transparent 1.2px);
  background-size: 7px 1px; background-repeat: repeat-x; background-position: bottom;
}
.cla-price {
  flex: 0 0 auto; font-family: var(--font-display), serif;
  font-weight: 600; font-size: clamp(1rem, 4vw, 1.16rem);
  font-variant-numeric: tabular-nums; color: var(--brass-deep);
}
.cla-desc {
  margin: 0.4rem 0 0; max-width: 54ch;
  font-family: var(--font-display), serif; font-style: italic;
  font-size: 0.96rem; line-height: 1.55; color: var(--ink-soft);
}
.cla-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.6rem; }
.cla-pill {
  font-size: 0.57rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
  padding: 0.22rem 0.58rem; border-radius: 999px;
}
.cla-pill-tag { background: rgba(92,108,75,0.15); color: var(--olive); }
.cla-pill-al  { background: rgba(164,118,47,0.15); color: var(--brass-deep); }

/* Star divider between courses */
.cla-divider {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  width: min(320px, 72%); margin: clamp(1.8rem, 6vw, 2.8rem) auto;
}
.cla-divider-line { flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(124,86,34,0.55)); }
.cla-divider-line:last-child { background: linear-gradient(270deg, transparent, rgba(124,86,34,0.55)); }
.cla-divider-star {
  width: 0.8rem; height: 0.8rem; flex: none; background: rgba(124,86,34,0.75);
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

.cla-empty {
  text-align: center; padding: 4rem 1.5rem 6rem; color: var(--brass-deep);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.1rem;
}

.cla-footer {
  text-align: center; padding: 0.8rem 1.5rem 2.2rem;
  font-size: 0.82rem; color: var(--ink-soft);
}
.cla-footer strong { color: var(--brass-deep); font-weight: 800; }

/* Motion */
@keyframes claIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.cla-in { animation: claIn 700ms cubic-bezier(0.16,1,0.3,1) both; }
@media (prefers-reduced-motion: reduce) {
  .cla-in { animation: none !important; }
  .cla-chip { transition: none !important; }
}
`;
