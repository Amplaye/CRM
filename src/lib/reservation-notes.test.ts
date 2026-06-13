import { describe, it, expect } from "vitest";
import {
  cleanGuestNotes,
  zoneTag,
  zoneFromTags,
  zoneFromLegacyNotes,
  readZonePref,
  withZoneTag,
} from "./reservation-notes";

describe("cleanGuestNotes", () => {
  it("keeps the guest's note, strips the voice/book Spanish annotations", () => {
    expect(
      cleanGuestNotes("una persona celiaca — Grupo grande, pendiente de revision — Prefiere interior"),
    ).toBe("una persona celiaca");
  });
  it("strips a marker glued on with a period without eating the guest text", () => {
    expect(cleanGuestNotes("compleanno. Prefiere exterior")).toBe("compleanno");
  });
  it("strips modify/waitlist markers", () => {
    expect(cleanGuestNotes("tavolo tranquillo — GRUPO MODIFICADO A 8 PERSONAS — REVISAR")).toBe(
      "tavolo tranquillo",
    );
    expect(cleanGuestNotes("Sin plazas disponibles en el turno, añadido a lista de espera")).toBe("");
  });
  it("leaves a clean guest note untouched", () => {
    expect(cleanGuestNotes("compleanno, tavolo tranquillo")).toBe("compleanno, tavolo tranquillo");
  });
  it("tolerates null/empty", () => {
    expect(cleanGuestNotes(null)).toBe("");
    expect(cleanGuestNotes("")).toBe("");
  });
});

describe("zone tags", () => {
  it("builds and reads a zone tag", () => {
    expect(zoneTag("inside")).toEqual(["zone:inside"]);
    expect(zoneTag(null)).toEqual([]);
    expect(zoneFromTags(["event_request", "zone:outside"])).toBe("outside");
    expect(zoneFromTags(["event_request"])).toBe(null);
  });
  it("reads the legacy notes marker as a fallback", () => {
    expect(zoneFromLegacyNotes("celiaca — Prefiere interior")).toBe("inside");
    expect(readZonePref(["event_request"], "x — Prefiere exterior")).toBe("outside");
    expect(readZonePref(["zone:inside"], "Prefiere exterior")).toBe("inside"); // tags win
  });
  it("replaces the zone tag while preserving other tags", () => {
    expect(withZoneTag(["event_request", "zone:inside"], "outside")).toEqual([
      "event_request",
      "zone:outside",
    ]);
    expect(withZoneTag(["zone:inside"], null)).toEqual([]);
  });
});
