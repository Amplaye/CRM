import { describe, it, expect } from "vitest";
import { suggestShelfLife } from "./shelf-life-presets";

describe("suggestShelfLife", () => {
  it("reads fresh dairy as short-lived", () => {
    expect(suggestShelfLife("Mozzarella di bufala")).toBe(5);
    expect(suggestShelfLife("Bufala Termosaldata Cicatelli")).toBe(5);
    expect(suggestShelfLife("Ricotta fresca")).toBe(5);
  });

  it("reads fresh fish and meat as very short-lived", () => {
    expect(suggestShelfLife("Branzino fresco")).toBe(2);
    expect(suggestShelfLife("Petto di pollo")).toBe(3);
    expect(suggestShelfLife("Macinato di manzo")).toBe(3);
  });

  it("keeps pantry / canned / dry staples long", () => {
    expect(suggestShelfLife("Farina 00")).toBe(365);
    expect(suggestShelfLife("Passata di pomodoro")).toBe(365);
    expect(suggestShelfLife("Vino rosso della casa")).toBe(365);
  });

  it("lets a long-life qualifier beat the fresh category", () => {
    expect(suggestShelfLife("Tonno")).toBe(2); // fresh fish
    expect(suggestShelfLife("Tonno in scatola")).toBe(365); // pantry wins
  });

  it("reads aged cheese and cured meats", () => {
    expect(suggestShelfLife("Parmigiano Reggiano")).toBe(60);
    expect(suggestShelfLife("Prosciutto crudo")).toBe(20);
  });

  it("reads frozen goods", () => {
    expect(suggestShelfLife("Patatine surgelate")).toBe(180);
  });

  it("returns null when it cannot tell (no false confidence)", () => {
    expect(suggestShelfLife("Articolo generico XYZ")).toBeNull();
    expect(suggestShelfLife("")).toBeNull();
    expect(suggestShelfLife(null)).toBeNull();
  });
});
