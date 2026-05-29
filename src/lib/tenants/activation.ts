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
 * and broke every onboard; PICNIC has no Warmup either, so it was dropped). */
export const N8N_TEMPLATE_COUNT = 16;
