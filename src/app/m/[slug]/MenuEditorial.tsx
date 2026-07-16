"use client";

import { useEffect, useRef, useState } from "react";
import { ClosePublicMenuButton } from "./ClosePublicMenuButton";

// Public hosted menu — Template 2 "EDITORIALE".
//
// Direction: a gourmet-magazine issue. Warm paper white, ink-black oversized
// serif masthead, numbered courses with hairline rules, dishes set like
// magazine entries (bold serif name, sienna price, italic description, small
// round photo). Everything flows on ONE page like a real printed issue: the
// nav is an index that anchor-scrolls — sticky chip bar on phones, a sticky
// left table-of-contents rail on desktop, with a scrollspy highlighting the
// course being read.
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

export default function MenuEditorial({
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
  const chipBarRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<string, HTMLElement>>(new Map());
  const secRefs = useRef<Map<string, HTMLElement>>(new Map());
  // While an index tap is smooth-scrolling, the spy would flicker through every
  // section in between — suppress it until the scroll settles on the target.
  const clickLock = useRef<{ key: string; until: number } | null>(null);

  // Scrollspy: the course whose heading zone crosses the upper third wins.
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
      { rootMargin: "-20% 0px -70% 0px" },
    );
    els.forEach(([, el]) => io.observe(el));
    return () => io.disconnect();
  }, [valid.length]);

  // Keep the active chip visible in the mobile bar (scroll the bar only).
  useEffect(() => {
    const bar = chipBarRef.current;
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
    <div className="edi-root">
      <ClosePublicMenuButton />

      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="edi-mast">
        <div className="edi-mast-top edi-in" style={{ animationDelay: "40ms" }}>
          <span className="edi-mast-rule" aria-hidden />
          <span className="edi-mast-label">{menuLabel}</span>
          <span className="edi-mast-rule" aria-hidden />
        </div>
        {logoUrl && (
          <img className="edi-logo edi-in" src={logoUrl} alt="" style={{ animationDelay: "120ms" }} />
        )}
        <h1 className="edi-title edi-in" style={{ animationDelay: "180ms" }}>
          {restaurantName}
        </h1>
        {!empty && (
          <p className="edi-deck edi-in" style={{ animationDelay: "320ms" }}>
            {valid.map((s, i) => (
              <span key={s.key}>
                {i > 0 && <span className="edi-deck-sep" aria-hidden> · </span>}
                {s.title}
              </span>
            ))}
          </p>
        )}
      </header>

      {empty ? (
        <div className="edi-empty">{emptyLabel}</div>
      ) : (
        <div className="edi-shell">
          {/* ── Index — left rail ≥1024px, sticky chips below ────────────── */}
          <nav className="edi-rail" aria-label={menuLabel}>
            <p className="edi-rail-head">{menuLabel}</p>
            <ul>
              {valid.map((s, i) => (
                <li key={s.key}>
                  <button
                    onClick={() => goTo(s.key)}
                    className={`edi-rail-link${s.key === activeKey ? " is-on" : ""}`}
                  >
                    <span className="edi-rail-no">{String(i + 1).padStart(2, "0")}</span>
                    <span className="edi-rail-title">
                      {s.featured && <span className="edi-star" aria-hidden>✦ </span>}
                      {s.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="edi-chipbar" aria-label={menuLabel}>
            <div ref={chipBarRef} className="edi-chips">
              {valid.map((s) => (
                <button
                  key={s.key}
                  ref={(el) => {
                    if (el) chipRefs.current.set(s.key, el);
                    else chipRefs.current.delete(s.key);
                  }}
                  onClick={() => goTo(s.key)}
                  className={`edi-chip${s.key === activeKey ? " is-on" : ""}`}
                >
                  {s.featured && <span className="edi-star" aria-hidden>✦ </span>}
                  {s.title}
                </button>
              ))}
            </div>
          </nav>

          {/* ── Courses ──────────────────────────────────────────────────── */}
          <main className="edi-main">
            {valid.map((s, si) => (
              <section
                key={s.key}
                data-seckey={s.key}
                ref={(el) => {
                  if (el) secRefs.current.set(s.key, el);
                  else secRefs.current.delete(s.key);
                }}
                className={`edi-course${s.featured ? " is-featured" : ""}`}
              >
                <div className="edi-course-head">
                  <span className="edi-course-no" aria-hidden>
                    {String(si + 1).padStart(2, "0")}
                  </span>
                  <h2 className="edi-course-title">{s.title}</h2>
                  {s.featured && <span className="edi-badge"><span aria-hidden>✦</span> {featuredLabel}</span>}
                </div>

                <ul className="edi-dishes">
                  {s.items.map((it) => {
                    const price = priceText(it);
                    return (
                      <li key={`${s.prefix}:${it.id}`} className="edi-dish">
                        {it.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="edi-thumb" src={it.image_url} alt={it.name} loading="lazy" />
                        )}
                        <div className="edi-dish-body">
                          <div className="edi-dish-row">
                            <h3 className="edi-dish-name">{it.name}</h3>
                            <span className="edi-leader" aria-hidden />
                            {price && <span className="edi-price">{price}</span>}
                          </div>
                          {it.description && <p className="edi-desc">{it.description}</p>}
                          {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                            <div className="edi-pills">
                              {it.tagLabels.map((label, k) => (
                                <span key={`${s.prefix}:${it.id}:tag:${k}`} className="edi-pill edi-pill-tag">{label}</span>
                              ))}
                              {it.allergenLabels.map((label, k) => (
                                <span key={`${s.prefix}:${it.id}:al:${k}`} className="edi-pill edi-pill-al">{label}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </main>
        </div>
      )}

      <footer className="edi-footer">
        <span className="edi-foot-rule" aria-hidden />
        <span>Powered by <strong>BaliFlow</strong></span>
        <span className="edi-foot-rule" aria-hidden />
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
html:has(.edi-root), html:has(.edi-root) body {
  overflow-x: clip;
  overflow-y: visible;
}
.edi-root {
  --paper: #faf6ee;
  --ink: #1b1611;
  --ink-soft: #5c5347;
  --sienna: var(--accent, #b3542e);
  --hair: rgba(27,22,17,0.16);
  min-height: 100dvh;
  background:
    radial-gradient(100% 40% at 50% 0%, rgba(179,84,46,0.05), transparent 70%),
    var(--paper);
  color: var(--ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  overflow-x: clip;
  padding-bottom: env(safe-area-inset-bottom);
}

/* Masthead */
.edi-mast {
  max-width: 72rem; margin: 0 auto; text-align: center;
  padding: clamp(3.2rem, 9vw, 5.5rem) clamp(1.25rem, 5vw, 3rem) clamp(1.8rem, 5vw, 3rem);
  border-bottom: 3px double var(--ink);
}
.edi-mast-top { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-bottom: clamp(1.1rem, 4vw, 1.8rem); }
.edi-mast-rule { flex: 1; max-width: 9rem; height: 1px; background: var(--hair); }
.edi-mast-label {
  font-size: clamp(0.62rem, 1.8vw, 0.72rem); font-weight: 700;
  letter-spacing: 0.55em; text-transform: uppercase; color: var(--sienna);
  padding-left: 0.55em;
}
.edi-logo {
  display: block; height: clamp(2.6rem, 9vw, 4rem); width: auto; max-width: 66vw;
  object-fit: contain; margin: 0 auto clamp(1rem, 3.5vw, 1.6rem);
}
.edi-title {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto; font-weight: 600;
  font-size: clamp(2.9rem, 12.5vw, 7rem);
  line-height: 0.98; letter-spacing: -0.025em; margin: 0;
  text-wrap: balance; padding-bottom: 0.12em;
}
.edi-deck {
  margin: clamp(0.8rem, 2.5vw, 1.2rem) auto 0; max-width: 46rem;
  font-family: var(--font-display), serif; font-style: italic;
  font-size: clamp(0.95rem, 3vw, 1.15rem); line-height: 1.6; color: var(--ink-soft);
  text-wrap: balance;
}
.edi-deck-sep { color: var(--sienna); }

/* Shell: single column on phones; rail 16rem + content on ≥1024px */
.edi-shell { max-width: 72rem; margin: 0 auto; }
@media (min-width: 1024px) {
  .edi-shell {
    display: grid; grid-template-columns: 16rem 1fr;
    gap: clamp(2rem, 4vw, 4rem);
    padding: 0 clamp(1.25rem, 4vw, 3rem);
    align-items: start;
  }
}

/* Left TOC rail — desktop only */
.edi-rail { display: none; }
@media (min-width: 1024px) {
  .edi-rail {
    display: block; position: sticky; top: clamp(1.5rem, 4vh, 3rem);
    padding: 2.4rem 0 2rem;
  }
  .edi-rail-head {
    font-size: 0.62rem; font-weight: 800; letter-spacing: 0.4em; text-transform: uppercase;
    color: var(--ink-soft); margin: 0 0 1.1rem; padding-left: 0.4em;
  }
  .edi-rail ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
  .edi-rail-link {
    display: flex; align-items: baseline; gap: 0.75rem; width: 100%;
    padding: 0.5rem 0.6rem; margin-left: -0.6rem; border-radius: 10px;
    cursor: pointer; text-align: left; border: 0; background: transparent;
    color: var(--ink-soft); transition: color .18s ease, background-color .18s ease;
    font-family: inherit;
  }
  .edi-rail-link:hover { color: var(--ink); background: rgba(27,22,17,0.05); }
  .edi-rail-no {
    font-family: var(--font-display), serif; font-style: italic;
    font-size: 0.8rem; color: var(--sienna); min-width: 1.5rem;
  }
  .edi-rail-title { font-size: 0.92rem; font-weight: 600; line-height: 1.3; }
  .edi-rail-link.is-on { color: var(--ink); background: rgba(179,84,46,0.09); }
  .edi-rail-link.is-on .edi-rail-title { font-weight: 800; }
  .edi-rail-link:focus-visible { outline: 2px solid var(--sienna); outline-offset: 2px; }
}

/* Sticky chip bar — phones/tablet */
.edi-chipbar {
  position: sticky; top: 0; z-index: 20;
  background: rgba(250,246,238,0.9);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  border-bottom: 1px solid var(--hair);
}
@media (min-width: 1024px) { .edi-chipbar { display: none; } }
.edi-chips {
  display: flex; gap: 0.45rem; overflow-x: auto;
  padding: 0.6rem clamp(1rem, 4vw, 2rem);
  scroll-padding-inline: 1rem; scrollbar-width: none; -ms-overflow-style: none;
}
.edi-chips::-webkit-scrollbar { display: none; }
.edi-chip {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: inherit;
  font-size: 0.78rem; font-weight: 700; letter-spacing: 0.03em;
  padding: 0.48rem 0.95rem; border-radius: 999px;
  color: var(--ink-soft); background: transparent;
  border: 1px solid var(--hair);
  transition: color .18s ease, background-color .18s ease, border-color .18s ease, transform .12s ease;
}
.edi-chip:hover { color: var(--ink); }
.edi-chip:active { transform: scale(0.95); }
.edi-chip.is-on { color: var(--paper); background: var(--ink); border-color: var(--ink); }
.edi-chip:focus-visible { outline: 2px solid var(--sienna); outline-offset: 2px; }
.edi-star { color: var(--sienna); }
.edi-chip.is-on .edi-star { color: #eec7a2; }

/* Courses */
.edi-main {
  padding: clamp(1.6rem, 5vw, 2.6rem) clamp(1.25rem, 5vw, 3rem) clamp(2.5rem, 6vw, 4rem);
  min-width: 0;
}
@media (min-width: 1024px) { .edi-main { padding-inline: 0; } }
.edi-course { padding: clamp(1.4rem, 4vw, 2.2rem) 0; scroll-margin-top: 4.2rem; }
@media (min-width: 1024px) { .edi-course { scroll-margin-top: 1.5rem; } }
.edi-course + .edi-course { border-top: 1px solid var(--hair); }
.edi-course.is-featured {
  background: linear-gradient(180deg, rgba(179,84,46,0.06), rgba(179,84,46,0.02));
  border: 1px solid rgba(179,84,46,0.18); border-radius: 18px;
  padding-inline: clamp(1.1rem, 3.5vw, 2rem);
  margin-block: clamp(0.9rem, 2.5vw, 1.4rem);
}
.edi-course.is-featured + .edi-course { border-top: 0; }
.edi-course-head {
  display: flex; align-items: baseline; gap: 0.9rem; flex-wrap: wrap;
  margin-bottom: clamp(1.1rem, 3.5vw, 1.7rem);
}
.edi-course-no {
  font-family: var(--font-display), serif; font-style: italic; font-weight: 500;
  font-size: clamp(1.05rem, 3vw, 1.4rem); color: var(--sienna);
}
.edi-course-title {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.75rem, 6.5vw, 2.8rem); line-height: 1.02; letter-spacing: -0.02em;
  margin: 0; text-wrap: balance; padding-bottom: 0.1em;
}
.edi-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.58rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--paper); background: var(--sienna);
  padding: 0.3rem 0.7rem; border-radius: 999px; transform: translateY(-0.3em);
}

/* Dishes — 1 col phones, 2-col magazine spread ≥768px */
.edi-dishes {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: 1fr;
  gap: clamp(1.1rem, 3.5vw, 1.6rem) clamp(2rem, 4vw, 3rem);
}
@media (min-width: 768px) { .edi-dishes { grid-template-columns: 1fr 1fr; } }
.edi-dish { display: flex; gap: 0.95rem; align-items: flex-start; min-width: 0; }
.edi-thumb {
  flex: 0 0 auto; width: clamp(3.6rem, 10vw, 4.4rem); height: clamp(3.6rem, 10vw, 4.4rem);
  border-radius: 50%; object-fit: cover;
  border: 1px solid var(--hair);
  box-shadow: 0 6px 16px -8px rgba(27,22,17,0.4);
}
.edi-dish-body { flex: 1; min-width: 0; }
.edi-dish-row { display: flex; align-items: baseline; gap: 0.55rem; }
.edi-dish-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.05rem, 4vw, 1.22rem); line-height: 1.2; letter-spacing: -0.008em;
  margin: 0; min-width: 0;
}
.edi-leader {
  flex: 1 1 0.75rem; min-width: 0.75rem; height: 1px; align-self: center; margin-top: 0.35em;
  background-image: radial-gradient(circle, rgba(27,22,17,0.42) 1px, transparent 1.2px);
  background-size: 6px 1px; background-repeat: repeat-x; background-position: bottom;
}
.edi-price {
  flex: 0 0 auto; font-family: var(--font-body), sans-serif;
  font-weight: 800; font-size: clamp(0.95rem, 3.4vw, 1.05rem);
  font-variant-numeric: tabular-nums; color: var(--sienna);
}
.edi-desc {
  margin: 0.4rem 0 0; max-width: 52ch;
  font-family: var(--font-display), serif; font-style: italic;
  font-size: 0.95rem; line-height: 1.55; color: var(--ink-soft);
}
.edi-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.6rem; }
.edi-pill {
  font-size: 0.56rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 0.22rem 0.55rem; border-radius: 999px;
}
.edi-pill-tag { color: #47632e; background: rgba(101,140,66,0.13); }
.edi-pill-al  { color: var(--sienna); background: rgba(179,84,46,0.11); }

.edi-empty {
  text-align: center; padding: 5rem 1.5rem 8rem; color: var(--ink-soft);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.15rem;
}

.edi-footer {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  max-width: 72rem; margin: 0 auto;
  padding: 1.6rem 1.5rem calc(2.4rem + env(safe-area-inset-bottom));
  border-top: 3px double var(--ink);
  font-size: 0.82rem; color: var(--ink-soft);
}
.edi-footer strong { color: var(--sienna); font-weight: 800; }
.edi-foot-rule { width: clamp(1.6rem, 6vw, 3rem); height: 1px; background: var(--hair); }

/* Motion */
@keyframes ediIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.edi-in { animation: ediIn 720ms cubic-bezier(0.16,1,0.3,1) both; }
@media (prefers-reduced-motion: reduce) {
  .edi-in { animation: none !important; }
  .edi-chip, .edi-rail-link { transition: none !important; }
}
`;
