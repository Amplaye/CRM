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

// Names proposed from real supplier lines. Before the trade vocabulary landed
// these came out as "Vongole C Cappuccine 0 60 80 1 X10" — unusable on a stock
// count, and different enough per delivery that the same clam never matched.
describe("proposeName on real supplier lines", () => {
  it("strips brand, calibro, glazing and pack size", () => {
    expect(proposeName('VONGOLE C/G "CAPPUCCINE" 0% 60/80 CF.1 KG (X10)')).toBe("Vongole");
    expect(proposeName('OLIVE NERE D/N V/V "QUALITALY" 1,7 KG (X6)')).toBe("Olive Nere");
    expect(proposeName('MOSCARDINI 40/60 IQF 1P "QUALITALY" CF.800 GR (X10)')).toBe("Moscardini");
    // "CREMA QUALITALY" is one quoted brand string, so it goes whole. The owner
    // can still rename on the spot — a short right name beats a long wrong one.
    expect(proposeName('ACETO BALSAMICO "CREMA QUALITALY" 6X500 ML')).toBe("Aceto Balsamico");
  });

  it("keeps the qualifiers that make two goods different", () => {
    // Dropping these would merge distinct products into one warehouse row.
    expect(proposeName("PROSCIUTTO COTTO ALTA QUALITA 1 KG")).toContain("Cotto");
    expect(proposeName("PROSCIUTTO CRUDO 24 MESI")).toContain("Crudo");
    expect(proposeName("Panna fresca gr. 35% 1 LT")).toContain("Fresca");
    expect(proposeName("PASTA FRESCA ALL'UOVO")).toContain("Fresca");
  });

  it("never proposes an empty name", () => {
    expect(proposeName("CF. 1 KG (X10)").length).toBeGreaterThan(0);
    expect(proposeName("").length).toBe(0);
  });
});

describe("suggestLineMatches classifies before it matches", () => {
  const warehouse = [{ id: "i1", name: "Assistenza", unit: "pz" }];

  it("refuses to map a service onto an ingredient", () => {
    const [m] = suggestLineMatches(
      [{ id: "l1", description: "RINNOVO CONTRATTO ASSISTENZA TECNICO ANNUALE", unit: "pz", quantity: 1, unitPrice: 400 }],
      warehouse,
    );
    expect(m.kind).toBe("service");
    expect(m.ingredientId).toBeNull();
  });

  it("hands goods back already converted into real units", () => {
    const [m] = suggestLineMatches(
      [{ id: "l1", description: 'ACETO BALSAMICO "CREMA" 6X500 ML', unit: "CAR", quantity: 1, unitPrice: 29.99 }],
      [],
    );
    expect(m.kind).toBe("goods");
    expect(m.derived.unit).toBe("l");
    expect(m.derived.quantity).toBe(3);
    expect(m.proposal.unit).toBe("l");
  });
});
