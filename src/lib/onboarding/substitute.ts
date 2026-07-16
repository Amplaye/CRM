// Tenant-onboarding workflow substitution.
//
// THE OFFICIAL RESTAURANT TEMPLATE ("template ristorante v1").
// We don't store template files in the repo: the live n8n workflows + Vapi
// assistant (which historically lived under the Picnic account) ARE the golden
// source of bot behavior. At runtime we fetch them via API and rewrite every
// STABLE template-specific value (UUID, restaurant name, webhook path, Vapi
// assistant id) to the new tenant's values.
//
// LIVE CONTACTS (2026-06-03): the three MUTABLE contacts — owner_phone,
// restaurant_phone and review_url — are NO LONGER baked into the clone. Every
// auxiliary workflow now reads them LIVE from the tenant's DB row at runtime
// (settings.bot_config.responsible_phone, settings.restaurant_phone,
// settings.review_url), exactly as the shared motore unico already did for the
// owner phone. So editing them in Settings → Bookings takes effect immediately
// without re-cloning or re-syncing the workflows. Only tenant_id / slug / name /
// Vapi assistant id stay baked, because they are STABLE after onboarding (the
// tenant_id is the very key the live config lookup uses). The orchestrator
// persists the three contacts into the tenant's settings (provisioningSettings)
// so the live read resolves them; the Picnic literals that remain in the
// template are dead fallbacks, never reached once the DB has the value.
//
// GOLDEN-SOURCE RULE: any improvement to bot behavior must be patched on this
// template (the ids below), never on a single client. That is what keeps Bali
// Flow a SaaS (one engine, many configs) instead of an agency (many copies).
//
// The constant VALUES below are the template's own ids/strings. The regex
// literals further down ("picnic-…", "PICNIC", "[Picnic]") match text still
// embedded inside the live template content, so they must stay verbatim.

const TEMPLATE_RESTAURANT_TENANT_ID = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5";
// The template Vapi assistant ("PICNIC - Sofía"). Cloned per tenant by the
// orchestrator; wherever the n8n template references this id, rewrite it to the
// new tenant's cloned assistant id.
const TEMPLATE_VAPI_ASSISTANT_ID = "6c92f776-abb2-4175-8a55-45d76ec01d1a";

export interface OnboardSubstitutions {
  newTenantId: string;
  newSlug: string;
  newRestaurantName: string;
  newVapiAssistantId?: string;
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

// Substitute every STABLE tenant-specific token inside a workflow JSON string.
// Operates on the whole JSON text (not just jsCode) because some values appear
// in node parameters, webhook paths, settings, etc.
//
// The three mutable contacts (owner_phone, restaurant_phone, review_url) are
// intentionally NOT substituted: the cloned workflows read them live from the
// DB (see the file header). The remaining Picnic contact literals act as inert
// fallbacks behind that live read.
export function substituteTenantTokens(workflowJsonText: string, sub: OnboardSubstitutions): string {
  let text = workflowJsonText;

  // The tenant_id is the lookup key for the live config read — it MUST be the
  // new tenant's id everywhere it appears (~30+ hardcoded REST URLs).
  text = replaceAll(text, TEMPLATE_RESTAURANT_TENANT_ID, sub.newTenantId);

  // Vapi assistant id — only substitute if caller provided it
  if (sub.newVapiAssistantId) text = replaceAll(text, TEMPLATE_VAPI_ASSISTANT_ID, sub.newVapiAssistantId);

  // Webhook paths embedded in the template: "picnic-*" → "{slug}-*".
  text = text.replace(new RegExp("picnic-(\\w+)", "g"), `${sub.newSlug}-$1`);

  // Restaurant name in messages and prompts. The template content still says
  // "PICNIC"/"Picnic" — replace only standalone occurrences (word boundaries),
  // not substrings inside arbitrary words.
  text = text.replace(/\bPICNIC\b/g, sub.newRestaurantName.toUpperCase());
  text = text.replace(/\bPicnic\b/g, sub.newRestaurantName);

  return text;
}

// Build a clean payload accepted by n8n's POST /workflows. We strip read-only
// fields (id, createdAt, etc.) and keep only what the API accepts as input.
export function toCreatePayload(workflow: any, newName: string): any {
  return {
    name: newName,
    nodes: workflow.nodes || [],
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
  };
}
