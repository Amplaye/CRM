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
 * at least this many active [Name]* workflows on n8n. */
export const N8N_TEMPLATE_COUNT = 13;
