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
// gpt-4o allows up to 16384 output tokens. Big multi-page menus can produce a
// lot of JSON; 8000 was truncating them mid-array (parse failure). Use the max.
const MAX_OUTPUT_TOKENS = 16000;

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
             "tags": string[]        // ONLY from this fixed list: vegano, vegetariano, piccante, consigliato, specialita, novita
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

// Second-pass prompt. The first pass (especially on image/PDF via vision) is
// great at reading dish NAMES + DESCRIPTIONS but routinely leaves allergens and
// tags empty — gpt-4o reading a rendered page doesn't reliably reason about
// ingredients. This pass runs on the structured result as TEXT (where the model
// is strong) and DEDUCES allergens + tags from each dish's name/description.
// Measured on the Fuji menu: 0% → ~85% allergens, ~38% tags. Mirrored verbatim
// in supabase/functions/menu-extract/index.ts — keep both in sync.
export const ENRICH_PROMPT = `Sei un esperto di sicurezza alimentare e cucina. Ricevi un menù già strutturato in JSON (nomi e descrizioni dei piatti) in cui "allergens" e "tags" possono essere vuoti o incompleti.

Il tuo UNICO compito: per OGNI piatto, compilare "allergens" e "tags" deducendoli dal nome e dalla descrizione con la conoscenza culinaria standard. NON modificare name/description/price/currency. NON aggiungere, togliere o riordinare i piatti. Mantieni ESATTAMENTE la stessa struttura (stesse categorie, stessi piatti, nello stesso ordine).

ALLERGENI — lista chiusa, lowercase (usa SOLO questi): glutine, latticini, uova, pesce, crostacei, frutta_secca, arachidi, soia, sedano, senape, sesamo, solfiti, lupini, molluschi
Deduzioni tipiche (non esaustivo):
- tempura/tempurizado/rebozado/empanado/panato/gyoza/tallarines/pasta/pane/soba(grano)/salsa di soia/teriyaki/katsu/kabayaki → glutine
- salsa di soia/teriyaki/miso/tofu/soia/edamame → soia
- langostino/gambas/ebi/gambero → crostacei
- pulpo/calamar/zamburiñas/vieiras/mejillones/almejas/seppia/polpo/calamaro/capesante → molluschi
- atún/salmón/pescado/anguila/surimi/sashimi/maguro/dashi/tonno/salmone/anguilla → pesce
- queso/crema/nata/yogur/helado(non sorbetto)/queso crema/formaggio/panna → latticini
- mayonesa/mahonesa/tortilla/dashimaki/tamago/huevo/uovo → uova
- sésamo/gomasio/aceite de sésamo/olio di sesamo → sesamo
- nueces/almendras/anacardos/noci/mandorle → frutta_secca

TAG — lista chiusa (usa SOLO questi): vegano, vegetariano, piccante, consigliato, specialita, novita
- "piccante": picante, spicy, kimchi, chili, peperoncino, "toque picante", wasabi
- "vegetariano": NON contiene carne, pesce, molluschi o crostacei
- "vegano": vegetariano E senza uova, latticini o miele
- "consigliato": SOLO se il menù lo marca esplicitamente (especial/recomendado/del chef/stella)
- "specialita": SOLO se il menù lo marca esplicitamente (especialidad de la casa/specialità della casa/signature/della casa). NON dedurlo dal nome.
- "novita": NON applicarlo MAI in automatico. "Novità/nuovo" è una decisione del ristoratore, non deducibile dal nome o dalla descrizione.

Per piatti senza descrizione, deduci dal nome (es. "Tarta de queso"/cheesecake → latticini, glutine, uova). È RICHIESTO dedurre gli allergeni ovvi; non inventare allergeni non plausibili.

Restituisci lo STESSO oggetto JSON, identica struttura, con allergens/tags compilati. Solo JSON valido, nessun commento, nessun markdown.`;

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

async function callResponses(
  content: ResponseContentBlock[],
  instructions: string = SYSTEM_PROMPT
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const payload: ResponsesPayload = {
    model: MODEL,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    instructions,
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
  return enrichAllergensAndTags(parseExtraction(raw));
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
  return enrichAllergensAndTags(parseExtraction(raw));
}

// Compact name/description-only view of the menu, with stable [c,i] coordinates,
// so the enrichment pass gets the minimum it needs (cheap tokens) and we can
// merge results back by position without trusting the model to preserve names.
type EnrichSlot = { c: number; i: number; name: string; description: string };

function collectEnrichSlots(menu: ExtractedMenu): EnrichSlot[] {
  const slots: EnrichSlot[] = [];
  menu.categories.forEach((cat, c) =>
    cat.items.forEach((it, i) => slots.push({ c, i, name: it.name, description: it.description }))
  );
  menu.uncategorized.forEach((it, i) =>
    slots.push({ c: -1, i, name: it.name, description: it.description })
  );
  return slots;
}

/**
 * Second pass: deduce allergens + tags for every dish from its name/description.
 * The first extraction (vision in particular) often returns these empty; this
 * fills them in, which is the real value for restaurant staff.
 *
 * Defensive by design: on ANY failure (no API key, parse error, shape
 * mismatch, empty menu) it returns the input menu unchanged — enrichment is a
 * best-effort enhancement, never a way to lose an extracted menu.
 *
 * `call` is injected so this is unit-testable without hitting OpenAI.
 */
export async function enrichAllergensAndTags(
  menu: ExtractedMenu,
  call: (content: ResponseContentBlock[]) => Promise<string> = (content) =>
    callResponses(content, ENRICH_PROMPT)
): Promise<ExtractedMenu> {
  const slots = collectEnrichSlots(menu);
  if (slots.length === 0) return menu;

  try {
    const payload = JSON.stringify({
      items: slots.map((s) => ({ c: s.c, i: s.i, name: s.name, description: s.description })),
    });
    const raw = await call([
      {
        type: 'input_text',
        text:
          `Per ogni item qui sotto restituisci un oggetto JSON ` +
          `{"items":[{"c":number,"i":number,"allergens":string[],"tags":string[]}]} ` +
          `con gli STESSI c,i. Solo JSON.\n\n${payload}`,
      },
    ]);

    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    }
    const fb = cleaned.indexOf('{');
    const lb = cleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const repaired = repairTruncatedJson(cleaned);
      if (!repaired) return menu;
      parsed = repaired;
    }

    const out = (parsed || {}) as { items?: unknown };
    const enriched = Array.isArray(out.items) ? out.items : [];
    if (enriched.length === 0) return menu;

    // Index the model's answers by coordinate so order/count drift can't corrupt
    // the merge (we only ever overwrite allergens/tags of the matching dish).
    const byKey = new Map<string, { allergens: string[]; tags: string[] }>();
    for (const e of enriched) {
      const o = (e || {}) as Record<string, unknown>;
      if (typeof o.c !== 'number' || typeof o.i !== 'number') continue;
      byKey.set(`${o.c}:${o.i}`, {
        allergens: cleanList(o.allergens, ALLOWED_ALLERGENS),
        tags: cleanList(o.tags, ALLOWED_TAGS),
      });
    }

    const applyTo = (it: ExtractedMenuItem, c: number, i: number): ExtractedMenuItem => {
      const hit = byKey.get(`${c}:${i}`);
      if (!hit) return it;
      // Union with anything the first pass already found — never drop a real
      // allergen the original extraction caught.
      return {
        ...it,
        allergens: Array.from(new Set([...it.allergens, ...hit.allergens])),
        tags: Array.from(new Set([...it.tags, ...hit.tags])),
      };
    };

    return {
      categories: menu.categories.map((cat, c) => ({
        ...cat,
        items: cat.items.map((it, i) => applyTo(it, c, i)),
      })),
      uncategorized: menu.uncategorized.map((it, i) => applyTo(it, -1, i)),
      raw_notes: menu.raw_notes,
    };
  } catch {
    return menu;
  }
}

function cleanList(raw: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.toLowerCase().trim())
        .filter((x) => allowed.has(x))
    )
  );
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
  } catch {
    // The model can hit the output-token cap and return JSON truncated
    // mid-array. Rather than lose the whole menu, salvage everything that did
    // come through by repairing the cut-off structure.
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) {
      parsed = repaired;
    } else {
      throw new Error('Menu extraction returned non-JSON (and could not be repaired)');
    }
  }

  return normalizeExtraction(parsed);
}

/**
 * Best-effort repair of JSON that was truncated mid-output (e.g. the model ran
 * out of tokens). Walks the string tracking string/escape state, drops any
 * trailing partial token, and closes the still-open `{`/`[` in order. Returns
 * the parsed object on success, or null if it still can't parse.
 */
export function repairTruncatedJson(s: string): unknown | null {
  // Trim to the last "safe" boundary: the last char that closes a value
  // (`}`, `]`, `"`) or is a digit — i.e. drop a dangling partial key/value.
  let end = s.length;
  while (end > 0 && !/[}\]"\d]/.test(s[end - 1])) end--;
  let work = s.slice(0, end);

  // Track structure to know what to close.
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < work.length; i++) {
    const c = work[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  // If we ended inside a string, close it.
  if (inStr) work += '"';
  // Drop a trailing comma (would make the closed array/object invalid).
  work = work.replace(/,\s*$/, '');
  // Close open structures in reverse order.
  for (let i = stack.length - 1; i >= 0; i--) {
    work += stack[i] === '{' ? '}' : ']';
  }

  try {
    return JSON.parse(work);
  } catch {
    return null;
  }
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

// novita/specialita are mostly human-applied badges (the ENRICH_PROMPT tells the
// AI never to auto-add 'novita' and to add 'specialita' only on an explicit menu
// cue), but they MUST be in the allow-list so a hand-applied tag survives the
// normalize step used by import-confirm and the enrich pass.
const ALLOWED_TAGS = new Set(['vegano', 'vegetariano', 'piccante', 'consigliato', 'specialita', 'novita']);

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
