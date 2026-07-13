// The QR tributario printed on every Spanish ticket.
//
// It is not decoration and it is not ours to design: AEAT publishes the exact URL,
// the exact parameter names, and even the physical size and the words printed above
// and below it ("Especificaciones técnicas para la generación del código QR"). A
// guest scans it and lands on the Agencia Tributaria's own page, which tells them
// whether the ticket in their hand was actually filed. That is the entire point of
// VERI*FACTU: verification by the customer, not by an inspector.
//
// Rules that are easy to get wrong and are therefore encoded here:
//   • the amount uses a DOT as decimal separator, and every value is URL-encoded;
//   • the date is DD-MM-AAAA, like everywhere else in the spec;
//   • sandbox and production are DIFFERENT HOSTS — printing a production QR while
//     filing to preproducción gives a receipt whose QR resolves to "not found".

import { fiscalDate, fiscalAmount, normalizeNif } from "./huella";

/** AEAT's cotejo endpoints. `prewww2` is preproducción — the one to print while
 * testing against the sandbox. */
export const AEAT_QR_BASE_PROD = "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR";
export const AEAT_QR_BASE_SANDBOX = "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR";

/** Which host to print. Client-readable (the receipt is rendered in the browser),
 * hence NEXT_PUBLIC_. Defaults to production: a missing env var must not silently
 * print sandbox QRs on real receipts. */
export function aeatQrBase(): string {
  return process.env.NEXT_PUBLIC_AEAT_ENV === "sandbox" ? AEAT_QR_BASE_SANDBOX : AEAT_QR_BASE_PROD;
}

export interface QrInput {
  nif: string;
  numSerie: string;
  /** The app's YYYY-MM-DD; converted to the spec's DD-MM-AAAA here. */
  fecha: string;
  importe: number;
}

/** The URL the QR encodes. */
export function aeatQrUrl(i: QrInput, base: string = aeatQrBase()): string {
  const params = new URLSearchParams({
    nif: normalizeNif(i.nif),
    numserie: i.numSerie,
    fecha: fiscalDate(i.fecha),
    importe: fiscalAmount(i.importe),
  });
  return `${base}?${params.toString()}`;
}
