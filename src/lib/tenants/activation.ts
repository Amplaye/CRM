// Shared activation constant for the admin health card.
//
// The "is this tenant activated" question turned out to need the LIVE state of a
// tenant's external artifacts (workflows active on n8n right now, assistant
// existing on Vapi), not what the settings row happens to record — legacy
// tenants like PICNIC were provisioned by hand before the wizard existed, so
// their settings have no onboarding marker and no recorded workflow ids, yet the
// bot works. So the verdict logic lives in the health route (which can make the
// network probes); only the template count is shared here.

/** Official restaurant template workflow count — a fully provisioned tenant has
 * at least this many active [Name]* workflows on n8n. Must equal the length of
 * TEMPLATE_RESTAURANT_WORKFLOW_IDS in src/lib/onboarding/orchestrator.ts (kept
 * aligned with PICNIC, the gold-standard tenant). Raised 13→17 on 2026-05-24,
 * lowered 17→16 on 2026-05-29 (the "Warmup" template id was stale on n8n — 404 —
 * and broke every onboard; PICNIC has no Warmup either, so it was dropped),
 * lowered 16→15 on 2026-06-09 (No-Show Auto-Cancel became the single shared
 * `[ALL]` cron — it's no longer cloned per tenant, so a complete tenant now has
 * 15 own-prefixed workflows, not 16. See orchestrator.ts for the full note),
 * lowered 15→14 on 2026-06-16 (Waitlist Reassurance likewise consolidated into
 * the single shared `[ALL] Waitlist Reassurance — Multi-Tenant` cron — the
 * endpoint already sweeps every tenant, so per-tenant clones were redundant). */
export const N8N_TEMPLATE_COUNT = 14;

/** Workflow functions that a tenant on the "motore unico" (shared engine) does
 * NOT run under its own `[Name]` prefix because a single shared workflow serves
 * every tenant. The health card must not red-flag their absence — that's the
 * intended architecture, not a broken tenant. A tenant's own `[Name]` copy of
 * these may exist but sit INACTIVE: that's correct (activating it would double
 * every reminder / follow-up). The live shared engine is the real worker.
 *   - "Chatbot WhatsApp": all WhatsApp goes through `[Meta Router] WhatsApp` →
 *      the one `[Picnic] Chatbot WhatsApp` engine (tenant injected at runtime).
 *   - "Reminders": served by `[ALL] Reminders — Multi-Tenant`.
 *   - "Web Call Token": superseded by the CRM `/api/voice/overrides` endpoint
 *      that the web widget calls directly (motore unico voce).
 *   - "Follow-up Post-Cena": served by `[ALL] Follow-up Post-Cena — Multi-Tenant`
 *      (the per-tenant clone was retired; the shared cron sweeps every tenant).
 *   - "Waitlist Reassurance": served by `[ALL] Waitlist Reassurance — Multi-Tenant`
 *      (consolidated 2026-06-16; per-tenant clones now redundant — see N8N_TEMPLATE_COUNT note).
 * A migrated tenant therefore legitimately runs 14 − 5 = 9 own workflows. */
export const MOTORE_UNICO_SHARED_WORKFLOWS = [
  "Chatbot WhatsApp",
  "Reminders",
  "Web Call Token",
  "Follow-up Post-Cena",
  "Waitlist Reassurance",
] as const;

/** Lower bar for a tenant served by the shared engine (motore unico). */
export const N8N_MOTORE_UNICO_MIN_COUNT =
  N8N_TEMPLATE_COUNT - MOTORE_UNICO_SHARED_WORKFLOWS.length; // 12
