// Unit conversion for ingredients. A restaurant buys in one unit (a 5 kg sack of
// flour) but a recipe measures in another (120 g per pizza). Costs and stock must
// reconcile across the two, so every supported unit maps to a base unit (mass→g,
// volume→ml, count→pz) with a factor. Conversion is only valid WITHIN a dimension
// (you can't turn litres into grams without a density) → null when incompatible.
//
// The catalogue is deliberately WIDE. Every unit a kitchen writes on a delivery
// note but that isn't offered here becomes a rounding decision the owner makes
// by hand — "0,15 kg" instead of "150 g", "0,08 l" instead of "1 cucchiaio" —
// and each of those is a chance to slip a decimal and blow up a food cost. More
// units on the list means fewer conversions done in someone's head.

export type Unit =
  // mass
  | "mg" | "g" | "hg" | "kg" | "q" | "t" | "oz" | "lb"
  // volume
  | "ml" | "cl" | "dl" | "l" | "tsp" | "tbsp" | "cup" | "floz" | "pt" | "gal"
  // count / packaging
  | "pz" | "dz" | "cf" | "ct" | "bt" | "lt_can" | "vas" | "bus" | "sac" | "porz";

export type Dimension = "g" | "ml" | "pz";

interface UnitDef {
  base: Dimension;
  /** how many base units one of this unit is (1 kg = 1000 g). */
  factor: number;
}

export const UNITS: Record<Unit, UnitDef> = {
  // ── Mass (base: gram) ─────────────────────────────────────────────────────
  mg: { base: "g", factor: 0.001 },
  g: { base: "g", factor: 1 },
  hg: { base: "g", factor: 100 },
  kg: { base: "g", factor: 1000 },
  q: { base: "g", factor: 100_000 },      // quintale — still used on bulk flour
  t: { base: "g", factor: 1_000_000 },
  oz: { base: "g", factor: 28.349523125 },
  lb: { base: "g", factor: 453.59237 },

  // ── Volume (base: millilitre) ─────────────────────────────────────────────
  ml: { base: "ml", factor: 1 },
  cl: { base: "ml", factor: 10 },
  dl: { base: "ml", factor: 100 },
  l: { base: "ml", factor: 1000 },
  tsp: { base: "ml", factor: 5 },         // cucchiaino
  tbsp: { base: "ml", factor: 15 },       // cucchiaio
  cup: { base: "ml", factor: 240 },
  floz: { base: "ml", factor: 29.5735295625 },
  pt: { base: "ml", factor: 473.176473 },
  gal: { base: "ml", factor: 3785.411784 },

  // ── Count & packaging (base: piece) ───────────────────────────────────────
  //
  // A "confezione" holds no fixed number of pieces — it varies per product — so
  // these are all factor 1: they COUNT things, they don't convert between each
  // other. Keeping them distinct still matters, because "3 casse" and "3 pezzi"
  // must never silently look like the same stock level.
  pz: { base: "pz", factor: 1 },
  dz: { base: "pz", factor: 12 },         // dozen — the one count that IS fixed
  cf: { base: "pz", factor: 1 },          // confezione
  ct: { base: "pz", factor: 1 },          // cartone / cassa
  bt: { base: "pz", factor: 1 },          // bottiglia
  lt_can: { base: "pz", factor: 1 },      // lattina
  vas: { base: "pz", factor: 1 },         // vaschetta
  bus: { base: "pz", factor: 1 },         // busta
  sac: { base: "pz", factor: 1 },         // sacco
  porz: { base: "pz", factor: 1 },        // porzione
};

/** Every unit, grouped for a <select> — dimension order, then magnitude. */
export const UNIT_OPTIONS: ReadonlyArray<{ dimension: Dimension; units: readonly Unit[] }> = [
  { dimension: "g", units: ["mg", "g", "hg", "kg", "q", "t", "oz", "lb"] },
  { dimension: "ml", units: ["ml", "cl", "dl", "l", "tsp", "tbsp", "cup", "floz", "pt", "gal"] },
  { dimension: "pz", units: ["pz", "dz", "porz", "cf", "ct", "bt", "lt_can", "vas", "bus", "sac"] },
];

/** All unit codes, flat — handy for validation and DB check constraints. */
export const ALL_UNITS: readonly Unit[] = Object.keys(UNITS) as Unit[];

/** Dictionary key for a unit's short label ("kg", "cucchiaio"). */
export const unitLabelKey = (u: string) => `unit_${u}` as const;

/** Dictionary key for the name of a dimension ("Peso", "Volume", "Pezzi"). */
export const dimensionLabelKey = (d: Dimension) => `unit_dim_${d}` as const;

export function isUnit(u: string): u is Unit {
  return Object.prototype.hasOwnProperty.call(UNITS, u);
}

/** True when two units share a dimension and can be converted into one another. */
export function compatible(a: string, b: string): boolean {
  if (!isUnit(a) || !isUnit(b)) return a === b; // unknown units only equal themselves
  return UNITS[a].base === UNITS[b].base;
}

/** Convert a quantity from one unit to another. Null when the units belong to
 * different dimensions (e.g. l → g). Same unit (or unknown but equal) → unchanged. */
export function convertQty(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  if (!isUnit(from) || !isUnit(to)) return null;
  if (UNITS[from].base !== UNITS[to].base) return null;
  return (qty * UNITS[from].factor) / UNITS[to].factor;
}

/** Convert a per-unit cost from one unit to another (inverse of quantity).
 * €/kg → €/g divides by 1000. Null when dimensions differ. */
export function convertUnitCost(cost: number, from: string, to: string): number | null {
  if (from === to) return cost;
  if (!isUnit(from) || !isUnit(to)) return null;
  if (UNITS[from].base !== UNITS[to].base) return null;
  return (cost * UNITS[to].factor) / UNITS[from].factor;
}
