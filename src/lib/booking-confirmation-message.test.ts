import { describe, it, expect } from "vitest";
import { buildBookingConfirmationMessage, cleanGuestNotes } from "./booking-confirmation-message";

describe("cleanGuestNotes", () => {
  it("keeps the guest's own note and strips internal routing annotations", () => {
    expect(cleanGuestNotes("una persona celiaca — Grupo grande, pendiente de revision — Prefiere interior")).toBe(
      "una persona celiaca",
    );
  });
  it("returns empty for purely internal notes", () => {
    expect(cleanGuestNotes("Grupo grande, pendiente de revision")).toBe("");
  });
  it("passes a plain guest note through unchanged", () => {
    expect(cleanGuestNotes("compleanno, tavolo tranquillo")).toBe("compleanno, tavolo tranquillo");
  });
  it("tolerates null/empty", () => {
    expect(cleanGuestNotes(null)).toBe("");
    expect(cleanGuestNotes("")).toBe("");
  });
});

describe("buildBookingConfirmationMessage", () => {
  it("uses the chat bot's *MODIFICA*/*ANNULLA* keywords (it) and the 📝 notes label", () => {
    const msg = buildBookingConfirmationMessage({
      date: "2026-06-13",
      time: "20:30",
      partySize: 7,
      guestName: "Steward",
      notes: "una persona celiaca — Grupo grande, pendiente de revision",
      language: "it",
    });
    expect(msg).toContain("✅ *Prenotazione confermata*");
    expect(msg).toContain("📝 Note: una persona celiaca");
    expect(msg).not.toContain("pendiente"); // internal annotation stripped
    expect(msg).toContain("Per modificare rispondi *MODIFICA*");
    expect(msg).not.toContain("MODIFICARE"); // the old, unrecognised keyword is gone
  });
});
