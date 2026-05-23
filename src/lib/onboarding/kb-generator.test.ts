import { describe, it, expect } from "vitest";
import {
  generateKbArticles, generateKbArticlesMulti, defaultQuestionnaire, KbQuestionnaire, KbContext, OpeningHours,
} from "./kb-generator";

const ctx: KbContext = { restaurant_name: "Trattoria Rossa", restaurant_phone: "+34 928 123 456", language: "es" };

// Find an article by its (localized) title. Articles are addressed by title,
// not index, because the count is variable (Schedule + Chef are conditional).
const byTitle = (arts: ReturnType<typeof generateKbArticles>, title: string) =>
  arts.find((a) => a.title === title);

const HOURS: OpeningHours = {
  "0": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }], // Sunday: lunch + dinner
  "1": [], // Monday closed
  "2": [{ open: "19:30", close: "22:30" }], // Tuesday: dinner only
};

describe("generateKbArticles — questionnaire → formatted KB", () => {
  it("returns the 4 core articles (no hours, no chef picks) with expected categories", () => {
    const arts = generateKbArticles(defaultQuestionnaire(), ctx);
    expect(arts.map((a) => a.title)).toEqual([
      "Política de reservas", "Dietas y alergias", "Servicios adicionales", "Ubicación y cómo llegar",
    ]);
    expect(arts.map((a) => a.category)).toEqual(["policies", "policies", "general", "general"]);
    for (const a of arts) {
      expect(a.title.trim().length).toBeGreaterThan(0);
      expect(a.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("emits a Schedule article from opening hours (Mon→Sun, lunch/dinner tagged, closed days)", () => {
    const arts = generateKbArticles(defaultQuestionnaire(), { ...ctx, opening_hours: HOURS });
    const sched = byTitle(arts, "Horario del restaurante");
    expect(sched).toBeTruthy();
    expect(sched!.category).toBe("general");
    // Monday first, listed as closed.
    expect(sched!.content.split("\n")[0]).toBe("Lunes: CERRADO");
    // Tuesday dinner-only slot tagged as cena.
    expect(sched!.content).toContain("Martes: 19:30-22:30 (cena)");
    // Sunday has both periods joined with "y".
    expect(sched!.content).toContain("Domingo: 12:30-15:30 (almuerzo) y 19:30-22:30 (cena)");
  });

  it("omits the Schedule article when no day is open", () => {
    const arts = generateKbArticles(defaultQuestionnaire(), { ...ctx, opening_hours: { "1": [], "2": [] } });
    expect(byTitle(arts, "Horario del restaurante")).toBeUndefined();
  });

  it("reservation article reflects auto-confirm threshold, large groups, grace, cancellation and no-show", () => {
    const q: KbQuestionnaire = {
      ...defaultQuestionnaire(), auto_confirm_max: 6, accepts_large_groups: true,
      late_grace_if_notified: true, cancellation_notice: "24h", noshow_release_min: 30, terrace: true,
    };
    const res = byTitle(generateKbArticles(q, ctx), "Política de reservas")!;
    expect(res.content).toContain("1-6"); // auto-confirm up to 6
    expect(res.content).toContain("7+"); // groups of 7+ pending (threshold = max+1)
    expect(res.content).toContain("más margen si el cliente avisa"); // grace nuance
    expect(res.content).toContain("al menos 24 h"); // cancellation notice
    expect(res.content).toContain("se libera pasados 30 min"); // no-show
    expect(res.content).toContain("Terraza: sujeta a disponibilidad"); // terrace preference, not guaranteed

    const noGroups = byTitle(generateKbArticles({ ...q, accepts_large_groups: false }, ctx), "Política de reservas")!;
    expect(noGroups.content).toContain("No se aceptan grupos");
    expect(noGroups.content).not.toContain("Depósito");
  });

  it("no-show line is omitted when set to 0 (don't invent a policy)", () => {
    const res = byTitle(generateKbArticles({ ...defaultQuestionnaire(), noshow_release_min: 0 }, ctx), "Política de reservas")!;
    expect(res.content).not.toContain("No-show");
  });

  it("services article maps payments, kids menu, delivery (with platform) and takeaway wait", () => {
    const q: KbQuestionnaire = {
      ...defaultQuestionnaire(), payments: ["cash", "bizum"], pets: true, terrace: false,
      kids_menu: true, takeaway: true, takeaway_wait: "20-30 min",
      delivery: true, delivery_platform: "Glovo", celebrations: true, outside_cake: true,
    };
    const svc = byTitle(generateKbArticles(q, ctx), "Servicios adicionales")!;
    expect(svc.content).toContain("efectivo");
    expect(svc.content).toContain("Bizum");
    expect(svc.content).toContain("Terraza: No");
    expect(svc.content).toContain("Menú infantil");
    expect(svc.content).toContain("tiempo de espera: 20-30 min");
    expect(svc.content).toContain("Delivery: sí, a través de Glovo");
    expect(svc.content).toContain("Celebraciones");
    expect(svc.content).toContain("Tarta propia");
  });

  it("delivery without a platform falls back to a generic yes; takeaway wait suppressed when no takeaway", () => {
    const q: KbQuestionnaire = { ...defaultQuestionnaire(), delivery: true, delivery_platform: "", takeaway: false, takeaway_wait: "20 min" };
    const svc = byTitle(generateKbArticles(q, ctx), "Servicios adicionales")!;
    expect(svc.content).toContain("Delivery: sí");
    expect(svc.content).not.toContain("a través de");
    expect(svc.content).toContain("Comida para llevar: No");
    expect(svc.content).not.toContain("tiempo de espera"); // no takeaway → no wait line
  });

  it("diets article builds the allergen safety protocol from present allergens", () => {
    const q: KbQuestionnaire = {
      ...defaultQuestionnaire(), vegetarian: true, vegan: false, gluten_free: true, lactose_free: false,
      celiac_safe: true, kitchen_allergens: ["gluten", "nuts", "dairy", "egg"],
      cannot_guarantee_traces: true, severe_allergy_escalate: true, allergen_info: true,
    };
    const diet = byTitle(generateKbArticles(q, ctx), "Dietas y alergias")!;
    expect(diet.content).toContain("Opciones vegetarianas: Sí");
    expect(diet.content).not.toContain("veganas");
    expect(diet.content).toContain("Protocolo para celíacos: preparación separada");
    expect(diet.content).toContain("contaminación cruzada");
    expect(diet.content).toContain("- gluten / harina de trigo");
    expect(diet.content).toContain("- frutos secos");
    expect(diet.content).toContain("No se puede garantizar la ausencia total de trazas");
    expect(diet.content).toContain("Alergia severa");
    expect(diet.content).toContain("disponible bajo petición");
  });

  it("diets article skips the allergen block when none are present, and falls back when fully empty", () => {
    const noAllergens = byTitle(generateKbArticles({ ...defaultQuestionnaire(), kitchen_allergens: [] }, ctx), "Dietas y alergias")!;
    expect(noAllergens.content).not.toContain("contaminación cruzada");

    const none = generateKbArticles({
      ...defaultQuestionnaire(), vegetarian: false, vegan: false, gluten_free: false, lactose_free: false,
      celiac_safe: false, kitchen_allergens: [], cannot_guarantee_traces: false, severe_allergy_escalate: false, allergen_info: false,
    }, ctx);
    expect(byTitle(none, "Dietas y alergias")!.content).toContain("Sin opciones especiales");
  });

  it("emits a Chef recommendations article only when dishes are listed (empties trimmed)", () => {
    const empty = generateKbArticles({ ...defaultQuestionnaire(), chef_recommendations: ["", "   "] }, ctx);
    expect(byTitle(empty, "Recomendaciones del chef")).toBeUndefined();

    const arts = generateKbArticles({ ...defaultQuestionnaire(), chef_recommendations: ["Mortazza — la más pedida", "Marinara — vegana", ""] }, ctx);
    const chef = byTitle(arts, "Recomendaciones del chef")!;
    expect(chef.category).toBe("menu");
    expect(chef.content).toBe("- Mortazza — la más pedida\n- Marinara — vegana");
  });

  it("location article includes cuisine type in the header, address, city, neighborhood, parking and phone", () => {
    const q: KbQuestionnaire = {
      ...defaultQuestionnaire(), cuisine_type: "Trattoria Napoletana", address: "Avenida Rafael Cabrera, 7",
      city: "35002 Las Palmas", neighborhood: "Triana", parking_info: "own", landmark: "Playa de Las Canteras",
    };
    const loc = byTitle(generateKbArticles(q, ctx), "Ubicación y cómo llegar")!;
    expect(loc.content).toContain("Trattoria Rossa - Trattoria Napoletana");
    expect(loc.content).toContain("Avenida Rafael Cabrera, 7");
    expect(loc.content).toContain("35002 Las Palmas");
    expect(loc.content).toContain("Triana");
    expect(loc.content).toContain("+34 928 123 456");
    expect(loc.content).toContain("parking propio");
    expect(loc.content).toContain("Playa de Las Canteras");
  });

  it("optional short fields are omitted cleanly when empty (no dangling labels)", () => {
    const q: KbQuestionnaire = { ...defaultQuestionnaire(), cuisine_type: "", address: "", city: "", neighborhood: "", landmark: "" };
    const loc = byTitle(generateKbArticles(q, { ...ctx, restaurant_phone: "" }), "Ubicación y cómo llegar")!;
    expect(loc.content).not.toContain("Dirección:");
    expect(loc.content).not.toContain("Población:");
    expect(loc.content).not.toContain("Zona:");
    expect(loc.content).not.toContain("Referencia:");
    expect(loc.content).not.toContain("Teléfono:");
    // Header is just the bare restaurant name when no cuisine type.
    expect(loc.content.split("\n")[0]).toBe("Trattoria Rossa");
  });

  it("produces localized output (it differs from es) without changing structure", () => {
    const es = generateKbArticles(defaultQuestionnaire(), { ...ctx, language: "es", opening_hours: HOURS });
    const it = generateKbArticles(defaultQuestionnaire(), { ...ctx, language: "it", opening_hours: HOURS });
    expect(byTitle(it, "Politica di prenotazione")).toBeTruthy();
    expect(byTitle(es, "Política de reservas")).toBeTruthy();
    expect(byTitle(it, "Orari del ristorante")!.content).toContain("CHIUSO");
    expect(it).toHaveLength(es.length);
    expect(it.map((a) => a.category)).toEqual(es.map((a) => a.category));
  });

  it("all four supported languages generate non-empty articles", () => {
    for (const language of ["es", "it", "en", "de"] as const) {
      const arts = generateKbArticles(defaultQuestionnaire(), { ...ctx, language, opening_hours: HOURS });
      expect(arts.length).toBeGreaterThanOrEqual(5); // schedule + 4 core
      for (const a of arts) expect(a.content.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("generateKbArticlesMulti — assistant speaks several languages", () => {
  const mctx = { restaurant_name: ctx.restaurant_name, restaurant_phone: ctx.restaurant_phone };

  it("single language is byte-identical to generateKbArticles (no header noise)", () => {
    const multi = generateKbArticlesMulti(defaultQuestionnaire(), { ...mctx, opening_hours: HOURS }, ["it"]);
    const single = generateKbArticles(defaultQuestionnaire(), { ...ctx, language: "it", opening_hours: HOURS });
    expect(multi).toEqual(single);
  });

  it("empty language list falls back to Spanish", () => {
    const arts = generateKbArticlesMulti(defaultQuestionnaire(), mctx, []);
    expect(byTitle(arts, "Política de reservas")).toBeTruthy(); // Spanish title
  });

  it("merges every language under one article per title, primary first", () => {
    const arts = generateKbArticlesMulti(defaultQuestionnaire(), mctx, ["it", "en"]);
    // Titles come from the PRIMARY language (Italian), one entry per title.
    const titles = arts.map((a) => a.title);
    expect(titles).toContain("Politica di prenotazione");
    expect(new Set(titles).size).toBe(titles.length); // no duplicate titles
    const resv = byTitle(arts, "Politica di prenotazione")!;
    // Both language blocks present, Italian (primary) before English.
    expect(resv.content).toContain("[Italiano]");
    expect(resv.content).toContain("[English]");
    expect(resv.content.indexOf("[Italiano]")).toBeLessThan(resv.content.indexOf("[English]"));
  });

  it("conditional articles (schedule, chef picks) appear once with all languages", () => {
    const q = { ...defaultQuestionnaire(), chef_recommendations: ["Mortazza"] };
    const arts = generateKbArticlesMulti(q, { ...mctx, opening_hours: HOURS }, ["es", "de"]);
    const sched = byTitle(arts, "Horario del restaurante")!; // Spanish primary title
    expect(sched.content).toContain("[Español]");
    expect(sched.content).toContain("[Deutsch]");
    const chef = byTitle(arts, "Recomendaciones del chef")!;
    expect(chef.content.match(/Mortazza/g)?.length).toBe(2); // once per language
  });

  it("article count is stable regardless of how many languages (one per topic)", () => {
    const single = generateKbArticlesMulti(defaultQuestionnaire(), { ...mctx, opening_hours: HOURS }, ["es"]);
    const triple = generateKbArticlesMulti(defaultQuestionnaire(), { ...mctx, opening_hours: HOURS }, ["es", "it", "en"]);
    expect(triple.length).toBe(single.length); // merged by topic, not concatenated
    expect(triple.map((a) => a.title)).toEqual(single.map((a) => a.title)); // primary titles
  });
});
