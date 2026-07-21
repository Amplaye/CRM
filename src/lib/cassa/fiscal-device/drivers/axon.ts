// Driver Axon / Micrelec Helios RT — documento commerciale via HTTP (porta 8080).
//
// ⚠️ Gira nel BROWSER. Il device della prova in loco è un Micrelec Helios
// (matricola 8AMPD127940, noleggio CENTROCASSA). L'Helios PLUS RT espone i
// comandi testuali (stesso set del socket TCP:9100) anche via HTTP POST su
// :8080 → questa è la via usabile da un'app web (il raw TCP non è raggiungibile
// dal browser).
//
// ⚠️ Il set comandi esatto va confermato col manuale Axon/rcfsistemi o da
// CENTROCASSA, e il tecnico imposta sul device il protocollo concordato. Qui
// implemento il formato testuale documentato; la taratura fine (giustificativi
// pagamento, matricola in risposta) si fa sul device reale.

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
const DEFAULT_PORT = 8080;

function endpoint(cfg: FiscalDeviceConfig): string {
  return `${deviceBaseUrl(cfg, DEFAULT_PORT)}/cmd`;
}

async function sendCommand(cfg: FiscalDeviceConfig, command: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(cfg), {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: command,
      signal: controller.signal,
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Documento commerciale Helios (formato testuale):
//   M\r\n                                  → apre documento
//   {qty}*{desc}\t{unitprice}\t{dept}\r\n  → riga articolo
//   T{total}\r\n                           → chiude e totalizza
// Risposta: "OK {doc_number} {printer_serial}\r\n".
function buildDocCommand(cfg: FiscalDeviceConfig, doc: CommercialDoc): string {
  const lines: string[] = ["M"];
  for (const line of doc.lines) {
    const dept = line.reparto ?? resolveReparto(cfg, line.vatRate);
    const desc = line.description.replace(/[\t\r\n]/g, " ").slice(0, 38);
    lines.push(`${line.qty}*${desc}\t${line.unitPrice.toFixed(2)}\t${dept}`);
  }
  if (doc.discount && doc.discount > 0) {
    lines.push(`-${doc.discount.toFixed(2)}`);
  }
  const total = doc.payments.reduce((s, p) => s + p.amount, 0);
  lines.push(`T${total.toFixed(2)}`);
  return lines.join("\r\n") + "\r\n";
}

function parseOk(text: string): { docNumber?: string; serial?: string } {
  // "OK 0042 MIC2024001" → docNumber=0042, serial=MIC2024001
  const m = text.trim().match(/^OK\s+(\S+)(?:\s+(\S+))?/i);
  if (!m) return {};
  return { docNumber: m[1], serial: m[2] };
}

export const axonDriver: FiscalDriver = {
  async testConnection(cfg: FiscalDeviceConfig): Promise<TestConnectionResult> {
    try {
      const text = await sendCommand(cfg, "S\r\n");
      const trimmed = text.trim();
      // Risposta stato attesa: "ST {status} {fiscal_memory}" — se arriva, il device è raggiungibile.
      if (/^ST\b/i.test(trimmed) || /^OK\b/i.test(trimmed)) {
        const serial = trimmed.split(/\s+/).find((tok) => /^[A-Z0-9]{6,}$/i.test(tok) && /[A-Za-z]/.test(tok));
        return { ok: true, model: "Micrelec Helios", serial };
      }
      return { ok: false, error: "Il registratore ha risposto in un formato non riconosciuto." };
    } catch (e) {
      return { ok: false, error: humanError(e) };
    }
  },

  async printCommercialDocument(cfg: FiscalDeviceConfig, doc: CommercialDoc): Promise<PrintDocResult> {
    try {
      const text = await sendCommand(cfg, buildDocCommand(cfg, doc));
      if (!/^OK\b/i.test(text.trim())) {
        return { ok: false, error: `Stampa rifiutata dall'RT: ${text.trim().slice(0, 120) || "nessuna risposta"}` };
      }
      const { docNumber, serial } = parseOk(text);
      return { ok: true, docNumber, serial, zPending: true };
    } catch (e) {
      return { ok: false, error: humanError(e) };
    }
  },

  async dailyClose(cfg: FiscalDeviceConfig): Promise<DailyCloseResult> {
    try {
      const text = await sendCommand(cfg, "Z\r\n");
      if (!/^OK\b/i.test(text.trim())) {
        return { ok: false, error: `Chiusura Z rifiutata: ${text.trim().slice(0, 120) || "nessuna risposta"}` };
      }
      const { docNumber } = parseOk(text);
      return { ok: true, zNumber: docNumber };
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
