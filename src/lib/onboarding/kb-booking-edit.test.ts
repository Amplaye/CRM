import { describe, it, expect } from "vitest";
import {
  reservationArticleFromForm,
  detectArticleLangs,
  RESERVATION_TITLES,
  BookingPolicyForm,
  ReservationArticleContext,
  OpeningHours,
} from "./kb-generator";

// Post-onboarding editing of the reservation-policy article (Settings → Bookings).
// These pure helpers keep the QUOTED policy (KB article) in lockstep with the
// ENFORCED policy (settings.venue / last_reservation_offset / closing offset).

const HOURS: OpeningHours = {
  "1": [{ open: "13:00", close: "16:00" }, { open: "20:00", close: "23:00" }], // Mon: lunch + dinner
  "2": [{ open: "20:00", close: "23:00" }], // Tue: dinner only
};

const baseForm: BookingPolicyForm = {
  cancellation_notice: "24h",
  late_tolerance_min: 20,
  late_grace_if_notified: true,
  last_lunch_offset_min: 30,
  last_dinner_offset_min: 60,
  deposit_required: true,
  deposit_amount: "30",
};

const baseCtx: ReservationArticleContext = {
  restaurant_name: "Trattoria Rossa",
  restaurant_phone: "+34 928 123 456",
  opening_hours: HOURS,
  languages: ["it"],
  capacity_seats: 40,
  auto_confirm_max: 6,
  accepts_large_groups: true,
  terrace: true,
};

describe("RESERVATION_TITLES", () => {
  it("lists the reservation article title in all four languages", () => {
    expect(RESERVATION_TITLES).toEqual([
      "Política de reservas",
      "Politica di prenotazione",
      "Reservation policy",
      "Reservierungsrichtlinie",
    ]);
  });
});

describe("detectArticleLangs", () => {
  it("falls back to the primary language when there are no section headers", () => {
    expect(detectArticleLangs("Capienza: 40\nCancellazione: ...", "it")).toEqual(["it"]);
  });

  it("recovers the languages in the order they appear in the merged article", () => {
    const content = "[English]\nCapacity: 40\n\n[Italiano]\nCapienza: 40";
    expect(detectArticleLangs(content, "es")).toEqual(["en", "it"]);
  });

  it("respects header position, not a fixed order", () => {
    const content = "[Deutsch]\n...\n\n[Español]\n...";
    expect(detectArticleLangs(content, "en")).toEqual(["de", "es"]);
  });
});

describe("reservationArticleFromForm", () => {
  it("returns the reservation article (policies category, primary-language title)", () => {
    const a = reservationArticleFromForm(baseForm, baseCtx);
    expect(a.category).toBe("policies");
    expect(a.title).toBe("Politica di prenotazione");
  });

  it("reflects the edited rules in the body (cancellation, late tolerance, deposit, capacity)", () => {
    const a = reservationArticleFromForm(baseForm, baseCtx).content;
    expect(a).toContain("Capienza: 40");
    expect(a).toContain("avvisare almeno 24 h prima");
    expect(a).toContain("Tolleranza ritardo: 20 min");
    expect(a).toContain("più margine se il cliente avvisa in anticipo");
    // Bare deposit number gets the currency symbol appended.
    expect(a).toContain("Caparra: è richiesta una caparra per i gruppi numerosi (30 €)");
  });

  it("derives the last-reservation cut-off from the shift close minus the offset", () => {
    // Dinner closes 23:00, offset 60 → last dinner reservation 22:00.
    const a = reservationArticleFromForm(baseForm, baseCtx).content;
    expect(a).toContain("Ultima prenotazione cena: 22:00");
    // Lunch closes 16:00, offset 30 → 15:30.
    expect(a).toContain("Ultima prenotazione pranzo: 15:30");
  });

  it("omits the deposit line when the venue does not take large groups", () => {
    const a = reservationArticleFromForm(baseForm, { ...baseCtx, accepts_large_groups: false }).content;
    expect(a).not.toContain("Caparra:");
  });

  it("includes the terrace caveat only when terrace is on", () => {
    const withTerrace = reservationArticleFromForm(baseForm, baseCtx).content;
    expect(withTerrace).toContain("Terrazza: soggetta a disponibilità, non garantita");
    const without = reservationArticleFromForm(baseForm, { ...baseCtx, terrace: false }).content;
    expect(without).not.toContain("non garantita");
  });

  it("omits the capacity line when capacity is unknown (0)", () => {
    const a = reservationArticleFromForm(baseForm, { ...baseCtx, capacity_seats: 0 }).content;
    expect(a).not.toContain("Capienza:");
  });

  it("stacks every language block for a multi-language tenant", () => {
    const a = reservationArticleFromForm(baseForm, { ...baseCtx, languages: ["it", "en"] }).content;
    expect(a).toContain("[Italiano]");
    expect(a).toContain("[English]");
    expect(a).toContain("let us know at least 24 h in advance");
  });

  it("marks a switched-off shift (-1) as no service", () => {
    const a = reservationArticleFromForm({ ...baseForm, last_lunch_offset_min: -1 }, baseCtx).content;
    expect(a).toContain("Ultima prenotazione pranzo: nessun servizio");
  });
});
