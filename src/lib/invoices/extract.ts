// Supplier-document extraction from a photo or PDF, mirroring src/lib/menu/extract.ts.
// "Invoice" here means any document that brings goods in: a fattura, but just as often
// a DDT / bolla di accompagnamento, which carries no VAT summary and sometimes no
// prices — the prompt must accept those or a delivery note silently yields zero lines.
// OpenAI gpt-4o via the Responses API, which accepts PDFs and images natively as
// input_file / input_image blocks (no server-side rasterization, no pdfjs). One
// pass is enough — an invoice is a single page of structured data, unlike a menu
// that needs a second allergen/tag deduction pass. We hit OpenAI directly (the
// Vercel AI Gateway needs a card and doesn't support file input); OPENAI_API_KEY
// is already on the project.

export type ExtractedInvoiceLine = {
  description: string;
  quantity: number | null;
  unit: string | null;          // "kg", "pz", "l"… free text as printed
  unitPrice: number | null;
  lineTotal: number | null;
  taxRate: number | null;       // VAT % (e.g. 10, 22)
};

export type ExtractedInvoice = {
  supplierName: string | null;
  supplierVat: string | null;   // P.IVA
  invoiceNumber: string | null;
  invoiceDate: string | null;   // ISO yyyy-mm-dd
  currency: string;
  netTotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
  lines: ExtractedInvoiceLine[];
  rawNotes?: string;
};

const MODEL = "gpt-4o";
const MAX_OUTPUT_TOKENS = 8000;

export const SYSTEM_PROMPT = `You are a supplier-document extraction assistant for an Italian restaurant CRM.

You read a SUPPLIER DOCUMENT and output a STRICT JSON object. Accept ANY of these — they
all carry goods the restaurant received and must be extracted the same way:
  - fattura / fattura fornitore (invoice)
  - documento di trasporto / DDT / bolla / bolla di accompagnamento (delivery note)
  - ricevuta or scontrino from a supplier
A DDT usually has no VAT summary and sometimes no prices at all — extract it anyway,
leaving unavailable fields null. A missing total is NEVER a reason to return no lines.

Rules, no exception:

1. Output VALID JSON only. No prose, no markdown fences, no comments.
2. Schema (TypeScript):
   {
     "supplierName": string | null,   // see rule 8 — chi EMETTE il documento
     "supplierVat": string | null,    // Partita IVA del FORNITORE (digits only, no "IT"
                                      // prefix). If the only P.IVA printed belongs to the
                                      // recipient, return null — never borrow theirs.
     "invoiceNumber": string | null,  // numero fattura, o numero DDT/bolla
     "invoiceDate": string | null,    // ISO "yyyy-mm-dd"; convert from dd/mm/yyyy
     "currency": string,              // "EUR" by default
     "netTotal": number | null,       // imponibile (totale netto, IVA esclusa)
     "taxTotal": number | null,       // totale IVA
     "grossTotal": number | null,     // totale documento (IVA inclusa)
     "lines": [
       {
         "description": string,       // descrizione articolo/prodotto
         "quantity": number | null,
         "unit": string | null,       // "kg", "pz", "lt", "g"… as printed
         "unitPrice": number | null,  // prezzo unitario
         "lineTotal": number | null,  // totale riga
         "taxRate": number | null     // aliquota IVA % della riga (es. 10, 22)
       }
     ],
     "rawNotes": string               // optional short confidence note
   }
3. NEVER invent values that are not visibly stated. Use null for anything unreadable.
4. Decimal separator in the JSON is always "." (12.50, never "12,50").
5. Extract EVERY goods line in the table, even when a line has no price.
6. Ignore boilerplate that is not merchandise: legal notes (e.g. "Assolve gli obblighi
   di cui all'art. 62…"), carrier/transport rows, signature boxes, CONAI notes.
8. SUPPLIER vs RECIPIENT — get this right, they are easy to swap:
   - The SUPPLIER issues the document. Its name is the letterhead/logo, normally top-left,
     next to the printer's address and "Iscr. Reg. Imp. / Cod. Fisc. e Part. IVA".
   - The RECIPIENT is the restaurant being delivered to, printed in a boxed field labelled
     "Intestatario", "Destinatario", "Spett.le", "Cliente" or "Cod. cliente" — very often
     in the top-RIGHT box, and often the only one showing a P.IVA.
   Put the LETTERHEAD company in supplierName. NEVER put the Intestatario/Destinatario
   there, however prominently it is printed.
9. Only if the document carries no goods at all (it is not a supplier document — e.g. a
   contract, a menu, an ID) return
   {"supplierName":null,"supplierVat":null,"invoiceNumber":null,"invoiceDate":null,"currency":"EUR","netTotal":null,"taxTotal":null,"grossTotal":null,"lines":[],"rawNotes":"not a supplier document"}.`;

const USER_PROMPT = `Extract this supplier document (invoice, DDT or bolla) as STRICT JSON
following the schema in the system prompt. Return ONLY the JSON object — no prose, no markdown.`;

type ResponseContentBlock =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

function responsesText(res: ResponsesApiResponse): string {
  if (typeof res.output_text === "string" && res.output_text.length > 0) return res.output_text;
  const parts: string[] = [];
  for (const out of res.output || []) {
    for (const block of out.content || []) {
      if (typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("");
}

/** Transient upstream failures — worth another go with the same input. */
function isRetryable(status: number): boolean {
  // 429 rate limit, 500/502/503/504 upstream hiccups. A 4xx about our request
  // (400 bad input, 401 bad key) would fail identically on every retry.
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

const RETRY_DELAYS_MS = [1500, 4000, 9000];

async function callResponses(content: ResponseContentBlock[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  let lastError = "";
  // A supplier document is scanned once and the owner is watching, so a blip
  // must not surface as "extraction failed" — it costs them a whole re-upload.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
          instructions: SYSTEM_PROMPT,
          input: [{ role: "user", content }],
        }),
      });
    } catch (e: any) {
      // Network-level failure (socket closed, DNS): retryable by nature.
      lastError = `network: ${e?.message || e}`;
      continue;
    }
    if (res.ok) return responsesText((await res.json()) as ResponsesApiResponse);
    const body = await res.text().catch(() => "");
    lastError = `openai responses ${res.status}: ${body.slice(0, 500)}`;
    if (!isRetryable(res.status)) break;
  }
  throw new Error(lastError || "openai responses failed");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extract an invoice from a base64 PDF/image. */
export async function extractInvoice(
  base64Data: string,
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/gif",
): Promise<ExtractedInvoice> {
  const dataUrl = `data:${mediaType};base64,${base64Data}`;
  const fileBlock: ResponseContentBlock =
    mediaType === "application/pdf"
      ? { type: "input_file", filename: "fattura.pdf", file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl };
  const raw = await callResponses([fileBlock, { type: "input_text", text: USER_PROMPT }]);
  return normalizeInvoice(parseInvoice(raw));
}

/** Tolerant JSON parse (handles markdown fences and leading prose). */
export function parseInvoice(raw: string): unknown {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const fb = cleaned.indexOf("{");
  const lb = cleaned.lastIndexOf("}");
  if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
  return JSON.parse(cleaned);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function str(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/** Strict normalization so the rest of the app can rely on the shape. */
export function normalizeInvoice(parsed: unknown): ExtractedInvoice {
  const o = (parsed || {}) as Record<string, unknown>;
  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines: ExtractedInvoiceLine[] = linesRaw.map((l) => {
    const li = (l || {}) as Record<string, unknown>;
    return {
      description: str(li.description, 300) || "",
      quantity: num(li.quantity),
      unit: str(li.unit, 16),
      unitPrice: num(li.unitPrice),
      lineTotal: num(li.lineTotal),
      taxRate: num(li.taxRate),
    };
  });
  let invoiceDate = str(o.invoiceDate, 10);
  // accept dd/mm/yyyy and convert
  if (invoiceDate && /^\d{2}\/\d{2}\/\d{4}$/.test(invoiceDate)) {
    const [d, m, y] = invoiceDate.split("/");
    invoiceDate = `${y}-${m}-${d}`;
  }
  const vatRaw = str(o.supplierVat, 20);
  return {
    supplierName: str(o.supplierName, 200),
    supplierVat: vatRaw ? vatRaw.replace(/[^\dA-Za-z]/g, "").replace(/^IT/i, "") : null,
    invoiceNumber: str(o.invoiceNumber, 60),
    invoiceDate: invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? invoiceDate : null,
    currency: str(o.currency, 3)?.toUpperCase() || "EUR",
    netTotal: num(o.netTotal),
    taxTotal: num(o.taxTotal),
    grossTotal: num(o.grossTotal),
    lines,
    rawNotes: str(o.rawNotes, 300) || undefined,
  };
}
