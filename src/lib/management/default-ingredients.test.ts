import { describe, it, expect } from "vitest";
import {
  DEFAULT_INGREDIENTS,
  defaultIngredientsFor,
  type Locale,
} from "./default-ingredients";
import { INGREDIENT_CATEGORIES, classifyIngredient } from "./ingredient-categories";
import { UNITS } from "./units";

const LOCALES: Locale[] = ["it", "en", "es", "de"];

describe("default ingredient catalogue", () => {
  it("uses only real units and real categories", () => {
    for (const d of DEFAULT_INGREDIENTS) {
      expect(Object.keys(UNITS), `${d.slug} unit`).toContain(d.unit);
      expect(INGREDIENT_CATEGORIES, `${d.slug} category`).toContain(d.category);
    }
  });

  it("has a non-empty name in every language", () => {
    for (const d of DEFAULT_INGREDIENTS) {
      for (const l of LOCALES) {
        expect(d.names[l]?.trim(), `${d.slug}/${l}`).toBeTruthy();
      }
    }
  });

  it("has unique slugs", () => {
    const slugs = DEFAULT_INGREDIENTS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // The whole point of the catalogue is that a tenant does NOT end up with
  // "Miele" and "Honey" as two rows. Names are unique per language, and the
  // ingredients table enforces unique (tenant_id, name) — a collision here
  // would make the seed insert fail.
  it("has unique names within each language", () => {
    for (const l of LOCALES) {
      const names = DEFAULT_INGREDIENTS.map((d) => d.names[l].toLowerCase());
      const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
      expect(dupes, `duplicate ${l} names`).toEqual([]);
    }
  });

  // Guards the classifier and the catalogue against each other: if a name is
  // filed by hand into a category the classifier would never infer, one of the
  // two is wrong. Rows the classifier can't place ("other") are allowed — the
  // explicit category is what makes them useful.
  it("agrees with the auto-classifier on every name it can place", () => {
    const mismatches: string[] = [];
    for (const d of DEFAULT_INGREDIENTS) {
      for (const l of LOCALES) {
        const guess = classifyIngredient(d.names[l], d.unit);
        if (guess !== "other" && guess !== d.category) {
          mismatches.push(`${d.names[l]} (${l}): declared ${d.category}, classified ${guess}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("renders one row per catalogue entry, falling back to English", () => {
    for (const l of LOCALES) {
      expect(defaultIngredientsFor(l)).toHaveLength(DEFAULT_INGREDIENTS.length);
    }
    expect(defaultIngredientsFor("fr")[0].name).toBe(DEFAULT_INGREDIENTS[0].names.en);
  });
});
