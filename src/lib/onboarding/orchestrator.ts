// Onboarding orchestrator: turn a wizard form payload into a fully
// provisioned tenant (DB rows + Vapi assistant + cloned n8n workflows).
// All steps are idempotent-friendly: on failure we report which step
// failed so the caller can retry without leaving partial state behind
// in critical resources (the cloned n8n workflows are deactivated by
// default until the wizard reports success).

import { createServiceRoleClient } from "@/lib/supabase/server";
import { substituteTenantTokens, toCreatePayload } from "./substitute";
import { createTenant } from "@/lib/tenants/create-tenant";
import { buildVoicePrompt } from "./voice-prompt";
import { cloneTemplateAssistant, findAssistantByName } from "./vapi";

export type OpeningHoursSlot = { open: string; close: string };
export type OpeningHours = Record<string, OpeningHoursSlot[]>; // keys 0..6 (Sunday=0)

export interface OnboardInput {
  // Restaurant
  restaurant_name: string;
  slug: string; // lowercase ASCII, used in webhook paths (e.g. "trattoria-rossa")
  restaurant_phone: string; // public phone shown in messages, e.g. "+34 928 123 456"
  owner_phone: string; // WhatsApp e164 of the staff/owner who receives notifications, e.g. "+34123456789"
  timezone: string;
  locale: string; // "es-ES" | "it-IT" | "en-GB" — used by the voice-prompt FECHA header
  language: "es" | "it" | "en" | "de"; // primary language for the bot
  // The single language the owner's CRM dashboard is shown in. Independent of
  // `language`/`locale` (those drive the assistant). Persisted on the tenant as
  // settings.crm_locale and read at app boot to fix the UI language. Optional:
  // the admin wizard omits it, in which case it falls back to `language`.
  crm_locale?: "es" | "it" | "en" | "de";
  review_url: string; // Google Maps review link for the post-meal followup
  // Operations
  opening_hours: OpeningHours;
  // Minutes before each shift's closing time to stop taking reservations. The
  // availability API derives the actual cut-off per day (close − offset). -1 =
  // shift not served. Persisted to settings.last_reservation_offset.
  last_reservation_offset?: { lunch: number; dinner: number };
  // Total covers (seats) the owner declared in the questionnaire. The starter
  // floor plan is generated so its seat total matches this exactly, so the
  // Tables section and the KB never disagree. (The old small/medium/large preset
  // was removed — it created a fixed table count unrelated to declared capacity.)
  capacity_seats: number;
  // On/off capabilities derived from the wizard answers (terrace, pets, events,
  // languages, double-shift). Persisted to settings.features so the Settings →
  // Features toggles open already matching what the owner said in the wizard.
  // Optional: the admin wizard omits it → defaults apply.
  features?: import("@/lib/types/tenant-settings").TenantFeatures;
  // Booking-confirmation venue subset (address/parking/deposit/cancellation),
  // persisted to settings.venue so the bot can repeat it in the WhatsApp/voice
  // recap. Optional: the admin wizard omits it. See venueFromQuestionnaire.
  venue?: import("./kb-generator").VenueInfo;
  // Knowledge base
  kb_articles: Array<{ title: string; content: string; category: string }>;
  // Body of the VOICE PROMPT KB article. Optional: when omitted (self-serve),
  // the orchestrator builds it server-side from the fixed agency template so
  // the client never writes or sees it (see voice-prompt.ts).
  voice_prompt?: string;
  // Owner login
  owner_email: string;
  owner_password: string;
  owner_name: string;

  // --- Self-serve mode (owner provisions their own pre-created tenant) ---
  // When set, the orchestrator UPGRADES this existing tenant instead of
  // creating a new one, and links the EXISTING owner user instead of creating
  // an auth account. The owner endpoint forces both to the caller's identity
  // (see owner-tenant.ts) — they are never trusted from a public form.
  tenant_id?: string;
  owner_user_id?: string;
  self_serve?: boolean;
}

export interface OnboardProgress {
  step: string;
  message: string;
  ok: boolean;
  data?: any;
}

// The n8n workflows that make up the OFFICIAL RESTAURANT TEMPLATE
// ("template ristorante v1"). These live workflows are the golden source:
// onboarding clones them and rewrites the tenant-specific tokens (see
// substitute.ts). Patch bot behavior HERE, never on a single client.
//
// This list is kept ALIGNED WITH PICNIC, the gold-standard legacy tenant that
// runs maintenance-free. Every per-tenant workflow PICNIC has must be here so a
// new client is born complete (same engine, only the KB differs). The four
// added 2026-05-24 closed the gap that left new tenants (e.g. Chef Oraz) with
// 13 while PICNIC had 17 working — each was verified per-tenant (references the
// tenant's own id / Vapi assistant / a "picnic-*" webhook path that
// substitute.ts rewrites to the new slug). Excluded from PICNIC's live set: a
// disabled duplicate "Deflector Post-Call" (junk, not the active one).
export const TEMPLATE_RESTAURANT_WORKFLOW_IDS = [
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
  // Added 2026-05-24 to match PICNIC (were missing from new tenants):
  "ZiEQ8iUpt8LnAYp5", // Vapi Voicemail Scheduler — per-tenant (tenant_id)
  "w2J411dX5JcOZZsJ", // Nightly Conversation Audit — per-tenant (tenant_id + picnic-audit-run webhook)
  "fenoM2b2Q9MMa0Kd", // Deflector Post-Call — per-tenant (picnic-deflector-postcall webhook)
  // NOTE: the Warmup (keep infra warm) template, formerly id y0HusBGSBVW7u9rm,
  // was REMOVED 2026-05-29 — the source workflow no longer exists on n8n (404),
  // so every self-serve onboard aborted at step 6 on its GET. PICNIC (the gold
  // standard) has no Warmup workflow either; the only live one is the oraz
  // clone, an orphan. It is a 4-min cron ping, non-essential; dropped rather
  // than rebuilt. The loop below also tolerates 404s defensively so a single
  // stale template id can never again break the whole provisioning.
];

// Every outbound call in provisioning gets a hard timeout. Without one, a single
// hung n8n/Vapi/KB request leaves the whole SSE stream open forever and the
// wizard sits on the loading screen indefinitely (the exact "loaded to infinity"
// bug an owner hit on her phone). On timeout we throw a labelled error so the
// step log shows WHICH call stalled, and the run fails cleanly instead of
// hanging — the owner then sees the retry / contact-support actions.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`request timed out after ${ms / 1000}s: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

async function n8n(method: string, path: string, body?: any): Promise<any> {
  const apiKey = process.env.N8N_API_KEY;
  const baseUrl = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";
  if (!apiKey) throw new Error("N8N_API_KEY not configured");
  const res = await fetchWithTimeout(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }, 30_000);
  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Build a realistic table layout whose seat total equals the capacity the owner
// declared in the questionnaire. We no longer ask for a small/medium/large
// preset: the declared seat count is the single source of truth, so the Tables
// section and the KB always agree (they used to drift — the preset made N tables
// of mixed 2/4/6 seats, unrelated to the declared capacity).
//
// Mix: mostly 2- and 4-tops with the occasional 6-top, the bread-and-butter of a
// real dining room. We lay them out greedily until the running seat total
// reaches the target, then trim/pad the LAST table so the sum lands EXACTLY on
// the declared number (clamped to a sane 2..300 range). Half inside, half out.
// The upper bound is just a runaway guard (a typo of 99999 shouldn't mint
// thousands of tables); a real 51-seat venue must NOT be silently truncated.
function buildTablesForCapacity(tenantId: string, declaredSeats: number) {
  const target = Math.max(2, Math.min(300, Math.round(declaredSeats) || 12));
  // Repeating pattern of party sizes; index i picks pattern[i % len].
  const pattern = [2, 4, 2, 4, 6, 2, 4];
  const sizes: number[] = [];
  let sum = 0;
  for (let i = 0; sum < target; i++) {
    let s = pattern[i % pattern.length];
    if (sum + s > target) s = target - sum; // last table absorbs the remainder
    if (s <= 0) break;
    sizes.push(s);
    sum += s;
  }
  // A 1-seat remainder reads oddly; merge it into the previous table when possible.
  if (sizes.length >= 2 && sizes[sizes.length - 1] === 1) {
    sizes[sizes.length - 2] += 1;
    sizes.pop();
  }

  const insideCount = Math.ceil(sizes.length / 2);
  return sizes.map((seats, idx) => {
    const i = idx + 1;
    const zone = i <= insideCount ? "inside" : "outside";
    const shape = seats <= 2 ? "round" : seats >= 6 ? "rectangle" : "square";
    const inZoneIdx = zone === "inside" ? i : i - insideCount;
    const col = (inZoneIdx - 1) % 4;
    const row = Math.floor((inZoneIdx - 1) / 4);
    return {
      tenant_id: tenantId,
      name: `T${i}`,
      seats,
      zone,
      shape,
      status: "active",
      position_x: 60 + col * 110,
      position_y: 60 + row * 110,
    };
  });
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
  let vapiAssistantId = "";
  const createdWorkflowIds: string[] = [];

  // Voice prompt body, computed once: the caller's text (admin wizard) or, when
  // omitted (self-serve), built from the fixed agency template. Reused as the
  // VOICE PROMPT KB article (step 3) and the cloned assistant's system prompt
  // stub (step 4); the full KB is then merged in by sync-kb-vapi (step 5).
  const voicePromptBody = input.voice_prompt?.trim()
    ? input.voice_prompt
    : buildVoicePrompt({
        restaurant_name: input.restaurant_name,
        language: input.language,
        opening_hours: input.opening_hours,
        restaurant_phone: input.restaurant_phone,
        timezone: input.timezone,
      });

  try {
    const supabase = createServiceRoleClient();

    // 1. Tenant row — create new (admin) or upgrade existing (self-serve)
    {
      const provisioningSettings = {
        timezone: input.timezone,
        locale: input.locale,
        // CRM dashboard language (separate from the assistant's locale above).
        // The app reads this at boot to fix the UI language.
        crm_locale: input.crm_locale || input.language,
        opening_hours: input.opening_hours,
        last_reservation_offset: input.last_reservation_offset || { lunch: 45, dinner: 60 },
        avg_spend: 25,
        avg_cost: 10,
        ai_monthly_cost: 450,
        no_show_baseline_pct: 15,
        ai_enabled_channels: ["whatsapp", "voice"],
        currency: "EUR",
        // Feature flags from the wizard answers (terrace/pets/events/languages/
        // double-shift). Read by Settings → Features and the bot's info source.
        ...(input.features ? { features: input.features } : {}),
        // Booking-confirmation venue subset, read by /api/ai/book to repeat the
        // address (+ maps link), parking, deposit and cancellation in the recap.
        ...(input.venue ? { venue: input.venue } : {}),
      };

      if (input.tenant_id) {
        // Self-serve: the owner's trial tenant already exists. Merge the
        // provisioning settings onto whatever the signup wrote and flip it to
        // "active" (full bot now provisioned).
        const { data: cur, error: getErr } = await supabase
          .from("tenants").select("settings").eq("id", input.tenant_id).single();
        if (getErr || !cur) throw new Error(`tenant ${input.tenant_id} not found`);
        const mergedSettings = { ...((cur.settings as any) || {}), ...provisioningSettings };
        const { error: updErr } = await supabase
          .from("tenants")
          .update({ name: input.restaurant_name, status: "active", settings: mergedSettings })
          .eq("id", input.tenant_id);
        if (updErr) throw new Error(`tenant upgrade: ${updErr.message}`);
        tenantId = input.tenant_id;
        push({ step: "tenant", message: `Tenant upgraded (${tenantId})`, ok: true, data: { tenant_id: tenantId } });
      } else {
        // Admin wizard provisions the full bot → born "active" (ready for traffic).
        const created = await createTenant(supabase, {
          name: input.restaurant_name,
          status: "active",
          settings: provisioningSettings,
        });
        tenantId = created.id;
        push({ step: "tenant", message: `Tenant created (${tenantId})`, ok: true, data: { tenant_id: tenantId } });
      }
    }

    // 2. Tables — idempotent: a retry after a truncated run must not double them.
    {
      const { count } = await supabase
        .from("restaurant_tables")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (count && count > 0) {
        push({ step: "tables", message: `${count} tables already present — skipped`, ok: true });
      } else {
        const tables = buildTablesForCapacity(tenantId, input.capacity_seats);
        const { error } = await supabase.from("restaurant_tables").insert(tables);
        if (error) throw new Error(`tables insert: ${error.message}`);
        const seatTotal = tables.reduce((s, tb) => s + tb.seats, 0);
        push({ step: "tables", message: `${tables.length} tables created (${seatTotal} seats)`, ok: true });
      }
    }

    // 3. KB articles (regular + the special VOICE PROMPT) — idempotent: skip if
    //    the tenant already has articles (avoids a duplicated KB on retry).
    {
      const { count } = await supabase
        .from("knowledge_articles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (count && count > 0) {
        push({ step: "kb", message: `${count} KB articles already present — skipped`, ok: true });
      } else {
        const articles = input.kb_articles.map((a) => ({
          tenant_id: tenantId,
          title: a.title,
          content: a.content,
          category: a.category || "general",
          status: "published",
        }));
        // Voice prompt is stored as a "VOICE PROMPT" titled article — sync-kb-vapi
        // recognises this title and uses the body as the assistant's voice prompt
        // (the rest of the articles become the KB block in the same system prompt).
        articles.push({
          tenant_id: tenantId,
          title: "VOICE PROMPT",
          content: voicePromptBody,
          category: "general",
          status: "published",
        });
        const { error } = await supabase.from("knowledge_articles").insert(articles);
        if (error) throw new Error(`KB insert: ${error.message}`);
        push({ step: "kb", message: `${articles.length} KB articles inserted`, ok: true });
      }
    }

    // 4. Vapi assistant — clone the agency template ("PICNIC - Sofía"). We reuse
    //    its voice / model / tools and only change the name, system prompt and
    //    greeting. The system prompt starts as the voice prompt body; step 5
    //    merges in the KB. A localized greeting avoids leaking the template's
    //    Picnic opener until the voicemail sync overwrites firstMessage.
    {
      const greetings: Record<OnboardInput["language"], string> = {
        es: `¡Hola, ${input.restaurant_name}, bienvenido! ¿En qué te puedo ayudar?`,
        it: `Ciao, ${input.restaurant_name}, benvenuto! Come posso aiutarti?`,
        en: `Hello, welcome to ${input.restaurant_name}! How can I help you?`,
        de: `Hallo, willkommen bei ${input.restaurant_name}! Wie kann ich helfen?`,
      };
      const key = process.env.VAPI_PRIVATE_KEY;
      if (!key) throw new Error("VAPI_PRIVATE_KEY not configured");
      const assistantName = `${input.restaurant_name} — Voice`;

      // Idempotent: don't leak a second clone on retry. Prefer the id already on
      // the tenant; else recover one a previous (truncated) run created under the
      // same name; else clone fresh.
      const { data: pre } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
      const existingId = (pre?.settings as any)?.vapi?.assistantId as string | undefined;
      let assistantId = existingId || (await findAssistantByName(key, assistantName)) || "";
      if (assistantId) {
        push({ step: "vapi", message: `Reusing existing Vapi assistant ${assistantId}`, ok: true, data: { assistantId } });
      } else {
        ({ assistantId } = await cloneTemplateAssistant({
          key,
          name: assistantName,
          systemPrompt: voicePromptBody,
          firstMessage: greetings[input.language] || greetings.es,
        }));
      }
      vapiAssistantId = assistantId;

      // Persist the Vapi assistant id in tenant.settings so sync-kb-vapi and the
      // voicemail sync can find it without code changes per-tenant.
      const { data: cur } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
      const merged = {
        ...((cur?.settings as any) || {}),
        vapi: {
          assistantId: vapiAssistantId,
          timezone: input.timezone,
          locale: input.locale,
        },
      };
      await supabase.from("tenants").update({ settings: merged }).eq("id", tenantId);
      if (!assistantId || assistantId !== existingId) {
        push({ step: "vapi", message: `Vapi assistant ${vapiAssistantId} ready`, ok: true, data: { assistantId: vapiAssistantId } });
      }
    }

    // 5. Sync KB into the Vapi assistant so its prompt has menu / policies / voice prompt
    {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://crm.baliflowagency.com";
      const sec = process.env.AI_WEBHOOK_SECRET || "";
      const r = await fetchWithTimeout(`${baseUrl}/api/sync-kb-vapi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ai-secret": sec },
        body: JSON.stringify({ tenant_id: tenantId }),
      }, 45_000);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`sync-kb-vapi: ${r.status} ${t.slice(0, 200)}`);
      }
      push({ step: "kb_sync", message: `KB synced into Vapi assistant ${vapiAssistantId}`, ok: true });
    }

    // 6. Clone n8n workflows — idempotent. A truncated run can leave the 13
    //    workflows created but never recorded on the tenant; cloning again would
    //    orphan a second set of 13. So: if this tenant's workflows already exist
    //    (matched by the "[<restaurant_name>]" name prefix), reuse them.
    {
      const namePrefix = `[${input.restaurant_name}]`;
      const existing = await n8n("GET", `/workflows?limit=250`);
      const already: string[] = (existing?.data || [])
        .filter((w: any) => typeof w?.name === "string" && w.name.startsWith(namePrefix))
        .map((w: any) => w.id);

      if (already.length >= TEMPLATE_RESTAURANT_WORKFLOW_IDS.length) {
        createdWorkflowIds.push(...already);
        // Make sure they're active (a prior run may have died before activating).
        for (const id of already) {
          try { await n8n("POST", `/workflows/${id}/activate`); } catch { /* tolerate */ }
        }
        push({ step: "n8n", message: `${already.length} workflows already present — reused`, ok: true, data: { workflow_ids: already } });
      } else {
        const sub = {
          newTenantId: tenantId,
          newSlug: input.slug,
          newOwnerPhone: input.owner_phone.startsWith("+") ? input.owner_phone : `+${input.owner_phone}`,
          newRestaurantName: input.restaurant_name,
          newRestaurantPhone: input.restaurant_phone,
          newReviewUrl: input.review_url,
          newVapiAssistantId: vapiAssistantId,
        };

        const skipped: string[] = [];
        for (const wid of TEMPLATE_RESTAURANT_WORKFLOW_IDS) {
          let original: any;
          try {
            original = await n8n("GET", `/workflows/${wid}`);
          } catch (e: any) {
            // A template id that no longer exists on n8n (404) must NOT abort the
            // whole onboarding — that's the bug that broke every self-serve run.
            // Skip the stale template, record it, and keep provisioning the rest.
            if (/→ 404:/.test(e?.message || "")) { skipped.push(wid); continue; }
            throw e;
          }
          const originalText = JSON.stringify(original);
          const rewritten = JSON.parse(substituteTenantTokens(originalText, sub));
          // Template workflow names are prefixed "[Picnic]" → swap for the tenant.
          const newName = (original.name || "Workflow").replace(/^\[Picnic\]/, namePrefix);
          const payload = toCreatePayload(rewritten, newName);
          const created = await n8n("POST", "/workflows", payload);
          createdWorkflowIds.push(created.id);
          // Activate immediately so cron triggers + webhooks fire without manual action.
          try { await n8n("POST", `/workflows/${created.id}/activate`); } catch { /* tolerate */ }
        }
        const skipNote = skipped.length ? ` (${skipped.length} stale template${skipped.length > 1 ? "s" : ""} skipped)` : "";
        push({ step: "n8n", message: `${createdWorkflowIds.length} workflows cloned & activated${skipNote}`, ok: true, data: { workflow_ids: createdWorkflowIds, skipped } });
      }

      // Persist the workflow ids NOW, right after creation — not only in the
      // final settings merge. This is exactly what the chef-oraz incident lost:
      // n8n succeeded but the process ended before the trailing update ran,
      // orphaning 13 workflows. Writing here means even a later truncation
      // leaves a tenant that a retry can fully recover.
      {
        const { data: cur } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
        const merged = { ...((cur?.settings as any) || {}), n8n: { workflow_ids: createdWorkflowIds } };
        await supabase.from("tenants").update({ settings: merged }).eq("id", tenantId);
      }
    }

    // 7. Owner user account + tenant_member link
    {
      if (input.owner_user_id) {
        // Self-serve: the owner already signed up and is already a member of
        // their trial tenant (created at signup). Don't create a duplicate auth
        // account — just make sure the membership row exists.
        const { data: existing } = await supabase
          .from("tenant_members")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("user_id", input.owner_user_id)
          .maybeSingle();
        if (!existing) {
          const { error: mErr } = await supabase
            .from("tenant_members")
            .insert({ tenant_id: tenantId, user_id: input.owner_user_id, role: "owner" });
          if (mErr) throw new Error(`tenant_member: ${mErr.message}`);
        }
        push({ step: "owner", message: `Owner ${input.owner_email} linked`, ok: true });
      } else {
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
    }

    // 8. Final commit: workflow ids + (self-serve) the provisioning markers, and
    //    re-assert status:active. This is the step the chef-oraz incident lost,
    //    so it must be the LAST thing and must actually land: we read back the
    //    row and retry once if the markers aren't there. Marking
    //    onboarding.completed also stops the dashboard guard from bouncing the
    //    owner back into the wizard.
    {
      const writeFinal = async () => {
        const { data: cur } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
        const prev = (cur?.settings as any) || {};
        const merged: Record<string, any> = {
          ...prev,
          n8n: { workflow_ids: createdWorkflowIds },
        };
        // sandbox_routable:true → while no real WA number is attached, this tenant
        // shares the single Meta sandbox number with the other test tenants. The
        // [Meta Router] WhatsApp n8n workflow lists every active tenant carrying
        // this flag in its "which restaurant?" menu and forwards to the chatbot at
        // "<slug>-whatsapp", so a freshly-provisioned CRM is reachable for testing
        // with ZERO manual steps. Written for BOTH paths (admin wizard + self-serve)
        // because during the demo phase every tenant we create must show up in the
        // shared menu. A real customer (own number) gets sandbox_routable cleared at
        // number-attach time and so drops out of the shared test menu. See
        // docs/SANDBOX_ROUTER.md.
        merged.provisioning = {
          ...(prev.provisioning || {}),
          whatsapp_attached: false,
          sandbox_routable: true,
          slug: input.slug,
        };
        if (input.self_serve) {
          merged.onboarding = { ...(prev.onboarding || {}), completed: true, completed_at: new Date().toISOString() };
          merged.provisioning.self_serve = true;
          merged.provisioning.completed_at = new Date().toISOString();
        }

        // Meta WhatsApp creds → tenants.secrets (NOT settings.bot_config, which is
        // member-readable; matches how Picnic stores them after the L5 security
        // hardening). The cloned chatbot reads the token from {bot_config ∪ secrets}
        // and sends via Meta when meta_phone_number_id + meta_access_token are both
        // present (META_ON). Without this, a freshly-cloned bot has no Meta creds and
        // silently falls back to the Twilio sandbox — we want every new tenant to be
        // born on Meta. During the demo phase all tenants share the one sandbox number
        // (META_WHATSAPP_PHONE_NUMBER_ID); a real customer gets their own number later.
        // Sourced from env (single source of truth — rotate the env, new tenants follow).
        const metaToken = process.env.META_ACCESS_TOKEN || "";
        const metaPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "";
        const metaSecrets = await (async () => {
          if (!metaToken || !metaPhoneId) return { wrote: false as const };
          const { data: curSec } = await supabase
            .from("tenants").select("secrets").eq("id", tenantId).single();
          const mergedSecrets = {
            ...((curSec?.secrets as any) || {}),
            meta_phone_number_id: metaPhoneId,
            meta_access_token: metaToken,
            ...(process.env.META_WABA_ID ? { meta_waba_id: process.env.META_WABA_ID } : {}),
          };
          const { error: secErr } = await supabase
            .from("tenants").update({ secrets: mergedSecrets }).eq("id", tenantId);
          return { wrote: !secErr, error: secErr?.message };
        })();

        // Re-assert active here too (not only in step 1): the markers and the
        // status now land together, so a tenant is never "active but unmarked"
        // nor "marked but trial".
        const { error } = await supabase
          .from("tenants")
          .update({ status: "active", settings: merged })
          .eq("id", tenantId);
        if (!error) {
          if (metaSecrets.wrote) {
            push({ step: "meta", message: `Meta WhatsApp creds written (shared sandbox number ${metaPhoneId})`, ok: true });
          } else if (!metaToken || !metaPhoneId) {
            push({ step: "meta", message: `Meta creds NOT set (env META_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID missing) — bot will fall back to Twilio`, ok: false });
          } else {
            push({ step: "meta", message: `Meta creds write failed: ${metaSecrets.error}`, ok: false });
          }
        }
        return error;
      };

      let finalErr = await writeFinal();
      if (finalErr) {
        // One retry — a transient write failure here was the whole incident.
        finalErr = await writeFinal();
        if (finalErr) throw new Error(`final commit: ${finalErr.message}`);
      }

      // Verify it actually landed before reporting success.
      const { data: check } = await supabase
        .from("tenants").select("status, settings").eq("id", tenantId).single();
      const ok = check?.status === "active" &&
        (!input.self_serve || (check?.settings as any)?.onboarding?.completed === true);
      if (!ok) throw new Error("final commit did not persist (status/markers missing)");
    }

    push({ step: "done", message: "Onboarding complete", ok: true });
    return { ok: true, tenant_id: tenantId, details: log };
  } catch (e: any) {
    push({ step: "error", message: e.message || String(e), ok: false });
    return { ok: false, tenant_id: tenantId || undefined, details: log };
  }
}
