"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Public hosted menu (Design 1 — "IMMERSIVE / Luxury Stories").
//
// Direction: a full-screen, one-dish-per-viewport experience with vertical
// scroll-snap, like a luxury Instagram story or an Apple product page. Each
// dish is a cover photo with a slow ken-burns drift; a bottom-up ink gradient
// floats the serif dish name, price, short description and minimal chips. A
// horizontal "chapter" bar at the top filters by category; a vertical dot rail
// tracks progress within the active category. A typographic hero opens the
// reel; dishes without a photo render as a materic gradient slide — beautiful,
// never a broken box. All motion respects prefers-reduced-motion.
//
// Server (page.tsx) does all data work and hands us flat, localized sections.
// We own presentation only. CSS is inlined so the public route ships a
// self-contained look without touching the CRM's global stylesheet.

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

// Deterministic gradient pick for photoless slides — index-driven, never
// random, so the same dish always wears the same colorway across renders.
const FALLBACK_GRADIENTS = [
  "linear-gradient(155deg, #241a10 0%, #3a2715 48%, #1a120a 100%)",
  "linear-gradient(160deg, #1c1c20 0%, #2c2620 46%, #14120f 100%)",
  "linear-gradient(150deg, #2a1f13 0%, #4a3318 52%, #1d150c 100%)",
  "linear-gradient(165deg, #19211c 0%, #2c352a 50%, #121712 100%)",
  "linear-gradient(150deg, #281611 0%, #43231a 50%, #190d09 100%)",
];

export default function MenuImmersive({
  restaurantName,
  menuLabel,
  emptyLabel,
  featuredLabel,
  sections,
}: Props) {
  const valid = sections.filter((s) => s.items.length > 0);
  const empty = valid.length === 0;

  const [activeSection, setActiveSection] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0); // 0 = hero, 1..n = dishes
  const reelRef = useRef<HTMLDivElement | null>(null);
  const chapterRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const section = valid[activeSection] ?? valid[0];
  const items = section?.items ?? [];

  // Slides: a hero card followed by every dish in the active section.
  const slideCount = items.length + 1;

  // Track which slide is centered, via IntersectionObserver on the snap reel.
  useEffect(() => {
    const reel = reelRef.current;
    if (!reel) return;
    const slides = Array.from(
      reel.querySelectorAll<HTMLElement>("[data-slide]"),
    );
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.55) {
            const idx = Number((e.target as HTMLElement).dataset.slide);
            if (!Number.isNaN(idx)) setActiveSlide(idx);
          }
        }
      },
      { root: reel, threshold: [0.55, 0.9] },
    );
    slides.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [activeSection]);

  // Center the active chapter chip within its own scroller (never the page).
  useEffect(() => {
    const chip = chapterRefs.current.get(activeSection);
    const bar = chip?.parentElement;
    if (!chip || !bar) return;
    bar.scrollTo({
      left: chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeSection]);

  const selectSection = useCallback((idx: number) => {
    setActiveSection(idx);
    setActiveSlide(0);
    // Jump the reel back to the hero of the new chapter.
    reelRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const onChapterKey = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % valid.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + valid.length) % valid.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = valid.length - 1;
    if (next === -1) return;
    e.preventDefault();
    selectSection(next);
    chapterRefs.current.get(next)?.focus();
  };

  // Scroll the reel to a given slide when a dot is tapped.
  const goToSlide = (idx: number) => {
    const reel = reelRef.current;
    if (!reel) return;
    const target = reel.querySelector<HTMLElement>(`[data-slide="${idx}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const dots = useMemo(
    () => Array.from({ length: slideCount }, (_, i) => i),
    [slideCount],
  );

  if (empty) {
    return (
      <div className="im-root im-empty-root">
        <div className="im-atmos" aria-hidden />
        <div className="im-empty">
          <p className="im-empty-eyebrow">{menuLabel}</p>
          <h1 className="im-empty-name">{restaurantName}</h1>
          <p className="im-empty-msg">{emptyLabel}</p>
        </div>
        <ImFooter />
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="im-root">
      <div className="im-atmos" aria-hidden />

      {/* ── Top chrome: current category + chapter filter bar ──────────── */}
      <header className="im-top">
        <div className="im-top-meta">
          <span className="im-wordmark">{restaurantName}</span>
          <span className="im-dot-sep" aria-hidden>·</span>
          <span className="im-now">
            {section.featured && <span className="im-now-star" aria-hidden>✦</span>}
            {section.title}
          </span>
        </div>
        <nav className="im-chapters" aria-label={menuLabel}>
          <div role="tablist" className="im-chapter-bar">
            {valid.map((s, idx) => {
              const on = idx === activeSection;
              return (
                <button
                  key={s.key}
                  ref={(el) => {
                    if (el) chapterRefs.current.set(idx, el);
                    else chapterRefs.current.delete(idx);
                  }}
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => selectSection(idx)}
                  onKeyDown={(e) => onChapterKey(e, idx)}
                  className={`im-chapter${on ? " is-on" : ""}`}
                >
                  {s.featured && <span className="im-chapter-star" aria-hidden>✦</span>}
                  {s.title}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* ── Vertical progress rail ─────────────────────────────────────── */}
      <div className="im-rail" aria-hidden>
        {dots.map((i) => (
          <button
            key={i}
            tabIndex={-1}
            aria-hidden
            className={`im-rail-dot${i === activeSlide ? " is-on" : ""}`}
            onClick={() => goToSlide(i)}
          />
        ))}
      </div>

      {/* ── The reel — one full-screen slide per snap point ────────────── */}
      <div
        key={section.key}
        ref={reelRef}
        className="im-reel"
        role="tabpanel"
        aria-label={section.title}
      >
        {/* Slide 0 — chapter hero */}
        <section className="im-slide im-hero" data-slide={0}>
          <div className="im-hero-bg" aria-hidden />
          <div className="im-hero-inner">
            <p className="im-hero-eyebrow">
              <span className="im-eb-line" aria-hidden />
              {section.featured ? featuredLabel : menuLabel}
              <span className="im-eb-line" aria-hidden />
            </p>
            <h1 className="im-hero-name">{section.title}</h1>
            <p className="im-hero-restaurant">{restaurantName}</p>
            <span className="im-scroll-cue" aria-hidden>
              <span className="im-scroll-word">scroll</span>
              <span className="im-scroll-arrow" />
            </span>
          </div>
        </section>

        {/* Dish slides */}
        {items.map((it, i) => {
          const price = priceText(it);
          const hasImg = !!it.image_url;
          const grad =
            FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length];
          const allChips = [
            ...it.tagLabels.map((label) => ({ label, kind: "tag" as const })),
            ...it.allergenLabels.map((label) => ({ label, kind: "al" as const })),
          ];
          return (
            <section
              key={`${section.prefix}:${it.id}`}
              className={`im-slide im-dish${hasImg ? "" : " is-noimg"}`}
              data-slide={i + 1}
            >
              {hasImg ? (
                <div
                  className="im-photo"
                  style={{ backgroundImage: `url("${it.image_url}")` }}
                  role="img"
                  aria-label={it.name}
                />
              ) : (
                <div className="im-fallback" style={{ background: grad }} aria-hidden>
                  <span className="im-fallback-mark">{it.name.charAt(0)}</span>
                </div>
              )}

              <div className="im-scrim" aria-hidden />

              <div className="im-caption">
                <div className="im-caption-inner">
                  {section.featured && (
                    <span className="im-badge">
                      <span aria-hidden>✦</span> {featuredLabel}
                    </span>
                  )}
                  <span className="im-index" aria-hidden>
                    {String(i + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
                  </span>
                  <h2 className="im-name">{it.name}</h2>
                  {price && <p className="im-price">{price}</p>}
                  {it.description && (
                    <p className="im-desc">{it.description}</p>
                  )}
                  {allChips.length > 0 && (
                    <div className="im-chips">
                      {allChips.map((c, idx2) => (
                        <span
                          key={`${it.id}:${c.kind}:${idx2}`}
                          className={`im-chip im-chip-${c.kind}`}
                        >
                          {c.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <ImFooter />
      <style>{styles}</style>
    </div>
  );
}

function ImFooter() {
  return (
    <footer className="im-footer">
      <span className="im-foot-rule" aria-hidden />
      <span className="im-foot-by">Powered by</span>{" "}
      <span className="im-foot-brand">BaliFlow</span>
      <span className="im-foot-rule" aria-hidden />
    </footer>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = `
.im-root {
  --ink: #0c0a07;
  --ink-2: #14110b;
  --cream: #f7efe2;
  --brass: #b07a32;
  --brass-soft: #d8b483;
  --brass-glow: #e7c794;
  position: fixed; inset: 0;
  color: var(--cream);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  background: #0c0a07;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
.im-atmos {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(176,122,50,0.16), transparent 60%),
    radial-gradient(100% 60% at 50% 120%, rgba(176,122,50,0.10), transparent 70%);
}

/* ── Top chrome ─────────────────────────────────────────────────────────── */
.im-top {
  position: absolute; top: 0; left: 0; right: 0; z-index: 30;
  padding: max(env(safe-area-inset-top), 0.9rem) 0 0.55rem;
  background: linear-gradient(180deg, rgba(8,6,4,0.78) 0%, rgba(8,6,4,0.42) 62%, transparent 100%);
}
.im-top-meta {
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: 0 1rem 0.55rem;
  font-size: 0.66rem; letter-spacing: 0.06em;
}
.im-wordmark {
  font-family: var(--font-display), Georgia, serif;
  font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--brass-soft); font-size: 0.7rem;
}
.im-dot-sep { color: rgba(216,180,131,0.5); }
.im-now {
  display: inline-flex; align-items: center; gap: 0.32em;
  color: rgba(247,239,226,0.78); font-weight: 600; letter-spacing: 0.04em;
}
.im-now-star { color: var(--brass-glow); font-size: 0.78em; }

.im-chapters { width: 100%; }
.im-chapter-bar {
  display: flex; gap: 0.42rem; overflow-x: auto;
  padding: 0.1rem 1rem 0.2rem;
  scrollbar-width: none; -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  justify-content: flex-start;
}
.im-chapter-bar::-webkit-scrollbar { display: none; }
@media (min-width: 560px) { .im-chapter-bar { justify-content: center; } }
.im-chapter {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body), sans-serif;
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.05em;
  padding: 0.34rem 0.78rem; border-radius: 999px;
  color: rgba(247,239,226,0.62);
  background: rgba(247,239,226,0.06);
  border: 1px solid rgba(216,180,131,0.16);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  transition: color .28s ease, background-color .28s ease, border-color .28s ease, transform .12s ease;
}
.im-chapter:hover { color: var(--cream); background: rgba(247,239,226,0.12); }
.im-chapter:active { transform: scale(0.94); }
.im-chapter.is-on {
  color: #1a120a;
  background: linear-gradient(135deg, var(--brass-glow), var(--brass));
  border-color: var(--brass-glow);
  box-shadow: 0 6px 18px -8px rgba(176,122,50,0.8);
}
.im-chapter-star { margin-right: 0.28em; font-size: 0.86em; }
.im-chapter:focus-visible { outline: 2px solid var(--brass-glow); outline-offset: 2px; }

/* ── Vertical progress rail ─────────────────────────────────────────────── */
.im-rail {
  position: absolute; z-index: 30;
  right: max(env(safe-area-inset-right), 0.55rem);
  top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
}
.im-rail-dot {
  width: 6px; height: 6px; padding: 0; border: 0; cursor: pointer;
  border-radius: 999px; background: rgba(247,239,226,0.28);
  transition: background-color .3s ease, height .3s cubic-bezier(0.16,1,0.3,1);
}
.im-rail-dot.is-on { background: var(--brass-glow); height: 20px; }

/* ── Reel & slides ──────────────────────────────────────────────────────── */
.im-reel {
  position: absolute; inset: 0; z-index: 10;
  overflow-y: auto; overflow-x: hidden;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none; -ms-overflow-style: none;
}
.im-reel::-webkit-scrollbar { display: none; }
.im-slide {
  position: relative;
  height: 100dvh; min-height: 100dvh; width: 100%;
  scroll-snap-align: start; scroll-snap-stop: always;
  overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end;
}
/* Desktop: keep the phone-story aspect, centered like a real device. */
@media (min-width: 760px) {
  .im-slide { max-width: 540px; margin: 0 auto; }
}

/* Hero slide */
.im-hero { justify-content: center; align-items: center; text-align: center; }
.im-hero-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(90% 70% at 50% 30%, rgba(176,122,50,0.22), transparent 65%),
    linear-gradient(180deg, #16100a 0%, #0c0a07 70%);
}
.im-hero-inner { position: relative; z-index: 2; padding: 0 1.6rem; max-width: 30rem; }
.im-hero-eyebrow {
  display: flex; align-items: center; justify-content: center; gap: 0.75rem;
  font-size: 0.6rem; letter-spacing: 0.4em; text-transform: uppercase;
  font-weight: 600; color: var(--brass-soft); margin: 0 0 1.1rem;
  padding-left: 0.4em;
}
.im-eb-line { width: 1.8rem; height: 1px; background: linear-gradient(90deg, transparent, var(--brass-soft)); }
.im-eb-line:last-child { background: linear-gradient(90deg, var(--brass-soft), transparent); }
.im-hero-name {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto; font-weight: 600;
  font-size: clamp(2.8rem, 16vw, 4.6rem); line-height: 0.96;
  letter-spacing: -0.02em; margin: 0; text-wrap: balance;
  background: linear-gradient(180deg, #fbf1df 0%, #e7c794 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.im-hero-restaurant {
  margin: 1.1rem 0 0; font-size: 0.7rem; letter-spacing: 0.34em;
  text-transform: uppercase; font-weight: 600; color: rgba(247,239,226,0.6);
}
.im-scroll-cue {
  display: inline-flex; flex-direction: column; align-items: center; gap: 0.5rem;
  margin-top: clamp(2rem, 9vh, 3.4rem);
}
.im-scroll-word {
  font-size: 0.56rem; letter-spacing: 0.42em; text-transform: uppercase;
  color: rgba(216,180,131,0.7); padding-left: 0.42em;
}
.im-scroll-arrow {
  width: 1px; height: 2.1rem;
  background: linear-gradient(180deg, var(--brass-soft), transparent);
  position: relative; animation: imCue 2.2s ease-in-out infinite;
}
.im-scroll-arrow::after {
  content: ""; position: absolute; bottom: 0; left: 50%;
  width: 7px; height: 7px; transform: translate(-50%, 2px) rotate(45deg);
  border-right: 1px solid var(--brass-soft); border-bottom: 1px solid var(--brass-soft);
}

/* Dish slide — photo */
.im-photo {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
  transform: scale(1.08);
  animation: imKen 5s ease-out infinite alternate;
}
.im-fallback {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.im-fallback::before {
  content: ""; position: absolute; inset: 0;
  background-image:
    radial-gradient(rgba(216,180,131,0.05) 1px, transparent 1.5px),
    radial-gradient(rgba(216,180,131,0.035) 1px, transparent 1.5px);
  background-size: 4px 4px, 9px 9px; background-position: 0 0, 3px 4px;
  mask-image: radial-gradient(120% 100% at 50% 35%, #000 30%, transparent 95%);
}
.im-fallback-mark {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: 44vw; line-height: 1; color: rgba(216,180,131,0.07);
  transform: translateY(-6%);
  user-select: none;
}
@media (min-width: 760px) { .im-fallback-mark { font-size: 17rem; } }

/* Scrim so the caption always reads */
.im-scrim {
  position: absolute; inset: 0; z-index: 1;
  background:
    linear-gradient(180deg, rgba(8,6,4,0.34) 0%, transparent 26%, transparent 44%, rgba(8,6,4,0.62) 78%, rgba(8,6,4,0.92) 100%);
}
.im-dish.is-noimg .im-scrim {
  background: linear-gradient(180deg, transparent 40%, rgba(8,6,4,0.55) 80%, rgba(8,6,4,0.88) 100%);
}

/* Caption */
.im-caption {
  position: relative; z-index: 2;
  padding: 0 1.5rem max(env(safe-area-inset-bottom), 2.4rem);
}
.im-caption-inner { max-width: 34rem; }
.im-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.56rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;
  color: #1a120a; background: linear-gradient(135deg, var(--brass-glow), var(--brass));
  padding: 0.28rem 0.66rem; border-radius: 999px; margin-bottom: 0.85rem;
}
.im-index {
  display: block; font-family: var(--font-display), serif; font-style: italic;
  font-size: 0.78rem; letter-spacing: 0.1em; color: var(--brass-soft);
  margin-bottom: 0.5rem; font-variant-numeric: tabular-nums;
}
.im-name {
  font-family: var(--font-display), Georgia, serif; font-optical-sizing: auto;
  font-weight: 600; font-size: clamp(2.1rem, 10vw, 3.1rem); line-height: 1.02;
  letter-spacing: -0.018em; margin: 0; text-wrap: balance;
  text-shadow: 0 2px 24px rgba(0,0,0,0.45);
}
.im-price {
  margin: 0.7rem 0 0; font-family: var(--font-display), serif;
  font-weight: 600; font-size: clamp(1.15rem, 5vw, 1.45rem);
  font-variant-numeric: tabular-nums; color: var(--brass-glow);
  text-shadow: 0 1px 14px rgba(0,0,0,0.5);
}
.im-desc {
  margin: 0.7rem 0 0; max-width: 40ch;
  font-size: 0.95rem; line-height: 1.55; font-style: italic;
  color: rgba(247,239,226,0.86);
  text-shadow: 0 1px 18px rgba(0,0,0,0.6);
}
.im-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 1rem; }
.im-chip {
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 0.26rem 0.62rem; border-radius: 999px;
  border: 1px solid rgba(247,239,226,0.16);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.im-chip-tag { background: rgba(216,180,131,0.14); color: var(--brass-glow); }
.im-chip-al { background: rgba(8,6,4,0.4); color: rgba(247,239,226,0.78); }

/* ── Empty state ────────────────────────────────────────────────────────── */
.im-empty-root { display: flex; align-items: center; justify-content: center; }
.im-empty { position: relative; z-index: 2; text-align: center; padding: 0 1.6rem; }
.im-empty-eyebrow {
  font-size: 0.62rem; letter-spacing: 0.4em; text-transform: uppercase;
  font-weight: 600; color: var(--brass-soft); margin: 0 0 1rem; padding-left: 0.4em;
}
.im-empty-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 600;
  font-size: clamp(2.6rem, 15vw, 4.4rem); line-height: 0.98; margin: 0;
  letter-spacing: -0.02em;
  background: linear-gradient(180deg, #fbf1df 0%, #e7c794 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.im-empty-msg { margin: 1.2rem 0 0; font-style: italic; color: rgba(247,239,226,0.7); font-size: 1rem; }

/* ── Footer ─────────────────────────────────────────────────────────────── */
.im-footer {
  position: absolute; z-index: 30; bottom: max(env(safe-area-inset-bottom), 0.55rem);
  left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; justify-content: center; gap: 0.6rem;
  font-size: 0.82rem; letter-spacing: 0.04em; white-space: nowrap;
  pointer-events: none;
}
.im-foot-rule { width: 1.6rem; height: 1px; background: rgba(216,180,131,0.5); }
.im-foot-by { color: #fff; font-weight: 500; }
.im-foot-brand { font-weight: 700; color: var(--brass-soft); }

/* ── Motion ─────────────────────────────────────────────────────────────── */
@keyframes imKen {
  from { transform: scale(1.16) translate(-1.5%, -2.5%); }
  to   { transform: scale(1.06) translate(0, 0); }
}
@keyframes imCue {
  0%, 100% { opacity: 0.4; transform: translateY(0); }
  50%      { opacity: 1; transform: translateY(4px); }
}
/* Reveal of caption content as a slide enters the snap point. */
@keyframes imRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes imHeroRise { from { opacity: 0; transform: translateY(22px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
.im-caption-inner > * { animation: imRise 700ms cubic-bezier(0.16,1,0.3,1) both; }
.im-caption-inner > *:nth-child(1) { animation-delay: 60ms; }
.im-caption-inner > *:nth-child(2) { animation-delay: 120ms; }
.im-caption-inner > *:nth-child(3) { animation-delay: 190ms; }
.im-caption-inner > *:nth-child(4) { animation-delay: 260ms; }
.im-caption-inner > *:nth-child(5) { animation-delay: 330ms; }
.im-caption-inner > *:nth-child(6) { animation-delay: 400ms; }
.im-hero-inner > * { animation: imHeroRise 900ms cubic-bezier(0.16,1,0.3,1) both; }
.im-hero-inner > *:nth-child(2) { animation-delay: 120ms; }
.im-hero-inner > *:nth-child(3) { animation-delay: 240ms; }
.im-hero-inner > *:nth-child(4) { animation-delay: 420ms; }

@media (prefers-reduced-motion: reduce) {
  .im-photo { animation: none !important; transform: scale(1.02); }
  .im-scroll-arrow { animation: none !important; }
  .im-caption-inner > *, .im-hero-inner > * { animation: none !important; }
  .im-reel { scroll-behavior: auto; }
  .im-chapter, .im-rail-dot { transition: none !important; }
}
`;
