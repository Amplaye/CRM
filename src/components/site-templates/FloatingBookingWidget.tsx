"use client";

import { useEffect, useState, type ReactNode } from "react";
import BookingWidget, { type BookingStrings } from "@/app/b/[slug]/BookingWidget";

/** CTA that a template renders in place of the old inline booking form. It
 * opens the floating panel. `className`/`style` let each template style it as
 * its own button so the section keeps the template's look. */
export function BookingCta({ className, style, children }: { className?: string; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => window.dispatchEvent(new CustomEvent("open-booking"))}
    >
      {children}
    </button>
  );
}

// Floating "Prenota" pill fixed bottom-right on every template site. Tapping it
// expands (animated) into a compact booking panel that hosts the real
// BookingWidget. Closing animates back into the pill. One instance is injected
// once at the page level (/s/[slug] and the editor) so no template needs to
// embed a booking section itself. `accent` comes from the template registry.

export default function FloatingBookingWidget({
  slug,
  accent,
  strings,
}: {
  slug: string;
  accent: string;
  strings: BookingStrings & { title: string };
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Keep the panel in the DOM through the closing animation.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  // Esc closes; lock nothing else (the site keeps scrolling behind on desktop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Any "Prenota" CTA inside a template opens the panel via this global event.
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("open-booking", openIt);
    return () => window.removeEventListener("open-booking", openIt);
  }, []);

  const vars = { ["--bw-accent" as string]: accent } as React.CSSProperties;

  return (
    <div className="fbw" style={vars}>
      {/* Invisible click-catcher: tapping outside the panel closes it. No dim,
          no blur — it never paints (see .fbw-backdrop in globals.css). */}
      {mounted && open ? (
        <button
          type="button"
          aria-label="close"
          onClick={() => setOpen(false)}
          className="fbw-backdrop"
        />
      ) : null}

      {/* Panel */}
      {mounted ? (
        <div className={`fbw-panel ${open ? "fbw-panel-in" : "fbw-panel-out"}`} role="dialog" aria-modal="true" aria-label={strings.title}>
          <div className="fbw-head">
            <div className="flex items-center gap-2">
              <span className="fbw-head-dot" />
              <span className="fbw-head-title">{strings.title}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="fbw-close" aria-label="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="fbw-body">
            <BookingWidget slug={slug} accent={accent} strings={strings} />
          </div>
        </div>
      ) : null}

      {/* Launcher pill */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`fbw-pill ${open ? "fbw-pill-hidden" : ""}`}
        aria-expanded={open}
      >
        <svg className="fbw-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="fbw-pill-text">{strings.title}</span>
      </button>
    </div>
  );
}
