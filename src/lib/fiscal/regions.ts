// Per-regime fiscal config — the SINGLE source of truth that turns a tenant's
// tax regime into the concrete VAT behaviour of the native cassa (which rates
// exist, what a plate of pasta is taxed at, what the coperto carries) AND, for
// Spain, into the AEAT codes that go on every VeriFactu record.
//
// Same shape as src/lib/compliance/regions.ts on purpose: a record of REGIMES,
// one resolver, consumed by the money math (totals.ts), the fiscal RPC and the
// Settings UI. Adding a market = adding one row here, never a code fork.
//
// ⚠️ The trap that costs the most: AEAT's `Impuesto` field DEFAULTS TO "01" (IVA)
// when omitted. A Canary tenant on IGIC whose records don't carry an explicit
// "03" is silently filed as mainland VAT. So `impuesto` is always written out.

import type { TenantSettings } from "@/lib/types/tenant-settings";

/** The tax regime a fiscal obligado operates under. Stored on `fiscal_obligados.regimen`
 * for Spanish obligados; Italian tenants (no obligado row) resolve to `iva_italia`. */
export type FiscalRegimen = "iva_italia" | "iva_peninsular" | "igic_canarias";

/** AEAT list L1 (`Impuesto`): 01 = IVA, 03 = IGIC. Only meaningful for ES. */
export type AeatImpuesto = "01" | "03";

export interface FiscalRegimeConfig {
  regimen: FiscalRegimen;
  /** Human label for the Settings → Fiscale panel. */
  label: string;
  /** Is this regime under the Spanish VeriFactu duty (RD 1007/2023)? Italy: no. */
  verifactu: boolean;
  /** AEAT `Impuesto` code to write on EVERY desglose line. Null for non-ES regimes. */
  impuesto: AeatImpuesto | null;
  /** The rates a till line may legally carry, ascending. */
  rates: number[];
  /** Rate applied when a line carries none — restaurant service (somministrazione). */
  defaultRate: number;
  /** The coperto is part of the service, so it carries the service rate. */
  coverRate: number;
  /** AEAT `ClaveRegimen` (list L8A): 01 = régimen general. */
  claveRegimen: string;
  /** AEAT `CalificacionOperacion` (list L9): S1 = sujeta y no exenta, sin inversión. */
  calificacionOperacion: string;
}

/** Every regime we serve. Restaurant (hostelería/somministrazione) rates:
 *  · Italy — IVA 10% on somministrazione.
 *  · Spain mainland — IVA reducido 10% on hostelería.
 *  · Canarias — IGIC tipo general 7% (there is no 10% band in IGIC at all). */
export const REGIMES: Record<FiscalRegimen, FiscalRegimeConfig> = {
  iva_italia: {
    regimen: "iva_italia",
    label: "IVA Italia",
    verifactu: false,
    impuesto: null,
    rates: [0, 4, 5, 10, 22],
    defaultRate: 10,
    coverRate: 10,
    claveRegimen: "01",
    calificacionOperacion: "S1",
  },
  iva_peninsular: {
    regimen: "iva_peninsular",
    label: "IVA (península y Baleares)",
    verifactu: true,
    impuesto: "01",
    rates: [0, 4, 10, 21],
    defaultRate: 10,
    coverRate: 10,
    claveRegimen: "01",
    calificacionOperacion: "S1",
  },
  igic_canarias: {
    regimen: "igic_canarias",
    label: "IGIC (Canarias)",
    verifactu: true,
    // Written explicitly on every line: omitting it makes AEAT assume IVA.
    impuesto: "03",
    rates: [0, 3, 7, 9.5, 15],
    defaultRate: 7,
    coverRate: 7,
    claveRegimen: "01",
    calificacionOperacion: "S1",
  },
};

/** Italy is what the cassa has always done — the safe default for any tenant with
 * no fiscal identity configured, so existing behaviour is byte-identical. */
const FALLBACK: FiscalRegimeConfig = REGIMES.iva_italia;

/** Resolve a stored regime string to its config (unknown/absent → Italy). */
export function regimeFor(regimen: string | null | undefined): FiscalRegimeConfig {
  if (!regimen) return FALLBACK;
  return REGIMES[regimen as FiscalRegimen] ?? FALLBACK;
}

/** The regime a tenant defaults to before an obligado exists, derived from the
 * compliance country it already declared (ES → mainland VAT; anything else →
 * Italy). Canarias can only be reached by explicitly setting the obligado's
 * regime: there is no way to infer "these coordinates are in the Canaries" from
 * a country code, and guessing wrong here files a whole till under the wrong tax. */
export function defaultRegimeForCountry(country: string | null | undefined): FiscalRegimen {
  return String(country || "").toUpperCase() === "ES" ? "iva_peninsular" : "iva_italia";
}

/** The VAT numbers the money math needs — the only slice of the regime totals.ts
 * is allowed to see, so it stays a pure arithmetic module. */
export interface VatConfig {
  defaultRate: number;
  coverRate: number;
}

export function vatConfigOf(regime: FiscalRegimeConfig): VatConfig {
  return { defaultRate: regime.defaultRate, coverRate: regime.coverRate };
}

/** THE resolver. `regimen` is the obligado's stored regime (null for tenants with
 * no fiscal identity yet); the tenant settings supply the country fallback. Pure. */
export function getFiscalRegime(
  settings: TenantSettings | null | undefined,
  regimen?: string | null,
): FiscalRegimeConfig {
  if (regimen) return regimeFor(regimen);
  return regimeFor(defaultRegimeForCountry(settings?.compliance?.country));
}

/** Is a rate legal under this regime? The cassa rejects anything else, because an
 * impossible rate is rejected by AEAT at submission time — i.e. AFTER the guest
 * has already walked out with a receipt. */
export function isValidRate(regime: FiscalRegimeConfig, rate: number): boolean {
  return regime.rates.some((r) => Math.abs(r - rate) < 0.001);
}
