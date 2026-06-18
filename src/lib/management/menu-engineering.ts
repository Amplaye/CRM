// Menu engineering — the classic Kasavana–Smith matrix. Each dish is scored on
// two axes over a period: POPULARITY (units sold) and PROFITABILITY (unit margin
// = price − food cost). A dish is "popular" when its share of total units beats a
// fair-share threshold, and "profitable" when its unit margin beats the menu's
// average. The 2×2 gives four classes the owner can act on:
//
//   star      high popularity + high margin → keep, protect, feature
//   plowhorse high popularity + low margin  → popular but thin: raise price / cut cost
//   puzzle    low popularity + high margin  → profitable but ignored: promote / reposition
//   dog       low popularity + low margin   → candidate to drop or rework
//
// Pure + deterministic; the dashboard only renders what this returns. Dishes with
// no price or no recipe (margin unknown) are excluded — they can't be placed.

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export interface MenuEngineeringInput {
  menuItemId: string;
  name: string;
  /** unit margin in € (price − food cost); null when not computable. */
  margin: number | null;
  /** units sold in the period. */
  unitsSold: number;
}

export interface MenuEngineeringRow {
  menuItemId: string;
  name: string;
  margin: number;
  unitsSold: number;
  /** share of total units (0–1). */
  popularity: number;
  klass: MenuClass;
}

export interface MenuEngineeringResult {
  rows: MenuEngineeringRow[];
  /** average unit margin across placed dishes (profitability cut line). */
  avgMargin: number;
  /** fair-share popularity cut line (0–1). */
  popularityCut: number;
  counts: Record<MenuClass, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the matrix. `popularityFactor` (default 0.7, the Kasavana–Smith
 * convention) sets the popularity cut line at factor × equal-share (1/N): a dish
 * clears the bar if it sells at least 70% of what it would under a perfectly even
 * split. Dishes with a null margin or zero total sales context are excluded.
 */
export function menuEngineering(
  input: MenuEngineeringInput[],
  popularityFactor = 0.7,
): MenuEngineeringResult {
  const placeable = input.filter((d) => d.margin !== null);
  const n = placeable.length;
  const counts: Record<MenuClass, number> = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
  if (n === 0) return { rows: [], avgMargin: 0, popularityCut: 0, counts };

  const totalUnits = placeable.reduce((s, d) => s + Math.max(0, d.unitsSold), 0);
  const avgMargin = round2(placeable.reduce((s, d) => s + (d.margin as number), 0) / n);
  // Fair share = factor × (1/N). With no sales at all, every dish is equally
  // "unpopular" → cut line 0 so popularity alone never makes a star.
  const popularityCut = totalUnits > 0 ? popularityFactor * (1 / n) : 0;

  const rows: MenuEngineeringRow[] = placeable.map((d) => {
    const popularity = totalUnits > 0 ? Math.max(0, d.unitsSold) / totalUnits : 0;
    const highPop = totalUnits > 0 && popularity >= popularityCut;
    const highMargin = (d.margin as number) >= avgMargin;
    const klass: MenuClass = highPop
      ? highMargin ? "star" : "plowhorse"
      : highMargin ? "puzzle" : "dog";
    counts[klass]++;
    return {
      menuItemId: d.menuItemId,
      name: d.name,
      margin: round2(d.margin as number),
      unitsSold: Math.max(0, d.unitsSold),
      popularity: round2(popularity),
      klass,
    };
  });

  // Stars first, then puzzles, plowhorses, dogs; by units desc within a class.
  const order: Record<MenuClass, number> = { star: 0, puzzle: 1, plowhorse: 2, dog: 3 };
  rows.sort((a, b) => order[a.klass] - order[b.klass] || b.unitsSold - a.unitsSold);
  return { rows, avgMargin, popularityCut: round2(popularityCut), counts };
}
