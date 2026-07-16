import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// AI pairing for the "import dish photos from the PDF" feature.
// ---------------------------------------------------------------------------
// The client has already (a) extracted the menu, (b) pulled the candidate dish
// images out of the PDF and encoded each as a small WebP data URL. This route
// shows gpt-4o ALL the candidate images at once plus the list of dish names,
// and asks it to say which dish (if any) each image depicts. It returns only
// the pairing decision — the client owns the pixels and does the upload.
//
// Why a separate vision call instead of doing this in the worker: the worker
// never has the per-image bytes (it splits PDFs with pdf-lib, which preserves
// images inside page-PDFs but doesn't extract them). The browser does. So the
// whole photo flow is additive and never touches the proven text-extraction
// path.

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'gpt-4o';
// One image ≈ a few hundred output tokens of JSON at most; the response is a
// compact index→name map, so this is plenty.
const MAX_OUTPUT_TOKENS = 4000;
// Guardrails: keep one request bounded so a pathological PDF can't blow the
// 60s Vercel window or the OpenAI payload limit. The client also caps these.
const MAX_IMAGES = 60;
const MAX_DISHES = 400;

type Body = {
  tenant_id: string;
  // Candidate images as data URLs (image/webp), in the client's candidate
  // order. Index in this array is the handle the model uses.
  images: string[];
  // All dish names in the extracted menu (any order; names are the join key).
  dishes: string[];
};

const SYSTEM_PROMPT = `Sei un assistente che abbina FOTO DI PIATTI ai nomi dei piatti di un menù.

Ricevi:
- una lista numerata di IMMAGINI (indice 0,1,2,...), ciascuna è una foto ritagliata da un menù PDF;
- la lista dei NOMI dei piatti del menù.

Per OGNI immagine decidi quale piatto rappresenta, scegliendo SOLO tra i nomi forniti.
Regole:
- Se un'immagine è chiaramente un piatto e corrisponde a un nome della lista, abbinala a QUEL nome (copialo identico).
- Se un'immagine NON è cibo (logo, sfondo, decorazione, bandiera, icona, texture) oppure è cibo ma non corrisponde con sicurezza a nessun nome della lista, restituisci dish = null.
- Non inventare nomi non presenti nella lista. Non abbinare due immagini molto diverse allo stesso piatto a meno che siano davvero lo stesso piatto.
- Nel dubbio tra "abbinamento incerto" e "null", preferisci null: l'utente correggerà a mano, ma un abbinamento sbagliato è peggio.

Output: SOLO JSON valido, nessun markdown, nessun commento, in questa forma:
{"pairs":[{"image":0,"dish":"Nome esatto dal menù"},{"image":1,"dish":null}, ...]}
Includi una voce per OGNI immagine ricevuta, nell'ordine degli indici.`;

type ResponseContentBlock =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

function responsesText(res: ResponsesApiResponse): string {
  if (typeof res.output_text === 'string' && res.output_text.length > 0) return res.output_text;
  const parts: string[] = [];
  for (const out of res.output || []) {
    for (const block of out.content || []) {
      if (typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('');
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (
    !body ||
    typeof body.tenant_id !== 'string' ||
    !Array.isArray(body.images) ||
    !Array.isArray(body.dishes)
  ) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const images = body.images
    .filter((s): s is string => typeof s === 'string' && s.startsWith('data:image/'))
    .slice(0, MAX_IMAGES);
  const dishes = body.dishes
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, MAX_DISHES);

  // Nothing to do — return an empty pairing rather than calling the model.
  if (images.length === 0 || dishes.length === 0) {
    return NextResponse.json({ pairs: [] });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Photos are a best-effort enhancement; if the key is missing, fail soft so
    // the import (text/prices/allergens) still completes without photos.
    return NextResponse.json({ pairs: [], degraded: 'no_openai_key' });
  }

  const content: ResponseContentBlock[] = [];
  images.forEach((dataUrl, idx) => {
    content.push({ type: 'input_text', text: `IMMAGINE ${idx}:` });
    content.push({ type: 'input_image', image_url: dataUrl });
  });
  content.push({
    type: 'input_text',
    text:
      `NOMI DEI PIATTI DEL MENÙ (scegli SOLO tra questi):\n` +
      dishes.map((d) => `- ${d}`).join('\n') +
      `\n\nRestituisci il JSON {"pairs":[...]} con una voce per ogni IMMAGINE (0..${images.length - 1}).`,
  });

  let raw: string;
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json(
        { pairs: [], degraded: 'openai_error', detail: detail.slice(0, 300) },
        { status: 200 }
      );
    }
    raw = responsesText((await res.json()) as ResponsesApiResponse);
  } catch (e) {
    return NextResponse.json(
      { pairs: [], degraded: 'openai_throw', detail: (e as Error)?.message?.slice(0, 300) },
      { status: 200 }
    );
  }

  // Parse the {"pairs":[{image,dish}]} JSON tolerantly.
  const pairs = parsePairs(raw, images.length, dishes);
  return NextResponse.json({ pairs });
}

type Pair = { image: number; dish: string | null };

function parsePairs(raw: string, imageCount: number, dishes: string[]): Pair[] {
  let cleaned = (raw || '').trim();
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
    return [];
  }
  const obj = (parsed || {}) as { pairs?: unknown };
  if (!Array.isArray(obj.pairs)) return [];

  // Only accept dish names that are actually in the menu (defends against the
  // model inventing a name); index must be in range. Dedupe by image index.
  const dishSet = new Set(dishes);
  const seen = new Set<number>();
  const out: Pair[] = [];
  for (const p of obj.pairs) {
    const o = (p || {}) as Record<string, unknown>;
    const image = typeof o.image === 'number' ? o.image : NaN;
    if (!Number.isInteger(image) || image < 0 || image >= imageCount || seen.has(image)) continue;
    seen.add(image);
    const dish =
      typeof o.dish === 'string' && dishSet.has(o.dish) ? o.dish : null;
    out.push({ image, dish });
  }
  return out;
}
