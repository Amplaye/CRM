// The huella (hash chain) of the VeriFactu register — art. 8 RRSIF.
//
// Every record links to the one before it: the previous record's huella is a
// FIELD of the string this record is hashed from, so rewriting any past ticket
// invalidates every ticket after it. That property is the whole point of the
// regulation, and it's why fiscal_records is physically append-only.
//
// This module is the TypeScript MIRROR of the SQL functions in
// scripts/migrations/2026-07-14-fiscal-verifactu.sql. The chain is actually
// computed IN SQL (inside the same transaction that locks the chain head — two
// tills cashing at once must not read the same prev_huella), but the spec is
// unforgiving about field order, separators, casing and date format, so we keep
// an independent TS implementation and a test that asserts SQL and TS produce
// the SAME hash on AEAT's published golden vector. If they ever diverge, the
// test fails here rather than the Agencia Tributaria rejecting a day of takings.
//
// Spec: AEAT "Especificaciones técnicas para la generación de la huella o hash
// de los registros de facturación" — SHA-256 over UTF-8, rendered as 64 UPPERCASE
// hex chars, fields joined `campo=valor&campo=valor` with NO trailing separator.

import { createHash } from "node:crypto";

/** Fields of a RegistroAlta, in AEAT's mandated order. Values are pre-formatted
 * strings: the spec hashes the literal text that goes in the XML, so formatting
 * is part of the contract, not a presentation detail. */
export interface AltaHuellaInput {
  /** NIF of the issuer (the obligado). */
  idEmisorFactura: string;
  /** Invoice/ticket series+number, e.g. "2026/000123". */
  numSerieFactura: string;
  /** Issue date, DD-MM-AAAA. */
  fechaExpedicionFactura: string;
  /** F1 (full invoice), F2 (factura simplificada — our tickets), R1…R5 (rectificativas). */
  tipoFactura: string;
  /** Total tax, 2 decimals, dot separator. */
  cuotaTotal: string;
  /** Grand total, 2 decimals, dot separator. */
  importeTotal: string;
  /** The PREVIOUS record's huella — empty string for the first record of a chain. */
  huella: string;
  /** Generation instant with its UTC offset, e.g. 2024-01-01T19:20:30+01:00. */
  fechaHoraHusoGenRegistro: string;
}

/** Fields of a RegistroAnulacion, in AEAT's mandated order. It identifies the
 * ANNULLED invoice — an annulment is not a new invoice, it's a record that says
 * "the one I name here never happened". */
export interface AnulacionHuellaInput {
  idEmisorFacturaAnulada: string;
  numSerieFacturaAnulada: string;
  fechaExpedicionFacturaAnulada: string;
  huella: string;
  fechaHoraHusoGenRegistro: string;
}

function join(fields: Array<[string, string]>): string {
  return fields.map(([k, v]) => `${k}=${v ?? ""}`).join("&");
}

export function altaPayload(i: AltaHuellaInput): string {
  return join([
    ["IDEmisorFactura", i.idEmisorFactura],
    ["NumSerieFactura", i.numSerieFactura],
    ["FechaExpedicionFactura", i.fechaExpedicionFactura],
    ["TipoFactura", i.tipoFactura],
    ["CuotaTotal", i.cuotaTotal],
    ["ImporteTotal", i.importeTotal],
    ["Huella", i.huella],
    ["FechaHoraHusoGenRegistro", i.fechaHoraHusoGenRegistro],
  ]);
}

export function anulacionPayload(i: AnulacionHuellaInput): string {
  return join([
    ["IDEmisorFacturaAnulada", i.idEmisorFacturaAnulada],
    ["NumSerieFacturaAnulada", i.numSerieFacturaAnulada],
    ["FechaExpedicionFacturaAnulada", i.fechaExpedicionFacturaAnulada],
    ["Huella", i.huella],
    ["FechaHoraHusoGenRegistro", i.fechaHoraHusoGenRegistro],
  ]);
}

/** SHA-256 → 64 UPPERCASE hex chars. Lowercase hex is a rejected record. */
export function sha256Upper(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex").toUpperCase();
}

export function altaHuella(i: AltaHuellaInput): string {
  return sha256Upper(altaPayload(i));
}

export function anulacionHuella(i: AnulacionHuellaInput): string {
  return sha256Upper(anulacionPayload(i));
}

// ── Formatters (the spec's, not ours) ───────────────────────────────────────
// Live in ./format (crypto-free) so client components can use them without
// pulling the browser crypto polyfill; re-exported here for server callers.

export { normalizeNif, fiscalAmount, fiscalDate, fiscalTimestamp } from "./format";
