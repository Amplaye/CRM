import type { SVGProps } from "react";

/**
 * A physical euro coin: milled edge, inner relief ring, € struck in the middle.
 *
 * Hand-drawn rather than imported because no icon set we ship carries an actual
 * coin — lucide's `Coins` is two discs seen at an angle (reads as "money", not
 * "a coin") and Ionicons has none at all. Euro, not dollar: every price in the
 * product is in euro.
 *
 * Geometry is lucide's grid (24×24, stroke 2, currentColor) so it drops in
 * anywhere a lucide icon does and inherits size and colour the same way. The €
 * is lucide's own `Euro` path at 0.55 scale, so its stroke is pre-divided
 * (3.64 × 0.55 ≈ 2) to come out the same weight as the rest of the icon.
 *
 * The relief ring is deliberately thin: at 14px — the size it renders in the
 * topbar badge — a heavier one closes up against the rim and the whole thing
 * turns into an ink blot.
 */
export function CoinIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6.9" strokeWidth={1} opacity={0.35} />
      <g transform="translate(5.675 5.4) scale(0.55)" strokeWidth={3.64}>
        <path d="M4 10h12" />
        <path d="M4 14h9" />
        <path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2" />
      </g>
    </svg>
  );
}

export default CoinIcon;
