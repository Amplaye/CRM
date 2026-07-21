"use client";

import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { UNIT_OPTIONS, dimensionLabelKey, unitLabelKey } from "@/lib/management/units";
import {
  INGREDIENT_CATEGORIES,
  categoryLabelKey,
} from "@/lib/management/ingredient-categories";

// The two pickers every ingredient form needs, in one place so the Inventory
// page and the recipe editor can never drift apart on what a valid unit or
// category is.

type T = (k: keyof Dictionary) => string;

/**
 * Every supported unit, grouped by dimension (weight / volume / pieces).
 *
 * Grouping is the point: the list is long on purpose — the more units we offer,
 * the fewer conversions an owner does in their head — but a flat list of 28
 * would be unusable, and <optgroup> also makes it obvious at a glance that you
 * can't mix litres into a weight.
 */
export function UnitSelect({
  value,
  onChange,
  t,
  className = "",
  style,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (unit: string) => void;
  t: T;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  ariaLabel?: string;
}) {
  // A row saved before a unit was retired (or typed in by an import) must still
  // show its own value rather than silently snapping to something else.
  const known = UNIT_OPTIONS.some((g) => (g.units as readonly string[]).includes(value));
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      style={style}
    >
      {!known && value && <option value={value}>{value}</option>}
      {UNIT_OPTIONS.map((group) => (
        <optgroup
          key={group.dimension}
          label={t(dimensionLabelKey(group.dimension) as keyof Dictionary)}
        >
          {group.units.map((u) => (
            <option key={u} value={u}>
              {t(unitLabelKey(u) as keyof Dictionary)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Warehouse category picker — what the product IS, so stock files itself. */
export function CategorySelect({
  value,
  onChange,
  t,
  className = "",
  style,
  id,
  ariaLabel,
}: {
  value: string | null;
  onChange: (category: string) => void;
  t: T;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value || "other"}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      style={style}
    >
      {INGREDIENT_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {t(categoryLabelKey(c) as keyof Dictionary)}
        </option>
      ))}
    </select>
  );
}
