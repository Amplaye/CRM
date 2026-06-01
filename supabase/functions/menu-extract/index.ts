// Supabase Edge Function: menu-extract
// ---------------------------------------------------------------------------
// The long-running worker for menu import. On Vercel Hobby every function is
// capped at 60s, but a large PDF takes 60-120s+ to extract via OpenAI vision.
// Supabase Edge Functions get a 150s wall-clock window (Free plan), so the slow
// OpenAI call lives HERE instead of on Vercel.
//
// Flow: POST /api/menu/import-job (on Vercel) inserts a 'pending' row in
// menu_import_jobs with the file as base64, then fire-and-forgets a POST to this
// function with { jobId }. This function loads the row, sets status='processing',
// runs the OpenAI extraction, and writes status='done' + result (or 'error').
// The dashboard polls GET /api/menu/import-job/[id] until done.
//
// Auth: server-to-server only. The caller must send the service-role key as a
// Bearer token; we also reject if WORKER_SHARED_SECRET is set and mismatched.
// Deploy with: supabase functions deploy menu-extract --no-verify-jwt
//
// This is a Deno port of src/lib/menu/extract.ts. Kept in sync by hand — the
// prompt + allow-lists + normalization are duplicated below. If you change the
// extraction contract, change BOTH files.

import { createClient } from "jsr:@supabase/supabase-js@2";

// --- extraction contract (mirrors src/lib/menu/extract.ts) -----------------

type ExtractedMenuItem = {
  name: string;
  description: string;
  price: number | null;
  currency: string;
  allergens: string[];
  tags: string[];
};
type ExtractedMenuCategory = { name: string; items: ExtractedMenuItem[] };
type ExtractedMenu = {
  categories: ExtractedMenuCategory[];
  uncategorized: ExtractedMenuItem[];
  raw_notes?: string;
};

const MODEL = "gpt-4o";
// gpt-4o allows up to 16384 output tokens. Big multi-page menus can produce a
// lot of JSON; 8000 was truncating them mid-array (parse failure). Use the max.
const MAX_OUTPUT_TOKENS = 16000;
// Bound the OpenAI call so a hung request can't burn the whole 150s window and
// leave the job stuck on 'processing'. Leaves headroom for the status write.
const OPENAI_TIMEOUT_MS = 140_000;

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

// Second-pass prompt — deduces allergens + tags from each dish's name/
// description after the first extraction (vision in particular leaves these
// empty). Mirrors ENRICH_PROMPT in src/lib/menu/extract.ts — keep in sync.
const ENRICH_PROMPT = `Sei un esperto di sicurezza alimentare e cucina. Ricevi un menù già strutturato in JSON (nomi e descrizioni dei piatti) in cui "allergens" e "tags" possono essere vuoti o incompleti.

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
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };

async function callResponses(
  content: ResponseContentBlock[],
  instructions: string = SYSTEM_PROMPT,
): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const payload = {
    model: MODEL,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    instructions,
    input: [{ role: "user", content }],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("openai responses timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openai responses ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  return responsesText(json);
}

function responsesText(res: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}): string {
  if (typeof res.output_text === "string" && res.output_text.length > 0) {
    return res.output_text;
  }
  const parts: string[] = [];
  for (const out of res.output || []) {
    for (const block of out.content || []) {
      if (typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("");
}

// One vision call on a single base64 blob → parsed menu, WITHOUT enrichment.
// Enrichment is a separate text pass we run ONCE at the end (after merging
// chunks), so it isn't repeated per chunk.
async function visionExtractRaw(base64Data: string, mediaType: string): Promise<ExtractedMenu> {
  const isPdf = mediaType === "application/pdf";
  const dataUrl = `data:${mediaType};base64,${base64Data}`;
  const fileBlock: ResponseContentBlock = isPdf
    ? { type: "input_file", filename: "menu.pdf", file_data: dataUrl }
    : { type: "input_image", image_url: dataUrl };
  const raw = await callResponses([
    fileBlock,
    { type: "input_text", text: USER_PROMPT },
  ]);
  return parseExtraction(raw);
}

async function extractMenuFromFile(opts: {
  base64Data: string;
  mediaType: string;
}): Promise<ExtractedMenu> {
  return await enrichAllergensAndTags(await visionExtractRaw(opts.base64Data, opts.mediaType));
}

// Merge several extracted menus (one per PDF page-chunk) into one, preserving
// page order. Categories with the same (case-insensitive, trimmed) name are
// combined so a section split across a chunk boundary doesn't appear twice.
function mergeMenus(parts: ExtractedMenu[]): ExtractedMenu {
  const categories: ExtractedMenuCategory[] = [];
  const byName = new Map<string, ExtractedMenuCategory>();
  const uncategorized: ExtractedMenuItem[] = [];
  const notes: string[] = [];

  for (const part of parts) {
    for (const cat of part.categories || []) {
      const key = (cat.name || "").trim().toLowerCase();
      const existing = key ? byName.get(key) : undefined;
      if (existing) {
        existing.items.push(...(cat.items || []));
      } else {
        const fresh: ExtractedMenuCategory = { name: cat.name, items: [...(cat.items || [])] };
        categories.push(fresh);
        if (key) byName.set(key, fresh);
      }
    }
    if (Array.isArray(part.uncategorized)) uncategorized.push(...part.uncategorized);
    if (part.raw_notes) notes.push(part.raw_notes);
  }

  return {
    categories,
    uncategorized,
    raw_notes: notes.length ? notes.join("\n") : undefined,
  };
}

// Cap concurrent OpenAI calls so a many-chunk menu doesn't trip rate limits or
// spike memory, while still finishing within the worker's 150s wall-clock.
// Running chunks in PARALLEL (not sequentially) is what lets a big menu fit:
// 8 chunks × ~30s sequential = 240s (over the limit), but in 2 waves of 4 ≈ 60s.
const CHUNK_CONCURRENCY = 4;

// Large multi-page image PDF: read page-chunks in bounded-concurrency waves
// (each chunk its own vision call → bounded time + output tokens), preserving
// page order, merge, then enrich ONCE. A chunk that fails is skipped rather
// than failing the whole menu — partial is better than none.
async function extractMenuFromChunks(chunks: string[]): Promise<ExtractedMenu> {
  const parts: ExtractedMenu[] = new Array(chunks.length);
  for (let base = 0; base < chunks.length; base += CHUNK_CONCURRENCY) {
    const wave = chunks.slice(base, base + CHUNK_CONCURRENCY);
    const settled = await Promise.allSettled(
      wave.map((c) => visionExtractRaw(c, "application/pdf"))
    );
    settled.forEach((s, k) => {
      if (s.status === "fulfilled") {
        parts[base + k] = s.value;
      } else {
        console.error(`[menu-extract] chunk ${base + k + 1}/${chunks.length} failed:`, s.reason?.message);
      }
    });
  }
  const ok = parts.filter(Boolean);
  if (ok.length === 0) {
    throw new Error("All page-chunks failed to extract");
  }
  return await enrichAllergensAndTags(mergeMenus(ok));
}

async function extractMenuFromText(text: string): Promise<ExtractedMenu> {
  const trimmed = text.slice(0, 100_000);
  const raw = await callResponses([
    { type: "input_text", text: `${USER_PROMPT}\n\n---MENU TEXT---\n${trimmed}` },
  ]);
  return await enrichAllergensAndTags(parseExtraction(raw));
}

// Second pass: deduce allergens + tags from dish names/descriptions. Mirrors
// enrichAllergensAndTags in src/lib/menu/extract.ts. Defensive: any failure
// returns the menu unchanged (enrichment never loses an extracted menu).
type EnrichSlot = { c: number; i: number; name: string; description: string };

function collectEnrichSlots(menu: ExtractedMenu): EnrichSlot[] {
  const slots: EnrichSlot[] = [];
  menu.categories.forEach((cat, c) =>
    cat.items.forEach((it, i) =>
      slots.push({ c, i, name: it.name, description: it.description })
    )
  );
  menu.uncategorized.forEach((it, i) =>
    slots.push({ c: -1, i, name: it.name, description: it.description })
  );
  return slots;
}

function cleanList(raw: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.toLowerCase().trim())
        .filter((x) => allowed.has(x)),
    ),
  );
}

async function enrichAllergensAndTags(menu: ExtractedMenu): Promise<ExtractedMenu> {
  const slots = collectEnrichSlots(menu);
  if (slots.length === 0) return menu;

  try {
    const payload = JSON.stringify({
      items: slots.map((s) => ({ c: s.c, i: s.i, name: s.name, description: s.description })),
    });
    const raw = await callResponses(
      [
        {
          type: "input_text",
          text:
            `Per ogni item qui sotto restituisci un oggetto JSON ` +
            `{"items":[{"c":number,"i":number,"allergens":string[],"tags":string[]}]} ` +
            `con gli STESSI c,i. Solo JSON.\n\n${payload}`,
        },
      ],
      ENRICH_PROMPT,
    );

    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    }
    const fb = cleaned.indexOf("{");
    const lb = cleaned.lastIndexOf("}");
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

    const byKey = new Map<string, { allergens: string[]; tags: string[] }>();
    for (const e of enriched) {
      const o = (e || {}) as Record<string, unknown>;
      if (typeof o.c !== "number" || typeof o.i !== "number") continue;
      byKey.set(`${o.c}:${o.i}`, {
        allergens: cleanList(o.allergens, ALLOWED_ALLERGENS),
        tags: cleanList(o.tags, ALLOWED_TAGS),
      });
    }

    const applyTo = (it: ExtractedMenuItem, c: number, i: number): ExtractedMenuItem => {
      const hit = byKey.get(`${c}:${i}`);
      if (!hit) return it;
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

function parseExtraction(raw: string): ExtractedMenu {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // The model can hit the output-token cap and return JSON truncated
    // mid-array. Salvage everything that did come through.
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) {
      parsed = repaired;
    } else {
      throw new Error("Menu extraction returned non-JSON (and could not be repaired)");
    }
  }
  return normalizeExtraction(parsed);
}

function repairTruncatedJson(s: string): unknown | null {
  let end = s.length;
  while (end > 0 && !/[}\]"\d]/.test(s[end - 1])) end--;
  let work = s.slice(0, end);
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < work.length; i++) {
    const c = work[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) work += '"';
  work = work.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) {
    work += stack[i] === "{" ? "}" : "]";
  }
  try {
    return JSON.parse(work);
  } catch {
    return null;
  }
}

const ALLOWED_ALLERGENS = new Set([
  "glutine", "latticini", "uova", "pesce", "crostacei", "frutta_secca",
  "arachidi", "soia", "sedano", "senape", "sesamo", "solfiti", "lupini", "molluschi",
]);
const ALLOWED_TAGS = new Set(["vegano", "vegetariano", "piccante", "consigliato", "specialita", "novita"]);

function normalizeExtraction(parsed: unknown): ExtractedMenu {
  const obj = (parsed || {}) as Record<string, unknown>;
  const categories = Array.isArray(obj.categories) ? obj.categories : [];
  const uncategorized = Array.isArray(obj.uncategorized) ? obj.uncategorized : [];
  return {
    categories: categories.map((c) => normalizeCategory(c)),
    uncategorized: uncategorized.map((it) => normalizeItem(it)),
    raw_notes: typeof obj.raw_notes === "string" ? obj.raw_notes : undefined,
  };
}

function normalizeCategory(raw: unknown): ExtractedMenuCategory {
  const obj = (raw || {}) as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  return {
    name: typeof obj.name === "string" ? obj.name.slice(0, 80).trim() : "Senza nome",
    items: items.map((it) => normalizeItem(it)),
  };
}

function normalizeItem(raw: unknown): ExtractedMenuItem {
  const obj = (raw || {}) as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.slice(0, 120).trim() : "";
  const description = typeof obj.description === "string" ? obj.description.slice(0, 600).trim() : "";
  const priceRaw = obj.price;
  let price: number | null = null;
  if (typeof priceRaw === "number" && Number.isFinite(priceRaw)) price = priceRaw;
  else if (typeof priceRaw === "string") {
    const n = Number(priceRaw.replace(",", "."));
    if (Number.isFinite(n)) price = n;
  }
  const currency =
    typeof obj.currency === "string" && obj.currency.length === 3
      ? obj.currency.toUpperCase()
      : "EUR";
  const allergens = Array.isArray(obj.allergens)
    ? Array.from(new Set((obj.allergens as unknown[])
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.toLowerCase().trim())
        .filter((a) => ALLOWED_ALLERGENS.has(a))))
    : [];
  const tags = Array.isArray(obj.tags)
    ? Array.from(new Set((obj.tags as unknown[])
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase().trim())
        .filter((t) => ALLOWED_TAGS.has(t))))
    : [];
  return { name, description, price, currency, allergens, tags };
}

// --- worker ----------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SHARED_SECRET = Deno.env.get("WORKER_SHARED_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Server-to-server auth via a shared secret we fully control (set as a
  // function secret, sent by the Next.js create route as x-worker-secret).
  // We don't gate on the Bearer/service-role token here because the Supabase
  // gateway handles the platform JWT and the exact injected value of
  // SUPABASE_SERVICE_ROLE_KEY isn't guaranteed to equal what the caller sends.
  if (!WORKER_SHARED_SECRET || req.headers.get("x-worker-secret") !== WORKER_SHARED_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let jobId: string | undefined;
  try {
    const body = await req.json();
    jobId = body?.jobId;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!jobId) return new Response("Missing jobId", { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Load the job.
  const { data: job, error: loadErr } = await supabase
    .from("menu_import_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (loadErr || !job) {
    return new Response("Job not found", { status: 404 });
  }
  // Idempotency: if it already finished, do nothing.
  if (job.status === "done" || job.status === "error") {
    return new Response(JSON.stringify({ ok: true, already: job.status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("menu_import_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    let result: ExtractedMenu;
    if (job.source === "text" && typeof job.source_text === "string") {
      result = await extractMenuFromText(job.source_text);
    } else if (Array.isArray(job.file_chunks) && job.file_chunks.length > 0) {
      // Large multi-page image PDF, pre-split into page-chunks by the Node route.
      result = await extractMenuFromChunks(job.file_chunks as string[]);
    } else if (job.file_base64 && job.media_type) {
      result = await extractMenuFromFile({
        base64Data: job.file_base64,
        mediaType: job.media_type,
      });
    } else {
      throw new Error("Job has no file_base64/source_text to extract");
    }

    await supabase
      .from("menu_import_jobs")
      .update({
        status: "done",
        result,
        error: null,
        // Drop the blobs now that we're done so rows don't accumulate megabytes.
        file_base64: null,
        file_chunks: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = (e as Error)?.message || "Extraction failed";
    await supabase
      .from("menu_import_jobs")
      .update({
        status: "error",
        error: message.slice(0, 1000),
        file_base64: null,
        file_chunks: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 200, // 200 so the fire-and-forget caller doesn't retry; status is in the row
      headers: { "Content-Type": "application/json" },
    });
  }
});
