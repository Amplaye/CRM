import { describe, it, expect } from "vitest";
import { generateKbArticles, defaultQuestionnaire, KbQuestionnaire, KbContext } from "./kb-generator";

const ctx: KbContext = { restaurant_name: "Trattoria Rossa", restaurant_phone: "+34 928 123 456", language: "es" };

describe("generateKbArticles — questionnaire → formatted KB", () => {
  it("always returns exactly 4 articles with the expected categories", () => {
    const arts = generateKbArticles(defaultQuestionnaire(), ctx);
    expect(arts).toHaveLength(4);
    expect(arts.map((a) => a.category)).toEqual(["policies", "general", "policies", "general"]);
    // Every article has a non-empty title and body — never blank.
    for (const a of arts) {
      expect(a.title.trim().length).toBeGreaterThan(0);
      expect(a.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("reservation article reflects auto-confirm threshold and large-group choice", () => {
    const q: KbQuestionnaire = { ...defaultQuestionnaire(), auto_confirm_max: 6, accepts_large_groups: true };
    const res = generateKbArticles(q, ctx)[0];
    expect(res.content).toContain("1-6"); // auto-confirm up to 6
    expect(res.content).toContain("7+"); // groups of 7+ pending (threshold = max+1)

    const noGroups = generateKbArticles({ ...q, accepts_large_groups: false }, ctx)[0];
    expect(noGroups.content).toContain("No se aceptan grupos");
    // No deposit line when large groups aren't accepted.
    expect(noGroups.content).not.toContain("Depósito");
  });

  it("maps payment methods and yes/no services into the services article", () => {
    const q: KbQuestionnaire = { ...defaultQuestionnaire(), payments: ["cash", "bizum"], pets: true, terrace: false };
    const svc = generateKbArticles(q, ctx)[1];
    expect(svc.content).toContain("efectivo");
    expect(svc.content).toContain("Bizum");
    expect(svc.content).toContain("Terraza: No");
  });

  it("diets article lists only enabled options, with a fallback when none", () => {
    const some = generateKbArticles({ ...defaultQuestionnaire(), vegetarian: true, vegan: false, gluten_free: false, celiac_safe: false, lactose_free: false, allergen_info: false }, ctx)[2];
    expect(some.content).toContain("vegetarianas");
    expect(some.content).not.toContain("veganas");

    const none = generateKbArticles({ ...defaultQuestionnaire(), vegetarian: false, vegan: false, gluten_free: false, celiac_safe: false, lactose_free: false, allergen_info: false }, ctx)[2];
    expect(none.content).toContain("Sin opciones especiales");
  });

  it("location article includes address, phone and chosen parking kind", () => {
    const q: KbQuestionnaire = { ...defaultQuestionnaire(), address: "Calle Mayor 12", parking_info: "own", landmark: "Playa de Las Canteras" };
    const loc = generateKbArticles(q, ctx)[3];
    expect(loc.content).toContain("Trattoria Rossa");
    expect(loc.content).toContain("Calle Mayor 12");
    expect(loc.content).toContain("+34 928 123 456");
    expect(loc.content).toContain("parking propio");
    expect(loc.content).toContain("Playa de Las Canteras");
  });

  it("produces localized output (it differs from es) without changing structure", () => {
    const es = generateKbArticles(defaultQuestionnaire(), { ...ctx, language: "es" });
    const it = generateKbArticles(defaultQuestionnaire(), { ...ctx, language: "it" });
    expect(it[0].title).toBe("Politica di prenotazione");
    expect(es[0].title).toBe("Política de reservas");
    expect(it).toHaveLength(4);
    // Categories are language-independent.
    expect(it.map((a) => a.category)).toEqual(es.map((a) => a.category));
  });

  it("optional short fields are omitted cleanly when empty (no dangling labels)", () => {
    const q: KbQuestionnaire = { ...defaultQuestionnaire(), address: "", landmark: "" };
    const loc = generateKbArticles(q, { ...ctx, restaurant_phone: "" })[3];
    expect(loc.content).not.toContain("Dirección:");
    expect(loc.content).not.toContain("Referencia:");
    expect(loc.content).not.toContain("Teléfono:");
  });
});
