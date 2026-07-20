import { describe, it, expect } from "vitest";
import { classifyLine, isStockable } from "./line-kind";

describe("classifyLine", () => {
  it("keeps services out of the warehouse (real Centrocassa invoices)", () => {
    // Booked as goods these became €400 and €180 "ingredients".
    expect(classifyLine("RINNOVO CONTRATTO ASSISTENZA TECNICO ANNUALE PUNTO CASSA")).toBe("service");
    expect(classifyLine("NOLEGGIO MISURATORE TELEMATICO MARCA MICRELEC MODELLO HELI")).toBe("service");
  });

  it("recognises the usual service wording", () => {
    for (const d of [
      "Canone mensile software gestionale",
      "Abbonamento annuale licenza",
      "Manutenzione impianto frigorifero",
      "Intervento tecnico straordinario",
      "Sanificazione locali",
      "Consulenza HACCP",
    ]) {
      expect(classifyLine(d)).toBe("service");
    }
  });

  it("recognises delivery charges and deposits", () => {
    for (const d of [
      "Spese di trasporto",
      "Contributo CONAI assolto",
      "Cauzione pallet EPAL",
      "Vuoto a rendere",
      "Arrotondamento",
      "Bollo su fattura",
    ]) {
      expect(classifyLine(d)).toBe("charge");
    }
  });

  it("still treats every real goods line as goods", () => {
    for (const d of [
      'VONGOLE C/G "CAPPUCCINE" 0% 60/80 CF.1 KG (X10)',
      "Tortelloni Ricotta e Spinaci",
      "Mozzarella Julienne Magnus",
      "VINO SPUMANTE PROSECCO BRUT DOP 0.75LT X 6",
      "SCATOLE BICCHIERI",
      "Parmigiano reggiano grattato 1 kg",
    ]) {
      expect(classifyLine(d)).toBe("goods");
    }
  });

  it("does not mistake food for a service on a shared word", () => {
    // "servito"/"servizio" appear on food lines; the food term must win.
    expect(classifyLine("Pane servito in cestino")).toBe("goods");
    expect(classifyLine("Servizio piatti pizza in ceramica")).toBe("goods");
  });

  it("defaults to goods when it cannot tell", () => {
    expect(classifyLine("ART. 4471 MISTO")).toBe("goods");
    expect(classifyLine("")).toBe("goods");
    expect(isStockable("QUALCOSA DI IGNOTO")).toBe(true);
  });
});
