import { describe, it, expect } from "vitest";
import {
  buildRecipePrompt,
  parseRecipeSuggestion,
  resolveSuggestion,
} from "@/lib/management/recipe-suggest";
import type { MatchCandidate } from "@/lib/management/ingredient-match";

describe("buildRecipePrompt", () => {
  it("emits a system+user pair and grounds on the known ingredient names", () => {
    const msgs = buildRecipePrompt(
      { menuItemId: "1", name: "Carbonara", description: "guanciale e pecorino" },
      ["Guanciale", "Pecorino", "Spaghetti"],
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    // The dish and its description reach the model…
    expect(msgs[1].content).toContain("Carbonara");
    expect(msgs[1].content).toContain("guanciale e pecorino");
    // …and so do the tenant's real ingredient names (the grounding).
    expect(msgs[1].content).toContain("Guanciale");
    expect(msgs[1].content).toContain("Pecorino");
  });

  it("handles a dish with no description and no known ingredients", () => {
    const msgs = buildRecipePrompt({ menuItemId: "1", name: "Insalata" }, []);
    expect(msgs[1].content).toContain("Insalata");
    // With no warehouse the prompt tells the model the stock is empty and to
    // stay conservative rather than inventing a full recipe.
    expect(msgs[1].content.toLowerCase()).toContain("empty");
  });
});

describe("parseRecipeSuggestion", () => {
  it("parses the documented {ingredients:[...]} shape", () => {
    const out = parseRecipeSuggestion(
      JSON.stringify({ ingredients: [{ name: "Spaghetti", qty: 120, unit: "g" }] }),
    );
    expect(out).toEqual([{ name: "Spaghetti", qty: 120, unit: "g" }]);
  });

  it("also accepts a bare array", () => {
    const out = parseRecipeSuggestion('[{"name":"Uovo","qty":1,"unit":"pz"}]');
    expect(out).toEqual([{ name: "Uovo", qty: 1, unit: "pz" }]);
  });

  it("salvages JSON wrapped in prose / code fences", () => {
    const out = parseRecipeSuggestion(
      'Ecco la ricetta:\n```json\n{"ingredients":[{"name":"Pecorino","qty":40,"unit":"g"}]}\n```',
    );
    expect(out).toEqual([{ name: "Pecorino", qty: 40, unit: "g" }]);
  });

  it("never throws on garbage and returns an empty array", () => {
    expect(parseRecipeSuggestion("not json at all")).toEqual([]);
    expect(parseRecipeSuggestion("")).toEqual([]);
    expect(parseRecipeSuggestion("{")).toEqual([]);
    expect(parseRecipeSuggestion("null")).toEqual([]);
  });

  it("drops malformed lines (missing name, non-positive/NaN qty) but keeps the rest", () => {
    const out = parseRecipeSuggestion(
      JSON.stringify({
        ingredients: [
          { name: "Spaghetti", qty: 120, unit: "g" },
          { name: "", qty: 10, unit: "g" }, // no name → dropped
          { name: "Sale", qty: 0, unit: "g" }, // non-positive → dropped
          { name: "Boh", qty: "tanto", unit: "g" }, // NaN → dropped
          { qty: 5, unit: "g" }, // no name → dropped
        ],
      }),
    );
    expect(out).toEqual([{ name: "Spaghetti", qty: 120, unit: "g" }]);
  });

  it("coerces numeric strings for qty", () => {
    const out = parseRecipeSuggestion('[{"name":"Guanciale","qty":"80","unit":"g"}]');
    expect(out).toEqual([{ name: "Guanciale", qty: 80, unit: "g" }]);
  });
});

describe("resolveSuggestion", () => {
  const ingredients: MatchCandidate[] = [
    { id: "ing-guanciale", name: "Guanciale", unit: "g" },
    { id: "ing-pecorino", name: "Pecorino", unit: "g" },
    { id: "ing-spaghetti", name: "Spaghetti", unit: "g" },
  ];

  it("maps a well-named suggestion to the real ingredient with high confidence", () => {
    const [line] = resolveSuggestion(
      [{ name: "Guanciale", qty: 80, unit: "g" }],
      ingredients,
    );
    expect(line.match.confidence).toBe("high");
    expect(line.match.ingredientId).toBe("ing-guanciale");
    expect(line.qty).toBe(80);
  });

  it("returns a create-proposal (no ingredientId) when nothing matches", () => {
    const [line] = resolveSuggestion(
      [{ name: "Tartufo bianco", qty: 5, unit: "g" }],
      ingredients,
    );
    expect(line.match.confidence).toBe("none");
    expect(line.match.ingredientId).toBeNull();
    expect(line.match.proposalName.length).toBeGreaterThan(0);
    expect(["g", "ml", "pz", "kg", "l"]).toContain(line.match.proposalUnit);
  });

  it("carries the AI unit through even for a create row", () => {
    const [line] = resolveSuggestion(
      [{ name: "Latte di cocco", qty: 100, unit: "ml" }],
      ingredients,
    );
    expect(line.unit).toBe("ml");
    expect(line.match.proposalUnit).toBe("ml");
  });

  it("preserves order and length of the input lines", () => {
    const out = resolveSuggestion(
      [
        { name: "Spaghetti", qty: 120, unit: "g" },
        { name: "Pecorino", qty: 40, unit: "g" },
      ],
      ingredients,
    );
    expect(out).toHaveLength(2);
    expect(out[0].suggestedName).toBe("Spaghetti");
    expect(out[1].suggestedName).toBe("Pecorino");
  });

  // Regression: the model answers in g/ml, but a recipe qty is stored in the
  // INGREDIENT's own unit. Snapping "100 g" onto a kg-stocked ingredient without
  // converting saved it as 100 KG — a real dish came out at € 2323 (66371%).
  it("converts the AI quantity into the matched ingredient's warehouse unit", () => {
    const kgStock: MatchCandidate[] = [
      { id: "ing-polpa", name: "Polpa Pomodoro", unit: "kg" },
    ];
    const [line] = resolveSuggestion(
      [{ name: "Polpa Pomodoro", qty: 100, unit: "g" }],
      kgStock,
    );
    expect(line.match.ingredientId).toBe("ing-polpa");
    expect(line.qty).toBe(0.1); // 100 g → 0.1 kg, NOT 100
    expect(line.unit).toBe("kg");
  });

  it("converts ml → l for a litre-stocked ingredient", () => {
    const [line] = resolveSuggestion(
      [{ name: "Panna Fresca", qty: 30, unit: "ml" }],
      [{ id: "ing-panna", name: "Panna Fresca", unit: "l" }],
    );
    expect(line.qty).toBe(0.03);
    expect(line.unit).toBe("l");
  });

  it("leaves the qty alone but adopts the warehouse unit when dimensions differ", () => {
    // ml → kg needs a density we don't have: keep the number, show the real unit
    // so the owner corrects it instead of silently saving a wrong quantity.
    const [line] = resolveSuggestion(
      [{ name: "Olio", qty: 20, unit: "ml" }],
      [{ id: "ing-olio", name: "Olio", unit: "kg" }],
    );
    expect(line.qty).toBe(20);
    expect(line.unit).toBe("kg");
  });

  it("handles an empty ingredient list — everything becomes a create-proposal", () => {
    const out = resolveSuggestion([{ name: "Spaghetti", qty: 120, unit: "g" }], []);
    expect(out[0].match.ingredientId).toBeNull();
    expect(out[0].match.confidence).toBe("none");
  });
});
