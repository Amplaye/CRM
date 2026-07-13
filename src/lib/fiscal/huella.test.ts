import { describe, it, expect } from "vitest";
import {
  altaPayload,
  anulacionPayload,
  altaHuella,
  sha256Upper,
  normalizeNif,
  fiscalAmount,
  fiscalDate,
  fiscalTimestamp,
} from "./huella";

// The whole register rests on this one function agreeing with the Agencia
// Tributaria byte for byte. AEAT publishes a worked example in
// "Especificaciones técnicas para la generación de la huella o hash"; if our
// output ever drifts from it, every ticket we file is rejected — so the golden
// vector is the first test in the file and the one that must never be relaxed.

const GOLDEN_PAYLOAD =
  "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024" +
  "&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=" +
  "&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00";

const GOLDEN_HASH = "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";

const GOLDEN_INPUT = {
  idEmisorFactura: "89890001K",
  numSerieFactura: "12345678/G33",
  fechaExpedicionFactura: "01-01-2024",
  tipoFactura: "F1",
  cuotaTotal: "12.35",
  importeTotal: "123.45",
  huella: "", // first record of the chain
  fechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
};

describe("AEAT golden vector", () => {
  it("builds the canonical string exactly as published", () => {
    expect(altaPayload(GOLDEN_INPUT)).toBe(GOLDEN_PAYLOAD);
  });

  it("hashes it to the published huella", () => {
    expect(altaHuella(GOLDEN_INPUT)).toBe(GOLDEN_HASH);
  });

  it("returns 64 UPPERCASE hex chars (lowercase is a rejected record)", () => {
    const h = altaHuella(GOLDEN_INPUT);
    expect(h).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("chaining", () => {
  it("feeds the previous huella in as a field, so a record depends on its predecessor", () => {
    const second = altaHuella({ ...GOLDEN_INPUT, numSerieFactura: "2", huella: GOLDEN_HASH });
    const orphan = altaHuella({ ...GOLDEN_INPUT, numSerieFactura: "2", huella: "" });
    expect(second).not.toBe(orphan);
  });

  it("changing any past field changes every hash downstream", () => {
    const tampered = altaHuella({ ...GOLDEN_INPUT, importeTotal: "123.46" });
    expect(tampered).not.toBe(GOLDEN_HASH);
  });

  it("an empty prev huella renders as an empty value, not the string 'null'", () => {
    expect(altaPayload({ ...GOLDEN_INPUT, huella: "" })).toContain("&Huella=&Fecha");
  });
});

describe("anulacion payload", () => {
  it("names the ANNULLED invoice, in AEAT's field order", () => {
    const p = anulacionPayload({
      idEmisorFacturaAnulada: "89890001K",
      numSerieFacturaAnulada: "2026/000123",
      fechaExpedicionFacturaAnulada: "14-07-2026",
      huella: GOLDEN_HASH,
      fechaHoraHusoGenRegistro: "2026-07-14T13:05:00+02:00",
    });
    expect(p).toBe(
      "IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=2026/000123" +
        "&FechaExpedicionFacturaAnulada=14-07-2026" +
        `&Huella=${GOLDEN_HASH}&FechaHoraHusoGenRegistro=2026-07-14T13:05:00+02:00`,
    );
    expect(sha256Upper(p)).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("formatters (the spec's, not ours)", () => {
  it("normalizes a NIF: uppercase, no punctuation, no spaces", () => {
    expect(normalizeNif(" b-12345678 ")).toBe("B12345678");
    expect(normalizeNif("89890001k")).toBe("89890001K");
    expect(normalizeNif(null)).toBe("");
  });

  it("renders amounts with 2 decimals and a dot, never a comma", () => {
    expect(fiscalAmount(1.5)).toBe("1.50");
    expect(fiscalAmount(123.456)).toBe("123.46");
    expect(fiscalAmount(0)).toBe("0.00");
    expect(fiscalAmount(1234.5)).toBe("1234.50"); // no thousands separator
    expect(fiscalAmount(null)).toBe("0.00");
  });

  it("renders dates DD-MM-AAAA from the app's YYYY-MM-DD", () => {
    expect(fiscalDate("2026-07-14")).toBe("14-07-2026");
    expect(fiscalDate("2024-01-01")).toBe("01-01-2024");
  });

  it("stamps the instant with the VENUE's offset, not UTC", () => {
    const at = new Date("2026-07-14T11:05:00Z");
    // Madrid in July is CEST (+02:00) — the same instant, declared where it happened.
    expect(fiscalTimestamp(at, "Europe/Madrid")).toBe("2026-07-14T13:05:00+02:00");
    // The Canaries are an hour behind the mainland — and this is exactly the kind
    // of tenant whose records must NOT inherit a peninsular assumption.
    expect(fiscalTimestamp(at, "Atlantic/Canary")).toBe("2026-07-14T12:05:00+01:00");
  });

  it("follows DST rather than hardcoding an offset", () => {
    const winter = new Date("2026-01-14T11:05:00Z");
    expect(fiscalTimestamp(winter, "Europe/Madrid")).toBe("2026-01-14T12:05:00+01:00");
    expect(fiscalTimestamp(winter, "Atlantic/Canary")).toBe("2026-01-14T11:05:00+00:00");
  });

  it("falls back to Madrid rather than crashing a payment on a bad timezone", () => {
    const at = new Date("2026-07-14T11:05:00Z");
    expect(fiscalTimestamp(at, "Not/AZone")).toBe("2026-07-14T13:05:00+02:00");
  });
});
