import type { FiscalRecordPayload, FiscalTransport, TransportResult } from "./transport";
import { fiscalDate } from "./huella";

// Verifacti — the transport we buy (≈2,90 €/NIF/month). It is a *colaborador
// social*: it holds the certificate, automates the representation mandate, and
// speaks IGIC and TicketBAI, none of which we want to build.
//
// What we do NOT delegate, and therefore what this file must send verbatim: the
// huella, the previous huella, the chain position, and the SistemaInformatico
// block. Verifacti is a pipe. The register is ours — if the provider recomputed
// our hashes we would have no chain of our own, and the whole point of the
// immutable table would evaporate.
//
// Endpoint shape is intentionally simple (one record per call, batched by the
// queue) because the failure mode of a batch endpoint is worse: a single bad
// record poisoning 50 good ones, all of which have already been handed to a guest
// as printed receipts.

const BASE = process.env.VERIFACTI_API_URL || "https://api.verifacti.com";

/** The wire body. Field names are AEAT's, because the provider passes them through. */
export function toVerifactiBody(r: FiscalRecordPayload): Record<string, unknown> {
  if (r.tipo === "anulacion") {
    return {
      serie: r.numSerie,
      numero: r.numSerie,
      fecha_expedicion: fiscalDate(r.fechaExpedicion),
      nif: r.nif,
      // The chain, restated: the provider must file OUR hash, not compute its own.
      huella: r.huella,
      encadenamiento: r.prevHuella
        ? { huella: r.prevHuella }
        : { primer_registro: "S" },
      fecha_hora_huso_gen_registro: r.fechaHoraHuso,
      sistema_informatico: r.sistema,
    };
  }

  return {
    serie: r.numSerie,
    numero: r.numSerie,
    fecha_expedicion: fiscalDate(r.fechaExpedicion),
    nif: r.nif,
    nombre: r.razonSocial,
    tipo_factura: r.tipoFactura,
    descripcion: r.descripcion,
    // Per-rate breakdown. Impuesto is ALWAYS present (see regions.ts): omit it and
    // AEAT files a Canary ticket as mainland VAT without a word of complaint.
    lineas: r.desglose.map((d) => ({
      impuesto: d.Impuesto,
      clave_regimen: d.ClaveRegimen,
      calificacion_operacion: d.CalificacionOperacion,
      base_imponible: d.BaseImponible,
      tipo_impositivo: d.TipoImpositivo,
      cuota_repercutida: d.CuotaRepercutida,
    })),
    importe_total: r.importeTotal.toFixed(2),
    cuota_total: r.cuotaTotal.toFixed(2),
    huella: r.huella,
    encadenamiento: r.prevHuella ? { huella: r.prevHuella } : { primer_registro: "S" },
    fecha_hora_huso_gen_registro: r.fechaHoraHuso,
    sistema_informatico: r.sistema,
    ...(r.rectifica ? { rectificativa: r.rectifica } : {}),
  };
}

/** Read the provider's answer without guessing: anything we don't recognise is
 * treated as still-pending and retried, never as silently accepted. */
export function parseVerifactiResponse(
  recordId: string,
  httpStatus: number,
  body: any,
): TransportResult {
  // 429 / 5xx / network: the record is fine, the moment isn't. Keep it queued.
  if (httpStatus === 429 || httpStatus >= 500) {
    return {
      recordId,
      status: "pending",
      csv: null,
      error: `HTTP ${httpStatus}${body?.message ? `: ${body.message}` : ""}`,
      retryable: true,
      raw: body,
    };
  }

  if (httpStatus >= 400) {
    // A substantive refusal: the record itself is wrong. Retrying it forever would
    // hammer AEAT with the same invalid record and bury the real problem under a
    // growing pending count. Stop, and surface it.
    return {
      recordId,
      status: "rejected",
      csv: null,
      error: body?.message || body?.error || `HTTP ${httpStatus}`,
      retryable: false,
      raw: body,
    };
  }

  const estado = String(body?.estado_registro || body?.status || "").toLowerCase();
  if (estado === "correcto" || estado === "accepted") {
    return { recordId, status: "accepted", csv: body?.csv ?? null, error: null, retryable: false, raw: body };
  }
  if (estado === "aceptadoconerrores" || estado === "accepted_with_errors") {
    return {
      recordId,
      status: "accepted_with_errors",
      csv: body?.csv ?? null,
      // Accepted, but AEAT flagged something. It IS filed — do not resend it.
      error: body?.message || body?.descripcion_error || "aceptado con errores",
      retryable: false,
      raw: body,
    };
  }
  if (estado === "incorrecto" || estado === "rejected") {
    return {
      recordId,
      status: "rejected",
      csv: null,
      error: body?.descripcion_error || body?.message || "rechazado",
      retryable: false,
      raw: body,
    };
  }

  // Unknown shape → assume nothing. Ask again.
  return { recordId, status: "pending", csv: null, error: "risposta non riconosciuta", retryable: true, raw: body };
}

export class VerifactiTransport implements FiscalTransport {
  readonly name = "verifacti";
  private readonly key: string;

  constructor(apiKey: string) {
    this.key = apiKey;
  }

  private async call(path: string, body: unknown, recordId: string): Promise<TransportResult> {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": this.key },
        body: JSON.stringify(body),
      });
      let parsed: any = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = { message: await res.text().catch(() => "") };
      }
      return parseVerifactiResponse(recordId, res.status, parsed);
    } catch (err) {
      // The network died. The record is committed and queued; the flush will retry.
      return {
        recordId,
        status: "pending",
        csv: null,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
        raw: null,
      };
    }
  }

  async submit(records: FiscalRecordPayload[]): Promise<TransportResult[]> {
    // Sequential ON PURPOSE: the chain is ordered, and AEAT rejects a record whose
    // predecessor it hasn't seen. Parallelism here would buy milliseconds and cost
    // a rejected chain.
    const out: TransportResult[] = [];
    for (const r of records) {
      const path = r.tipo === "anulacion" ? "/verifactu/cancel" : "/verifactu/create";
      out.push(await this.call(path, toVerifactiBody(r), r.recordId));
    }
    return out;
  }

  async status(recordId: string): Promise<TransportResult> {
    try {
      const res = await fetch(`${BASE}/verifactu/status/${encodeURIComponent(recordId)}`, {
        headers: { "X-API-KEY": this.key },
      });
      const body = await res.json().catch(() => null);
      return parseVerifactiResponse(recordId, res.status, body);
    } catch (err) {
      return {
        recordId,
        status: "pending",
        csv: null,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
        raw: null,
      };
    }
  }
}
