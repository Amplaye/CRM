"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ── Design 2 — "EDITORIAL / Gourmet Magazine" ───────────────────────────────
// A printed luxury food-magazine spread (Kinfolk / Cereal / a Michelin carte on
// heavy stock) ported to a single React route. Oversized Fraunces display type
// is the protagonist; an asymmetric bento of photographs in varying crops sits
// inside a warm ivory page with a single bronze accent. Courses are numbered
// chapters ("01 — Antipasti") fronted by a sticky table-of-contents index.
//
// Photos enter editorially: the first item of a course can run as a wide
// full-bleed lead, the rest fall into a broken bento (tall, square, small) that
// recomposes to one column on phones. Items WITHOUT a photo never leave a hole —
// the dish name itself becomes the graphic: a large italic typographic block.
//
// Conventions mirror MenuView.tsx: "use client", inline `styles` string,
// shared price formatter, tag/allergen chips, prefers-reduced-motion respected.

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
};

function priceText(it: MenuViewItem): string | null {
  if (it.price == null) return null;
  const cur = it.currency === "EUR" ? "€" : it.currency;
  return `${it.price.toFixed(2)} ${cur}`;
}

function chapterNo(n: number): string {
  return String(n + 1).padStart(2, "0");
}

// Editorial bento rhythm. Each item gets a deterministic "shape" from its index
// within the course, so the asymmetry is intentional and repeatable (no random).
// "lead"  → wide full-bleed photo card (course opener, only if it has an image)
// "tall"  → portrait crop, spans two rows
// "wide"  → landscape crop, spans two columns
// "square"→ compact square crop
// A purely typographic block is used whenever an item has no image.
type Shape = "lead" | "tall" | "wide" | "square";

function shapeFor(index: number, hasImage: boolean): Shape {
  if (!hasImage) return "square"; // grid footprint only; rendered as type block
  if (index === 0) return "lead";
  // Repeating editorial cadence after the lead: tall, square, square, wide…
  const cadence: Shape[] = ["tall", "square", "square", "wide", "square", "tall"];
  return cadence[(index - 1) % cadence.length];
}

export default function MenuEditorial({
  restaurantName,
  menuLabel,
  emptyLabel,
  featuredLabel,
  sections,
}: Props) {
  const empty = sections.length === 0;
  const [activeKey, setActiveKey] = useState<string>(sections[0]?.key ?? "");
  const [swapKey, setSwapKey] = useState(0);
  const indexRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const activeIdx = Math.max(0, sections.findIndex((s) => s.key === activeKey));
  const active = sections[activeIdx] ?? sections[0];

  // Keep the active chapter chip centered in its scroller without moving the page.
  useEffect(() => {
    const bar = indexRef.current;
    const chip = chipRefs.current.get(activeKey);
    if (!bar || !chip) return;
    bar.scrollTo({
      left: chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeKey]);

  // Chapters FILTER in place (like the other templates): tapping one swaps the
  // visible course with a crossfade + staggered reveal. Only one chapter is
  // mounted at a time — so we render ~one course of photos, not all 88, which
  // also keeps scrolling smooth.
  const jumpTo = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      if (key === activeKey) return;
      setActiveKey(key);
      setSwapKey((n) => n + 1);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [activeKey],
  );

  return (
    <div className="ed-root">
      <div className="ed-grain" aria-hidden />

      {/* ── Masthead ──────────────────────────────────────────────────────── */}
      <header className="ed-mast">
        <div className="ed-mast-row">
          <span className="ed-issue" aria-hidden>
            La&nbsp;Carta
          </span>
          <span className="ed-issue ed-issue-end" aria-hidden>
            {menuLabel}
          </span>
        </div>
        <h1 className="ed-title">{restaurantName}</h1>
        <p className="ed-dek">
          <span className="ed-dek-line" aria-hidden />
          {menuLabel}
          <span className="ed-dek-line" aria-hidden />
        </p>
      </header>

      {empty ? (
        <div className="ed-empty">{emptyLabel}</div>
      ) : (
        <>
          {/* ── Sticky table of contents ───────────────────────────────────── */}
          <nav className="ed-toc" aria-label={menuLabel}>
            <div ref={indexRef} className="ed-toc-track">
              {sections.map((s, i) => {
                const on = s.key === activeKey;
                return (
                  <a
                    key={s.key}
                    ref={(el) => {
                      if (el) chipRefs.current.set(s.key, el);
                      else chipRefs.current.delete(s.key);
                    }}
                    href={`#ch-${s.key}`}
                    onClick={(e) => jumpTo(s.key, e)}
                    aria-current={on ? "true" : undefined}
                    className={`ed-toc-chip${on ? " is-on" : ""}`}
                  >
                    <span className="ed-toc-no" aria-hidden>
                      {chapterNo(i)}
                    </span>
                    <span className="ed-toc-name">{s.title}</span>
                    {s.featured && (
                      <span className="ed-toc-star" aria-hidden>
                        ✦
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          </nav>

          {/* ── Active chapter (filtered in place) ─────────────────────────── */}
          <main className="ed-main">
            {(() => {
              const section = active;
              const si = activeIdx;
              return (
              <section
                key={swapKey}
                id={`ch-${section.key}`}
                data-key={section.key}
                className="ed-chapter"
                aria-labelledby={`ch-h-${section.key}`}
              >
                <div className="ed-chap-head">
                  <span className="ed-chap-no" aria-hidden>
                    {chapterNo(si)}
                  </span>
                  <div className="ed-chap-meta">
                    {section.featured && (
                      <span className="ed-chap-badge">
                        <span aria-hidden>✦</span> {featuredLabel}
                      </span>
                    )}
                    <h2 id={`ch-h-${section.key}`} className="ed-chap-title">
                      {section.title}
                    </h2>
                  </div>
                  <span className="ed-chap-rule" aria-hidden />
                </div>

                <div className="ed-bento">
                  {section.items.map((it, ii) => {
                    const price = priceText(it);
                    const hasImg = !!it.image_url;
                    const shape = shapeFor(ii, hasImg);
                    const chips =
                      it.tagLabels.length > 0 || it.allergenLabels.length > 0;

                    return (
                      <article
                        key={`${section.prefix}:${it.id}`}
                        className={`ed-card ed-${shape}${
                          hasImg ? " has-img" : " no-img"
                        }`}
                        style={{ ["--i" as string]: ii }}
                      >
                        {hasImg ? (
                          <div className="ed-photo-wrap">
                            <img
                              className="ed-photo"
                              src={it.image_url as string}
                              alt={it.name}
                              loading="lazy"
                              decoding="async"
                            />
                            <div className="ed-photo-scrim" aria-hidden />
                            {price && (
                              <span className="ed-photo-price">{price}</span>
                            )}
                          </div>
                        ) : null}

                        <div className="ed-card-body">
                          <div className="ed-card-headline">
                            <h3 className="ed-dish-name">{it.name}</h3>
                            {!hasImg && price && (
                              <>
                                <span className="ed-leader" aria-hidden />
                                <span className="ed-dish-price">{price}</span>
                              </>
                            )}
                          </div>

                          {it.description && (
                            <p className="ed-dish-desc">{it.description}</p>
                          )}

                          {chips && (
                            <div className="ed-chips">
                              {it.tagLabels.map((label, k) => (
                                <span
                                  key={`${section.prefix}:${it.id}:t:${k}`}
                                  className="ed-chip ed-chip-tag"
                                >
                                  {label}
                                </span>
                              ))}
                              {it.allergenLabels.map((label, k) => (
                                <span
                                  key={`${section.prefix}:${it.id}:a:${k}`}
                                  className="ed-chip ed-chip-al"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
              );
            })()}
          </main>
        </>
      )}

      <footer className="ed-footer">
        <span className="ed-foot-by">Powered by</span>{" "}
        <span className="ed-foot-brand">BaliFlow</span>
      </footer>

      <div className="ed-foot-orn" aria-hidden>
        <span className="ed-foot-orn-line" />
        <span className="ed-foot-orn-star" />
        <span className="ed-foot-orn-line" />
      </div>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
// Self-contained: the public route ships its own look. Warm ivory paper, near-
// black ink, a single burnt-bronze accent and an olive secondary. Bento grid
// uses CSS grid spans for asymmetry on desktop, recomposing to 1–2 cols on phone.
const styles = `
.ed-root {
  --paper: #faf6ee;
  --paper-2: #f3ead9;
  --ink: #1c150d;
  --ink-2: #4a3f30;
  --ink-3: #7a6c57;
  --bronze: #7e5226;
  --bronze-bright: #a4682c;
  --olive: #5c6c4b;
  --hair: rgba(28,21,13,0.14);
  position: relative;
  color: var(--ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  background:
    radial-gradient(120% 50% at 100% 0%, rgba(126,82,38,0.06), transparent 60%),
    linear-gradient(180deg, #fcf8f0 0%, var(--paper) 30%, #f5ecdd 100%);
  overflow-x: hidden;
  min-height: 100dvh;
}
.ed-grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5;
  background-image:
    radial-gradient(rgba(124,82,38,0.05) 1px, transparent 1.4px),
    radial-gradient(rgba(124,82,38,0.03) 1px, transparent 1.4px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 2px 3px;
  mix-blend-mode: multiply;
}
.ed-root > *:not(.ed-grain) { position: relative; z-index: 1; }

/* ── Masthead — oversized editorial title ──────────────────────────────────*/
.ed-mast {
  max-width: 1180px; margin: 0 auto;
  padding: clamp(2.2rem, 7vw, 4rem) clamp(1.25rem, 5vw, 3rem) clamp(1.4rem, 4vw, 2.2rem);
}
.ed-mast-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.34em; text-transform: uppercase;
  color: var(--bronze); padding-bottom: clamp(1.1rem, 4vw, 2rem);
  border-bottom: 1px solid var(--hair);
}
.ed-issue { white-space: nowrap; }
.ed-issue-end { color: var(--ink-3); }
.ed-title {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto;
  font-weight: 600;
  font-size: clamp(2.9rem, 15vw, 8rem);
  line-height: 0.92;
  letter-spacing: -0.03em;
  margin: clamp(1.4rem, 5vw, 2.6rem) 0 0;
  text-wrap: balance;
  color: var(--ink);
}
.ed-dek {
  display: flex; align-items: center; gap: 0.8rem; margin: clamp(1rem,3vw,1.6rem) 0 0;
  font-size: 0.64rem; font-weight: 700; letter-spacing: 0.32em; text-transform: uppercase;
  color: var(--ink-3);
}
.ed-dek-line { flex: 0 0 auto; width: clamp(1.6rem, 6vw, 3rem); height: 1px; background: var(--bronze); opacity: 0.55; }
.ed-dek-line:last-child { flex: 1; }

/* ── Sticky table of contents ──────────────────────────────────────────────*/
.ed-toc {
  position: sticky; top: 0; z-index: 30;
  background: rgba(250,246,238,0.82);
  backdrop-filter: saturate(1.4) blur(12px);
  -webkit-backdrop-filter: saturate(1.4) blur(12px);
  border-top: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
}
.ed-toc-track {
  max-width: 1180px; margin: 0 auto;
  display: flex; gap: clamp(0.6rem, 2vw, 1.4rem); overflow-x: auto;
  padding: 0.7rem clamp(1.25rem, 5vw, 3rem);
  scrollbar-width: none; -ms-overflow-style: none;
}
.ed-toc-track::-webkit-scrollbar { display: none; }
.ed-toc-chip {
  flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 0.4rem;
  text-decoration: none; color: var(--ink-3);
  font-size: 0.82rem; font-weight: 600; letter-spacing: 0.01em;
  padding: 0.25rem 0; white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color .22s ease, border-color .22s ease;
}
.ed-toc-no { font-family: var(--font-display), serif; font-style: italic; font-size: 0.72rem; color: var(--bronze); opacity: 0.7; }
.ed-toc-chip:hover { color: var(--ink); }
.ed-toc-chip.is-on { color: var(--ink); border-color: var(--bronze); }
.ed-toc-chip.is-on .ed-toc-no { opacity: 1; }
.ed-toc-star { font-size: 0.66em; color: var(--olive); }
.ed-toc-chip:focus-visible { outline: 2px solid var(--bronze); outline-offset: 3px; border-radius: 2px; }

/* ── Main / chapters ───────────────────────────────────────────────────────*/
.ed-main { max-width: 1180px; margin: 0 auto; padding: 0 clamp(1.25rem, 5vw, 3rem) 2rem; }
.ed-chapter { padding: clamp(2.4rem, 7vw, 4.5rem) 0 clamp(1rem, 3vw, 1.6rem); scroll-margin-top: 4rem; }

.ed-chap-head {
  display: grid; grid-template-columns: auto 1fr; align-items: end;
  column-gap: clamp(0.8rem, 3vw, 1.6rem); margin-bottom: clamp(1.4rem, 4vw, 2.4rem);
}
.ed-chap-no {
  grid-row: 1 / span 2;
  font-family: var(--font-display), serif; font-weight: 600; font-style: italic;
  font-size: clamp(2.4rem, 9vw, 4.4rem); line-height: 0.8;
  color: var(--bronze); letter-spacing: -0.02em;
}
.ed-chap-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 0.45rem; }
.ed-chap-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.56rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
  color: #fbf6ec; background: var(--olive); padding: 0.28rem 0.65rem; border-radius: 999px;
}
.ed-chap-title {
  font-family: var(--font-display), Georgia, serif; font-optical-sizing: auto;
  font-weight: 600; font-size: clamp(1.9rem, 7vw, 3.3rem); line-height: 1;
  letter-spacing: -0.02em; margin: 0; text-wrap: balance;
}
.ed-chap-rule { grid-column: 1 / -1; height: 1px; margin-top: clamp(0.9rem,3vw,1.4rem); background: var(--hair); }

/* ── Bento grid ────────────────────────────────────────────────────────────*/
.ed-bento {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 12px;          /* fine row track → tall cards span more rows */
  gap: clamp(0.9rem, 2.4vw, 1.6rem);
}
.ed-card {
  grid-column: span 2;           /* desktop default footprint */
  display: flex; flex-direction: column;
  min-width: 0;
}

/* Editorial footprints (desktop) */
.ed-lead   { grid-column: 1 / -1; grid-row: span 26; }
.ed-tall   { grid-column: span 2; grid-row: span 30; }
.ed-wide   { grid-column: span 2; grid-row: span 19; }
.ed-square { grid-column: span 2; grid-row: span 19; }
.ed-card.no-img { grid-row: span 12; }

/* Photo cards */
.ed-card.has-img { position: relative; }
.ed-photo-wrap {
  position: relative; flex: 1 1 auto; min-height: 9rem;
  border-radius: 4px; overflow: hidden;
  background: var(--paper-2);
  box-shadow: 0 1px 0 rgba(255,255,255,0.6), 0 18px 40px -30px rgba(42,29,17,0.7);
}
.ed-photo {
  width: 100%; height: 100%; object-fit: cover; display: block;
  filter: saturate(1.02) contrast(1.02);
  transition: transform .7s cubic-bezier(0.16,1,0.3,1);
}
.ed-photo-scrim {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, transparent 45%, rgba(20,14,7,0.42) 100%);
  opacity: 0; transition: opacity .4s ease;
}
.ed-card.has-img:hover .ed-photo { transform: scale(1.045); }
.ed-card.has-img:hover .ed-photo-scrim { opacity: 1; }
.ed-photo-price {
  position: absolute; top: 0.7rem; right: 0.7rem;
  font-family: var(--font-display), serif; font-weight: 600; font-size: 0.92rem;
  font-variant-numeric: tabular-nums; color: var(--ink);
  background: rgba(250,246,238,0.92); backdrop-filter: blur(4px);
  padding: 0.22rem 0.55rem; border-radius: 999px;
  box-shadow: 0 6px 16px -8px rgba(42,29,17,0.6);
}

.ed-card-body { padding-top: 0.7rem; }
.ed-card.no-img .ed-card-body {
  flex: 1 1 auto; padding: clamp(0.9rem,2.5vw,1.3rem) 0;
  border-top: 1px solid var(--hair);
}
.ed-card-headline { display: flex; align-items: baseline; gap: 0.5rem; }
.ed-dish-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(1.12rem, 2.4vw, 1.42rem); line-height: 1.12; letter-spacing: -0.012em;
  margin: 0; min-width: 0;
}
/* No-photo cards become the graphic: bigger, italic, set as a typographic block */
.ed-card.no-img .ed-dish-name {
  font-style: italic; font-size: clamp(1.5rem, 5vw, 2.1rem); line-height: 1.04;
  letter-spacing: -0.02em;
}
.ed-leader { flex: 1; align-self: flex-end; margin-bottom: 0.42em; height: 0; border-bottom: 1.5px dotted rgba(124,82,38,0.4); }
.ed-dish-price {
  flex: 0 0 auto; font-family: var(--font-display), serif; font-weight: 600;
  font-size: clamp(1.05rem, 3.4vw, 1.3rem); font-variant-numeric: tabular-nums; color: var(--bronze);
}
.ed-dish-desc {
  margin: 0.5rem 0 0; max-width: 52ch;
  font-size: 0.9rem; line-height: 1.6; color: var(--ink-2); font-style: italic;
}
.ed-card.no-img .ed-dish-desc { max-width: 46ch; font-size: 0.95rem; }

.ed-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.7rem; }
.ed-chip {
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 0.22rem 0.6rem; border-radius: 999px;
}
.ed-chip-tag { background: rgba(92,108,75,0.14); color: var(--olive); }
.ed-chip-al { background: rgba(126,82,38,0.13); color: var(--bronze); font-weight: 600; }

/* ── Empty / footer ────────────────────────────────────────────────────────*/
.ed-empty {
  max-width: 1180px; margin: 0 auto; text-align: center; padding: 6rem 1.5rem;
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.15rem; color: var(--bronze);
}
.ed-footer {
  display: flex; align-items: center; justify-content: center; gap: 0.6rem;
  padding: 10px; font-size: 0.86rem;
}
.ed-foot-rule { width: 2rem; height: 1px; background: rgba(124,82,38,0.45); }
.ed-foot-by { color: #000; font-weight: 500; }
.ed-foot-brand { font-weight: 700; color: var(--bronze); }

/* Decorative star divider beneath "Powered by". */
.ed-foot-orn {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  width: min(360px, 78%); margin: -1.4rem auto 0; padding-bottom: 3rem;
}
.ed-foot-orn-line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(124,82,38,0.55) 70%, rgba(124,82,38,0.7));
}
.ed-foot-orn-line:last-child {
  background: linear-gradient(270deg, transparent, rgba(124,82,38,0.55) 70%, rgba(124,82,38,0.7));
}
.ed-foot-orn-star {
  width: 1.05rem; height: 1.05rem; flex: none; background: var(--bronze);
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

/* ── Reveal on chapter swap ────────────────────────────────────────────────*/
/* Chapters filter in place (one mounted at a time): a quick crossfade on the
   chapter + a staggered rise on its cards. Time-based (no scroll-driven
   animation-timeline) so it stays buttery on mobile even with many photos. */
@keyframes edReveal { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes edHead { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes edFade { from { opacity: 0; } to { opacity: 1; } }
.ed-chapter { animation: edFade 260ms ease both; }
@media (prefers-reduced-motion: no-preference) {
  .ed-card { animation: edReveal 560ms cubic-bezier(0.16,1,0.3,1) both; animation-delay: calc(var(--i) * 45ms + 60ms); }
  .ed-chap-head { animation: edHead 520ms cubic-bezier(0.16,1,0.3,1) both; }
  .ed-title, .ed-dek { animation: edReveal 820ms cubic-bezier(0.16,1,0.3,1) both; }
  .ed-dek { animation-delay: 120ms; }
}

/* ── Tablet ────────────────────────────────────────────────────────────────*/
@media (max-width: 880px) {
  .ed-bento { grid-template-columns: repeat(2, 1fr); }
  .ed-lead   { grid-column: 1 / -1; grid-row: span 24; }
  .ed-tall   { grid-column: span 1; grid-row: span 28; }
  .ed-wide   { grid-column: 1 / -1; grid-row: span 18; }
  .ed-square { grid-column: span 1; grid-row: span 22; }
  .ed-card.no-img { grid-column: 1 / -1; grid-row: span 10; }
}

/* ── Phone (≤560px) — one clean column, photos keep aspect, type leads ───────*/
@media (max-width: 560px) {
  .ed-bento { grid-template-columns: 1fr; grid-auto-rows: auto; gap: clamp(1.4rem, 6vw, 1.9rem); }
  .ed-card, .ed-lead, .ed-tall, .ed-wide, .ed-square, .ed-card.no-img {
    grid-column: 1 / -1; grid-row: auto;
  }
  .ed-photo-wrap { min-height: 0; aspect-ratio: 4 / 3; }
  .ed-lead .ed-photo-wrap { aspect-ratio: 3 / 2; }
  .ed-tall .ed-photo-wrap { aspect-ratio: 3 / 4; }
  .ed-chap-head { grid-template-columns: 1fr; }
  .ed-chap-no { grid-row: auto; font-size: clamp(2.2rem, 12vw, 3rem); }
}

@media (prefers-reduced-motion: reduce) {
  .ed-card, .ed-chap-head, .ed-title, .ed-dek, .ed-chapter { animation: none !important; }
  .ed-photo, .ed-photo-scrim { transition: none !important; }
  .ed-toc { scroll-behavior: auto; }
}
`;
