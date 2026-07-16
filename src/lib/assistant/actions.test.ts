import { describe, it, expect } from "vitest";
import {
  detectAction,
  parseDateWord,
  parseTimeWord,
  parsePartyWord,
  parseNameWord,
  parsePhoneWord,
  parseMoneyWord,
} from "./actions";

// A fixed "now" so relative dates are deterministic: Monday 2026-07-06.
const NOW = new Date("2026-07-06T15:00:00");

describe("parsers", () => {
  it("parses relative dates", () => {
    expect(parseDateWord("prenota per oggi", NOW)).toBe("2026-07-06");
    expect(parseDateWord("tavolo per domani", NOW)).toBe("2026-07-07");
    expect(parseDateWord("dopodomani alle 20", NOW)).toBe("2026-07-08");
    expect(parseDateWord("book for tomorrow", NOW)).toBe("2026-07-07");
    expect(parseDateWord("reserva para manana", NOW)).toBe("2026-07-07");
    expect(parseDateWord("morgen um 20 uhr", NOW)).toBe("2026-07-07");
  });

  it("parses explicit dates (DMY) and rolls past dates to next year", () => {
    expect(parseDateWord("il 12/08", NOW)).toBe("2026-08-12");
    expect(parseDateWord("il 12/08/2027", NOW)).toBe("2027-08-12");
    expect(parseDateWord("2026-12-24", NOW)).toBe("2026-12-24");
    // 05/01 already passed in 2026 → next year
    expect(parseDateWord("il 05/01", NOW)).toBe("2027-01-05");
  });

  it("parses times", () => {
    expect(parseTimeWord("alle 20:30")).toBe("20:30");
    expect(parseTimeWord("alle 20")).toBe("20:00");
    // bare small hour in a restaurant means the evening
    expect(parseTimeWord("alle 8")).toBe("20:00");
    expect(parseTimeWord("at 21:15")).toBe("21:15");
    expect(parseTimeWord("a las 21")).toBe("21:00");
    expect(parseTimeWord("um 19:00")).toBe("19:00");
  });

  it("parses party size", () => {
    expect(parsePartyWord("tavolo per 4 persone")).toBe(4);
    expect(parsePartyWord("per 6")).toBe(6);
    expect(parsePartyWord("for 2 people")).toBe(2);
    expect(parsePartyWord("para 5 personas")).toBe(5);
    // "per le 20:30" is a time, not a party of 20
    expect(parsePartyWord("per 20:30")).toBeNull();
  });

  it("parses names, phones and money", () => {
    expect(parseNameWord("prenota a nome di Mario Rossi per domani")).toBe("Mario Rossi");
    expect(parseNameWord("prenota a nome Giulia alle 20")).toBe("Giulia");
    expect(parseNameWord("cancella la prenotazione di Marco")).toBe("Marco");
    // "per domani" must not become a name
    expect(parseNameWord("prenota per domani")).toBeNull();
    expect(parsePhoneWord("il numero e +39 333 123 4567")).toBe("+393331234567");
    expect(parseMoneyWord("apri la cassa con 150 euro")).toBe(150);
    expect(parseMoneyWord("con 99,50")).toBe(99.5);
  });
});

describe("detectAction", () => {
  it("detects create_reservation with slots (it)", () => {
    const a = detectAction("crea una prenotazione a nome Mario per domani alle 20:30 per 4 persone", NOW);
    expect(a).toMatchObject({
      kind: "create_reservation",
      name: "Mario",
      date: "2026-07-07",
      time: "20:30",
      party: 4,
    });
  });

  it("detects create_reservation in en/es/de", () => {
    expect(detectAction("book a table for tomorrow", NOW)?.kind).toBe("create_reservation");
    expect(detectAction("crea una nueva reserva para 2 personas", NOW)?.kind).toBe("create_reservation");
    expect(detectAction("erstelle eine neue reservierung", NOW)?.kind).toBe("create_reservation");
  });

  it("detects cancel_reservation", () => {
    const a = detectAction("cancella la prenotazione di Marco", NOW);
    expect(a).toMatchObject({ kind: "cancel_reservation", name: "Marco" });
    expect(detectAction("cancel the reservation for tomorrow", NOW)?.kind).toBe("cancel_reservation");
  });

  it("detects recap_reservations with date", () => {
    expect(detectAction("fammi un recap delle prenotazioni", NOW)).toMatchObject({
      kind: "recap_reservations",
      date: "2026-07-06",
    });
    expect(detectAction("quante prenotazioni abbiamo domani?", NOW)).toMatchObject({
      kind: "recap_reservations",
      date: "2026-07-07",
    });
    expect(detectAction("show the reservations list", NOW)?.kind).toBe("recap_reservations");
  });

  it("detects revenue / day recap", () => {
    expect(detectAction("quanto abbiamo incassato oggi?", NOW)?.kind).toBe("revenue");
    expect(detectAction("recap della giornata", NOW)?.kind).toBe("revenue");
    expect(detectAction("today's takings", NOW)?.kind).toBe("revenue");
  });

  it("detects open/close register with optional float", () => {
    expect(detectAction("apri la cassa", NOW)).toMatchObject({ kind: "open_register" });
    expect(detectAction("apri la cassa con 100 euro", NOW)).toMatchObject({
      kind: "open_register",
      float: 100,
    });
    expect(detectAction("chiudi la cassa", NOW)?.kind).toBe("close_register");
    expect(detectAction("close the till", NOW)?.kind).toBe("close_register");
  });

  it("leaves how-to questions to the knowledge base", () => {
    expect(detectAction("come apro la cassa?", NOW)).toBeNull();
    expect(detectAction("how do I close the till?", NOW)).toBeNull();
    expect(detectAction("come creo una prenotazione?", NOW)).toBeNull();
  });

  it("ignores unrelated chatter", () => {
    expect(detectAction("ciao come va", NOW)).toBeNull();
    expect(detectAction("come funziona il menu digitale", NOW)).toBeNull();
  });
});
