// Voice "motore unico" — the single engine that serves EVERY tenant's voice
// calls, the exact analogue of the WhatsApp chat engine (one n8n workflow,
// tenant injected per message).
//
// There is ONE shared Vapi assistant (the ENGINE). Nothing tenant-specific is
// baked into it. On every call we compose the tenant's system prompt FRESH from
// the single source of truth:
//   - buildVoicePrompt(...)  — the agency's behavioural template, in CODE
//   - the tenant's published KB articles + opening hours, from the DB
// and hand it to Vapi as assistantOverrides at call-start (web) or as a
// transient assistant (inbound phone). Because the prompt is regenerated on
// every call, changing the code template OR any DB value (menu/hours/KB/policy)
// is reflected on the NEXT call for ALL tenants automatically — no per-tenant
// clone, no re-sync, no hand-patching.
//
// Tenant resolution inside the n8n voice webhooks no longer relies on a
// per-tenant assistantId (there is only one now): we stamp metadata.tenant_id
// on the call here, and the webhook reads it back.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildVoicePrompt, type OpeningHours } from "@/lib/onboarding/voice-prompt";
import { composeVapiSystemPrompt, isPromptArticle, type VapiKbArticle } from "@/lib/onboarding/vapi";
import { extractArticleLang } from "@/lib/onboarding/kb-generator";
import {
  resolveVoicemailState,
  buildVoicemailBlock,
  injectBlock,
  voicemailFirstMessage,
  transferCallTool,
  type VoicemailConfig,
  type VoicemailState,
} from "@/lib/voice/voicemail";

// The shared engine assistant. Defaults to the former golden-source template
// ("PICNIC - Sofía"), which already carries the right voice/transcriber/tools.
// Overridable per environment.
export const ENGINE_VAPI_ASSISTANT_ID =
  process.env.VAPI_ENGINE_ASSISTANT_ID ||
  process.env.VAPI_TEMPLATE_ASSISTANT_ID ||
  "6c92f776-abb2-4175-8a55-45d76ec01d1a";

/** Date variables the prompt header expects, already spelled out in full. */
export interface VoiceDateVars {
  current_date?: string; // e.g. "lunes 1 de junio de 2026"
  tomorrow_date?: string;
  current_time?: string; // e.g. "11:15"
  from_number?: string; // caller's number; empty/placeholder on web calls
}

/** A bare 2-letter language code from a locale ("it-IT" -> "it"). */
function langOf(locale?: string): "es" | "it" | "en" | "de" {
  const c = (locale || "").slice(0, 2).toLowerCase();
  return c === "it" || c === "en" || c === "de" ? c : "es";
}

/**
 * The locale to GREET in, derived from the caller's phone number when we can
 * recognise its country prefix — so a foreign tourist hears the opener in their
 * own language even though the venue's default is another. Only the four
 * supported languages are mapped (it/es/en/de); every other prefix (and any
 * unrecognisable/blank number) falls back to the venue's own locale, which is
 * also what web calls always use (no number).
 *
 * This sets only the OPENING language (greeting + the model's default). The
 * transcriber stays multilingual, so the conversation still follows whatever
 * language the caller actually speaks after the greeting.
 *
 * Prefixes are matched longest-first. We deliberately map only a handful of
 * unambiguous, high-traffic country codes per language rather than the whole
 * ITU list: a wrong guess greets a local in a foreign tongue, so we stay
 * conservative and let anything uncertain fall through to the venue locale.
 */
const PHONE_PREFIX_LOCALE: Array<[string, string]> = [
  // English-speaking (longer codes first so e.g. +1 doesn't shadow +1-...)
  ["+44", "en-GB"], // UK
  ["+353", "en-GB"], // Ireland
  ["+1", "en-GB"], // US/Canada
  ["+61", "en-GB"], // Australia
  ["+64", "en-GB"], // New Zealand
  // German-speaking
  ["+49", "de-DE"], // Germany
  ["+43", "de-DE"], // Austria
  ["+41", "de-DE"], // Switzerland (de is the plurality language)
  // Spanish-speaking
  ["+34", "es-ES"], // Spain
  ["+52", "es-ES"], // Mexico
  ["+54", "es-ES"], // Argentina
  ["+57", "es-ES"], // Colombia
  ["+56", "es-ES"], // Chile
  // Italian
  ["+39", "it-IT"], // Italy
];

/**
 * Pure: map a caller's phone number to a greeting locale, or undefined if the
 * prefix isn't one we map (caller should then be greeted in the venue's locale).
 * Tolerates "00"-prefixed international form and spaces/dashes in the number.
 */
export function localeFromPhonePrefix(rawNumber?: string): string | undefined {
  if (!rawNumber) return undefined;
  // Normalise: strip spaces/dashes/parens, turn a leading "00" into "+".
  let n = rawNumber.replace(/[\s\-().]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (!n.startsWith("+")) return undefined; // no country code -> can't tell
  // Longest prefix wins (sort by length desc once, here).
  const sorted = [...PHONE_PREFIX_LOCALE].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, locale] of sorted) {
    if (n.startsWith(prefix)) return locale;
  }
  return undefined;
}

/** The four languages the system supports, with the tenant's primary first.
 * Gladia restricts auto-detection to exactly this set (so it never drifts to an
 * unrelated language like Hindi the way Deepgram "multi" did), while still
 * adapting to whichever of the four the caller speaks. Primary-first biases
 * detection toward the venue's own language for borderline (it/es) audio. */
function candidateLanguages(locale?: string): string[] {
  const primary = langOf(locale);
  return [primary, ...["it", "es", "en", "de"].filter((l) => l !== primary)];
}

/** Human language name for the per-call default-language directive in the
 * prompt (so the model defaults to the venue's language, not the Spanish the
 * prompt happens to be written in). */
function languageName(locale?: string): string {
  return { it: "italiano", es: "español", en: "English", de: "Deutsch" }[langOf(locale)];
}

/** The short "one moment" filler Vapi plays while a tool runs, in the call's
 * language. The engine assistant's tool request-start messages are a single
 * "{{filler}}" template, so this value (not Vapi's own language detection, which
 * defaulted to English) decides the language — no more English "One moment." on
 * an Italian call. */
export function fillerFor(locale?: string): string {
  return { it: "Un attimo.", es: "Un momento.", en: "One moment.", de: "Einen Moment." }[langOf(locale)];
}

/** The idle nudge Vapi plays after a few seconds of caller silence ("are you
 * still there?"), in the call's language. Fed to the engine's messagePlan idle
 * message as the "{{idle_prompt}}" template, same per-call mechanism as the
 * filler so it's never the wrong language. */
export function idlePromptFor(locale?: string): string {
  return {
    it: "Sei ancora lì?",
    es: "¿Sigues ahí?",
    en: "Are you still there?",
    de: "Bist du noch da?",
  }[langOf(locale)];
}

const BCP47: Record<string, string> = { es: "es-ES", it: "it-IT", en: "en-GB", de: "de-DE" };

/**
 * Pure: the spelled-out date variables the prompt header reads, in the tenant's
 * timezone + language (e.g. "lunes 1 de junio de 2026"). Computed server-side so
 * the date is single-sourced too (the widget no longer formats dates). `now` is
 * injected for testability.
 */
export function spelledDateVars(now: Date, timezone?: string, locale?: string): VoiceDateVars {
  const bcp = BCP47[langOf(locale)] || "es-ES";
  const tz = timezone || "Atlantic/Canary";
  const full = (d: Date) =>
    new Intl.DateTimeFormat(bcp, {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz,
    }).format(d);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const current_time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  }).format(now);
  return { current_date: full(now), tomorrow_date: full(tomorrow), current_time };
}

/** The assistant's own name (the voice persona), spoken in the greeting. */
export const ASSISTANT_NAME = "Sofía";

/** The LLM the engine runs. Read LIVE from the Vapi engine assistant — the Vapi
 * dashboard is the single source of truth for the model. Nothing is hardcoded
 * here except a fallback used only if Vapi is unreachable. */
export interface EngineModel {
  provider: string;
  model: string;
}

// Fallback only — the real value comes from the dashboard via fetchEngineModel.
// gpt-4.1 (NOT a mini, NOT a reasoning model): no audible reasoning pauses, clean
// Italian, and it actually obeys "call tools silently" — gpt-5-mini broke all
// three (garbled Italian, reasoning pauses, narrated before tools → Vapi silence).
const FALLBACK_ENGINE_MODEL: EngineModel = { provider: "openai", model: "gpt-4.1" };

let _engineModelCache: { value: EngineModel; at: number } | null = null;
const ENGINE_MODEL_TTL_MS = 60_000;

/** The Vapi REST bearer token, tolerating the quoted form some envs store. */
function vapiPrivateKey(): string {
  return (process.env.VAPI_PRIVATE_KEY || "").replace(/^"|"$/g, "").trim();
}

/**
 * Read the engine assistant's configured model from Vapi so the dashboard is the
 * single source of truth: change the model there and the next call uses it, with
 * no code change. Cached briefly (60s) to avoid a Vapi round-trip per call.
 * Falls back to the last cached value, then FALLBACK_ENGINE_MODEL, so a Vapi
 * hiccup never breaks call setup. `now`/`fetchImpl` injected for testing.
 */
export async function fetchEngineModel(
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<EngineModel> {
  if (_engineModelCache && now - _engineModelCache.at < ENGINE_MODEL_TTL_MS) {
    return _engineModelCache.value;
  }
  const key = vapiPrivateKey();
  if (!key) return _engineModelCache?.value || FALLBACK_ENGINE_MODEL;
  try {
    const res = await fetchImpl(`https://api.vapi.ai/assistant/${ENGINE_VAPI_ASSISTANT_ID}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return _engineModelCache?.value || FALLBACK_ENGINE_MODEL;
    const a: any = await res.json();
    const provider = a?.model?.provider;
    const model = a?.model?.model;
    if (provider && model) {
      const value: EngineModel = { provider, model };
      _engineModelCache = { value, at: now };
      return value;
    }
  } catch {
    /* network/parse error — fall through to fallback */
  }
  return _engineModelCache?.value || FALLBACK_ENGINE_MODEL;
}

/** Pure: the spoken greeting, in the tenant's primary language. The assistant
 * introduces herself by name + the venue she works for. The IDIOMAS rule still
 * switches language on the caller's first turn; this is only the opener. */
export function greetingFor(name: string, locale?: string): string {
  const n = name || "el restaurante";
  const a = ASSISTANT_NAME;
  switch (langOf(locale)) {
    case "it":
      return `Ciao, sono ${a}, l'assistente di ${n}. Come posso aiutarti?`;
    case "en":
      return `Hi, I'm ${a}, the assistant for ${n}. How can I help you?`;
    case "de":
      return `Hallo, ich bin ${a}, die Assistentin von ${n}. Wie kann ich dir helfen?`;
    default:
      return `Hola, soy ${a}, la asistente de ${n}. ¿En qué te puedo ayudar?`;
  }
}


export interface ComposedTenantPrompt {
  systemPrompt: string;
  name: string;
  locale?: string;
  timezone?: string;
  /** Resolved voicemail state for THIS call ("normal" unless the tenant has the
   * segreteria enabled and currently active/forwarding). Drives the spoken
   * opener and the transfer tool in the assistant overrides. */
  voicemailState?: VoicemailState;
  /** Owner phone to transfer to when voicemailState === "forward". */
  forwardPhone?: string;
}

/**
 * Compose a tenant's full voice system prompt from the single source of truth:
 * the CODE template (buildVoicePrompt, which now carries every behavioural rule
 * including the anti-fraud + privacy guardrails) plus the tenant's live opening
 * hours and published KB articles from the DB. The stored "VOICE PROMPT" KB
 * article (a frozen onboarding snapshot) is intentionally IGNORED as the
 * behaviour source — code is the source — but is excluded from the KB block too.
 */
export async function composeTenantVoicePrompt(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  now: Date = new Date(),
): Promise<ComposedTenantPrompt> {
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, settings")
    .eq("id", tenantId)
    .single();
  if (tErr || !tenant) throw new Error(`Tenant ${tenantId} not found`);

  const settings = (tenant.settings || {}) as {
    timezone?: string;
    locale?: string;
    opening_hours?: OpeningHours;
    restaurant_phone?: string;
    description?: string;
    vapi_voicemail?: VoicemailConfig;
  };

  // The venue's real seating zones, derived from its tables — so the agent only
  // asks "inside or outside?" when the venue actually HAS both (Oraz is
  // indoor-only; asking it, then proposing non-existent outdoor slots, was a bug).
  const { data: tableRows } = await supabase
    .from("restaurant_tables")
    .select("zone")
    .eq("tenant_id", tenantId);
  const zoneSet = new Set<string>(
    ((tableRows || []) as { zone?: string | null }[])
      .map((r) => r.zone)
      .filter((z): z is string => !!z),
  );
  const zones = (["inside", "outside"] as const).filter((z) => zoneSet.has(z));

  const voicePromptBody = buildVoicePrompt({
    restaurant_name: tenant.name,
    language: langOf(settings.locale),
    opening_hours: settings.opening_hours || {},
    restaurant_phone: settings.restaurant_phone,
    timezone: settings.timezone,
    description: settings.description,
    zones: [...zones],
  });

  const { data: articles, error: aErr } = await supabase
    .from("knowledge_articles")
    .select("title, content, category")
    .eq("tenant_id", tenantId)
    .eq("status", "published");
  if (aErr) throw aErr;

  // Inject the KB in ONE language — the call's own (the tenant's primary). The
  // articles are stored merged ("[Italiano]…[Español]…[English]"); shipping all
  // three tripled the prompt and primed the model to leak the other languages.
  // The agent translates these facts to the caller just like it does tool JSON.
  const primaryLang = langOf(settings.locale);
  const kbArticles: VapiKbArticle[] = ((articles || []) as VapiKbArticle[])
    .filter((a) => a && a.title && !isPromptArticle(a.title) && (a.content || "").trim())
    .map((a) => ({ ...a, content: extractArticleLang(a.content || "", primaryLang) }))
    .filter((a) => (a.content || "").trim());

  let systemPrompt = composeVapiSystemPrompt({ voicePromptBody, kbArticles });

  // Voicemail / "segreteria": when the tenant has it enabled it OVERRIDES the
  // reservation agent for this call. This is the SAME block the legacy per-tenant
  // sync route injects into a dedicated assistant — composed here into the
  // per-call prompt so the feature finally works on the shared "motore unico"
  // too (it used to be a no-op for engine tenants). active/forward are resolved
  // against the venue's timezone + the current time (so "scheduled" honours the
  // slots); "normal" leaves the prompt untouched.
  const vm = settings.vapi_voicemail;
  const { state: voicemailState, active, forward, forwardPhone } = resolveVoicemailState(
    vm,
    settings.timezone || "Atlantic/Canary",
    now,
  );
  if (vm && (active || forward)) {
    systemPrompt = injectBlock(systemPrompt, buildVoicemailBlock(active, vm));
  }

  return {
    systemPrompt,
    name: tenant.name,
    locale: settings.locale,
    timezone: settings.timezone,
    voicemailState,
    forwardPhone,
  };
}

/**
 * Pure: assemble the Vapi assistantOverrides object for a call from an already
 * composed prompt. Stamps metadata.tenant_id so the n8n voice webhooks can
 * resolve the tenant (one engine assistant serves all tenants, so the
 * assistantId is no longer a tenant discriminator).
 */
export function buildAssistantOverrides(
  composed: ComposedTenantPrompt,
  tenantId: string,
  dateVars: VoiceDateVars = {},
  model: EngineModel = FALLBACK_ENGINE_MODEL,
  greetLocale?: string,
): Record<string, any> {
  // The language we OPEN in. When the caller's phone prefix is recognised we
  // greet in their language (a foreign tourist hears their own tongue); else we
  // fall back to the venue's own locale. This drives only the greeting + the
  // model's starting language — the transcriber stays multilingual so the
  // conversation follows whatever the caller actually speaks afterwards.
  const openLocale = greetLocale || composed.locale;
  // Voicemail/forward overrides the spoken opener; "normal" keeps the greeting.
  const vmFirst =
    composed.voicemailState && composed.voicemailState !== "normal"
      ? voicemailFirstMessage(composed.voicemailState, composed.name, langOf(openLocale))
      : null;
  return {
    firstMessage: vmFirst || greetingFor(composed.name, openLocale),
    metadata: { tenant_id: tenantId },
    // spoken_language drives the prompt's per-call default-language directive so
    // the agent opens (and stays) in the caller's/venue's language instead of
    // defaulting to the Spanish the prompt is written in.
    variableValues: {
      ...dateVars,
      spoken_language: languageName(openLocale),
      filler: fillerFor(openLocale),
      idle_prompt: idlePromptFor(openLocale),
    },
    // Transcriber: Gladia solaria-1, restricted to the four supported languages.
    // Deepgram "multi" spanned 10 languages and drifted (it transcribed clear
    // Italian audio with spurious Hindi/Devanagari mid-sentence), which then
    // pushed the model to Spanish. Gladia detects among ONLY {it,es,en,de}, so it
    // stays multilingual (adapts to the caller) but can never wander to an
    // unrelated language. Primary-first list biases borderline it/es audio toward
    // the venue's own language. Premium STT, deliberately chosen for reliability.
    transcriber: {
      provider: "gladia",
      model: "solaria-1",
      languages: candidateLanguages(composed.locale),
    },
    // The model is whatever the Vapi engine assistant is set to (read live by
    // fetchEngineModel — the dashboard is the source of truth, nothing pinned in
    // code). We still must send a model object here because Vapi requires
    // provider+model to accept the per-tenant system prompt (messages); it
    // inherits temperature/maxTokens from the base assistant via deep-merge.
    model: {
      provider: model.provider,
      model: model.model,
      messages: [{ role: "system", content: composed.systemPrompt }],
      // In FORWARD state the agent must transfer to the owner — give it the tool
      // for this call (it only needs transferCall; booking tools are inert here).
      ...(composed.voicemailState === "forward" && composed.forwardPhone
        ? { tools: [transferCallTool(composed.forwardPhone)] }
        : {}),
    },
  };
}

/**
 * Convenience: compose prompt + overrides for a tenant in one call. Date vars
 * are computed from the TENANT's own timezone + language (single source — the
 * caller/widget only needs the tenant_id); `extraVars` (e.g. from_number) is
 * merged on top. `now` is injectable for testing.
 *
 * `callerNumber` is the number the customer is calling FROM (inbound phone). If
 * its country prefix maps to one of the four supported languages we greet in
 * that language (a foreign tourist hears their own tongue); otherwise — and on
 * web calls, which have no caller number — we greet in the venue's own locale.
 * Dates always stay in the venue's tz/locale (they're spoken in the venue's
 * timezone); only the greeting + the model's opening language follow the caller.
 */
export async function buildTenantCallConfig(
  tenantId: string,
  extraVars: VoiceDateVars = {},
  now: Date = new Date(),
  callerNumber?: string,
): Promise<{
  assistantId: string;
  assistantOverrides: Record<string, any>;
  /** Resolved voicemail state for this call — lets the webhook fire the
   * call_followup WhatsApp when the segreteria ("active") answered. */
  voicemailState?: VoicemailState;
  /** The venue name (template variable for the follow-up message). */
  restaurantName: string;
  /** Language to send the follow-up template in (caller prefix, else venue). */
  lang: "es" | "it" | "en" | "de";
}> {
  const supabase = createServiceRoleClient();
  const composed = await composeTenantVoicePrompt(supabase, tenantId, now);
  // Populate {{from_number}} so the prompt's phone step is grounded in reality:
  // the REAL caller line on inbound phone calls (the agent may then offer to use
  // it for the WhatsApp confirmation), and an explicit EMPTY string on web calls
  // (no caller id) so the placeholder never leaks into the prompt and the agent
  // asks for the number instead of inventing one. Without this the variable was
  // never substituted at all, so the model once filled book_table.telefono with
  // the venue's OWN backup phone — sending the confirmation to the restaurant.
  const dateVars = {
    ...spelledDateVars(now, composed.timezone, composed.locale),
    from_number: callerNumber || "",
    ...extraVars,
  };
  const model = await fetchEngineModel();
  const greetLocale = localeFromPhonePrefix(callerNumber);
  return {
    assistantId: ENGINE_VAPI_ASSISTANT_ID,
    assistantOverrides: buildAssistantOverrides(composed, tenantId, dateVars, model, greetLocale),
    voicemailState: composed.voicemailState,
    restaurantName: composed.name,
    lang: langOf(greetLocale || composed.locale),
  };
}
