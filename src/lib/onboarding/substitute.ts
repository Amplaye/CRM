// Tenant-onboarding workflow substitution.
//
// At runtime we fetch the Picnic workflows from n8n via API and rewrite
// every tenant-specific value (UUID, owner phone, restaurant name,
// webhook path, Retell agent/LLM/KB ids, Picnic phone, Google review URL)
// to the new tenant's values. We don't store template files in the repo —
// Picnic is the live "golden source" of behavior, and any patch we make
// to it automatically flows into the next onboarding.

const PICNIC_TENANT_ID = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5";
const PICNIC_OWNER_PHONE = "+34641790137";
const PICNIC_RESTAURANT_PHONE = "+34 828 712 623";
const PICNIC_RESTAURANT_PHONE_BARE = "828 712 623";
const PICNIC_RESTAURANT_PHONE_DIGITS = "828712623";
const PICNIC_REVIEW_URL_FRAGMENT = "cid=975701473301178074";
const PICNIC_RETELL_AGENT_ID = "agent_985ab572aeb67df9d2612fbb4e";
const PICNIC_RETELL_LLM_ID = "llm_d19f792cd11a22132956f81dc7fe";
const PICNIC_RETELL_KB_ID = "knowledge_base_eebeefd1538418b1";

export interface OnboardSubstitutions {
  newTenantId: string;
  newSlug: string;
  newOwnerPhone: string;
  newRestaurantName: string;
  newRestaurantPhone: string;
  newReviewUrl: string;
  newRetellAgentId?: string;
  newRetellLlmId?: string;
  newRetellKbId?: string;
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

  text = replaceAll(text, PICNIC_TENANT_ID, sub.newTenantId);
  text = replaceAll(text, PICNIC_OWNER_PHONE, sub.newOwnerPhone);
  text = replaceAll(text, PICNIC_RESTAURANT_PHONE, sub.newRestaurantPhone);
  text = replaceAll(text, PICNIC_RESTAURANT_PHONE_BARE, sub.newRestaurantPhone.replace(/^\+?\d+\s/, ""));
  text = replaceAll(text, PICNIC_RESTAURANT_PHONE_DIGITS, sub.newRestaurantPhone.replace(/\D/g, ""));

  // Google review URL: replace the cid fragment OR the full URL if present
  if (sub.newReviewUrl) {
    text = replaceAll(text, "https://www.google.com/maps?cid=975701473301178074", sub.newReviewUrl);
    text = replaceAll(text, PICNIC_REVIEW_URL_FRAGMENT, sub.newReviewUrl);
  }

  // Retell ids — only substitute if caller provided them
  if (sub.newRetellAgentId) text = replaceAll(text, PICNIC_RETELL_AGENT_ID, sub.newRetellAgentId);
  if (sub.newRetellLlmId) text = replaceAll(text, PICNIC_RETELL_LLM_ID, sub.newRetellLlmId);
  if (sub.newRetellKbId) text = replaceAll(text, PICNIC_RETELL_KB_ID, sub.newRetellKbId);

  // Webhook paths: picnic-* → {slug}-*
  text = text.replace(new RegExp("picnic-(\\w+)", "g"), `${sub.newSlug}-$1`);

  // Restaurant name in messages and prompts. Be careful: only replace
  // standalone occurrences of "PICNIC" / "Picnic", not substrings inside
  // arbitrary words. Use word boundaries.
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
