// Onboarding orchestrator: turn a wizard form payload into a fully
// provisioned tenant (DB rows + Retell agent + cloned n8n workflows).
// All steps are idempotent-friendly: on failure we report which step
// failed so the caller can retry without leaving partial state behind
// in critical resources (the cloned n8n workflows are deactivated by
// default until the wizard reports success).

import { createServiceRoleClient } from "@/lib/supabase/server";
import { substituteTenantTokens, toCreatePayload } from "./substitute";

const RETELL_BASE = "https://api.retellai.com";

export type OpeningHoursSlot = { open: string; close: string };
export type OpeningHours = Record<string, OpeningHoursSlot[]>; // keys 0..6 (Sunday=0)

export interface OnboardInput {
  // Restaurant
  restaurant_name: string;
  slug: string; // lowercase ASCII, used in webhook paths (e.g. "trattoria-rossa")
  restaurant_phone: string; // public phone shown in messages, e.g. "+34 928 123 456"
  owner_phone: string; // WhatsApp e164 of the staff/owner who receives notifications, e.g. "+34123456789"
  timezone: string;
  locale: string; // "es-ES" | "it-IT" | "en-GB" — used by the Retell FECHA header
  language: "es" | "it" | "en"; // primary language for the bot
  review_url: string; // Google Maps review link for the post-meal followup
  // Operations
  opening_hours: OpeningHours;
  table_size_preset: "small" | "medium" | "large"; // 6/12/20 tables auto-generated
  // Knowledge base
  kb_articles: Array<{ title: string; content: string; category: string }>;
  voice_prompt: string; // body of the VOICE PROMPT KB article (Retell general_prompt template)
  // Owner login
  owner_email: string;
  owner_password: string;
  owner_name: string;
}

export interface OnboardProgress {
  step: string;
  message: string;
  ok: boolean;
  data?: any;
}

const DEFAULT_TABLE_SIZE: Record<OnboardInput["table_size_preset"], number> = {
  small: 6,
  medium: 12,
  large: 20,
};

// Default voice id (Yerom) used across every demo per the user's preference.
const DEFAULT_VOICE_ID = "custom_voice_da9c1a838c8cfd4064a9ce1730";

const PICNIC_TENANT_ID = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5";
const PICNIC_WORKFLOW_IDS = [
  "166QnQsGHqXDpBxa", // Chatbot WhatsApp
  "2PhhKlZHe0kg23qT", // Web Call Token
  "2t5TL552kz3HL0By", // Daily Summary 10AM
  "31yGmF9OJ9EFFHO7", // Voice Agent Webhooks
  "5xfCf9n0vQcS9MQl", // Auto-Complete Stale Seated
  "CFMJqjOcSr6mEqVq", // Voice Tool — Restaurant Info
  "Hm1IhFQTaqnlJMQR", // Reminders
  "WRdkF33U17VQZZ8J", // No-Show Auto-Cancel
  "dZeAkXEpRjOjn8n6", // Follow-up Post-Cena
  "hcVLsbtGUWtPS2G1", // Waitlist Reassurance
  "nZdFqTRUrBlPOb3z", // Menu del Dia - 30min antes
  "z1Akph5impMRh28Y", // Pre-Turno Summary
  "IDx1EqaQTUq6YHEu", // Weekly AI Report
];

async function n8n(method: string, path: string, body?: any): Promise<any> {
  const apiKey = process.env.N8N_API_KEY;
  const baseUrl = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";
  if (!apiKey) throw new Error("N8N_API_KEY not configured");
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function retell(method: string, path: string, body?: any): Promise<any> {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY not configured");
  const res = await fetch(`${RETELL_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Retell ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function buildDefaultTables(tenantId: string, count: number) {
  // Half inside, half outside for demo realism. Round/square mixed by seat count.
  const tables: any[] = [];
  for (let i = 1; i <= count; i++) {
    const insideCount = Math.ceil(count / 2);
    const zone = i <= insideCount ? "inside" : "outside";
    const seats = i % 4 === 0 ? 6 : i % 3 === 0 ? 4 : 2;
    const shape = seats <= 2 ? "round" : seats >= 6 ? "rectangle" : "square";
    const inZoneIdx = zone === "inside" ? i : i - insideCount;
    const col = (inZoneIdx - 1) % 4;
    const row = Math.floor((inZoneIdx - 1) / 4);
    tables.push({
      tenant_id: tenantId,
      name: `T${i}`,
      seats,
      zone,
      shape,
      status: "active",
      position_x: 60 + col * 110,
      position_y: 60 + row * 110,
    });
  }
  return tables;
}

export async function runOnboard(
  input: OnboardInput,
  emit: (p: OnboardProgress) => void
): Promise<{ ok: boolean; tenant_id?: string; details: OnboardProgress[] }> {
  const log: OnboardProgress[] = [];
  const push = (p: OnboardProgress) => {
    log.push(p);
    emit(p);
  };

  let tenantId = "";
  let retellLlmId = "";
  let retellAgentId = "";
  let retellKbId = "";
  const createdWorkflowIds: string[] = [];

  try {
    const supabase = createServiceRoleClient();

    // 1. Tenant row
    {
      const initialSettings = {
        timezone: input.timezone,
        locale: input.locale,
        opening_hours: input.opening_hours,
        avg_spend: 25,
        avg_cost: 10,
        ai_monthly_cost: 450,
        no_show_baseline_pct: 15,
        ai_enabled_channels: ["whatsapp", "voice"],
        currency: "EUR",
      };
      const { data, error } = await supabase
        .from("tenants")
        .insert({
          name: input.restaurant_name,
          business_type: "restaurant",
          settings: initialSettings,
        })
        .select("id")
        .single();
      if (error) throw new Error(`tenant insert: ${error.message}`);
      tenantId = data.id;
      push({ step: "tenant", message: `Tenant created (${tenantId})`, ok: true, data: { tenant_id: tenantId } });
    }

    // 2. Tables
    {
      const tables = buildDefaultTables(tenantId, DEFAULT_TABLE_SIZE[input.table_size_preset]);
      const { error } = await supabase.from("restaurant_tables").insert(tables);
      if (error) throw new Error(`tables insert: ${error.message}`);
      push({ step: "tables", message: `${tables.length} default tables created`, ok: true });
    }

    // 3. KB articles (regular + the special VOICE PROMPT)
    {
      const articles = input.kb_articles.map((a) => ({
        tenant_id: tenantId,
        title: a.title,
        content: a.content,
        category: a.category || "general",
        status: "published",
      }));
      // Voice prompt is stored as a "VOICE PROMPT" titled article — sync-kb-retell
      // recognises this title and uses the body as Retell general_prompt.
      articles.push({
        tenant_id: tenantId,
        title: "VOICE PROMPT",
        content: input.voice_prompt,
        category: "general",
        status: "published",
      });
      const { error } = await supabase.from("knowledge_articles").insert(articles);
      if (error) throw new Error(`KB insert: ${error.message}`);
      push({ step: "kb", message: `${articles.length} KB articles inserted`, ok: true });
    }

    // 4. Retell LLM + agent
    {
      // Stub general_prompt — sync-kb-retell will replace it with the full
      // VOICE PROMPT body wrapped with a dynamic FECHA header on first sync.
      const llm = await retell("POST", "/create-retell-llm", {
        model: "gpt-4o-mini",
        general_prompt: `Eres el agente vocal de ${input.restaurant_name}. Sé breve y útil.`,
      });
      retellLlmId = llm.llm_id;

      const agent = await retell("POST", "/create-agent", {
        response_engine: { type: "retell-llm", llm_id: retellLlmId },
        voice_id: DEFAULT_VOICE_ID,
        agent_name: `${input.restaurant_name} Agent`,
        language: input.language === "it" ? "it-IT" : input.language === "en" ? "en-US" : "es-ES",
      });
      retellAgentId = agent.agent_id;

      // Persist the Retell ids in tenant.settings so sync-kb-retell can find them
      // without code changes per-tenant.
      const { data: cur } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
      const merged = {
        ...((cur?.settings as any) || {}),
        retell: {
          llmId: retellLlmId,
          agentId: retellAgentId,
          timezone: input.timezone,
          locale: input.locale,
          voiceId: DEFAULT_VOICE_ID,
        },
      };
      await supabase.from("tenants").update({ settings: merged }).eq("id", tenantId);
      push({ step: "retell", message: `Retell agent ${retellAgentId} created`, ok: true, data: { llmId: retellLlmId, agentId: retellAgentId } });
    }

    // 5. Sync KB into Retell so the agent has menu / policies / voice prompt
    {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://crm.baliflowagency.com";
      const sec = process.env.AI_WEBHOOK_SECRET || "";
      const r = await fetch(`${baseUrl}/api/sync-kb-retell`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ai-secret": sec },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`sync-kb-retell: ${r.status} ${t.slice(0, 200)}`);
      }
      const j = await r.json();
      retellKbId = j.kb_id || "";
      push({ step: "kb_sync", message: `KB synced to Retell (${retellKbId})`, ok: true });
    }

    // 6. Clone n8n workflows
    {
      const sub = {
        newTenantId: tenantId,
        newSlug: input.slug,
        newOwnerPhone: input.owner_phone.startsWith("+") ? input.owner_phone : `+${input.owner_phone}`,
        newRestaurantName: input.restaurant_name,
        newRestaurantPhone: input.restaurant_phone,
        newReviewUrl: input.review_url,
        newRetellAgentId: retellAgentId,
        newRetellLlmId: retellLlmId,
        newRetellKbId: retellKbId,
      };

      for (const wid of PICNIC_WORKFLOW_IDS) {
        const original = await n8n("GET", `/workflows/${wid}`);
        const originalText = JSON.stringify(original);
        const rewritten = JSON.parse(substituteTenantTokens(originalText, sub));
        const newName = (original.name || "Workflow").replace(/^\[Picnic\]/, `[${input.restaurant_name}]`);
        const payload = toCreatePayload(rewritten, newName);
        const created = await n8n("POST", "/workflows", payload);
        createdWorkflowIds.push(created.id);
      }
      push({ step: "n8n", message: `${createdWorkflowIds.length} workflows cloned`, ok: true, data: { workflow_ids: createdWorkflowIds } });
    }

    // 7. Owner user account + tenant_member link
    {
      const { data: created, error: cuErr } = await supabase.auth.admin.createUser({
        email: input.owner_email,
        password: input.owner_password,
        email_confirm: true,
        user_metadata: { name: input.owner_name },
      });
      if (cuErr) throw new Error(`owner user: ${cuErr.message}`);
      const ownerId = created.user!.id;
      // The handle_new_user trigger inserts into public.users automatically.
      // Add the tenant membership.
      const { error: mErr } = await supabase
        .from("tenant_members")
        .insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" });
      if (mErr) throw new Error(`tenant_member: ${mErr.message}`);
      push({ step: "owner", message: `Owner account ${input.owner_email} linked`, ok: true });
    }

    // 8. Save tenant.settings.workflow_ids so the admin UI can show / activate them later
    {
      const { data: cur } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
      const merged = {
        ...((cur?.settings as any) || {}),
        n8n: { workflow_ids: createdWorkflowIds },
      };
      await supabase.from("tenants").update({ settings: merged }).eq("id", tenantId);
    }

    push({ step: "done", message: "Onboarding complete", ok: true });
    return { ok: true, tenant_id: tenantId, details: log };
  } catch (e: any) {
    push({ step: "error", message: e.message || String(e), ok: false });
    return { ok: false, tenant_id: tenantId || undefined, details: log };
  }
}
