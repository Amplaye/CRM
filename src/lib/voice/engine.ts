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

/** Pure: the spoken greeting, in the tenant's primary language. The IDIOMAS rule
 * still switches language on the caller's first turn; this is only the opener. */
export function greetingFor(name: string, locale?: string): string {
  const n = name || "el restaurante";
  switch (langOf(locale)) {
    case "it":
      return `Ciao, ${n}, benvenuto! Come posso aiutarti?`;
    case "en":
      return `Hello, ${n}, welcome! How can I help you?`;
    case "de":
      return `Hallo, ${n}, willkommen! Wie kann ich dir helfen?`;
    default:
      return `¡Hola, ${n}, bienvenido! ¿En qué te puedo ayudar?`;
  }
}

/** Pure: transcriber keywords so the STT recognises the venue name + the few
 * domain words. Base list mirrors the template; the venue name tokens are added
 * so each tenant's name transcribes cleanly. */
export function transcriberKeywords(name: string): string[] {
  const base = ["interior", "exterior", "terraza", "reserva", "Confirmo", "Cancelar"];
  const nameTokens = (name || "")
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length >= 3);
  return Array.from(new Set([...nameTokens, ...base]));
}

export interface ComposedTenantPrompt {
  systemPrompt: string;
  name: string;
  locale?: string;
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
  };

  const voicePromptBody = buildVoicePrompt({
    restaurant_name: tenant.name,
    language: langOf(settings.locale),
    opening_hours: settings.opening_hours || {},
    restaurant_phone: settings.restaurant_phone,
    timezone: settings.timezone,
    description: settings.description,
  });

  const { data: articles, error: aErr } = await supabase
    .from("knowledge_articles")
    .select("title, content, category")
    .eq("tenant_id", tenantId)
    .eq("status", "published");
  if (aErr) throw aErr;

  const kbArticles: VapiKbArticle[] = ((articles || []) as VapiKbArticle[])
    .filter((a) => a && a.title && !isPromptArticle(a.title) && (a.content || "").trim());

  const systemPrompt = composeVapiSystemPrompt({ voicePromptBody, kbArticles });
  return { systemPrompt, name: tenant.name, locale: settings.locale };
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
): Record<string, any> {
  return {
    firstMessage: greetingFor(composed.name, composed.locale),
    metadata: { tenant_id: tenantId },
    variableValues: { ...dateVars },
    transcriber: { keywords: transcriberKeywords(composed.name) },
    model: { messages: [{ role: "system", content: composed.systemPrompt }] },
  };
}

/** Convenience: compose prompt + overrides for a tenant in one call (web path). */
export async function buildTenantCallConfig(
  tenantId: string,
  dateVars: VoiceDateVars = {},
): Promise<{ assistantId: string; assistantOverrides: Record<string, any> }> {
  const supabase = createServiceRoleClient();
  const composed = await composeTenantVoicePrompt(supabase, tenantId);
  return {
    assistantId: ENGINE_VAPI_ASSISTANT_ID,
    assistantOverrides: buildAssistantOverrides(composed, tenantId, dateVars),
  };
}
