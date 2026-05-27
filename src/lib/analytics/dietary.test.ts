import { describe, it, expect } from "vitest";
import { detectDiets } from "./dietary";

const has = (text: string) => Array.from(detectDiets(text)).sort();

describe("detectDiets", () => {
  it("returns nothing for empty or unrelated text", () => {
    expect(has("")).toEqual([]);
    expect(has("Vorrei un tavolo per due persone domani sera")).toEqual([]);
  });

  it("detects lactose-free across languages", () => {
    expect(has("ha del cibo senza lattosio?")).toEqual(["lactose"]);
    expect(has("sono intollerante al lattosio")).toEqual(["lactose"]);
    expect(has("¿tienen algo sin lactosa?")).toEqual(["lactose"]);
    expect(has("do you have lactose-free options")).toEqual(["lactose"]);
    expect(has("brauche etwas laktosefrei")).toEqual(["lactose"]);
  });

  it("detects gluten-free incl. celiac wording", () => {
    expect(has("avete piatti senza glutine?")).toEqual(["gluten"]);
    expect(has("viene una persona celiaca")).toEqual(["gluten"]);
    expect(has("soy celíaco")).toEqual(["gluten"]);
    expect(has("we need a gluten-free menu")).toEqual(["gluten"]);
    expect(has("ich habe Zöliakie")).toEqual(["gluten"]);
  });

  it("detects vegetarian and vegan separately", () => {
    expect(has("avete cibo vegetariano?")).toEqual(["vegetarian"]);
    expect(has("siamo vegani")).toEqual(["vegan"]);
    expect(has("do you offer vegan dishes")).toEqual(["vegan"]);
    expect(has("ein vegetarisches Gericht bitte")).toEqual(["vegetarian"]);
  });

  it("does not let a vegan mention also count as vegetarian", () => {
    expect(has("menu vegano")).toEqual(["vegan"]);
    // but if both words appear, both count
    expect(has("opzioni vegetariane e vegane")).toEqual(["vegan", "vegetarian"]);
  });

  it("detects multiple categories in one message", () => {
    expect(has("siamo in 4, uno celiaco e uno vegano, e c'è chi non tollera il lattosio"))
      .toEqual(["gluten", "lactose", "vegan"]);
  });

  it("is case-insensitive", () => {
    expect(has("SENZA GLUTINE per favore")).toEqual(["gluten"]);
    expect(has("VEGANO")).toEqual(["vegan"]);
  });
});
