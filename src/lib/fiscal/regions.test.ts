import { describe, it, expect } from "vitest";
import {
  REGIMES,
  regimeFor,
  defaultRegimeForCountry,
  getFiscalRegime,
  vatConfigOf,
  isValidRate,
} from "./regions";
import type { TenantSettings } from "@/lib/types/tenant-settings";

describe("the Impuesto trap", () => {
  it("writes 03 for IGIC — AEAT assumes 01 (IVA) when the field is omitted", () => {
    expect(REGIMES.igic_canarias.impuesto).toBe("03");
  });

  it("writes 01 for mainland VAT", () => {
    expect(REGIMES.iva_peninsular.impuesto).toBe("01");
  });

  it("has no AEAT code for Italy — Italy is not under VeriFactu", () => {
    expect(REGIMES.iva_italia.impuesto).toBeNull();
    expect(REGIMES.iva_italia.verifactu).toBe(false);
  });

  it("marks both Spanish regimes as under the VeriFactu duty", () => {
    expect(REGIMES.iva_peninsular.verifactu).toBe(true);
    expect(REGIMES.igic_canarias.verifactu).toBe(true);
  });
});

describe("restaurant rates per regime", () => {
  it("taxes hostelería at 10% on the mainland, 7% in the Canaries", () => {
    expect(REGIMES.iva_peninsular.defaultRate).toBe(10);
    expect(REGIMES.igic_canarias.defaultRate).toBe(7);
  });

  it("has no 10% band at all under IGIC — the peninsular default is not merely wrong, it's impossible", () => {
    expect(isValidRate(REGIMES.igic_canarias, 10)).toBe(false);
    expect(isValidRate(REGIMES.igic_canarias, 7)).toBe(true);
    expect(isValidRate(REGIMES.igic_canarias, 9.5)).toBe(true);
  });

  it("rejects a rate that does not exist in the regime", () => {
    expect(isValidRate(REGIMES.iva_peninsular, 21)).toBe(true);
    expect(isValidRate(REGIMES.iva_peninsular, 22)).toBe(false); // 22 is Italy's
    expect(isValidRate(REGIMES.iva_italia, 22)).toBe(true);
  });

  it("carries the service rate on the coperto in every regime", () => {
    for (const r of Object.values(REGIMES)) {
      expect(r.coverRate).toBe(r.defaultRate);
    }
  });
});

describe("resolution", () => {
  it("falls back to Italy for an unknown or absent regime (today's behaviour, unchanged)", () => {
    expect(regimeFor(null).regimen).toBe("iva_italia");
    expect(regimeFor("martian_vat").regimen).toBe("iva_italia");
  });

  it("derives mainland VAT from a declared ES tenant", () => {
    expect(defaultRegimeForCountry("ES")).toBe("iva_peninsular");
    expect(defaultRegimeForCountry("es")).toBe("iva_peninsular");
    expect(defaultRegimeForCountry("IT")).toBe("iva_italia");
    expect(defaultRegimeForCountry(null)).toBe("iva_italia");
  });

  it("never INFERS the Canaries from a country code — only an explicit regime gets you there", () => {
    const canary = { compliance: { country: "ES" } } as TenantSettings;
    expect(getFiscalRegime(canary).regimen).toBe("iva_peninsular");
    expect(getFiscalRegime(canary, "igic_canarias").regimen).toBe("igic_canarias");
  });

  it("lets the obligado's stored regime win over the country fallback", () => {
    const it = { compliance: { country: "IT" } } as TenantSettings;
    expect(getFiscalRegime(it).regimen).toBe("iva_italia");
    expect(getFiscalRegime(it, "iva_peninsular").regimen).toBe("iva_peninsular");
  });

  it("hands the money math only the two numbers it needs", () => {
    expect(vatConfigOf(REGIMES.igic_canarias)).toEqual({ defaultRate: 7, coverRate: 7 });
  });
});
