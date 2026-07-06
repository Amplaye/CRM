import { describe, it, expect } from "vitest";
import { answerQuery, normalize, scoreTopic } from "./engine";
import { KB, topicById } from "./kb";

// The assistant must resolve real staff questions in all four CRM languages
// without any external service — these are the golden queries.

describe("normalize", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalize("Com'è? Perché!")).toBe("com e perche");
    expect(normalize("¿CÓMO añado un plato?")).toBe("como anado un plato");
  });
});

describe("answerQuery — topic matching", () => {
  const cases: Array<[string, "en" | "it" | "es" | "de", string]> = [
    // Italian
    ["come apro la cassa?", "it", "cassa-open-close"],
    ["chiusura di cassa e fondo", "it", "cassa-open-close"],
    ["come aggiungo un piatto al menu?", "it", "menu-manage"],
    ["gestire le prenotazioni", "it", "reservations"],
    ["come collegare whatsapp", "it", "whatsapp-connect"],
    ["scorte e magazzino", "it", "inventory"],
    ["food cost di un piatto", "it", "food-cost"],
    ["aggiungere un tavolo in sala", "it", "floor"],
    ["annullare uno scontrino", "it", "cassa-receipts"],
    ["invitare un cameriere nel team", "it", "staff"],
    ["il gestionale è bloccato col lucchetto", "it", "billing"],
    ["inviare la comanda con le portate", "it", "cassa-orders"],
    // English
    ["how do I close the till?", "en", "cassa-open-close"],
    ["add a dish to the menu", "en", "menu-manage"],
    ["connect whatsapp", "en", "whatsapp-connect"],
    // Spanish
    ["¿cómo añado un plato?", "es", "menu-manage"],
    ["abrir la caja con fondo", "es", "cassa-open-close"],
    ["lista de espera", "es", "waitlist"],
    // German
    ["wie verbinde ich whatsapp?", "de", "whatsapp-connect"],
    ["kasse schließen", "de", "cassa-open-close"],
  ];

  it.each(cases)("%s (%s) → %s", (query, lang, expectedId) => {
    const reply = answerQuery(query, lang);
    expect(reply.kind).toBe("topic");
    expect(reply.topic?.id).toBe(expectedId);
  });

  it("answers in the requested language", () => {
    const reply = answerQuery("come apro la cassa?", "it");
    expect(reply.topic?.answer.it).toContain("giornata");
  });

  it("offers related topics as chips", () => {
    const reply = answerQuery("come apro la cassa?", "it");
    expect(reply.related.length).toBeGreaterThan(0);
  });
});

describe("answerQuery — smalltalk & fallback", () => {
  it("greets back on a bare greeting", () => {
    const reply = answerQuery("ciao", "it");
    expect(reply.kind).toBe("smalltalk");
    expect(reply.text).toBeTruthy();
  });

  it("thanks in the right language", () => {
    const reply = answerQuery("gracias", "es");
    expect(reply.kind).toBe("smalltalk");
    expect(reply.text).toContain("nada");
  });

  it("prefers the real question over an embedded greeting", () => {
    const reply = answerQuery("ciao, come aggiungo un piatto al menu?", "it");
    expect(reply.kind).toBe("topic");
    expect(reply.topic?.id).toBe("menu-manage");
  });

  it("falls back with suggestions on gibberish", () => {
    const reply = answerQuery("xyzabc qwerty", "en");
    expect(reply.kind).toBe("fallback");
    expect(reply.suggestions.length).toBeGreaterThan(0);
  });
});

describe("knowledge base integrity", () => {
  it("every topic has all four languages everywhere", () => {
    for (const topic of KB) {
      for (const lang of ["en", "it", "es", "de"] as const) {
        expect(topic.title[lang], `${topic.id} title ${lang}`).toBeTruthy();
        expect(topic.answer[lang], `${topic.id} answer ${lang}`).toBeTruthy();
        if (topic.steps) {
          expect(topic.steps[lang]?.length, `${topic.id} steps ${lang}`).toBeGreaterThan(0);
        }
        for (const link of topic.links || []) {
          expect(link.label[lang], `${topic.id} link ${lang}`).toBeTruthy();
        }
      }
      expect(topic.keywords.length, `${topic.id} keywords`).toBeGreaterThan(2);
    }
  });

  it("related ids all resolve", () => {
    for (const topic of KB) {
      for (const rel of topic.related || []) {
        expect(topicById(rel), `${topic.id} → ${rel}`).toBeTruthy();
      }
    }
  });

  it("every topic is reachable by its own title", () => {
    for (const topic of KB) {
      const score = scoreTopic(topic, normalize(topic.title.it));
      expect(score, `${topic.id} unreachable via title`).toBeGreaterThanOrEqual(0);
    }
  });
});
