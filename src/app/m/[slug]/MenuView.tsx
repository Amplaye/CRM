"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Client-side presentation for the public hosted menu. The server component
// (page.tsx) does all the data work and hands us flat, ready-to-render
// sections plus the localized UI strings. We own three things here:
//   1) a sticky, horizontally-scrollable tab bar (one tab per section),
//   2) scroll-spy that highlights the tab for whatever section is in view,
//   3) smooth scroll-to-section when a tab is tapped.
// Everything stays in the CRM's warm terracotta/sand design language so the
// public menu feels like the same product as the dashboard.

export type MenuTag = string;

export type MenuViewItem = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  tags: MenuTag[];
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
  sections: MenuViewSection[];
};

export default function MenuView({ restaurantName, menuLabel, sections }: Props) {
  const [activeKey, setActiveKey] = useState<string>(sections[0]?.key ?? "");
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  // While a tap-triggered smooth scroll is in flight we mute the scroll-spy so
  // it doesn't flicker through every section the page flies past.
  const isProgrammaticScroll = useRef(false);

  const setSectionRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(key, el);
    else sectionRefs.current.delete(key);
  }, []);

  // Keep the active tab visible in the (possibly overflowing) tab bar. We scroll
  // the bar's own scrollLeft rather than calling scrollIntoView on the tab —
  // scrollIntoView on a child of a position:sticky element yanks the *document*
  // back toward where the bar would sit unstuck (i.e. the top of the page).
  useEffect(() => {
    const bar = tabBarRef.current;
    const tab = tabRefs.current.get(activeKey);
    if (!bar || !tab) return;
    const target = tab.offsetLeft - bar.clientWidth / 2 + tab.clientWidth / 2;
    bar.scrollTo({ left: target, behavior: "smooth" });
  }, [activeKey]);

  // Scroll-spy: the active section is the topmost one whose heading has crossed
  // just under the sticky tab bar. We read on scroll (rAF-throttled) instead of
  // IntersectionObserver so short sections near the bottom still win cleanly.
  useEffect(() => {
    if (sections.length === 0) return;
    let raf = 0;

    const compute = () => {
      raf = 0;
      if (isProgrammaticScroll.current) return;
      const probe = 140; // px below viewport top — just under the sticky bar
      let current = sections[0].key;
      for (const s of sections) {
        const el = sectionRefs.current.get(s.key);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= probe) current = s.key;
        else break;
      }
      // Bottom of page → force-select the last section even if its heading
      // never reaches the probe line (short final sections).
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = sections[sections.length - 1].key;
      }
      setActiveKey((prev) => (prev === current ? prev : current));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections]);

  const scrollTo = (key: string) => {
    const el = sectionRefs.current.get(key);
    if (!el) return;
    setActiveKey(key);
    isProgrammaticScroll.current = true;
    // scrollIntoView + the section's scroll-margin-top (set inline below) lands
    // the heading just under the sticky bar and survives content reflow better
    // than manual offset math over a long page.
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Re-enable the spy once the smooth scroll has settled. A long jump can take
    // a beat; keep the spy muted long enough that it doesn't snap back.
    window.setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 900);
  };

  const empty = sections.length === 0;

  return (
    <div
      className="min-h-screen text-zinc-900 font-sans"
      style={{
        background:
          "linear-gradient(to top, #E1CAB2, #ECD7BF, #F4E4CD, #F7EEE0, #FCF6ED)",
      }}
    >
      {/* Hero */}
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-terracotta-500, #f45517), var(--color-terracotta-700, #be2e0b))",
          }}
        />
        {/* subtle plate-ring texture */}
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, #fff 0, transparent 38%), radial-gradient(circle at 85% 70%, #fff 0, transparent 30%)",
          }}
        />
        <div className="relative px-6 pt-12 pb-10 text-center text-white">
          <p className="text-[11px] uppercase tracking-[0.35em] font-semibold text-white/80">
            {menuLabel}
          </p>
          <h1 className="mt-3 text-4xl md:text-5xl font-black tracking-tight drop-shadow-sm">
            {restaurantName}
          </h1>
          <div className="mx-auto mt-5 h-px w-16 bg-white/40" />
        </div>
      </header>

      {/* Sticky tab bar */}
      {!empty && (
        <nav
          className="sticky top-0 z-20 border-b border-black/5 backdrop-blur-md"
          style={{ background: "rgba(252, 246, 237, 0.82)" }}
        >
          <div className="max-w-2xl mx-auto">
            <div
              ref={tabBarRef}
              className="flex gap-1.5 overflow-x-auto px-4 py-3"
              style={{ scrollbarWidth: "none" }}
            >
              {sections.map((s) => {
                const active = s.key === activeKey;
                return (
                  <button
                    key={s.key}
                    ref={(el) => {
                      if (el) tabRefs.current.set(s.key, el);
                      else tabRefs.current.delete(s.key);
                    }}
                    onClick={() => scrollTo(s.key)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold tracking-wide transition-all ${
                      active
                        ? "text-white shadow-sm"
                        : "text-zinc-600 hover:text-zinc-900 bg-black/[0.04] hover:bg-black/[0.07]"
                    }`}
                    style={
                      active
                        ? {
                            background:
                              "var(--color-terracotta-600, #e53f0c)",
                          }
                        : undefined
                    }
                  >
                    {s.featured && (
                      <span aria-hidden className="mr-1 text-[0.7em] align-middle">
                        ★
                      </span>
                    )}
                    {s.title}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      )}

      <main className="max-w-2xl mx-auto px-5 pt-8 pb-16">
        {empty ? (
          <div className="text-center py-20">
            <p className="text-sm text-zinc-500">{menuLabel}…</p>
          </div>
        ) : (
          <div className="space-y-12">
            {sections.map((s) => (
              <section
                key={s.key}
                ref={(el) => setSectionRef(s.key, el)}
                style={{ scrollMarginTop: 116 }}
              >
                <div className="mb-5 flex items-center gap-3">
                  {s.featured && (
                    <span
                      className="inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-black uppercase tracking-wider text-white"
                      style={{ background: "var(--color-olive-600, #5c6c4b)" }}
                    >
                      ★ Top
                    </span>
                  )}
                  <h2 className="text-xl font-black tracking-tight text-zinc-900">
                    {s.title}
                  </h2>
                  <span
                    className="h-px flex-1"
                    style={{ background: "rgba(0,0,0,0.10)" }}
                  />
                </div>

                <ul className="space-y-3">
                  {s.items.map((it) => (
                    <li
                      key={`${s.prefix}:${it.id}`}
                      className="rounded-2xl bg-white/70 ring-1 ring-black/[0.04] px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_14px_rgba(0,0,0,0.07)]"
                    >
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="font-bold text-[15px] leading-snug text-zinc-900">
                          {it.name}
                        </h3>
                        {it.price != null && (
                          <span
                            className="shrink-0 text-[15px] font-black tabular-nums"
                            style={{ color: "var(--color-terracotta-600, #e53f0c)" }}
                          >
                            {it.price.toFixed(2)}{" "}
                            {it.currency === "EUR" ? "€" : it.currency}
                          </span>
                        )}
                      </div>
                      {it.description && (
                        <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-600">
                          {it.description}
                        </p>
                      )}
                      {(it.tagLabels.length > 0 || it.allergenLabels.length > 0) && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {it.tagLabels.map((label, i) => (
                            <span
                              key={`${s.prefix}:${it.id}:tag:${i}`}
                              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                              style={{
                                background: "var(--color-olive-100, #eaede5)",
                                color: "var(--color-olive-700, #49563d)",
                              }}
                            >
                              {label}
                            </span>
                          ))}
                          {it.allergenLabels.map((label, i) => (
                            <span
                              key={`${s.prefix}:${it.id}:al:${i}`}
                              className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset"
                              style={{
                                color: "var(--color-terracotta-700, #be2e0b)",
                                borderColor: "rgba(190, 46, 11, 0.25)",
                              }}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="pb-10 pt-2 text-center text-xs text-zinc-400">
        Powered by{" "}
        <span className="font-bold" style={{ color: "var(--color-terracotta-600, #e53f0c)" }}>
          BaliFlow
        </span>
      </footer>
    </div>
  );
}
