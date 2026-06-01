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
const MAX_OUTPUT_TOKENS = 8000;
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
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };

async function callResponses(content: ResponseContentBlock[]): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const payload = {
    model: MODEL,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    instructions: SYSTEM_PROMPT,
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

async function extractMenuFromFile(opts: {
  base64Data: string;
  mediaType: string;
}): Promise<ExtractedMenu> {
  const isPdf = opts.mediaType === "application/pdf";
  const dataUrl = `data:${opts.mediaType};base64,${opts.base64Data}`;
  const fileBlock: ResponseContentBlock = isPdf
    ? { type: "input_file", filename: "menu.pdf", file_data: dataUrl }
    : { type: "input_image", image_url: dataUrl };
  const raw = await callResponses([
    fileBlock,
    { type: "input_text", text: USER_PROMPT },
  ]);
  return parseExtraction(raw);
}

async function extractMenuFromText(text: string): Promise<ExtractedMenu> {
  const trimmed = text.slice(0, 100_000);
  const raw = await callResponses([
    { type: "input_text", text: `${USER_PROMPT}\n\n---MENU TEXT---\n${trimmed}` },
  ]);
  return parseExtraction(raw);
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
  } catch (err) {
    throw new Error(`Menu extraction returned non-JSON: ${String(err).slice(0, 200)}`);
  }
  return normalizeExtraction(parsed);
}

const ALLOWED_ALLERGENS = new Set([
  "glutine", "latticini", "uova", "pesce", "crostacei", "frutta_secca",
  "arachidi", "soia", "sedano", "senape", "sesamo", "solfiti", "lupini", "molluschi",
]);
const ALLOWED_TAGS = new Set(["vegano", "vegetariano", "piccante", "consigliato"]);

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
        // Drop the blob now that we're done so rows don't accumulate megabytes.
        file_base64: null,
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 200, // 200 so the fire-and-forget caller doesn't retry; status is in the row
      headers: { "Content-Type": "application/json" },
    });
  }
});
