// Single source of truth for the WhatsApp "From" (sender) number.
//
// SaaS principle (see docs/PIANO_SAAS.md, Mossa 5): the sending number is a
// per-tenant CONFIG value (data in tenants.settings.whatsapp.from), not code.
// Onboarding a real customer's WhatsApp line then becomes a config field, not a
// code edit scattered across every send site. Until a tenant sets its own
// number, we fall back to the shared platform env number, and finally to the
// Twilio sandbox so local/demo keeps working.
//
// This is the ONLY file allowed to name the sandbox sender — locked by
// src/lib/saas-invariants.test.ts so no route can re-hardcode a number.
export const TWILIO_SANDBOX_FROM = "whatsapp:+14155238886";

/** Ensure a number carries the `whatsapp:` channel prefix Twilio expects. */
function normalizeFrom(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  return v.startsWith("whatsapp:") ? v : "whatsapp:" + v;
}

/**
 * Resolve which WhatsApp number a message is sent FROM, in priority order:
 *   1. the tenant's own configured number (settings.whatsapp.from) — the SaaS path
 *   2. the platform env default (TWILIO_WHATSAPP_FROM)
 *   3. the Twilio sandbox (so demo/local works with zero config)
 *
 * Pass `undefined` when the tenant is unknown (generic relay) to get the
 * platform default — byte-identical to the old inline `env || sandbox`.
 */
export function resolveWhatsAppFrom(tenantFrom?: string | null): string {
  if (tenantFrom && tenantFrom.trim()) return normalizeFrom(tenantFrom);
  const env = process.env.TWILIO_WHATSAPP_FROM;
  if (env && env.trim()) return normalizeFrom(env);
  return TWILIO_SANDBOX_FROM;
}

/** Read a tenant's configured WhatsApp sender from its settings JSONB, if any. */
export function tenantWhatsAppFrom(settings: unknown): string | undefined {
  const w = (settings as { whatsapp?: { from?: unknown } } | null | undefined)?.whatsapp;
  return typeof w?.from === "string" && w.from.trim() ? w.from : undefined;
}
