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
//
// Exported so the post-onboarding re-sync (resyncContactTokens) can mirror the
// clone-time stripping when it rewrites the national form of restaurant_phone.
export function nationalDigits(phone: string, countryCode = "34"): string {
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

// The old→new values for a post-onboarding contact re-sync. Only the three
// fields that the clone baked into the per-tenant workflows (owner_phone,
// restaurant_phone, review_url) — everything else (slug, ids, names) is stable
// after onboarding and stays untouched.
export interface ContactResync {
  oldOwnerPhone: string;
  newOwnerPhone: string;
  oldRestaurantPhone: string;
  newRestaurantPhone: string;
  oldReviewUrl: string;
  newReviewUrl: string;
}

// Re-sync the THREE contact tokens the onboarding clone baked into a per-tenant
// n8n workflow (owner_phone, restaurant_phone, review_url) when the owner later
// edits them in Settings → Bookings. Pure find-and-replace over the workflow
// JSON text: it preserves node ids, webhook paths and everything else, so the
// caller can PUT the same workflow back IN PLACE (never recreate it).
//
// This is the pragmatic counterpart to substituteTenantTokens (which runs at
// clone time, template→new). The real fix is to make these auxiliary workflows
// read the values LIVE from the DB like the shared motore already does, and drop
// the baking + this re-sync entirely — see the note in the sync route.
export function resyncContactTokens(workflowJsonText: string, sub: ContactResync): string {
  let text = workflowJsonText;

  // Full-form replacement for each contact: only when old is non-empty and
  // actually differs, so a no-op save (or a never-set field) never touches the
  // JSON. Order is independent — these strings don't overlap in practice.
  // KNOWN LIMIT: when owner_phone and restaurant_phone were baked as the SAME
  // literal (some legacy tenants set them equal), they're indistinguishable in
  // the JSON — changing one to a different new value moves both (owner runs
  // first and wins). Unsolvable with find-replace; it only bites equal→diverging
  // edits. The proper fix is LIVE DB reads (see header).
  const pairs: Array<[string, string]> = [
    [sub.oldOwnerPhone, sub.newOwnerPhone],
    [sub.oldRestaurantPhone, sub.newRestaurantPhone],
    [sub.oldReviewUrl, sub.newReviewUrl],
  ];
  for (const [oldV, newV] of pairs) {
    const o = (oldV || "").trim();
    if (o && o !== (newV || "").trim()) text = replaceAll(text, o, newV);
  }

  // restaurant_phone is baked in TWO forms: its full form (handled above) AND
  // national-only digits — substitute.ts strips the country code for the BARE/
  // DIGITS template tokens (e.g. "828712623"), and that bare form can end up
  // glued after a literal "+34" in the clone ("+34684109244"). We rewrite
  // national→national (both country-code-stripped), which CANNOT double a +34
  // that isn't part of the replaced substring — the opposite of the clone-time
  // bug. Guards: only when the national string is long enough (≥7 digits) to be
  // a real phone — short digit runs could collide with arbitrary ids — and only
  // when it actually changes after stripping.
  const oldNat = nationalDigits(sub.oldRestaurantPhone || "");
  const newNat = nationalDigits(sub.newRestaurantPhone || "");
  if (oldNat.length >= 7 && oldNat !== newNat) {
    text = replaceAll(text, oldNat, newNat);
  }

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
