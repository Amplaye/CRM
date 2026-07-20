import { NextResponse } from "next/server";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { TenantSettings } from "@/lib/types/tenant-settings";
import { getFeatures } from "@/lib/types/tenant-settings";
import { getFiscalRegime, vatConfigOf, type FiscalRegimeConfig } from "./regions";
import { sistemaInformatico, type SistemaInformatico } from "./sistema";
import { fiscalTimestamp } from "./huella";
import type { VatConfig } from "@/lib/cassa/totals";

// The fiscal context of a tenant, resolved once per request and handed to the
// cassa RPCs. Two things live here and nowhere else:
//
//   1. WHICH TAX REGIME the money math must use (Italy 10%, mainland VAT 10%,
//      IGIC 7%) — so a Canary bill is never built on the peninsular assumption.
//
//   2. WHO IS ALLOWED TO ISSUE THE TICKET. This is the guard that closes the hole
//      Sofía found. For a Spanish obligado exactly one of three things is true:
//
//        native   → our cassa issues, WE are the SIF, we register and send.
//        external → an already-compliant external POS issues. We must NOT emit a
//                   ticket at all: an invoice from an unregistered system is the
//                   very offence. We only import its sales for analytics.
//        none     → nobody is compliant. The till refuses the payment.
//
//      There is no fourth mode — in particular there is no "he bills from a random
//      POS and we file it with Hacienda for him". The register must be produced by
//      the system that ISSUES, at the instant it issues. So the illegal combination
//      is BLOCKED, not covered.
//
// Fail-CLOSED, like assertManagement(): an unreadable tenant denies. But the whole
// thing is inert until `fiscal_enabled` is on for that tenant, so today's Italian
// (and un-onboarded Spanish) tills behave exactly as they do now.

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** Who issues the invoices for a NIF. Mirrors fiscal_obligados.sif_mode. */
export type SifMode = "native" | "external" | "none";

export interface FiscalContext {
  /** True when this payment must produce a chained, filed fiscal record. */
  register: boolean;
  /** `off` = the tenant is not under VeriFactu at all (Italy, or flag off). */
  mode: SifMode | "off";
  obligadoId: string | null;
  nif: string | null;
  regime: FiscalRegimeConfig;
  vat: VatConfig;
  /** Series prefix that keeps NumSerieFactura unique when venues share a NIF. */
  serie: string;
  timezone: string;
  sistema: SistemaInformatico;
}

/** Resolve the fiscal context of a tenant. Never throws: an unresolvable tenant
 * comes back as `off`, and the guard below is what turns that into a refusal when
 * it matters. */
export async function getFiscalContext(
  svc: ServiceClient,
  tenantId: string,
): Promise<FiscalContext> {
  const { data: tenant } = await svc
    .from("tenants")
    .select("settings, fiscal_serie, fiscal_obligado_id, fiscal_obligados(id, nif, regimen, sif_mode)")
    .eq("id", tenantId)
    .maybeSingle();

  const settings = (tenant?.settings || {}) as TenantSettings;
  const timezone = settings.timezone || "Europe/Rome";
  const obligado = (tenant as any)?.fiscal_obligados as
    | { id: string; nif: string; regimen: string; sif_mode: SifMode }
    | null
    | undefined;

  const regime = getFiscalRegime(settings, obligado?.regimen);
  const enabled = Boolean(tenant) && getFeatures(settings).fiscal_enabled;

  // Not under the duty (or not switched on yet) → today's behaviour, untouched.
  if (!enabled || !regime.verifactu) {
    return {
      register: false,
      mode: "off",
      obligadoId: null,
      nif: null,
      regime,
      vat: vatConfigOf(regime),
      serie: "",
      timezone,
      sistema: sistemaInformatico(tenantId),
    };
  }

  const mode: SifMode = obligado?.sif_mode ?? "none";
  return {
    register: mode === "native",
    mode,
    obligadoId: obligado?.id ?? null,
    nif: obligado?.nif ?? null,
    regime,
    vat: vatConfigOf(regime),
    serie: (tenant as any)?.fiscal_serie || "",
    timezone,
    sistema: sistemaInformatico(tenantId),
  };
}

/**
 * The guard. Returns a 403 when this tenant's till may NOT legally issue a ticket,
 * or `null` when it may (and `ctx.register` says whether that ticket must be filed).
 *
 * Called by every route that can CREATE a bill: pay, void, and the anonymous QR
 * table-ordering endpoint — that last one runs with no authentication at all, so
 * without this a guest's phone could open a bill on a till that is not allowed to
 * emit one.
 */
/**
 * What switching a tenant to the built-in till means fiscally.
 *
 * Pure, so the rule is testable without a database — and the rule matters:
 * `sif_mode` (who issues the invoices) is a different axis from which till we
 * sync, and moving one without the other strands the tenant. Under VeriFactu,
 * taking over the till means taking over issuance, which is only lawful once a
 * NIF exists. Outside VeriFactu (Italy today) issuance is not ours to claim and
 * must stay untouched.
 */
export function planFiscalSwitch(ctx: FiscalContext): {
  /** Our cassa becomes the issuing SIF → sif_mode must move to 'native'. */
  becomesIssuer: boolean;
  /** Under the duty but no NIF: refuse rather than deliver a till that can't emit. */
  blocked: boolean;
} {
  const becomesIssuer = ctx.regime.verifactu && ctx.mode !== "off";
  return { becomesIssuer, blocked: becomesIssuer && !ctx.obligadoId };
}

export function assertFiscal(ctx: FiscalContext): NextResponse | null {
  if (ctx.mode === "off" || ctx.mode === "native") return null;

  if (ctx.mode === "external") {
    // The venue's own POS is the compliant SIF. If our cassa also emitted tickets
    // they would be invoices from an unregistered system — and if we ALSO filed
    // them, AEAT would receive the same sale twice, once from each system.
    return NextResponse.json(
      { error: "fiscal_external_pos", detail: "Le fatture di questo NIF le emette il POS esterno: la cassa nativa non può incassare." },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { error: "fiscal_not_configured", detail: "Identità fiscale (NIF) non configurata: la cassa non può emettere ticket in Spagna." },
    { status: 403 },
  );
}

/** The instant, stamped with the venue's own UTC offset (AEAT wants the offset of
 * the place the sale happened, not UTC). */
export function fiscalNow(ctx: FiscalContext, at: Date = new Date()): string {
  return fiscalTimestamp(at, ctx.timezone);
}

/** Turn the cassa's per-rate VAT rows into AEAT's desglose. The field NAMES are
 * AEAT's — this object is registered verbatim. `Impuesto` is always written out:
 * omit it and AEAT silently files the ticket as mainland IVA. */
export function toDesglose(
  ctx: FiscalContext,
  rows: Array<{ rate: number; net: number; tax: number }>,
): Array<Record<string, string>> {
  return rows.map((r) => ({
    Impuesto: ctx.regime.impuesto ?? "01",
    ClaveRegimen: ctx.regime.claveRegimen,
    CalificacionOperacion: ctx.regime.calificacionOperacion,
    TipoImpositivo: r.rate.toFixed(2),
    BaseImponible: r.net.toFixed(2),
    CuotaRepercutida: r.tax.toFixed(2),
  }));
}
