// Unit conversion for ingredients. A restaurant buys in one unit (a 5 kg sack of
// flour) but a recipe measures in another (120 g per pizza). Costs and stock must
// reconcile across the two, so every supported unit maps to a base unit (mass→g,
// volume→ml, count→pz) with a factor. Conversion is only valid WITHIN a dimension
// (you can't turn litres into grams without a density) → null when incompatible.

export type Unit = "g" | "kg" | "ml" | "l" | "pz";

interface UnitDef {
  base: "g" | "ml" | "pz";
  /** how many base units one of this unit is (1 kg = 1000 g). */
  factor: number;
}

export const UNITS: Record<Unit, UnitDef> = {
  g: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  l: { base: "ml", factor: 1000 },
  pz: { base: "pz", factor: 1 },
};

export function isUnit(u: string): u is Unit {
  return u === "g" || u === "kg" || u === "ml" || u === "l" || u === "pz";
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
