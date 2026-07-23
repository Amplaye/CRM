// FatturaPA (Fattura Elettronica / SDI) XML parser — dependency-free.
// A single .xml file can carry the shared header (CedentePrestatore = supplier)
// plus one or more FatturaElettronicaBody blocks (one invoice each). We map each
// body onto the same ExtractedInvoice shape the photo OCR produces, so the rest
// of the pipeline (supplier resolve, line classification, confirm) is identical —
// with one extra field the photo path can't give us: DataScadenzaPagamento →
// due_date, which is exactly what the scadenzario needs.
//
// Namespace prefixes vary between issuers (p:, ns2:, none). FatturaPA body tags
// themselves are unprefixed in practice, but we strip any "prefix:" defensively.

import type { ExtractedInvoice } from "./extract";

export type ParsedFattura = ExtractedInvoice & { dueDate: string | null };

type XmlNode = { tag: string; children: XmlNode[]; text: string };

// ---- minimal, tolerant XML to tree ----------------------------------------
function parseXml(xml: string): XmlNode {
  // Drop prolog, comments, CDATA wrappers and namespace prefixes on tag names.
  const cleaned = xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  const root: XmlNode = { tag: "#root", children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tagRe = /<\/?([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const name = m[2];
    const selfClose = m[4];
    const textRun = m[5];
    if (textRun != null) {
      const t = textRun.trim();
      if (t) stack[stack.length - 1].text += decodeEntities(t);
      continue;
    }
    const isClose = m[0].startsWith("</");
    if (isClose) {
      if (stack.length > 1) stack.pop();
    } else {
      const node: XmlNode = { tag: name, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
  }
  return root;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

// ---- tree query helpers ----------------------------------------------------
function first(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) if (c.tag === tag) return c;
  for (const c of node.children) {
    const found = first(c, tag);
    if (found) return found;
  }
  return undefined;
}
function directAll(node: XmlNode | undefined, tag: string): XmlNode[] {
  if (!node) return [];
  return node.children.filter((c) => c.tag === tag);
}
function textOf(node: XmlNode | undefined, tag: string): string | null {
  const n = first(node, tag);
  const t = n?.text?.trim();
  return t ? t : null;
}
function numOf(node: XmlNode | undefined, tag: string): number | null {
  const t = textOf(node, tag);
  if (t == null) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---- FatturaPA to ExtractedInvoice[] --------------------------------------
export function parseFatturaPa(xml: string): ParsedFattura[] {
  const root = parseXml(xml);
  const fattura = first(root, "FatturaElettronica") || root;

  // Supplier lives in the header, shared by every body in the file.
  const cedente = first(fattura, "CedentePrestatore");
  const anagrafica = first(cedente, "DatiAnagrafici");
  const idIva = first(anagrafica, "IdFiscaleIVA");
  const paese = textOf(idIva, "IdPaese") || "";
  const codice = textOf(idIva, "IdCodice") || "";
  const vat = codice ? `${paese}${codice}` : textOf(anagrafica, "CodiceFiscale");
  const denom = textOf(anagrafica, "Denominazione");
  const nome = textOf(anagrafica, "Nome");
  const cognome = textOf(anagrafica, "Cognome");
  const supplierName = denom || [nome, cognome].filter(Boolean).join(" ") || null;

  const bodies = directAll(fattura, "FatturaElettronicaBody");
  const list = bodies.length ? bodies : [fattura];

  return list.map((body): ParsedFattura => {
    const generali = first(body, "DatiGeneraliDocumento");
    const beni = first(body, "DatiBeniServizi");

    const lines = directAll(beni, "DettaglioLinee").map((l) => ({
      description: textOf(l, "Descrizione") || "",
      quantity: numOf(l, "Quantita"),
      unit: textOf(l, "UnitaMisura"),
      unitPrice: numOf(l, "PrezzoUnitario"),
      lineTotal: numOf(l, "PrezzoTotale"),
      taxRate: numOf(l, "AliquotaIVA"),
    }));

    // Riepilogo (one block per VAT rate) gives net + tax totals.
    const riepiloghi = directAll(beni, "DatiRiepilogo");
    let net = 0, tax = 0, hasRiep = false;
    for (const r of riepiloghi) {
      const imp = numOf(r, "ImponibileImporto");
      const imposta = numOf(r, "Imposta");
      if (imp != null) { net += imp; hasRiep = true; }
      if (imposta != null) { tax += imposta; hasRiep = true; }
    }

    const gross = numOf(generali, "ImportoTotaleDocumento");
    const dueDate = textOf(first(body, "DatiPagamento"), "DataScadenzaPagamento");

    return {
      supplierName,
      supplierVat: vat,
      invoiceNumber: textOf(generali, "Numero"),
      invoiceDate: textOf(generali, "Data"),
      currency: textOf(generali, "Divisa") || "EUR",
      netTotal: hasRiep ? round2(net) : null,
      taxTotal: hasRiep ? round2(tax) : null,
      grossTotal: gross ?? (hasRiep ? round2(net + tax) : null),
      lines,
      dueDate: dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate) ? dueDate.slice(0, 10) : null,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
