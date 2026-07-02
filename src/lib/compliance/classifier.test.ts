import { describe, it, expect } from "vitest";
import { classifyText, isSensitive } from "./classifier";

describe("classifyText — Tier 1 (sensitive) detection", () => {
  const health = [
    "Soy alérgico al marisco",              // ES allergy
    "Sono allergico ai crostacei",          // IT allergy
    "Ich habe eine Allergie gegen Nüsse",   // DE allergy
    "I have a nut allergy",                 // EN allergy
    "tengo intolerancia a la lactosa",      // ES intolerance
    "sono celiaco",                         // IT celiac
    "Ich bin Zöliakie-Betroffener",         // DE coeliac
    "estoy embarazada",                     // ES pregnancy
    "sono incinta",                         // IT pregnancy
    "ich bin schwanger",                    // DE pregnancy
    "I'm diabetic",                         // EN condition
  ];
  it.each(health)("flags health: %s", (msg) => {
    const c = classifyText(msg);
    expect(c.tier).toBe(1);
    expect(c.categories).toContain("health");
    expect(c.matches.length).toBeGreaterThan(0);
  });

  const accessibility = [
    "necesito acceso para silla de ruedas", // ES wheelchair
    "vengo in sedia a rotelle",             // IT wheelchair
    "Ich komme im Rollstuhl",               // DE wheelchair
    "we need wheelchair access",            // EN
    "movilidad reducida",                   // ES reduced mobility
  ];
  it.each(accessibility)("flags accessibility: %s", (msg) => {
    const c = classifyText(msg);
    expect(c.tier).toBe(1);
    expect(c.categories).toContain("accessibility");
  });
});

describe("classifyText — Tier 0 (ordinary) stays ordinary", () => {
  const ordinary = [
    "Quiero reservar mesa para 4 el sábado a las 21",
    "Tavolo per due stasera alle 20:30",
    "Ein Tisch für drei Personen bitte",
    "Table for two tomorrow, we bring our dog",   // pets = ordinary
    "Veniamo con due bambini",                     // kids = ordinary
    "",
    "   ",
  ];
  it.each(ordinary)("stays Tier 0: %s", (msg) => {
    expect(classifyText(msg).tier).toBe(0);
    expect(isSensitive(msg)).toBe(false);
  });
});

describe("classifyText — robustness", () => {
  it("handles null/undefined", () => {
    expect(classifyText(null).tier).toBe(0);
    expect(classifyText(undefined).matches).toEqual([]);
  });
  it("detects across multiple categories at once", () => {
    const c = classifyText("Soy alérgico al marisco y voy en silla de ruedas");
    expect(c.categories).toContain("health");
    expect(c.categories).toContain("accessibility");
  });
});
