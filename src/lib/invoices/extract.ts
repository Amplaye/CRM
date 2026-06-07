// Supplier-invoice extraction from a photo or PDF, mirroring src/lib/menu/extract.ts:
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

const SYSTEM_PROMPT = `You are an invoice-extraction assistant for an Italian restaurant CRM.

You read a SUPPLIER INVOICE (fattura fornitore — image or PDF) and output a STRICT JSON
object. Rules, no exception:

1. Output VALID JSON only. No prose, no markdown fences, no comments.
2. Schema (TypeScript):
   {
     "supplierName": string | null,   // ragione sociale del fornitore
     "supplierVat": string | null,    // Partita IVA (digits only, no "IT" prefix), null if absent
     "invoiceNumber": string | null,  // numero fattura
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
5. If the document is NOT a supplier invoice, return
   {"supplierName":null,"supplierVat":null,"invoiceNumber":null,"invoiceDate":null,"currency":"EUR","netTotal":null,"taxTotal":null,"grossTotal":null,"lines":[],"rawNotes":"not an invoice"}.`;

const USER_PROMPT = `Extract this supplier invoice as STRICT JSON following the schema in the system prompt.
Return ONLY the JSON object — no prose, no markdown.`;

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

async function callResponses(content: ResponseContentBlock[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/responses", {
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
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openai responses ${res.status}: ${body.slice(0, 500)}`);
  }
  return responsesText((await res.json()) as ResponsesApiResponse);
}

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
