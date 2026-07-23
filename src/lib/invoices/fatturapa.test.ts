import { describe, it, expect } from "vitest";
import { parseFatturaPa } from "./fatturapa";

// A trimmed but realistic FatturaPA (namespace-prefixed root, unprefixed body).
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA>
        <Anagrafica><Denominazione>Rossi Forniture S.r.l.</Denominazione></Anagrafica>
      </DatiAnagrafici>
    </CedentePrestatore>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-07-10</Data>
        <Numero>FT/2026/512</Numero>
        <ImportoTotaleDocumento>122.00</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Mozzarella fiordilatte 3kg</Descrizione>
        <Quantita>10.00</Quantita>
        <UnitaMisura>KG</UnitaMisura>
        <PrezzoUnitario>8.00</PrezzoUnitario>
        <PrezzoTotale>80.00</PrezzoTotale>
        <AliquotaIVA>10.00</AliquotaIVA>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>2</NumeroLinea>
        <Descrizione>Trasporto</Descrizione>
        <PrezzoTotale>20.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo><AliquotaIVA>10.00</AliquotaIVA><ImponibileImporto>80.00</ImponibileImporto><Imposta>8.00</Imposta></DatiRiepilogo>
      <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>20.00</ImponibileImporto><Imposta>4.40</Imposta></DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <DettaglioPagamento>
        <ImportoPagamento>122.00</ImportoPagamento>
        <DataScadenzaPagamento>2026-08-09</DataScadenzaPagamento>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;

describe("parseFatturaPa", () => {
  it("extracts supplier, totals, lines and due date", () => {
    const invoices = parseFatturaPa(SAMPLE);
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    expect(inv.supplierName).toBe("Rossi Forniture S.r.l.");
    expect(inv.supplierVat).toBe("IT01234567890");
    expect(inv.invoiceNumber).toBe("FT/2026/512");
    expect(inv.invoiceDate).toBe("2026-07-10");
    expect(inv.currency).toBe("EUR");
    expect(inv.netTotal).toBe(100);
    expect(inv.taxTotal).toBe(12.4);
    expect(inv.grossTotal).toBe(122);
    expect(inv.dueDate).toBe("2026-08-09");
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]).toMatchObject({ description: "Mozzarella fiordilatte 3kg", quantity: 10, unit: "KG", unitPrice: 8, lineTotal: 80, taxRate: 10 });
    expect(inv.lines[1].description).toBe("Trasporto");
  });

  it("falls back to gross = net + tax when total is absent, and handles multiple bodies", () => {
    const noTotal = SAMPLE.replace(/<ImportoTotaleDocumento>[\s\S]*?<\/ImportoTotaleDocumento>/, "");
    const inv = parseFatturaPa(noTotal)[0];
    expect(inv.grossTotal).toBe(112.4);
  });
});
