import { describe, it, expect } from "vitest";
import { parsePackSize, deriveLine, classifyUm } from "./pack-size";

// Every line below is copied verbatim from a real Ristogamma DDT (n. 3.692),
// the document that exposed this gap: booked literally it produced six "1 pz"
// rows, which is useless for food cost.
describe("the Ristogamma DDT, end to end", () => {
  it("NR piece: reads the item weight, not the carton", () => {
    // "(X6)" is six jars to a carton — we received one jar of 1,7 kg.
    const d = deriveLine({
      description: 'OLIVE NERE D/N V/V "QUALITALY" 1,7 KG (X6)',
      unit: "NR", quantity: 1, unitPrice: 7.9,
    });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(1.7);
    expect(d.unitCost).toBeCloseTo(4.6471, 3);
  });

  it("CF pack: 1 KG despite the (X10) carton", () => {
    const d = deriveLine({
      description: 'VONGOLE C/G "CAPPUCCINE" 0% 60/80 CF.1 KG (X10)',
      unit: "CF", quantity: 1, unitPrice: 3.98,
    });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(1);
    expect(d.unitCost).toBeCloseTo(3.98, 4);
  });

  it("CAR carton: multiplies the 6X500 ML multipack into litres", () => {
    const d = deriveLine({
      description: 'ACETO BALSAMICO "CREMA QUALITALY" 6X500 ML',
      unit: "CAR", quantity: 1, unitPrice: 29.99,
    });
    expect(d.unit).toBe("l");
    expect(d.quantity).toBe(3);
    expect(d.unitCost).toBeCloseTo(9.9967, 3);
  });

  it("ignores calibro and glazing percentages", () => {
    // "SG.41/50" is pieces per kg and "DEV.25%" a process note — neither is a size.
    const d = deriveLine({
      description: 'GAMB.CODA SG.41/50 "MARYSOL" EC. DEV.25% 1 KG (X10)',
      unit: "CF", quantity: 1, unitPrice: 9.96,
    });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(1);
    expect(d.unitCost).toBeCloseTo(9.96, 4);
  });

  it("survives spaced calibro and (X 10)", () => {
    const d = deriveLine({
      description: 'CALAMARI AN/CIUFFI S/P 10/20 "JMARINE" IQF 0% CF.1 KG (X 10)',
      unit: "CF", quantity: 1, unitPrice: 11.98,
    });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(1);
  });

  it("converts grams to a per-kg cost", () => {
    const d = deriveLine({
      description: 'MOSCARDINI 40/60 IQF 1P "QUALITALY" CF.800 GR (X10)',
      unit: "CF", quantity: 1, unitPrice: 6.9,
    });
    // 800 g quoted as 0,8 kg at €8,625/kg — the way the trade prices it.
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(0.8);
    expect(d.unitCost).toBeCloseTo(8.625, 4);
  });
});

describe("classifyUm", () => {
  it("separates packs, cartons, pieces and real measures", () => {
    expect(classifyUm("CF")).toBe("pack");
    expect(classifyUm("CAR")).toBe("carton");
    expect(classifyUm("NR")).toBe("piece");
    expect(classifyUm("KG")).toBe("weight");
    expect(classifyUm("")).toBe("unknown");
  });
});

describe("parsePackSize", () => {
  it("a carton with an (Xn) multiplier multiplies the inner pack", () => {
    const p = parsePackSize("PELATI CF.400 GR (X24)", "CT");
    expect(p).toMatchObject({ size: 9.6, unit: "kg" });
  });

  it("the same line bought as a pack does NOT multiply", () => {
    const p = parsePackSize("PELATI CF.400 GR (X24)", "CF");
    expect(p).toMatchObject({ size: 0.4, unit: "kg" });
  });

  it("leaves lines already priced by weight alone", () => {
    expect(parsePackSize("PROSCIUTTO CRUDO", "KG")).toBeNull();
  });

  it("returns null when no format is stated", () => {
    expect(parsePackSize("VERDURE MISTE", "CF")).toBeNull();
  });

  it("handles litres and decimal commas", () => {
    expect(parsePackSize("OLIO E.V.O. LATTA 5 LT", "CF")).toMatchObject({ size: 5, unit: "l" });
    expect(parsePackSize("PANNA UHT 0,5 LT", "CF")).toMatchObject({ size: 0.5, unit: "l" });
  });
});

describe("deriveLine safety", () => {
  it("multiplies by the delivered quantity", () => {
    const d = deriveLine({ description: "FARINA 00 SACCO 25 KG", unit: "CF", quantity: 4, unitPrice: 18.5 });
    expect(d.quantity).toBe(100);
    expect(d.unitCost).toBeCloseTo(0.74, 4);
  });

  it("falls back to the line total when no unit price is printed", () => {
    const d = deriveLine({ description: "ZUCCHERO CF.1 KG", unit: "CF", quantity: 2, lineTotal: 3.0 });
    expect(d.unitCost).toBeCloseTo(1.5, 4);
  });

  it("keeps an unreadable line as pieces rather than inventing a size", () => {
    const d = deriveLine({ description: "ASSORTIMENTO MISTO", unit: "CF", quantity: 3, unitPrice: 5 });
    expect(d.unit).toBe("pz");
    expect(d.quantity).toBe(3);
    expect(d.unitCost).toBe(5);
    expect(d.pack).toBeNull();
  });

  it("passes through a line already billed per kilo", () => {
    const d = deriveLine({ description: "PROSCIUTTO CRUDO", unit: "KG", quantity: 2.4, unitPrice: 21.5 });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(2.4);
    expect(d.unitCost).toBe(21.5);
  });

  it("never returns a NaN cost", () => {
    const d = deriveLine({ description: "X", unit: null, quantity: null, unitPrice: null });
    expect(d.unitCost).toBeNull();
    expect(d.quantity).toBe(1);
  });
});

// Lines taken from four further real documents (Punto&Pasta DDT, Gavioli
// cantina, Superfresco). Each exposed a U.M. the first version booked as
// pieces, silently turning a weight into a count.
describe("supplier unit vocabulary", () => {
  it('reads "KIL" as kilos (Punto&Pasta)', () => {
    const d = deriveLine({ description: "Tortelloni Ricotta e Spinaci", unit: "KIL", quantity: 10, unitPrice: 14.5 });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(10);
    expect(d.unitCost).toBe(14.5);
  });

  it('reads "Ltr" as litres (Superfresco)', () => {
    const d = deriveLine({ description: "Panna fresca gr. 35% 1 LT", unit: "Ltr", quantity: 2, unitPrice: 6.8 });
    expect(d.unit).toBe("l");
    expect(d.quantity).toBe(2);
    expect(d.unitCost).toBe(6.8);
  });

  it('treats "BT" as a bottle pack and reads its size (Gavioli)', () => {
    const d = deriveLine({
      description: "VINO SPUMANTE PROSECCO BRUT DOP 0.75LT X 6 ALCOOL 11,5%",
      unit: "BT", quantity: 30, unitPrice: 4.2,
    });
    expect(d.unit).toBe("l");
    expect(d.quantity).toBeCloseTo(22.5, 3); // 30 bottles × 0,75 l
  });

  it("keeps a decimal weight billed per kilo intact (Superfresco)", () => {
    const d = deriveLine({ description: "Bufala 250gr Termosaldata", unit: "kg", quantity: 13.5, unitPrice: 3 });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(13.5);
    expect(d.unitCost).toBe(3);
  });

  it("does not read the alcohol percentage as a size", () => {
    const p = parsePackSize("VINO ROSSO DOP ALCOOL 13,5% 0,75 LT", "BT");
    expect(p).toMatchObject({ size: 0.75, unit: "l" });
  });
});

// The four rows the owner photographed from the Superfresco invoice, where the
// review still showed the supplier's raw figures. These assert what the field
// must contain once the conversion runs.
describe("Superfresco review rows", () => {
  it('"netto2.5kg" billed by the piece becomes real kilos', () => {
    const d = deriveLine({
      description: "Polpa pomodoro Pa'pizza netto2.5kg", unit: "n", quantity: 3.7, unitPrice: 18,
    });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBe(9.25);       // 3,7 latte × 2,5 kg
    expect(d.unitCost).toBe(7.2);        // 18,00 ÷ 2,5
    expect(d.explanation).toBeTruthy();
  });

  it("a 100 gr piece price becomes a per-kilo price", () => {
    const d = deriveLine({
      description: "Robiola vaccina 100gr PF", unit: "Pz", quantity: 3, unitPrice: 0.33,
    });
    expect(d.unit).toBe("kg");
    expect(d.quantity).toBeCloseTo(0.3, 6);
    expect(d.unitCost).toBeCloseTo(3.3, 4);
  });

  it('explains "Ltr" → "l" even though nothing was multiplied', () => {
    // Silence here read as a mistake; the note says the units are equivalent.
    const d = deriveLine({ description: "Panna fresca gr. 35% 1 LT", unit: "Ltr", quantity: 2, unitPrice: 6.8 });
    expect(d.unit).toBe("l");
    expect(d.quantity).toBe(2);
    expect(d.explanation).toBe("2 Ltr = 2 l");
  });

  it("stays quiet when the document already agrees with the warehouse", () => {
    const d = deriveLine({ description: "Feta Cubetti 1kg", unit: "kg", quantity: 2, unitPrice: 13.9 });
    expect(d.unit).toBe("kg");
    expect(d.explanation).toBeNull();
  });
});
