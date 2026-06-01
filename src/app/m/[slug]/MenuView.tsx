"use client";

import { useState, useRef, useLayoutEffect } from "react";

// Client-side presentation for the public hosted menu, shared via a QR sticker.
// The server (page.tsx) does all data work and hands us flat, localized
// sections. We render an editorial restaurant menu — Playfair small-caps
// headers over Geist descriptions, on the CRM's warm terracotta/sand palette so
// it reads as the same product as the dashboard.
//
// Tabs FILTER, they don't anchor-scroll: tapping a category swaps the visible
// section in place (with a short crossfade) instead of scrolling the page to a
// heading. One section is mounted at a time.

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
  sections: MenuViewSection[];
};

const TERRACOTTA = "#c4451c";
const TERRACOTTA_SOFT = "#e0a890";
const OLIVE = "#5c6c4b";
const INK = "#2b2118";

function priceText(it: MenuViewItem): string | null {
  if (it.price == null) return null;
  const cur = it.currency === "EUR" ? "€" : it.currency;
  return `${it.price.toFixed(2)} ${cur}`;
}

export default function MenuView({
  restaurantName,
  menuLabel,
  emptyLabel,
  sections,
}: Props) {
  const [activeKey, setActiveKey] = useState<string>(sections[0]?.key ?? "");
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Bump on every tab change so the panel re-keys and replays its fade-in.
  const [fadeKey, setFadeKey] = useState(0);

  const active = sections.find((s) => s.key === activeKey) ?? sections[0];

  // Keep the selected tab centered in the overflowing tab bar. We move the bar's
  // own scrollLeft (never the document) so selecting a tab can't jlog the page.
  useLayoutEffect(() => {
    const bar = tabBarRef.current;
    const tab = tabRefs.current.get(activeKey);
    if (!bar || !tab) return;
    const target = tab.offsetLeft - bar.clientWidth / 2 + tab.clientWidth / 2;
    bar.scrollTo({ left: target, behavior: "smooth" });
  }, [activeKey]);

  const select = (key: string) => {
    if (key === activeKey) return;
    setActiveKey(key);
    setFadeKey((n) => n + 1);
    // Jump the reading area to the top of the new section's list — the page
    // doesn't long-scroll, but if the previous section was long the viewport
    // could be mid-list. Instant, no animation, so it never reads as anchoring.
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  // Arrow / Home / End keyboard navigation for the tablist (ARIA tab pattern).
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
    <div
      className="min-h-screen font-sans"
      style={{
        color: INK,
        background:
          "linear-gradient(to bottom, #fbf3e7 0%, #f6e9d6 38%, #efdcc4 100%)",
      }}
    >
      {/* Hero — serif wordmark on a warm card, framed by a thin rule. */}
      <header className="px-6 pt-12 pb-8 text-center">
        <p
          className="text-[11px] uppercase tracking-[0.45em] font-semibold"
          style={{ color: TERRACOTTA }}
        >
          {menuLabel}
        </p>
        <h1
          className="mt-4 text-[2.6rem] leading-[1.05] md:text-6xl"
          style={{
            fontFamily: "var(--font-playfair), Georgia, serif",
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {restaurantName}
        </h1>
        <div className="mt-6 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-10" style={{ background: TERRACOTTA_SOFT }} />
          <span
            className="inline-block h-1.5 w-1.5 rotate-45"
            style={{ background: TERRACOTTA }}
          />
          <span className="h-px w-10" style={{ background: TERRACOTTA_SOFT }} />
        </div>
      </header>

      {empty ? (
        <div className="px-6 py-24 text-center">
          <p className="text-sm" style={{ color: "#9a8a76" }}>
            {emptyLabel}
          </p>
        </div>
      ) : (
        <>
          {/* Sticky filter tabs */}
          <nav
            className="sticky top-0 z-20 border-y"
            style={{
              borderColor: "rgba(196,69,28,0.14)",
              background: "rgba(251,243,231,0.86)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
            aria-label={menuLabel}
          >
            <div className="max-w-2xl mx-auto">
              <div
                ref={tabBarRef}
                role="tablist"
                className="flex gap-2 overflow-x-auto px-4 py-3"
                style={{ scrollbarWidth: "none" }}
              >
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
                      className="shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-4 py-2 text-[13px] font-bold tracking-wide transition-colors duration-200"
                      style={
                        on
                          ? {
                              background: TERRACOTTA,
                              borderColor: TERRACOTTA,
                              color: "#fff",
                            }
                          : {
                              background: "transparent",
                              borderColor: "rgba(43,33,24,0.16)",
                              color: "rgba(43,33,24,0.62)",
                            }
                      }
                    >
                      {s.featured && (
                        <span aria-hidden className="mr-1 align-middle text-[0.8em]">
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

          {/* Active section — the only one mounted. Re-keyed per selection so the
              fade-in replays; honors prefers-reduced-motion via the class. */}
          <main className="max-w-2xl mx-auto px-6 pt-9 pb-20">
            <section
              key={fadeKey}
              id="menu-panel"
              role="tabpanel"
              aria-labelledby={`tab-${active.key}`}
              className="menu-fade-in"
            >
              <div className="mb-7 text-center">
                {active.featured && (
                  <span
                    className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white"
                    style={{ background: OLIVE }}
                  >
                    <span aria-hidden>✦</span> Selezione
                  </span>
                )}
                <h2
                  className="text-[1.7rem] leading-tight"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontWeight: 600,
                  }}
                >
                  {active.title}
                </h2>
                <div
                  className="mx-auto mt-3 h-px w-14"
                  style={{ background: TERRACOTTA_SOFT }}
                  aria-hidden
                />
              </div>

              <ul className="space-y-7">
                {active.items.map((it) => {
                  const price = priceText(it);
                  return (
                    <li key={`${active.prefix}:${it.id}`}>
                      {/* Name … price, joined by a leader rule (classic menu). */}
                      <div className="flex items-baseline gap-3">
                        <h3
                          className="text-[17px] leading-snug"
                          style={{ fontWeight: 700 }}
                        >
                          {it.name}
                        </h3>
                        <span
                          className="mb-1 flex-1 border-b border-dotted"
                          style={{ borderColor: "rgba(43,33,24,0.22)" }}
                          aria-hidden
                        />
                        {price && (
                          <span
                            className="shrink-0 text-[16px] tabular-nums"
                            style={{ fontWeight: 700, color: TERRACOTTA }}
                          >
                            {price}
                          </span>
                        )}
                      </div>

                      {it.description && (
                        <p
                          className="mt-1.5 text-[14px] leading-relaxed"
                          style={{ color: "rgba(43,33,24,0.66)" }}
                        >
                          {it.description}
                        </p>
                      )}

                      {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {it.tagLabels.map((label, i) => (
                            <span
                              key={`${active.prefix}:${it.id}:tag:${i}`}
                              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                              style={{
                                background: "rgba(92,108,75,0.12)",
                                color: OLIVE,
                              }}
                            >
                              {label}
                            </span>
                          ))}
                          {it.allergenLabels.map((label, i) => (
                            <span
                              key={`${active.prefix}:${it.id}:al:${i}`}
                              className="rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                              style={{
                                color: "rgba(196,69,28,0.85)",
                                background: "rgba(196,69,28,0.07)",
                              }}
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

      <footer
        className="pb-10 pt-2 text-center text-[11px]"
        style={{ color: "rgba(43,33,24,0.4)" }}
      >
        Powered by{" "}
        <span className="font-bold" style={{ color: TERRACOTTA }}>
          BaliFlow
        </span>
      </footer>

      <style>{`
        @keyframes menuFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }
        .menu-fade-in { animation: menuFadeIn 260ms cubic-bezier(0.22,1,0.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .menu-fade-in { animation: none; }
        }
        [role="tab"]:focus-visible {
          outline: 2px solid ${TERRACOTTA};
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
