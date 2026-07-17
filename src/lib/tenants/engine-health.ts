// Chatbot engine health + engine flag.
//
// The chatbot engine is the Cloudflare Worker (bot-engine); n8n has been shut
// down. What's left here is (1) the Worker's /health probe used by the admin
// tenant health card, and (2) the per-tenant engine flag helper. The old
// "verità viva" n8n workflow classifier (resolveN8nTenantHealth / normFunc /
// TenantWorkflow) was removed with n8n — the Worker is multi-tenant dynamic, so
// there is no per-tenant workflow list to classify.

/** Which chatbot engine serves a tenant. Kept as a union for the settings type;
 * every tenant is "cloudflare" now, "n8n" survives only for historical rows. */
export type BotEngine = "n8n" | "cloudflare";

/** Base URL of the deployed bot-engine Worker. */
export const CLOUDFLARE_ENGINE_BASE_URL = "https://bot-engine.sofia-f88.workers.dev";

/** The Worker's health endpoint — reachable + healthy means `{"ok":true}`. */
export function cloudflareEngineHealthUrl(): string {
  return `${CLOUDFLARE_ENGINE_BASE_URL}/health`;
}

/**
 * Which chatbot engine serves this tenant, read from settings.provisioning.engine.
 * New tenants are born "cloudflare" (see the onboarding orchestrator). A legacy
 * row with the flag absent resolves to "n8n" — harmless now that n8n is gone, but
 * it keeps the union honest for any historical data that was never migrated.
 */
export function getBotEngine(
  settings: { provisioning?: { engine?: unknown; [k: string]: unknown } } | null | undefined
): BotEngine {
  return settings?.provisioning?.engine === "cloudflare" ? "cloudflare" : "n8n";
}

/** Strict `{ok:true}` check on the Worker /health response body. */
export function isCloudflareEngineHealthy(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).ok === true
  );
}
