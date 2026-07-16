// The transport layer to AEAT — deliberately behind an interface.
//
// We buy the transport (Verifacti, a colaborador social: it holds the certificates,
// automates the representation mandate, speaks IGIC and TicketBAI) and we build in
// house only what is legally undelegable: the immutable register, the hash chain,
// the QR, the per-line tax engine. That split is a business decision, and business
// decisions get reversed — so the vendor lives behind this interface and nothing
// else in the codebase knows its name. The day we decide to file directly against
// AEAT's SOAP endpoint with our own certificate, exactly one file changes.

import type { SistemaInformatico } from "./sistema";

/** One record, as the transport needs to see it. Flattened from fiscal_records +
 * its obligado, so a transport never touches the database. */
export interface FiscalRecordPayload {
  recordId: string;
  nif: string;
  razonSocial: string;
  tipo: "alta" | "anulacion";
  numSerie: string;
  /** YYYY-MM-DD (the transport formats it for the wire). */
  fechaExpedicion: string;
  tipoFactura: string;
  descripcion: string;
  desglose: Array<Record<string, string>>;
  cuotaTotal: number;
  importeTotal: number;
  prevHuella: string | null;
  huella: string;
  fechaHoraHuso: string;
  chainIndex: number;
  sistema: SistemaInformatico;
  rectifica?: Record<string, unknown> | null;
}

export interface TransportResult {
  recordId: string;
  /** `pending` means "not yet decided, ask again" — NOT a failure. */
  status: "accepted" | "accepted_with_errors" | "rejected" | "pending";
  /** AEAT's Código Seguro de Verificación, returned on acceptance. */
  csv: string | null;
  error: string | null;
  /**
   * Should the queue try again?
   *
   * TRUE for anything transient — network, 429, 5xx. FALSE for a substantive
   * rejection (a malformed record, a broken chain): retrying that forever would
   * just hammer AEAT with the same invalid record and hide the real problem behind
   * a growing pending count. A rejected record needs a human, so we stop and say so.
   */
  retryable: boolean;
  raw: unknown;
}

export interface FiscalTransport {
  readonly name: string;
  submit(records: FiscalRecordPayload[]): Promise<TransportResult[]>;
  status(recordId: string): Promise<TransportResult>;
}

/** The transport used when none is configured (local dev, the E2E driver, an
 * Italian-only deployment). It accepts everything and invents a CSV, so the queue
 * mechanics can be exercised end-to-end without touching the Agencia Tributaria.
 * Never selected in production: getTransport() only returns it when there is no
 * VERIFACTI_API_KEY, and a Spanish tenant without a key cannot be `native` anyway. */
export class MockTransport implements FiscalTransport {
  readonly name = "mock";

  async submit(records: FiscalRecordPayload[]): Promise<TransportResult[]> {
    return records.map((r) => ({
      recordId: r.recordId,
      status: "accepted" as const,
      csv: `MOCK-${r.huella.slice(0, 12)}`,
      error: null,
      retryable: false,
      raw: { mock: true, numSerie: r.numSerie },
    }));
  }

  async status(recordId: string): Promise<TransportResult> {
    return { recordId, status: "accepted", csv: `MOCK-${recordId.slice(0, 12)}`, error: null, retryable: false, raw: { mock: true } };
  }
}
