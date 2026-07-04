import { describe, it, expect } from "vitest";
import {
  normalizeUnit,
  nameTokens,
  matchScore,
  proposeName,
  suggestLineMatches,
} from "@/lib/management/ingredient-match";

describe("normalizeUnit", () => {
  it("maps messy invoice unit labels to warehouse units", () => {
    expect(normalizeUnit("KG")).toBe("kg");
    expect(normalizeUnit("Lt.")).toBe("l");
    expect(normalizeUnit("GR")).toBe("g");
    expect(normalizeUnit("Nr")).toBe("pz");
    expect(normalizeUnit("CF")).toBe("pz");
    expect(normalizeUnit("")).toBe("pz");
    expect(normalizeUnit(null)).toBe("pz");
    expect(normalizeUnit("cassetta")).toBe("pz"); // unknown → count
  });
});

describe("nameTokens", () => {
  it("strips packaging noise, pack sizes and accents; stems plurals", () => {
    expect(nameTokens("FARINA TIPO 00 SACCO 25KG")).toEqual(["farin", "tip", "00"]);
    expect(nameTokens("Pomodori pelati")).toEqual(nameTokens("pomodoro pelato"));
    expect(nameTokens("Caffè")).toEqual(nameTokens("caffe"));
  });

  it("keeps 'latte' (milk) even though 'latta' (tin) is packaging noise", () => {
    expect(nameTokens("LATTE INTERO UHT 1L").length).toBeGreaterThan(0);
    expect(nameTokens("LATTE INTERO UHT 1L")).toContain("latt");
  });
});

describe("matchScore", () => {
  it("scores a verbose invoice line high against its short warehouse name", () => {
    expect(matchScore("FARINA TIPO 00 SACCO 25KG", "Farina 00")).toBeGreaterThan(0.8);
    expect(matchScore("MOZZARELLA FIOR DI LATTE 3KG", "Mozzarella")).toBeGreaterThan(0.6);
  });

  it("scores unrelated products low", () => {
    expect(matchScore("OLIO EVO 5LT", "Farina 00")).toBeLessThan(0.3);
    expect(matchScore("DETERSIVO PIATTI", "Pomodoro pelato")).toBeLessThan(0.3);
  });

  it("matches across singular/plural", () => {
    expect(matchScore("POMODORI PELATI CT 6X1KG", "Pomodoro pelato")).toBeGreaterThan(0.8);
  });
});

describe("suggestLineMatches", () => {
  const warehouse = [
    { id: "flour", name: "Farina 00", unit: "kg" },
    { id: "mozz", name: "Mozzarella", unit: "kg" },
    { id: "oil", name: "Olio extravergine", unit: "l" },
  ];

  it("auto-assigns high-confidence matches", () => {
    const [m] = suggestLineMatches(
      [{ id: "l1", description: "FARINA TIPO 00 SACCO 25KG", unit: "KG" }],
      warehouse,
    );
    expect(m.ingredientId).toBe("flour");
    expect(m.confidence).toBe("high");
  });

  it("proposes a cleaned new ingredient for unmatched lines", () => {
    const [m] = suggestLineMatches(
      [{ id: "l1", description: "GUANCIALE STAGIONATO SV 1.5KG", unit: "KG" }],
      warehouse,
    );
    expect(m.ingredientId).toBeNull();
    expect(m.confidence).toBe("none");
    expect(m.proposal.name.toLowerCase()).toContain("guanciale");
    expect(m.proposal.unit).toBe("kg");
  });

  it("dampens matches whose units live in different dimensions", () => {
    const kg = suggestLineMatches([{ id: "a", description: "MOZZARELLA 3KG", unit: "KG" }], warehouse)[0];
    const lt = suggestLineMatches([{ id: "a", description: "MOZZARELLA 3KG", unit: "LT" }], warehouse)[0];
    expect(lt.score).toBeLessThan(kg.score);
    expect(kg.ingredientId).toBe("mozz");
  });

  it("handles an empty warehouse (first ever invoice) gracefully", () => {
    const out = suggestLineMatches(
      [{ id: "l1", description: "POMODORI PELATI 6X1KG", unit: "CT" }],
      [],
    );
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].proposal.name).toBe("Pomodori Pelati");
  });
});

describe("proposeName", () => {
  it("drops pack sizes and packaging words, keeps type codes, title-cases", () => {
    expect(proposeName("FARINA TIPO 00 SACCO 25KG")).toBe("Farina Tipo 00");
    expect(proposeName("POMODORI PELATI CT 6X1KG")).toBe("Pomodori Pelati");
  });

  it("falls back to the raw description when everything is noise", () => {
    expect(proposeName("25KG")).toBe("25KG");
  });
});
