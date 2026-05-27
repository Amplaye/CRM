// One-off: regenerate the VOICE PROMPT article for oraz + Sofía AI from the
// current buildVoicePrompt() golden template (hour-required + phone-prefix
// rules) and sync each assistant. Does NOT touch Picnic (_VOICE_PROMPT_ is
// hand-made). Run with: npx tsx scripts/regen-voice-prompts.ts
import { buildVoicePrompt, type VoicePromptInputResolved } from "../src/lib/onboarding/voice-prompt";

const SB_URL = "https://azhlnybiqlkbhbboyvud.supabase.co";
const SB_KEY = process.env.SB_SERVICE_KEY!;
const CRM_BASE = process.env.CRM_BASE || "https://crm.baliflowagency.com";
const AI_SECRET = process.env.AI_WEBHOOK_SECRET || "";

const TENANTS = [
  { id: "2b2116fc-ce75-4d9c-979c-bfd867d667e8", name: "oraz", lang: "it" as const },
  { id: "579d9521-474f-4187-8eca-68b8cfdfc5c5", name: "Sofía AI", lang: "es" as const },
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
    const rows = await sb(`tenants?id=eq.${t.id}&select=settings`);
    const settings = rows[0]?.settings || {};
    const input: VoicePromptInputResolved = {
      restaurant_name: settings.restaurant_name || t.name,
      language: t.lang,
      opening_hours: settings.opening_hours || {},
      restaurant_phone: settings.bot_config?.restaurant_phone || settings.restaurant_phone,
      timezone: settings.bot_config?.timezone || settings.timezone,
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
    console.log(`${t.name}: sync-kb-vapi -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
