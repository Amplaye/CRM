import { describe, it, expect } from "vitest";
import { toVerifactiBody, parseVerifactiResponse } from "./verifacti";
import type { FiscalRecordPayload } from "./transport";
import { sistemaInformatico } from "./sistema";

const RECORD: FiscalRecordPayload = {
  recordId: "rec-1",
  nif: "B12345678",
  razonSocial: "Bar Ejemplo SL",
  tipo: "alta",
  numSerie: "2026/000123",
  fechaExpedicion: "2026-07-14",
  tipoFactura: "F2",
  descripcion: "Consumición en local",
  desglose: [
    {
      Impuesto: "03",
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "7.00",
      BaseImponible: "1.40",
      CuotaRepercutida: "0.10",
    },
  ],
  cuotaTotal: 0.1,
  importeTotal: 1.5,
  prevHuella: "AAAA",
  huella: "BBBB",
  fechaHoraHuso: "2026-07-14T13:05:00+02:00",
  chainIndex: 2,
  sistema: sistemaInformatico("tenant-1"),
};

describe("mapping to the provider's wire format", () => {
  it("sends OUR huella and OUR previous huella — the provider is a pipe, not the register", () => {
    const body = toVerifactiBody(RECORD) as any;
    expect(body.huella).toBe("BBBB");
    expect(body.encadenamiento).toEqual({ huella: "AAAA" });
  });

  it("declares PrimerRegistro on the first record of a chain instead of an empty link", () => {
    const body = toVerifactiBody({ ...RECORD, prevHuella: null }) as any;
    expect(body.encadenamiento).toEqual({ primer_registro: "S" });
  });

  it("carries the explicit Impuesto through — a Canary ticket must not arrive as mainland VAT", () => {
    const body = toVerifactiBody(RECORD) as any;
    expect(body.lineas[0].impuesto).toBe("03");
  });

  it("formats the date as DD-MM-AAAA and the amounts with 2 decimals", () => {
    const body = toVerifactiBody(RECORD) as any;
    expect(body.fecha_expedicion).toBe("14-07-2026");
    expect(body.importe_total).toBe("1.50");
    expect(body.cuota_total).toBe("0.10");
  });

  it("declares SoloVerifactu on every record — the flag that removes XAdES, event log and 6-hourly summaries", () => {
    const body = toVerifactiBody(RECORD) as any;
    expect(body.sistema_informatico.TipoUsoPosibleSoloVerifactu).toBe("S");
    expect(body.sistema_informatico.IndicadorMultiplesOT).toBe("S");
  });

  it("an anulacion names the killed invoice and carries no lines", () => {
    const body = toVerifactiBody({ ...RECORD, tipo: "anulacion" }) as any;
    expect(body.serie).toBe("2026/000123");
    expect(body.lineas).toBeUndefined();
    expect(body.huella).toBe("BBBB");
  });
});

describe("reading the provider's answer", () => {
  it("keeps a 429 QUEUED — a rate limit is not a rejection", () => {
    const r = parseVerifactiResponse("rec-1", 429, { message: "too many requests" });
    expect(r.status).toBe("pending");
    expect(r.retryable).toBe(true);
  });

  it("keeps a 5xx queued too", () => {
    expect(parseVerifactiResponse("rec-1", 503, {}).retryable).toBe(true);
  });

  it("does NOT retry a substantive rejection — retrying forever would hide it", () => {
    const r = parseVerifactiResponse("rec-1", 400, { message: "desglose inválido" });
    expect(r.status).toBe("rejected");
    expect(r.retryable).toBe(false);
    expect(r.error).toBe("desglose inválido");
  });

  it("accepts a Correcto and keeps the CSV", () => {
    const r = parseVerifactiResponse("rec-1", 200, { estado_registro: "Correcto", csv: "ABC123" });
    expect(r.status).toBe("accepted");
    expect(r.csv).toBe("ABC123");
    expect(r.retryable).toBe(false);
  });

  it("treats AceptadoConErrores as FILED — it is registered, resending it would duplicate it", () => {
    const r = parseVerifactiResponse("rec-1", 200, {
      estado_registro: "AceptadoConErrores",
      csv: "ABC123",
      descripcion_error: "campo opcional ausente",
    });
    expect(r.status).toBe("accepted_with_errors");
    expect(r.retryable).toBe(false);
    expect(r.csv).toBe("ABC123");
  });

  it("assumes nothing from an unrecognised body — asks again rather than declaring success", () => {
    const r = parseVerifactiResponse("rec-1", 200, { weird: true });
    expect(r.status).toBe("pending");
    expect(r.retryable).toBe(true);
  });
});
