"use client";

import { useState, useRef, useLayoutEffect } from "react";

// Client-side presentation for the public hosted menu, shared via a QR sticker.
// The server (page.tsx) does all data work and hands us flat, localized
// sections. We render an editorial restaurant menu — Playfair serif headers
// over Geist descriptions — in the CRM's own palette (warm bronze #c4956a on a
// sand gradient, black text) so the public menu reads as the same product as
// the dashboard.
//
// Tabs FILTER, they don't anchor-scroll: tapping a category swaps the visible
// section in place (with a crossfade + staggered item entrance) instead of
// scrolling the page to a heading. One section is mounted at a time.

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
  featuredLabel: string;
  sections: MenuViewSection[];
};

// CRM palette — the warm bronze the dashboard uses for active nav / accents,
// plus its olive. Text is black, per the dashboard.
const BRONZE = "#c4956a"; // CRM accent — used for fills (active tab, ornaments)
const BRONZE_DEEP = "#7e5226"; // deep bronze for text-on-sand: passes WCAG AA (>=4.8:1)
const BRONZE_SOFT = "#dcc1a3";
const OLIVE = "#5c6c4b";
const INK = "#000000";

function priceText(it: MenuViewItem): string | null {
  if (it.price == null) return null;
  const cur = it.currency === "EUR" ? "€" : it.currency;
  return `${it.price.toFixed(2)} ${cur}`;
}

export default function MenuView({
  restaurantName,
  menuLabel,
  emptyLabel,
  featuredLabel,
  sections,
}: Props) {
  const [activeKey, setActiveKey] = useState<string>(sections[0]?.key ?? "");
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Bump on every tab change so the panel re-keys and replays its entrance.
  const [fadeKey, setFadeKey] = useState(0);

  const active = sections.find((s) => s.key === activeKey) ?? sections[0];

  // Keep the selected tab centered in the overflowing tab bar. We move the bar's
  // own scrollLeft (never the document) so selecting a tab can't jolt the page.
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
    // Reset reading position to the new section's top. Instant (not smooth) so
    // it never reads as anchor-scrolling — the content simply swaps in place.
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
  const serif = "var(--font-playfair), Georgia, serif";

  return (
    <div
      className="min-h-[100dvh] font-sans"
      style={{
        color: INK,
        background:
          "linear-gradient(to bottom, #FCF6ED 0%, #F4E4CD 45%, #ECD7BF 100%)",
      }}
    >
      {/* Hero — serif wordmark framed by a bronze ornament. */}
      <header className="px-5 pt-10 pb-7 text-center sm:pt-14 sm:pb-9">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.4em] sm:text-[11px]"
          style={{ color: BRONZE_DEEP }}
        >
          {menuLabel}
        </p>
        <h1
          className="mx-auto mt-3 max-w-[16ch] text-[2.15rem] leading-[1.06] sm:text-5xl md:text-6xl"
          style={{ fontFamily: serif, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          {restaurantName}
        </h1>
        <div className="mt-5 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-9" style={{ background: BRONZE_SOFT }} />
          <span
            className="inline-block h-1.5 w-1.5 rotate-45"
            style={{ background: BRONZE }}
          />
          <span className="h-px w-9" style={{ background: BRONZE_SOFT }} />
        </div>
      </header>

      {empty ? (
        <div className="px-6 py-24 text-center">
          <p className="text-sm" style={{ color: BRONZE_DEEP }}>
            {emptyLabel}
          </p>
        </div>
      ) : (
        <>
          {/* Sticky filter tabs */}
          <nav
            className="sticky top-0 z-20 border-b"
            style={{
              borderColor: "rgba(196,149,106,0.30)",
              background: "rgba(252,246,237,0.88)",
              backdropFilter: "saturate(1.4) blur(12px)",
              WebkitBackdropFilter: "saturate(1.4) blur(12px)",
            }}
            aria-label={menuLabel}
          >
            <div className="mx-auto max-w-2xl">
              <div
                ref={tabBarRef}
                role="tablist"
                className="menu-tabs flex gap-2 overflow-x-auto px-4 py-2.5 sm:py-3"
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
                      className="menu-tab shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-bold tracking-wide"
                      style={
                        on
                          ? {
                              background: BRONZE,
                              borderColor: BRONZE,
                              color: "#1a130c",
                              boxShadow: "0 4px 14px rgba(196,149,106,0.45)",
                            }
                          : {
                              background: "rgba(196,149,106,0.08)",
                              borderColor: "rgba(0,0,0,0.10)",
                              color: "rgba(0,0,0,0.66)",
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
              entrance replays; honors prefers-reduced-motion via the classes. */}
          <main className="mx-auto max-w-2xl px-5 pb-20 pt-8 sm:px-6 sm:pt-9">
            <section
              key={fadeKey}
              id="menu-panel"
              role="tabpanel"
              aria-labelledby={`tab-${active.key}`}
              className="menu-panel"
            >
              <div className="mb-7 text-center">
                {active.featured && (
                  <span
                    className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white"
                    style={{ background: OLIVE }}
                  >
                    <span aria-hidden>✦</span> {featuredLabel}
                  </span>
                )}
                <h2
                  className="text-[1.6rem] leading-tight sm:text-[1.9rem]"
                  style={{ fontFamily: serif, fontWeight: 600 }}
                >
                  {active.title}
                </h2>
                <div
                  className="mx-auto mt-3 h-px w-12"
                  style={{ background: BRONZE_SOFT }}
                  aria-hidden
                />
              </div>

              <ul className="divide-y" style={{ borderColor: "rgba(0,0,0,0.07)" }}>
                {active.items.map((it, i) => {
                  const price = priceText(it);
                  return (
                    <li
                      key={`${active.prefix}:${it.id}`}
                      className="menu-item py-4 first:pt-0"
                      style={{ ["--i" as string]: i }}
                    >
                      {/* Name … price, joined by a leader rule (classic menu). */}
                      <div className="flex items-baseline gap-2.5">
                        <h3 className="text-[16px] leading-snug sm:text-[17px]" style={{ fontWeight: 700 }}>
                          {it.name}
                        </h3>
                        <span
                          className="mb-1 flex-1 border-b border-dotted"
                          style={{ borderColor: "rgba(0,0,0,0.25)" }}
                          aria-hidden
                        />
                        {price && (
                          <span
                            className="shrink-0 text-[15px] tabular-nums sm:text-[16px]"
                            style={{ fontWeight: 800, color: BRONZE_DEEP }}
                          >
                            {price}
                          </span>
                        )}
                      </div>

                      {it.description && (
                        <p
                          className="mt-1.5 text-[14px] leading-relaxed"
                          style={{ color: "rgba(0,0,0,0.78)" }}
                        >
                          {it.description}
                        </p>
                      )}

                      {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {it.tagLabels.map((label, idx2) => (
                            <span
                              key={`${active.prefix}:${it.id}:tag:${idx2}`}
                              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                              style={{ background: "rgba(92,108,75,0.14)", color: OLIVE }}
                            >
                              {label}
                            </span>
                          ))}
                          {it.allergenLabels.map((label, idx2) => (
                            <span
                              key={`${active.prefix}:${it.id}:al:${idx2}`}
                              className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                              style={{
                                color: BRONZE_DEEP,
                                background: "rgba(196,149,106,0.16)",
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
        style={{ color: "rgba(0,0,0,0.45)" }}
      >
        Powered by{" "}
        <span className="font-bold" style={{ color: BRONZE_DEEP }}>
          BaliFlow
        </span>
      </footer>

      <style>{`
        .menu-tabs { scrollbar-width: none; -ms-overflow-style: none; scroll-padding-inline: 16px; }
        .menu-tabs::-webkit-scrollbar { display: none; }
        .menu-tab { transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 120ms ease; }
        .menu-tab:active { transform: scale(0.95); }

        /* Section swap: the heading/divider crossfade in, items rise in a short
           stagger so switching tabs feels alive rather than instant. */
        @keyframes menuPanelIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes menuItemIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .menu-panel { animation: menuPanelIn 220ms ease both; }
        .menu-item { animation: menuItemIn 380ms cubic-bezier(0.22,1,0.36,1) both; animation-delay: calc(var(--i) * 45ms + 60ms); }

        @media (prefers-reduced-motion: reduce) {
          .menu-panel, .menu-item, .menu-tab { animation: none !important; transition: none !important; }
          .menu-item { opacity: 1 !important; transform: none !important; }
        }
        [role="tab"]:focus-visible { outline: 2px solid ${BRONZE_DEEP}; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
