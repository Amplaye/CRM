// Menu extraction from PDF/image/HTML text using OpenAI gpt-4o via the
// Responses API. The Responses API accepts PDFs and images natively as
// `input_file` blocks, so we don't need to rasterize PDFs server-side
// (which would pull in pdfjs-dist + a native canvas binary).
//
// We hit OpenAI directly (not via Vercel AI Gateway), because the Gateway
// requires a credit card on file even for free credits and does not
// support `file` input. The OPENAI_API_KEY is already configured on the
// Vercel project.

export type ExtractedMenuItem = {
  name: string;
  description: string;
  price: number | null;
  currency: string;
  allergens: string[];
  tags: string[];
};

export type ExtractedMenuCategory = {
  name: string;
  items: ExtractedMenuItem[];
};

export type ExtractedMenu = {
  categories: ExtractedMenuCategory[];
  uncategorized: ExtractedMenuItem[];
  raw_notes?: string;
};

const MODEL = 'gpt-4o';
const MAX_OUTPUT_TOKENS = 8000;

const SYSTEM_PROMPT = `You are a menu-extraction assistant for an Italian restaurant CRM.

Your job is to read a restaurant menu (image, PDF or text) and output a STRICT JSON
object describing it. Follow these rules without exception:

1. Output VALID JSON only. No prose, no markdown fences, no comments.
2. Schema (TypeScript):
   {
     "categories": [
       {
         "name": string,            // e.g. "Antipasti", "Primi", "Pizze", "Dolci", "Bevande"
         "items": [
           {
             "name": string,         // dish name as it appears
             "description": string,  // ingredients / short description, "" if absent
             "price": number | null, // in the menu's currency, e.g. 12.5; null if no price shown
             "currency": string,     // "EUR" by default; "USD" if dollars, "GBP" if pounds
             "allergens": string[],  // lowercase tokens from this fixed list ONLY:
                                     // glutine, latticini, uova, pesce, crostacei, frutta_secca,
                                     // arachidi, soia, sedano, senape, sesamo, solfiti, lupini, molluschi
             "tags": string[]        // ONLY from this fixed list: vegano, vegetariano, piccante, consigliato
           }
         ]
       }
     ],
     "uncategorized": [ /* same item shape, for items found without a clear category */ ],
     "raw_notes": string             // optional, very short note about confidence/skipped sections
   }
3. NEVER invent prices, allergens, or tags that are not visibly stated or universally
   true (e.g. "carbonara" → eggs/dairy yes; "pizza margherita" → dairy yes; but do not
   guess "piccante" unless menu marks it).
4. Keep category names short and capitalized. Translate obvious foreign categories
   to Italian when the menu is in Italian; otherwise keep the original language.
5. If the file is not a menu, return {"categories":[],"uncategorized":[],"raw_notes":"not a menu"}.
6. Decimal separator: always use "." (12.50, never "12,50") in the JSON.`;

const USER_PROMPT = `Extract this menu as STRICT JSON following the schema in the system prompt.
Return ONLY the JSON object — no prose, no markdown, no explanation.`;

type ResponseContentBlock =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string };

type ResponsesPayload = {
  model: string;
  max_output_tokens: number;
  temperature: number;
  instructions: string;
  input: Array<{ role: 'user'; content: ResponseContentBlock[] }>;
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

async function callResponses(content: ResponseContentBlock[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const payload: ResponsesPayload = {
    model: MODEL,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    instructions: SYSTEM_PROMPT,
    input: [{ role: 'user', content }],
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`openai responses ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as ResponsesApiResponse;
  return responsesText(json);
}

/**
 * Extract the assembled text from a Responses API payload. Prefers the
 * convenience `output_text` field; falls back to walking the structured
 * `output[].content[]` tree for compatibility.
 */
export function responsesText(res: ResponsesApiResponse): string {
  if (typeof res.output_text === 'string' && res.output_text.length > 0) {
    return res.output_text;
  }
  const parts: string[] = [];
  for (const out of res.output || []) {
    for (const block of out.content || []) {
      if (typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Run extraction on a PDF or image buffer. Both PDFs and images are sent
 * as `input_file` blocks to the Responses API — gpt-4o handles them
 * natively without any client-side rasterization.
 */
export async function extractMenuFromFile(opts: {
  base64Data: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}): Promise<ExtractedMenu> {
  const isPdf = opts.mediaType === 'application/pdf';
  const dataUrl = `data:${opts.mediaType};base64,${opts.base64Data}`;

  const fileBlock: ResponseContentBlock = isPdf
    ? { type: 'input_file', filename: 'menu.pdf', file_data: dataUrl }
    : { type: 'input_image', image_url: dataUrl };

  const raw = await callResponses([fileBlock, { type: 'input_text', text: USER_PROMPT }]);
  return parseExtraction(raw);
}

/**
 * Run extraction on plain text (e.g. scraped HTML body). Useful for menus
 * hosted as simple webpages.
 */
export async function extractMenuFromText(text: string): Promise<ExtractedMenu> {
  const trimmed = text.slice(0, 100_000); // hard cap; menus are never this long
  const raw = await callResponses([
    { type: 'input_text', text: `${USER_PROMPT}\n\n---MENU TEXT---\n${trimmed}` },
  ]);
  return parseExtraction(raw);
}

/**
 * Parse the model response. Tolerant to leading/trailing whitespace and to
 * (incorrect but common) markdown code-fence wrapping.
 */
export function parseExtraction(raw: string): ExtractedMenu {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  // Sometimes the model adds explanation BEFORE the JSON. Find the first { and last }.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Menu extraction returned non-JSON: ${String(err).slice(0, 200)}`);
  }

  return normalizeExtraction(parsed);
}

/**
 * Apply strict normalization so the rest of the app can rely on shape +
 * allowed values. Strips anything off-schema so a hallucinated "tag" can
 * never make it into the database.
 */
export function normalizeExtraction(parsed: unknown): ExtractedMenu {
  const obj = (parsed || {}) as Record<string, unknown>;
  const categories = Array.isArray(obj.categories) ? obj.categories : [];
  const uncategorized = Array.isArray(obj.uncategorized) ? obj.uncategorized : [];

  return {
    categories: categories.map((c) => normalizeCategory(c)),
    uncategorized: uncategorized.map((it) => normalizeItem(it)),
    raw_notes: typeof obj.raw_notes === 'string' ? obj.raw_notes : undefined,
  };
}

const ALLOWED_ALLERGENS = new Set([
  'glutine',
  'latticini',
  'uova',
  'pesce',
  'crostacei',
  'frutta_secca',
  'arachidi',
  'soia',
  'sedano',
  'senape',
  'sesamo',
  'solfiti',
  'lupini',
  'molluschi',
]);

const ALLOWED_TAGS = new Set(['vegano', 'vegetariano', 'piccante', 'consigliato']);

function normalizeCategory(raw: unknown): ExtractedMenuCategory {
  const obj = (raw || {}) as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  return {
    name: typeof obj.name === 'string' ? obj.name.slice(0, 80).trim() : 'Senza nome',
    items: items.map((it) => normalizeItem(it)),
  };
}

function normalizeItem(raw: unknown): ExtractedMenuItem {
  const obj = (raw || {}) as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.slice(0, 120).trim() : '';
  const description = typeof obj.description === 'string' ? obj.description.slice(0, 600).trim() : '';
  const priceRaw = obj.price;
  let price: number | null = null;
  if (typeof priceRaw === 'number' && Number.isFinite(priceRaw)) price = priceRaw;
  else if (typeof priceRaw === 'string') {
    const n = Number(priceRaw.replace(',', '.'));
    if (Number.isFinite(n)) price = n;
  }
  const currency =
    typeof obj.currency === 'string' && obj.currency.length === 3 ? obj.currency.toUpperCase() : 'EUR';
  const allergens = Array.isArray(obj.allergens)
    ? Array.from(
        new Set(
          (obj.allergens as unknown[])
            .filter((a): a is string => typeof a === 'string')
            .map((a) => a.toLowerCase().trim())
            .filter((a) => ALLOWED_ALLERGENS.has(a))
        )
      )
    : [];
  const tags = Array.isArray(obj.tags)
    ? Array.from(
        new Set(
          (obj.tags as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.toLowerCase().trim())
            .filter((t) => ALLOWED_TAGS.has(t))
        )
      )
    : [];
  return { name, description, price, currency, allergens, tags };
}
