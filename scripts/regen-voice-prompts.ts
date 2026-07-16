// Regenerate the VOICE PROMPT KB article for the live voice tenants from the
// current buildVoicePrompt() golden template, then sync each tenant's Vapi
// assistant so the spoken prompt matches the source. Re-run any time the
// template changes (e.g. the date header). Idempotent: sync-kb-vapi only PATCHes
// Vapi when the composed prompt actually changed.
//
// Scope = the REAL voice clients only (Oraz, BALI Rest). PICNIC is excluded on
// purpose: it is the legacy GOLDEN TEMPLATE we clone from, not a customer with
// its own voice agent (its assistant IS the shared template). The template's own
// prompt is updated separately (see scripts/update-template-prompt.ts).
//
// Run with: SB_SERVICE_KEY=… AI_WEBHOOK_SECRET=… npx tsx scripts/regen-voice-prompts.ts
import { buildVoicePrompt, type VoicePromptInputResolved } from "../src/lib/onboarding/voice-prompt";

const SB_URL = process.env.SB_URL || "https://azhlnybiqlkbhbboyvud.supabase.co";
const SB_KEY = process.env.SB_SERVICE_KEY!;
const CRM_BASE = process.env.CRM_BASE || "https://crm.baliflowagency.com";
const AI_SECRET = process.env.AI_WEBHOOK_SECRET || "";

const TENANTS = [
  { id: "93eebe9c-8af5-4ca5-a315-3376ef4976e5", name: "Oraz", lang: "it" as const },
  { id: "a085e5bb-11f3-47f9-96da-c6cfdbff2ea0", name: "BALI Rest", lang: "es" as const },
];

async function sb(path: string, init?: RequestInit) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`SB ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  for (const t of TENANTS) {
    const rows = await sb(`tenants?id=eq.${t.id}&select=name,settings`);
    const settings = rows[0]?.settings || {};
    const lang = (settings.bot_config?.primary_language || t.lang) as VoicePromptInputResolved["language"];
    const input: VoicePromptInputResolved = {
      restaurant_name: rows[0]?.name || t.name,
      language: lang,
      opening_hours: settings.opening_hours || {},
      restaurant_phone: settings.bot_config?.restaurant_phone || settings.restaurant_phone,
      timezone: settings.timezone || settings.bot_config?.timezone,
      description: settings.description || "restaurante",
    };
    const prompt = buildVoicePrompt(input);

    const arts = await sb(`knowledge_articles?tenant_id=eq.${t.id}&title=eq.VOICE PROMPT&select=id`);
    if (!arts[0]) throw new Error(`No VOICE PROMPT article for ${t.name}`);
    await sb(`knowledge_articles?id=eq.${arts[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: prompt, status: "published" }),
    });
    console.log(`${t.name}: article updated -> ${prompt.length} chars`);

    const r = await fetch(`${CRM_BASE}/api/sync-kb-vapi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-secret": AI_SECRET },
      body: JSON.stringify({ tenant_id: t.id }),
    });
    console.log(`${t.name}: sync-kb-vapi -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
