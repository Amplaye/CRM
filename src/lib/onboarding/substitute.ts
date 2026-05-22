// Tenant-onboarding workflow substitution.
//
// THE OFFICIAL RESTAURANT TEMPLATE ("template ristorante v1").
// We don't store template files in the repo: the live n8n workflows + Vapi
// assistant (which historically lived under the Picnic account) ARE the golden
// source of bot behavior. At runtime we fetch them via API and rewrite every
// template-specific value (UUID, owner phone, restaurant name, webhook path,
// Vapi assistant id, restaurant phone, Google review URL) to the new
// tenant's values.
//
// GOLDEN-SOURCE RULE: any improvement to bot behavior must be patched on this
// template (the ids below), never on a single client. That is what keeps Bali
// Flow a SaaS (one engine, many configs) instead of an agency (many copies).
//
// The constant VALUES below are the template's own ids/strings. The regex
// literals further down ("picnic-…", "PICNIC", "[Picnic]") match text still
// embedded inside the live template content, so they must stay verbatim.

const TEMPLATE_RESTAURANT_TENANT_ID = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5";
const TEMPLATE_RESTAURANT_OWNER_PHONE = "+34641790137";
const TEMPLATE_RESTAURANT_PHONE = "+34 828 712 623";
const TEMPLATE_RESTAURANT_PHONE_BARE = "828 712 623";
const TEMPLATE_RESTAURANT_PHONE_DIGITS = "828712623";
const TEMPLATE_RESTAURANT_REVIEW_URL_FRAGMENT = "cid=975701473301178074";
// The template Vapi assistant ("PICNIC - Sofía"). Cloned per tenant by the
// orchestrator; wherever the n8n template references this id, rewrite it to the
// new tenant's cloned assistant id.
const TEMPLATE_VAPI_ASSISTANT_ID = "6c92f776-abb2-4175-8a55-45d76ec01d1a";

export interface OnboardSubstitutions {
  newTenantId: string;
  newSlug: string;
  newOwnerPhone: string;
  newRestaurantName: string;
  newRestaurantPhone: string;
  newReviewUrl: string;
  newVapiAssistantId?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

// Substitute every tenant-specific token inside a workflow JSON string.
// Operates on the whole JSON text (not just jsCode) because some values
// appear in node parameters, webhook paths, settings, etc.
export function substituteTenantTokens(workflowJsonText: string, sub: OnboardSubstitutions): string {
  let text = workflowJsonText;

  text = replaceAll(text, TEMPLATE_RESTAURANT_TENANT_ID, sub.newTenantId);
  text = replaceAll(text, TEMPLATE_RESTAURANT_OWNER_PHONE, sub.newOwnerPhone);
  text = replaceAll(text, TEMPLATE_RESTAURANT_PHONE, sub.newRestaurantPhone);
  text = replaceAll(text, TEMPLATE_RESTAURANT_PHONE_BARE, sub.newRestaurantPhone.replace(/^\+?\d+\s/, ""));
  text = replaceAll(text, TEMPLATE_RESTAURANT_PHONE_DIGITS, sub.newRestaurantPhone.replace(/\D/g, ""));

  // Google review URL: replace the cid fragment OR the full URL if present
  if (sub.newReviewUrl) {
    text = replaceAll(text, "https://www.google.com/maps?cid=975701473301178074", sub.newReviewUrl);
    text = replaceAll(text, TEMPLATE_RESTAURANT_REVIEW_URL_FRAGMENT, sub.newReviewUrl);
  }

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
