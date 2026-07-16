"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ClosePublicMenuButton } from "./ClosePublicMenuButton";

// Public hosted menu — Template 1 "IMMERSIVO".
//
// Direction: a dark, photo-first gallery. The dish photography IS the menu:
// a cinematic full-bleed hero opens the page, then the active category renders
// as a fluid card gallery — one column on phones, a rhythmic 6-col bento on
// tablet/desktop where every 5th card goes wide. Dishes without a photo wear a
// deterministic materic gradient with a giant serif initial, so a half-
// photographed menu still looks intentional.
//
// The server (page.tsx) does all data work and hands us flat, localized
// sections; we own presentation only. CSS is inlined so the public route ships
// a self-contained look. Branding hooks: --accent (owner colour),
// --font-display / --font-body (owner font choice).

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

// Deterministic gradient for photoless cards — index-driven, never random, so
// the same dish always wears the same colorway across renders.
const FALLBACK_GRADIENTS = [
  "linear-gradient(150deg, #2b1d10 0%, #4a3015 55%, #1c130a 100%)",
  "linear-gradient(160deg, #20201f 0%, #35291c 50%, #151310 100%)",
  "linear-gradient(145deg, #1d2420 0%, #2e3a2c 52%, #131813 100%)",
  "linear-gradient(155deg, #2a1512 0%, #45241b 50%, #180d0a 100%)",
  "linear-gradient(150deg, #241a20 0%, #3a2a33 52%, #161014 100%)",
];

export default function MenuImmersive({
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
  const [swapKey, setSwapKey] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const galleryRef = useRef<HTMLElement | null>(null);

  const activeIdx = Math.max(0, valid.findIndex((s) => s.key === activeKey));
  const active = valid[activeIdx] ?? valid[0];

  // Center the selected chip by scrolling the BAR only (never the page).
  useLayoutEffect(() => {
    const bar = barRef.current;
    const chip = chipRefs.current.get(activeKey);
    if (!bar || !chip) return;
    bar.scrollTo({
      left: chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeKey]);

  const select = (key: string) => {
    if (key === activeKey) return;
    setActiveKey(key);
    setSwapKey((n) => n + 1);
    // Land at the top of the gallery, keeping the sticky bar in view.
    const gal = galleryRef.current;
    if (gal) {
      const y = gal.getBoundingClientRect().top + window.scrollY - 76;
      window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
    }
  };

  const onChipKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % valid.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + valid.length) % valid.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = valid.length - 1;
    if (next === -1) return;
    e.preventDefault();
    const key = valid[next].key;
    select(key);
    chipRefs.current.get(key)?.focus();
  };

  return (
    <div className="imm-root">
      <ClosePublicMenuButton />
      <div className="imm-glow" aria-hidden />
      <div className="imm-grain" aria-hidden />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="imm-hero">
        <div className="imm-hero-inner">
          {logoUrl && (
            <img className="imm-logo imm-up" src={logoUrl} alt="" style={{ animationDelay: "60ms" }} />
          )}
          <p className="imm-eyebrow imm-up" style={{ animationDelay: "140ms" }}>
            <span className="imm-eyebrow-dot" aria-hidden />
            {menuLabel}
            <span className="imm-eyebrow-dot" aria-hidden />
          </p>
          <h1 className="imm-title imm-up" style={{ animationDelay: "220ms" }}>
            {restaurantName}
          </h1>
          {!empty && (
            <div className="imm-hero-hint imm-up" style={{ animationDelay: "420ms" }} aria-hidden>
              <span className="imm-hint-line" />
            </div>
          )}
        </div>
      </header>

      {empty ? (
        <div className="imm-empty">{emptyLabel}</div>
      ) : (
        <>
          {/* ── Sticky chapter bar ─────────────────────────────────────────── */}
          <nav className="imm-nav" aria-label={menuLabel}>
            <div ref={barRef} role="tablist" className="imm-chips">
              {valid.map((s, idx) => {
                const on = s.key === active.key;
                return (
                  <button
                    key={s.key}
                    ref={(el) => {
                      if (el) chipRefs.current.set(s.key, el);
                      else chipRefs.current.delete(s.key);
                    }}
                    id={`imm-tab-${s.key}`}
                    role="tab"
                    aria-selected={on}
                    aria-controls="imm-panel"
                    tabIndex={on ? 0 : -1}
                    onClick={() => select(s.key)}
                    onKeyDown={(e) => onChipKeyDown(e, idx)}
                    className={`imm-chip${on ? " is-on" : ""}`}
                  >
                    {s.featured && <span className="imm-chip-star" aria-hidden>✦</span>}
                    {s.title}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* ── Active section gallery ─────────────────────────────────────── */}
          <main
            key={swapKey}
            ref={galleryRef}
            id="imm-panel"
            role="tabpanel"
            aria-labelledby={`imm-tab-${active.key}`}
            className="imm-main"
          >
            <div className="imm-sec-head">
              <span className="imm-sec-no" aria-hidden>{String(activeIdx + 1).padStart(2, "0")}</span>
              <h2 className="imm-sec-title">{active.title}</h2>
              {active.featured && (
                <span className="imm-badge"><span aria-hidden>✦</span> {featuredLabel}</span>
              )}
            </div>

            <ul className="imm-grid">
              {active.items.map((it, i) => {
                const price = priceText(it);
                const hasPhoto = !!it.image_url;
                return (
                  <li
                    key={`${active.prefix}:${it.id}`}
                    className={`imm-card${hasPhoto ? "" : " no-photo"}`}
                    style={{ ["--i" as string]: i }}
                  >
                    <figure className="imm-media">
                      {hasPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image_url!} alt={it.name} loading={i < 2 ? "eager" : "lazy"} />
                      ) : (
                        <div
                          className="imm-media-fallback"
                          style={{ background: FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length] }}
                          aria-hidden
                        >
                          <span>{it.name.trim().charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                      <div className="imm-scrim" aria-hidden />
                      <figcaption className="imm-overlay">
                        <h3 className="imm-dish-name">{it.name}</h3>
                        {price && <span className="imm-price">{price}</span>}
                      </figcaption>
                    </figure>

                    {(it.description || it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                      <div className="imm-body">
                        {it.description && <p className="imm-desc">{it.description}</p>}
                        {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                          <div className="imm-chips-row">
                            {it.tagLabels.map((label, k) => (
                              <span key={`${active.prefix}:${it.id}:tag:${k}`} className="imm-pill imm-pill-tag">{label}</span>
                            ))}
                            {it.allergenLabels.map((label, k) => (
                              <span key={`${active.prefix}:${it.id}:al:${k}`} className="imm-pill imm-pill-al">{label}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </main>
        </>
      )}

      <footer className="imm-footer">
        <span className="imm-foot-line" aria-hidden />
        <span>
          Powered by <strong>BaliFlow</strong>
        </span>
        <span className="imm-foot-line" aria-hidden />
      </footer>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = `
.imm-root {
  --bg: #0e0b08;
  --bg2: #171208;
  --ink: #f4ecdd;
  --ink-dim: #b3a68e;
  --gold: var(--accent, #c89b5e);
  --card: #191410;
  --line: rgba(200,155,94,0.22);
  position: relative;
  min-height: 100dvh;
  background: linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  color: var(--ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  overflow-x: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
.imm-glow {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(90% 55% at 50% -8%, rgba(200,155,94,0.16), transparent 62%),
    radial-gradient(60% 40% at 90% 100%, rgba(200,155,94,0.05), transparent 70%);
}
.imm-grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.4;
  background-image:
    radial-gradient(rgba(255,255,255,0.028) 1px, transparent 1.4px),
    radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1.4px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 2px 3px;
}
.imm-root > *:not(.imm-glow):not(.imm-grain) { position: relative; z-index: 1; }

/* Hero */
.imm-hero {
  min-height: min(78dvh, 46rem);
  display: grid; place-items: center; text-align: center;
  padding: clamp(4rem, 12vh, 7rem) 1.25rem clamp(2.5rem, 8vh, 5rem);
}
.imm-hero-inner { max-width: 60rem; }
.imm-logo {
  display: block; height: clamp(3rem, 11vw, 4.6rem); width: auto; max-width: 72vw;
  object-fit: contain; margin: 0 auto clamp(1.2rem, 4vh, 2rem);
  filter: drop-shadow(0 8px 24px rgba(0,0,0,0.5));
}
.imm-eyebrow {
  display: inline-flex; align-items: center; gap: 0.9rem;
  font-size: clamp(0.62rem, 1.6vw, 0.72rem); letter-spacing: 0.5em; text-transform: uppercase;
  font-weight: 600; color: var(--gold); margin: 0 0 clamp(0.9rem, 3vh, 1.4rem);
  padding-left: 0.5em;
}
.imm-eyebrow-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--gold); opacity: 0.85; }
.imm-title {
  font-family: var(--font-display), Georgia, serif;
  font-optical-sizing: auto; font-weight: 500;
  font-size: clamp(2.8rem, 11vw, 6.4rem);
  line-height: 1.02; letter-spacing: -0.02em; margin: 0;
  text-wrap: balance; padding-bottom: 0.12em;
  background: linear-gradient(180deg, #fdf6e7 10%, #d9bd90 95%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.imm-hero-hint { margin-top: clamp(1.6rem, 5vh, 2.8rem); display: flex; justify-content: center; }
.imm-hint-line {
  width: 1px; height: clamp(2.4rem, 7vh, 4rem);
  background: linear-gradient(180deg, var(--gold), transparent);
  animation: immHint 2.2s ease-in-out infinite;
}
@keyframes immHint { 0%,100% { transform: scaleY(0.55); opacity: 0.45; } 50% { transform: scaleY(1); opacity: 1; } }

/* Sticky chapter bar */
.imm-nav {
  position: sticky; top: 0; z-index: 20;
  background: rgba(14,11,8,0.78);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-block: 1px solid var(--line);
}
.imm-chips {
  display: flex; gap: 0.5rem; overflow-x: auto;
  max-width: 78rem; margin: 0 auto;
  padding: 0.65rem clamp(1rem, 4vw, 2rem);
  scroll-padding-inline: 1rem;
  scrollbar-width: none; -ms-overflow-style: none;
}
.imm-chips::-webkit-scrollbar { display: none; }
.imm-chip {
  flex: 0 0 auto; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body), sans-serif;
  font-size: 0.8rem; font-weight: 600; letter-spacing: 0.05em;
  padding: 0.5rem 1.05rem; border-radius: 999px;
  color: var(--ink-dim); background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.09);
  transition: color .2s ease, background-color .2s ease, border-color .2s ease, transform .12s ease;
}
.imm-chip:hover { color: var(--ink); background: rgba(255,255,255,0.09); }
.imm-chip:active { transform: scale(0.95); }
.imm-chip.is-on {
  color: #17110a; background: linear-gradient(135deg, #e6c893, var(--gold));
  border-color: transparent; font-weight: 700;
  box-shadow: 0 6px 20px -8px rgba(200,155,94,0.75);
}
.imm-chip-star { margin-right: 0.35em; font-size: 0.85em; }
.imm-chip:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* Section head */
.imm-main {
  max-width: 78rem; margin: 0 auto;
  padding: clamp(2rem, 5vw, 3.5rem) clamp(1rem, 4vw, 2rem) clamp(3rem, 7vw, 5rem);
  animation: immPanel 260ms ease both;
}
.imm-sec-head {
  display: flex; align-items: baseline; gap: 0.9rem; flex-wrap: wrap;
  margin-bottom: clamp(1.4rem, 4vw, 2.2rem);
}
.imm-sec-no {
  font-family: var(--font-display), serif; font-style: italic; font-weight: 500;
  font-size: clamp(1rem, 3vw, 1.3rem); color: var(--gold);
}
.imm-sec-title {
  font-family: var(--font-display), Georgia, serif; font-weight: 500;
  font-size: clamp(1.9rem, 6.5vw, 3.2rem); line-height: 1.04; letter-spacing: -0.015em;
  margin: 0; text-wrap: balance; padding-bottom: 0.1em;
}
.imm-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.6rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;
  color: #17110a; background: linear-gradient(135deg, #e6c893, var(--gold));
  padding: 0.32rem 0.75rem; border-radius: 999px; transform: translateY(-0.35em);
}

/* Gallery — 1 col on phones, bento on md+ (every 5th card goes wide). */
.imm-grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: clamp(1rem, 3vw, 1.5rem);
  grid-template-columns: 1fr;
}
@media (min-width: 640px)  { .imm-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) {
  .imm-grid { grid-template-columns: repeat(6, 1fr); }
  .imm-card { grid-column: span 2; }
  .imm-card:nth-child(5n + 1) { grid-column: span 4; }
  .imm-card:nth-child(5n + 1) .imm-media { aspect-ratio: 16 / 8.5; }
}
.imm-card {
  border-radius: 20px; overflow: hidden;
  background: var(--card);
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow: 0 24px 48px -32px rgba(0,0,0,0.85);
  animation: immCard 560ms cubic-bezier(0.16,1,0.3,1) both;
  animation-delay: calc(var(--i) * 60ms);
  transition: transform .28s cubic-bezier(0.16,1,0.3,1), border-color .28s ease;
}
@media (hover: hover) {
  .imm-card:hover { transform: translateY(-4px); border-color: rgba(200,155,94,0.4); }
  .imm-card:hover .imm-media img { transform: scale(1.045); }
}
.imm-media { position: relative; aspect-ratio: 4 / 3; overflow: hidden; margin: 0; }
.imm-media img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  transition: transform .8s cubic-bezier(0.16,1,0.3,1);
}
.imm-media-fallback {
  position: absolute; inset: 0; display: grid; place-items: center;
}
.imm-media-fallback span {
  font-family: var(--font-display), serif; font-style: italic; font-weight: 500;
  font-size: clamp(4rem, 14vw, 6.5rem); line-height: 1;
  color: rgba(244,236,221,0.14); user-select: none;
}
.imm-scrim {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 40%, rgba(8,6,4,0.28) 66%, rgba(8,6,4,0.86) 100%);
}
.imm-overlay {
  position: absolute; inset-inline: 0; bottom: 0;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 0.8rem;
  padding: clamp(0.9rem, 3vw, 1.3rem);
}
.imm-dish-name {
  font-family: var(--font-display), Georgia, serif; font-weight: 500;
  font-size: clamp(1.25rem, 4.6vw, 1.6rem); line-height: 1.12; letter-spacing: -0.01em;
  margin: 0; text-shadow: 0 2px 14px rgba(0,0,0,0.6);
}
.imm-price {
  flex: 0 0 auto;
  font-family: var(--font-body), sans-serif; font-weight: 700;
  font-variant-numeric: tabular-nums; font-size: clamp(0.85rem, 3vw, 0.95rem);
  color: #17110a; background: linear-gradient(135deg, #eed4a4, var(--gold));
  padding: 0.34rem 0.75rem; border-radius: 999px;
  box-shadow: 0 4px 14px -4px rgba(0,0,0,0.5);
}
.imm-body { padding: clamp(0.85rem, 3vw, 1.15rem) clamp(0.9rem, 3vw, 1.3rem) clamp(1rem, 3vw, 1.3rem); }
.imm-desc {
  margin: 0; font-size: 0.9rem; line-height: 1.6; color: var(--ink-dim); max-width: 60ch;
}
.imm-chips-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.7rem; }
.imm-pill {
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 0.24rem 0.6rem; border-radius: 999px; border: 1px solid transparent;
}
.imm-pill-tag { color: #b9cf9f; background: rgba(150,180,110,0.12); border-color: rgba(150,180,110,0.25); }
.imm-pill-al  { color: #e0b988; background: rgba(200,155,94,0.12); border-color: rgba(200,155,94,0.3); }

.imm-empty {
  text-align: center; padding: 5rem 1.5rem 8rem; color: var(--ink-dim);
  font-family: var(--font-display), serif; font-style: italic; font-size: 1.15rem;
}

.imm-footer {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  padding: 0 1.5rem calc(2.4rem + env(safe-area-inset-bottom));
  font-size: 0.82rem; color: var(--ink-dim);
}
.imm-footer strong { color: var(--gold); font-weight: 700; }
.imm-foot-line { width: clamp(2rem, 8vw, 4rem); height: 1px; background: linear-gradient(90deg, transparent, var(--line)); }
.imm-foot-line:last-child { background: linear-gradient(270deg, transparent, var(--line)); }

/* Motion */
@keyframes immUp { from { opacity: 0; transform: translateY(18px); filter: blur(5px); } to { opacity: 1; transform: none; filter: none; } }
.imm-up { animation: immUp 820ms cubic-bezier(0.16,1,0.3,1) both; }
@keyframes immPanel { from { opacity: 0; } to { opacity: 1; } }
@keyframes immCard { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .imm-up, .imm-main, .imm-card, .imm-hint-line { animation: none !important; }
  .imm-card, .imm-media img, .imm-chip { transition: none !important; }
}
`;
