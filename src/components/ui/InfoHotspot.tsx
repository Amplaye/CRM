"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface InfoHotspotProps {
  /** Bold heading inside the popover (usually the field label). */
  title: string;
  /** Plain-language explanation of what the field does. */
  body: string;
  /** Optional worked example, shown in a highlighted box. */
  example?: string;
  /** Which edge of the popover lines up with the icon. Use "end" for fields near the right edge. */
  align?: "start" | "end";
  /** Open above ("top") or below ("bottom") the icon. Use "top" inside overflow-hidden containers. */
  side?: "top" | "bottom";
  /** Accessible label for the trigger button. Falls back to "<title> — info". */
  ariaLabel?: string;
}

// Small "i" hotspot that opens a popover explaining a field, with an optional
// worked example. Click to toggle; closes on outside-click or Escape. Brand
// styling matches the cream/terracotta settings panels. No external deps.
export function InfoHotspot({ title, body, example, align = "start", side = "bottom", ariaLabel }: InfoHotspotProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel || `${title} — info`}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[#c4956a] hover:bg-[#c4956a]/15 active:scale-95 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#c4956a]/40"
      >
        <Info className="w-4 h-4" strokeWidth={2} />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={title}
          className={`absolute z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl border-2 p-3.5 text-left ${side === "top" ? "bottom-full mb-2" : "top-full mt-2"} ${align === "end" ? "right-0" : "left-0"}`}
          style={{
            borderColor: "#c4956a",
            background: "#fffaf3",
            boxShadow: "0 16px 40px rgba(196,149,106,0.28), 0 4px 12px rgba(196,149,106,0.18)",
          }}
        >
          <p className="text-sm font-bold text-black mb-1">{title}</p>
          <p className="text-xs leading-relaxed text-black/80">{body}</p>
          {example && (
            <p
              className="mt-2.5 text-xs leading-relaxed text-black rounded-lg px-2.5 py-2 border-l-2"
              style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.12)" }}
            >
              {example}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
