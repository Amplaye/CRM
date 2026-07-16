// Single source of truth for the WhatsApp "From" — the Meta phone_number_id
// a message is sent FROM.
//
// SaaS principle (see docs/PIANO_SAAS.md, Mossa 5): the sending number is a
// per-tenant CONFIG value (data in tenants.settings.whatsapp.from), not code.
// Onboarding a real customer's WhatsApp line then becomes a config field, not a
// code edit scattered across every send site.
//
// Migration (2026-05-29): WhatsApp moved off Twilio onto the Meta WhatsApp
// Cloud API. The sender is now a Meta `phone_number_id` (bare digits, e.g.
// "1095078260361095"), NOT a Twilio "whatsapp:+E.164" string. Today every
// tenant resolves to the shared platform number (META_WHATSAPP_PHONE_NUMBER_ID);
// when a real client gets its own Meta number we set settings.whatsapp.from to
// that tenant's phone_number_id — one config row, no code change.
//
// This is the ONLY file allowed to name the platform sender — locked by
// src/lib/saas-invariants.test.ts so no route can re-hardcode a number.

/** Strip any stray formatting so we always hand Meta a bare phone_number_id. */
function normalizeFrom(raw: string): string {
  return (raw || "").replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
}

/**
 * Resolve which Meta phone_number_id a message is sent FROM, in priority order:
 *   1. the tenant's own configured number (settings.whatsapp.from) — the SaaS path
 *   2. the platform env default (META_WHATSAPP_PHONE_NUMBER_ID)
 *   3. empty string — no number configured; the caller surfaces a clear error
 *      (sending from a wrong/blank number would silently fail at Meta anyway).
 *
 * Pass `undefined` when the tenant is unknown (generic relay) to get the
 * platform default.
 */
export function resolveWhatsAppFrom(tenantFrom?: string | null): string {
  if (tenantFrom && tenantFrom.trim()) return normalizeFrom(tenantFrom);
  const env = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (env && env.trim()) return normalizeFrom(env);
  return "";
}

/** Read a tenant's configured WhatsApp sender (Meta phone_number_id) from its
 *  settings JSONB, if any. */
export function tenantWhatsAppFrom(settings: unknown): string | undefined {
  const w = (settings as { whatsapp?: { from?: unknown } } | null | undefined)?.whatsapp;
  return typeof w?.from === "string" && w.from.trim() ? w.from : undefined;
}
