// Driver Epson RT (ePOS-Print / FPmate) — documento commerciale via XML su HTTP.
//
// ⚠️ Gira nel BROWSER. Endpoint: POST http(s)://<host>/cgi-bin/fpmate.cgi
// Protocollo: XML fiscale Epson (printerFiscalReceipt → printRecItem …
// → printRecTotal → endFiscalReceipt). La risposta riporta numero documento e
// matricola stampante.
//
// NB: i nomi dei tag/attributi seguono lo standard ePOS fiscale Epson; alcuni
// dettagli (index pagamenti, giustificativi) possono richiedere taratura sul
// device reale in loco — vedi il piano, fase di verifica end-to-end.

import type {
  CommercialDoc,
  DailyCloseResult,
  FiscalDeviceConfig,
  FiscalDriver,
  PrintDocResult,
  TestConnectionResult,
} from "../types";
import { deviceBaseUrl, resolveReparto } from "../types";

const TIMEOUT_MS = 12000;

function endpoint(cfg: FiscalDeviceConfig): string {
  return `${deviceBaseUrl(cfg)}/cgi-bin/fpmate.cgi?devid=local_printer&timeout=10000`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Epson paymentType: 0=contante, 2=carta/credito, 3=ticket/buono pasto.
function paymentType(type: string): number {
  switch (type) {
    case "card":
      return 2;
    case "voucher":
      return 3;
    default:
      return 0; // cash / other
  }
}

function buildReceiptXml(cfg: FiscalDeviceConfig, doc: CommercialDoc): string {
  const parts: string[] = [];
  parts.push(`<printerFiscalReceipt>`);
  parts.push(`<beginFiscalReceipt operator="1" />`);

  for (const line of doc.lines) {
    const dept = line.reparto ?? resolveReparto(cfg, line.vatRate);
    parts.push(
      `<printRecItem operator="1" description="${xmlEscape(line.description).slice(0, 38)}" ` +
        `quantity="${line.qty}" unitPrice="${line.unitPrice.toFixed(2)}" ` +
        `department="${dept}" justification="1" />`,
    );
  }

  if (doc.discount && doc.discount > 0) {
    parts.push(
      `<printRecItemAdjustment operator="1" description="Sconto" ` +
        `amount="${doc.discount.toFixed(2)}" adjustmentType="1" department="1" justification="1" />`,
    );
  }

  parts.push(`<printRecSubtotal operator="1" option="0" />`);

  for (const p of doc.payments) {
    parts.push(
      `<printRecTotal operator="1" description="${xmlEscape(labelForPayment(p.type))}" ` +
        `payment="${p.amount.toFixed(2)}" paymentType="${paymentType(p.type)}" index="0" justification="1" />`,
    );
  }

  if (cfg.lotteryEnabled && doc.lotteryCode) {
    parts.push(`<printRecMessage operator="1" messageType="4" message="${xmlEscape(doc.lotteryCode)}" />`);
  }
  if (doc.customerTaxCode) {
    parts.push(`<printRecMessage operator="1" messageType="3" message="${xmlEscape(doc.customerTaxCode)}" />`);
  }

  parts.push(`<endFiscalReceipt operator="1" />`);
  parts.push(`</printerFiscalReceipt>`);
  return soapEnvelope(parts.join(""));
}

function labelForPayment(type: string): string {
  switch (type) {
    case "card":
      return "Carta";
    case "voucher":
      return "Buono pasto";
    case "cash":
      return "Contante";
    default:
      return "Pagamento";
  }
}

function soapEnvelope(inner: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`
  );
}

async function postXml(cfg: FiscalDeviceConfig, body: string): Promise<Document> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(cfg), {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    return new DOMParser().parseFromString(text, "text/xml");
  } finally {
    clearTimeout(timer);
  }
}

// La risposta Epson ha <response success="true" code="" status="...">
// con addInfo/elementList contenenti fiscalReceiptNumber, fiscalReceiptDate, ecc.
function readAttr(dom: Document, tag: string, attr: string): string | undefined {
  const el = dom.getElementsByTagName(tag)[0];
  return el?.getAttribute(attr) ?? undefined;
}

function elementValue(dom: Document, name: string): string | undefined {
  const els = dom.getElementsByTagName("elementList");
  for (let i = 0; i < els.length; i++) {
    if (els[i].getAttribute("name") === name) return els[i].getAttribute("value") ?? undefined;
  }
  return undefined;
}

export const epsonDriver: FiscalDriver = {
  async testConnection(cfg: FiscalDeviceConfig): Promise<TestConnectionResult> {
    try {
      // Query stato + informazioni stampante.
      const body = soapEnvelope(`<printerCommand><queryPrinterStatus statusType="1" /></printerCommand>`);
      const dom = await postXml(cfg, body);
      const resp = dom.getElementsByTagName("response")[0];
      if (!resp) return { ok: false, error: "Risposta non riconosciuta dall'RT" };
      const success = resp.getAttribute("success") === "true";
      const serial =
        elementValue(dom, "printerSerialNumber") ?? readAttr(dom, "response", "serialNumber");
      const model = elementValue(dom, "printerModel");
      if (!success) return { ok: false, error: `RT ha risposto con errore (code ${resp.getAttribute("code") ?? "?"})` };
      return { ok: true, model, serial };
    } catch (e) {
      return { ok: false, error: humanError(e) };
    }
  },

  async printCommercialDocument(cfg: FiscalDeviceConfig, doc: CommercialDoc): Promise<PrintDocResult> {
    try {
      const dom = await postXml(cfg, buildReceiptXml(cfg, doc));
      const resp = dom.getElementsByTagName("response")[0];
      if (!resp) return { ok: false, error: "Risposta non riconosciuta dall'RT" };
      if (resp.getAttribute("success") !== "true") {
        return { ok: false, error: `Stampa rifiutata dall'RT (code ${resp.getAttribute("code") ?? "?"})` };
      }
      const docNumber =
        elementValue(dom, "fiscalReceiptNumber") ?? readAttr(dom, "receipt", "fiscalReceiptNumber");
      const docDate =
        elementValue(dom, "fiscalReceiptDate") ?? readAttr(dom, "receipt", "fiscalReceiptDate");
      const serial = elementValue(dom, "printerSerialNumber");
      return { ok: true, docNumber, docDate, serial, zPending: true };
    } catch (e) {
      return { ok: false, error: humanError(e) };
    }
  },

  async dailyClose(cfg: FiscalDeviceConfig): Promise<DailyCloseResult> {
    try {
      const body = soapEnvelope(`<printerFiscalReport><printZReport operator="1" /></printerFiscalReport>`);
      const dom = await postXml(cfg, body);
      const resp = dom.getElementsByTagName("response")[0];
      if (!resp || resp.getAttribute("success") !== "true") {
        return { ok: false, error: `Chiusura Z rifiutata (code ${resp?.getAttribute("code") ?? "?"})` };
      }
      const zNumber = elementValue(dom, "zRepNumber") ?? readAttr(dom, "response", "zRepNumber");
      return { ok: true, zNumber };
    } catch (e) {
      return { ok: false, error: humanError(e) };
    }
  },
};

function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return "Registratore non raggiungibile (timeout). Controlla IP e rete.";
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return "Registratore non raggiungibile. Controlla che sia in rete e l'indirizzo IP.";
  return msg;
}
