"use client";

// The gift card as the guest sees it. ONE component, rendered both in the
// dashboard editor (live preview) and on the public /g/<slug> page — which is
// what makes "what I design" and "what they buy" impossible to drift apart.

import { giftDesignBackground, DEFAULT_GIFT_TEXT_COLOR, type GiftDesign } from "@/lib/gift-cards/designs";
import { formatGiftCents } from "@/lib/gift-cards/gift-cards";

export function GiftCardPreview({
  design,
  selected,
  onClick,
  currency = "EUR",
  className = "",
}: {
  design: GiftDesign;
  /** Draws the selection ring on the public page. Omit in the editor. */
  selected?: boolean;
  onClick?: () => void;
  currency?: string;
  className?: string;
}) {
  const textColor = design.text_color || DEFAULT_GIFT_TEXT_COLOR;
  const interactive = typeof onClick === "function";

  const body = (
    <>
      {/* 16:10 keeps the card a card at every width — no reflow surprises on a phone. */}
      <div className="flex h-full flex-col justify-between p-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight" style={{ color: textColor }}>
            {design.title || "—"}
          </p>
          {design.subtitle ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug opacity-90" style={{ color: textColor }}>
              {design.subtitle}
            </p>
          ) : null}
        </div>
        <p className="text-2xl font-bold tabular-nums" style={{ color: textColor }}>
          {formatGiftCents(design.amount_cents, currency)}
        </p>
      </div>
    </>
  );

  const style = {
    background: giftDesignBackground(design),
    aspectRatio: "16 / 10",
    boxShadow: selected ? `0 0 0 3px #fff, 0 0 0 5px ${design.color}` : undefined,
  } as const;

  if (!interactive) {
    return (
      <div className={`overflow-hidden rounded-2xl ${className}`} style={style}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!selected}
      className={`block w-full overflow-hidden rounded-2xl text-left transition-transform hover:-translate-y-0.5 ${className}`}
      style={style}
    >
      {body}
    </button>
  );
}
