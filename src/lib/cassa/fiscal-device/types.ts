// Astrazione driver per Registratore Telematico (RT) fiscale italiano.
//
// ⚠️ ARCHITETTURA: questi driver girano NEL BROWSER (come PrintSheet), non lato
// server. Il Worker Cloudflare (edge) non può raggiungere la LAN del ristorante
// dove sta l'RT. Il fiscale spagnolo (src/lib/fiscal/*, VeriFactu→AEAT via
// internet) resta separato e invariato.

export type FiscalBrand = "epson" | "axon" | "generic";

// Come il browser raggiunge il device sulla LAN.
export type FiscalTransport = "lan_http" | "lan_ws";

export interface FiscalDeviceConfig {
  brand: FiscalBrand;
  transport: FiscalTransport;
  /** IP o hostname del device sulla rete locale, con porta opzionale (es. "192.168.1.50" o "192.168.1.50:8080"). */
  host: string;
  /** true → https, false/undefined → http. */
  tls?: boolean;
  /** aliquota IVA (come stringa "10") → indice reparto programmato sull'RT. */
  vatRepartoMap?: Record<string, number>;
  lotteryEnabled?: boolean;
}

export interface CommercialDocLine {
  description: string;
  qty: number;
  /** prezzo unitario LORDO (IVA inclusa) in euro. */
  unitPrice: number;
  /** aliquota IVA: 0 | 4 | 5 | 10 | 22. */
  vatRate: number;
  /** indice reparto sull'RT; se assente si risolve da vatRepartoMap. */
  reparto?: number;
}

export type CommercialDocPaymentType = "cash" | "card" | "voucher" | "other";

export interface CommercialDocPayment {
  type: CommercialDocPaymentType;
  amount: number;
}

export interface CommercialDoc {
  lines: CommercialDocLine[];
  payments: CommercialDocPayment[];
  /** sconto a scontrino, in euro (opzionale). */
  discount?: number;
  /** codice lotteria degli scontrini (opzionale). */
  lotteryCode?: string;
  /** codice fiscale cliente per documento con CF (opzionale). */
  customerTaxCode?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  model?: string;
  serial?: string;
  error?: string;
}

export interface PrintDocResult {
  ok: boolean;
  docNumber?: string;
  docDate?: string; // ISO
  serial?: string;
  /** true se la vendita è registrata ma la chiusura Z è ancora pendente. */
  zPending?: boolean;
  error?: string;
}

export interface DailyCloseResult {
  ok: boolean;
  zNumber?: string;
  error?: string;
}

export interface FiscalDriver {
  testConnection(cfg: FiscalDeviceConfig): Promise<TestConnectionResult>;
  printCommercialDocument(cfg: FiscalDeviceConfig, doc: CommercialDoc): Promise<PrintDocResult>;
  /** chiusura fiscale giornaliera (Z-report). */
  dailyClose(cfg: FiscalDeviceConfig): Promise<DailyCloseResult>;
}

// Reparti di default: aliquota IVA → indice reparto sull'RT.
// Prerequisito operativo: CENTROCASSA programma questi reparti sul device.
export const DEFAULT_VAT_REPARTO_MAP: Record<string, number> = {
  "4": 1,
  "5": 2,
  "10": 3,
  "22": 4,
  "0": 5,
};

export function resolveReparto(cfg: FiscalDeviceConfig, vatRate: number): number {
  const key = String(vatRate);
  const map = cfg.vatRepartoMap ?? {};
  return map[key] ?? DEFAULT_VAT_REPARTO_MAP[key] ?? 1;
}

/** Costruisce l'URL base per il device, aggiungendo la porta di default se assente. */
export function deviceBaseUrl(cfg: FiscalDeviceConfig, defaultPort?: number): string {
  const scheme = cfg.tls ? "https" : "http";
  const hasPort = /:\d+$/.test(cfg.host);
  const host = hasPort || !defaultPort ? cfg.host : `${cfg.host}:${defaultPort}`;
  return `${scheme}://${host}`;
}
