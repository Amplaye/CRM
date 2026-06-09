import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runOnboard, OnboardInput, OnboardProgress } from "@/lib/onboarding/orchestrator";
import { resolveOwnerProvisionTenant } from "@/lib/onboarding/owner-tenant";
import { generateKbArticlesMulti, venueFromQuestionnaire, botConfigFromQuestionnaire, mapsLink, shortenMapsLink, KbQuestionnaire, Lang } from "@/lib/onboarding/kb-generator";
import { featuresFromQuestionnaire } from "@/lib/types/tenant-settings";
import { chatCompletion } from "@/lib/openai-base-url";

// Owner self-serve provisioning. Same engine as the admin wizard
// (/api/admin/onboard → runOnboard), but driven by the restaurant owner for
// THEIR OWN tenant. Clones 16 n8n workflows sequentially; 300s headroom so a
// slow n8n can't kill the run before the final commit (see admin/onboard for
// the full rationale + the early-marker safety net). Fluid Compute allows 800s.
export const maxDuration = 300;

const localeFor = (l: Lang) =>
  l === "it" ? "it-IT" : l === "en" ? "en-GB" : l === "de" ? "de-DE" : "es-ES";

function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

const LANG_NAMES: Record<Lang, string> = {
  es: "Spanish (es-ES)", it: "Italian (it-IT)", en: "English (en-GB)", de: "German (de-DE)",
};

// Translate one short free-text phrase into `target`. The owner writes the
// landmark / cuisine type once in the primary language; for a multilingual KB
// each language block must read them in ITS language. Proper nouns (address,
// city, neighborhood) are intentionally NOT translated — only these descriptive
// prose fields. Best-effort: any failure returns the original so a translation
// hiccup never blocks onboarding (the owner gets the source text, not nothing).
async function translatePhrase(text: string, target: Lang): Promise<string> {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  try {
    const res = await chatCompletion({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            `You are a professional translator for short restaurant info snippets ` +
            `(a landmark/reference point or a cuisine type). ALWAYS translate the input ` +
            `into ${LANG_NAMES[target]}, producing the most idiomatic rendering — never ` +
            `return the source unchanged when it is in another language. Keep proper ` +
            `nouns (street names, place names, monuments) as they are. Output ONLY the ` +
            `translation: no quotes, no labels, no explanation.`,
        },
        { role: "user", content: `Translate to ${LANG_NAMES[target]}: ${trimmed}` },
      ],
    });
    if (!res.ok) return trimmed;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

// Build per-language translations of the free-text prose fields (landmark,
// cuisine_type). `primary` is the language the owner typed them in, so it keeps
// the original text verbatim; every other selected language gets a translation.
async function freeTextTranslations(
  q: KbQuestionnaire,
  selected: Lang[],
  primary: Lang,
): Promise<Partial<Record<Lang, { landmark?: string; cuisine_type?: string }>>> {
  const landmark = (q.landmark || "").trim();
  const cuisine = (q.cuisine_type || "").trim();
  if (!landmark && !cuisine) return {};
  const out: Partial<Record<Lang, { landmark?: string; cuisine_type?: string }>> = {};
  const others = selected.filter((l) => l !== primary);
  // Each language's two fields in parallel; languages also resolve concurrently.
  await Promise.all(
    others.map(async (lang) => {
      const [lm, cz] = await Promise.all([
        translatePhrase(landmark, lang),
        translatePhrase(cuisine, lang),
      ]);
      out[lang] = { landmark: lm, cuisine_type: cz };
    }),
  );
  return out;
}

interface SelfServeBody {
  restaurant_name: string;
  restaurant_phone: string;
  owner_phone: string;
  language?: Lang; // legacy single-language hint (still honoured)
  languages?: Lang[]; // assistant speaks these; languages[0] is the primary one
  crm_locale?: Lang; // the single language the owner's dashboard will be in
  timezone: string;
  review_url?: string;
  opening_hours: Record<string, Array<{ open: string; close: string }>>;
  questionnaire: KbQuestionnaire;
  tenant_id?: string; // optional hint; the resolver still proves ownership
}

export async function POST(req: Request) {
  // 1. Authenticate the caller (cookie session).
  const authClient = await createServerSupabaseClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as SelfServeBody;

  // 2. CONTROLLO FERREO — resolve which tenant this user may provision from
  //    their own memberships. The tenant id is never trusted from the body
  //    unless it is proven to be one the caller owns.
  const svc = createServiceRoleClient();
  const { data: memberships, error: memErr } = await svc
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user.id);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const resolved = resolveOwnerProvisionTenant(memberships || [], body.tenant_id);
  if (!resolved.ok) {
    const status = resolved.reason === "forbidden_tenant" ? 403 : 400;
    return NextResponse.json({ error: resolved.reason }, { status });
  }
  const tenantId = resolved.tenantId;

  // 3. Idempotency: never double-provision (would orphan Vapi/n8n resources).
  const { data: tenant } = await svc
    .from("tenants").select("id, settings").eq("id", tenantId).single();
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  // Block re-provisioning ONLY when onboarding actually COMPLETED. Keying this on
  // the mere presence of a Vapi assistant id was wrong: a run that died after the
  // assistant was created (e.g. the connection dropped during the n8n clone) left
  // an assistantId behind, so every retry was rejected with 409 and the owner
  // could never finish — they'd be stuck. The orchestrator is fully idempotent
  // (it reuses the existing assistant / tables / KB / workflows), so a retry on an
  // incomplete tenant is safe and is exactly what recovers a truncated run.
  if ((tenant.settings as any)?.onboarding?.completed) {
    return NextResponse.json({ error: "already_provisioned" }, { status: 409 });
  }

  // 4. Build the orchestrator input. KB articles are generated server-side from
  //    the fixed-field questionnaire (the client never ships free-text). The
  //    voice prompt is omitted on purpose → orchestrator builds it from the
  //    agency template.
  // The assistant can speak several languages. languages[0] is the primary one
  // (drives voice prompt, locale and greeting); the KB is built in every one.
  const ALL: Lang[] = ["es", "it", "en", "de"];
  const langs = (Array.isArray(body.languages) ? body.languages : [body.language])
    .filter((l): l is Lang => !!l && ALL.includes(l));
  const selected: Lang[] = langs.length ? Array.from(new Set(langs)) : ["es"];
  const lang = selected[0];
  // CRM dashboard language — a single locale, independent of the assistant
  // languages. Falls back to the primary assistant language if not provided.
  const crmLocale: Lang = ALL.includes(body.crm_locale as Lang) ? (body.crm_locale as Lang) : lang;
  // Translate the free-text prose fields (landmark, cuisine type) into every
  // selected language so each KB language block reads them in its own language
  // instead of repeating the owner's original wording. Best-effort.
  const freeTextByLang = await freeTextTranslations(body.questionnaire, selected, lang);
  const kbArticles = generateKbArticlesMulti(body.questionnaire, {
    restaurant_name: body.restaurant_name,
    restaurant_phone: body.restaurant_phone || "",
    opening_hours: body.opening_hours || {},
  }, selected, freeTextByLang);
  // Slug carries a tenant-id suffix so two restaurants with the same name never
  // collide on n8n webhook paths.
  const slug = `${slugify(body.restaurant_name) || "resto"}-${tenantId.slice(0, 4)}`;

  // Pre-generate a SHORT Maps link (da.gd) so the WhatsApp recap shows the street name
  // + a tiny link instead of a giant URL. Best-effort: if da.gd is slow/down we store the
  // venue without maps_short and the bot falls back to the long URL. Idempotency key
  // (maps_short_src) lets scripts/venue-maps-short.mjs refresh it later if the address changes.
  const venue = venueFromQuestionnaire(body.questionnaire);
  const longMaps = mapsLink(venue.address, venue.city);
  if (longMaps) {
    const short = await shortenMapsLink(longMaps);
    if (short) { venue.maps_short = short; venue.maps_short_src = longMaps; }
  }

  const input: OnboardInput = {
    restaurant_name: body.restaurant_name,
    slug,
    restaurant_phone: (body.restaurant_phone || "").trim(),
    owner_phone: (body.owner_phone || "").trim(),
    timezone: body.timezone || "Atlantic/Canary",
    locale: localeFor(lang),
    language: lang,
    crm_locale: crmLocale,
    review_url: (body.review_url || "").trim(),
    opening_hours: body.opening_hours || {},
    last_reservation_offset: {
      lunch: body.questionnaire.last_lunch_offset_min,
      dinner: body.questionnaire.last_dinner_offset_min,
    },
    // Seat the starter floor plan from the declared capacity so Tables == KB.
    capacity_seats: body.questionnaire?.capacity_seats || 12,
    // Feature flags derived from the wizard answers, so Settings → Features
    // opens already matching what the owner said (e.g. "no terrace" → OFF).
    features: featuresFromQuestionnaire(body.questionnaire, selected.length),
    // Booking-confirmation venue subset (address/parking/deposit/cancellation +
    // pre-shortened maps link), persisted on the tenant so /api/ai/book can echo it.
    venue,
    // Booking-policy thresholds the cloned n8n bot reads from settings.bot_config
    // (large-group / block sizes + last-reservation offset). Without these the bot
    // fell back to its hardcoded Picnic defaults and ignored the wizard answers.
    booking_policy: botConfigFromQuestionnaire(body.questionnaire),
    kb_articles: kbArticles,
    // voice_prompt intentionally omitted → built from the agency template.
    owner_email: user.email || "",
    owner_password: "", // unused: owner already exists
    owner_name: (user.user_metadata as any)?.name || "",
    tenant_id: tenantId,
    owner_user_id: user.id,
    self_serve: true,
  };

  // 5. Stream progress over SSE so the wizard shows a live step log.
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (p: OnboardProgress) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`)); } catch { /* client gone */ }
      };
      // The stream MUST always emit a terminal `result` event and close, on every
      // path. If it doesn't, the wizard's read loop never sees the end and sits on
      // the loading screen forever (the "loaded to infinity" bug). runOnboard
      // already catches its own errors, but we guard here too so even an unexpected
      // throw can't leave the stream — and thus the UI — hanging open.
      try {
        const result = await runOnboard(input, emit);
        emit({ step: "result", message: "final", ok: result.ok, data: result } as OnboardProgress);
      } catch (e: any) {
        emit({ step: "error", message: e?.message || String(e), ok: false });
        emit({ step: "result", message: "final", ok: false } as OnboardProgress);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
