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

// The national part of a phone number — its digits with the country code dropped.
// The template's BARE/DIGITS tokens are national-only ("828 712 623"), so a full
// E.164 number must be reduced the same way before substitution, or a "+34"
// literal already in the template doubles the prefix ("+3434684109244").
//
// We strip a known leading country code (default "34" — every tenant so far is
// Spanish, matching the template's own +34). If the number doesn't start with it
// (a future non-ES tenant), we leave the digits as-is rather than guessing — the
// worst case is a longer-but-correct number, never a doubled prefix.
function nationalDigits(phone: string, countryCode = "34"): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.startsWith(countryCode) ? digits.slice(countryCode.length) : digits;
}

// Substitute every tenant-specific token inside a workflow JSON string.
// Operates on the whole JSON text (not just jsCode) because some values
// appear in node parameters, webhook paths, settings, etc.
export function substituteTenantTokens(workflowJsonText: string, sub: OnboardSubstitutions): string {
  let text = workflowJsonText;

  text = replaceAll(text, TEMPLATE_RESTAURANT_TENANT_ID, sub.newTenantId);
  text = replaceAll(text, TEMPLATE_RESTAURANT_OWNER_PHONE, sub.newOwnerPhone);
  text = replaceAll(text, TEMPLATE_RESTAURANT_PHONE, sub.newRestaurantPhone);
  // The BARE/DIGITS template tokens are the NATIONAL part only (no "34" country
  // code, e.g. "828 712 623"). The full number must be stripped of its country
  // code before substituting them, or a token sitting after a literal "+34" in
  // the template yields a doubled prefix (e.g. "+34" + "34684109244" =
  // "+3434684109244"). nationalDigits() drops the leading country code robustly,
  // independent of spacing. See the regression test in substitute.test.ts.
  const newPhoneNational = nationalDigits(sub.newRestaurantPhone);
  text = replaceAll(text, TEMPLATE_RESTAURANT_PHONE_BARE, newPhoneNational);
  text = replaceAll(text, TEMPLATE_RESTAURANT_PHONE_DIGITS, newPhoneNational);

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
