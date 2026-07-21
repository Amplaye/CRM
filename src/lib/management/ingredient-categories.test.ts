import { describe, expect, it } from "vitest";
import {
  INGREDIENT_CATEGORIES,
  classifyIngredient,
  isIngredientCategory,
} from "./ingredient-categories";

describe("classifyIngredient", () => {
  it("files the obvious staples of each category", () => {
    expect(classifyIngredient("Petto di pollo")).toBe("meat");
    expect(classifyIngredient("Salmone fresco")).toBe("fish");
    expect(classifyIngredient("Zucchine")).toBe("vegetables");
    expect(classifyIngredient("Banane")).toBe("fruit");
    expect(classifyIngredient("Mozzarella di bufala")).toBe("dairy");
    expect(classifyIngredient("Prosciutto crudo")).toBe("cured_meats");
    expect(classifyIngredient("Farina 00")).toBe("flour_cereals");
    expect(classifyIngredient("Spaghetti n.5")).toBe("pasta_rice");
    expect(classifyIngredient("Pomodori pelati")).toBe("preserves");
    expect(classifyIngredient("Origano secco")).toBe("spices");
    expect(classifyIngredient("Birra Moretti")).toBe("beer");
    expect(classifyIngredient("Vodka")).toBe("spirits");
    expect(classifyIngredient("Tovaglioli di carta")).toBe("consumables");
  });

  it("is accent- and case-insensitive", () => {
    expect(classifyIngredient("CAFFÈ")).toBe("soft_drinks");
    expect(classifyIngredient("caffe")).toBe("soft_drinks");
    expect(classifyIngredient("Sedano rapa")).toBe("vegetables");
    expect(classifyIngredient("PIMIENTA NEGRA")).toBe("spices");
  });

  // A prepared good is named after its raw material, and the prepared reading
  // is the right one for a storeroom: a purée is stocked, ordered and wasted
  // like a sauce, not like the fruit it came from.
  it("files a preparation by what it IS, not what it was made from", () => {
    expect(classifyIngredient("Purè di patate")).toBe("preserves");
    expect(classifyIngredient("Pure De Mango")).toBe("preserves");
    expect(classifyIngredient("Mermelada Fragola")).toBe("preserves");
    expect(classifyIngredient("Salsa Cheddar")).toBe("preserves");
    expect(classifyIngredient("Zumo De Limon")).toBe("soft_drinks");
  });

  // The ordering traps the rule list is deliberately sequenced to survive.
  it("prefers vinegar over wine for 'aceto di vino'", () => {
    expect(classifyIngredient("Aceto di vino rosso")).toBe("oil_vinegar");
    expect(classifyIngredient("Vino bianco da cucina")).toBe("wine");
  });

  it("files frozen goods as frozen, not by their raw material", () => {
    expect(classifyIngredient("Spinaci surgelati")).toBe("frozen");
    expect(classifyIngredient("Patatine congelate")).toBe("frozen");
    expect(classifyIngredient("Spinaci freschi")).toBe("vegetables");
  });

  it("keeps cured meats out of the meat bucket", () => {
    expect(classifyIngredient("Bresaola di manzo")).toBe("cured_meats");
    expect(classifyIngredient("Manzo macinato")).toBe("meat");
  });

  it("distinguishes olive oil from table olives", () => {
    expect(classifyIngredient("Olio extravergine di oliva")).toBe("oil_vinegar");
    expect(classifyIngredient("Olive taggiasche")).toBe("preserves");
  });

  // Stems match word PREFIXES, not free substrings: "tovaglioli" must not be a
  // vegetable just because it contains "aglio".
  it("does not match a stem buried inside an unrelated word", () => {
    expect(classifyIngredient("Tovaglioli di carta")).toBe("consumables");
    expect(classifyIngredient("Pepinillos")).toBe("preserves");
    expect(classifyIngredient("Jengibre")).toBe("vegetables");
  });

  it("falls back to 'other' rather than guessing", () => {
    expect(classifyIngredient("Zorblax 3000")).toBe("other");
    expect(classifyIngredient("")).toBe("other");
  });

  it("always returns a value inside the catalogue", () => {
    for (const name of ["Pollo", "Qwerty", "Vino", "", "   "]) {
      expect(isIngredientCategory(classifyIngredient(name))).toBe(true);
    }
  });
});

describe("INGREDIENT_CATEGORIES", () => {
  it("has no duplicates and ends with the 'other' fallback", () => {
    expect(new Set(INGREDIENT_CATEGORIES).size).toBe(INGREDIENT_CATEGORIES.length);
    expect(INGREDIENT_CATEGORIES.at(-1)).toBe("other");
  });
});
