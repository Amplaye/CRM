// Onboarding orchestrator: turn a wizard form payload into a fully
// provisioned tenant (DB rows + Supabase data + Cloudflare bot-engine wiring).
// All steps are idempotent-friendly: on failure we report which step
// failed so the caller can retry without leaving partial state behind.
//
// The chatbot engine is the Cloudflare Worker (bot-engine), which is fully
// DYNAMIC: it resolves a tenant at runtime from Supabase (own number →
// meta_whatsapp_connections) or from the KV `sandbox:tenants` list (shared
// sandbox number). So a new tenant needs NO cloned workflows — it just needs its
// Supabase rows + the engine flag + (for the sandbox demo phase) a line in the
// KV list. This replaces the old step that cloned 14 n8n workflows per tenant.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/tenants/create-tenant";
import { resolveProvisioningMarkers } from "@/lib/tenants/provisioning-markers";
import { addSandboxTenant } from "@/lib/tenants/sandbox-registry";
import { complianceSettingsForPhone } from "@/lib/compliance/detect-country";

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
  // Booking-policy thresholds the CLONED n8n bot reads from settings.bot_config
  // (NOT from last_reservation_offset/auto_confirm — those drive the KB prose and
  // the CRM availability API, but the bot's own gatekeeping reads these keys).
  // Without them every clone fell back to the bot's hardcoded Picnic defaults
  // (large=7, block=13, closing offset=45), so a wizard that said "groups 10+"
  // or "30 min before close" was silently ignored. See botConfigFromQuestionnaire.
  // Optional: the admin wizard omits it → the bot keeps its built-in defaults.
  booking_policy?: {
    party_size_threshold_large: number; // party size at/above which it's a pending request
    party_size_block_threshold: number; // party size above which it's refused outright
    closing_time_offset_min: number; // minutes before close the last reservation is taken
  };
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

// (Historical note: onboarding used to clone 14 n8n workflows per tenant from a
// golden template. n8n is shut down; the bot-engine Worker resolves each tenant
// dynamically, so there is nothing to clone. See the module header + step 6.)

// Build a realistic table layout whose seat total equals the capacity the owner
// declared in the questionnaire. We no longer ask for a small/medium/large
// preset: the declared seat count is the single source of truth, so the Tables
// section and the KB always agree (they used to drift — the preset made N tables
// of mixed 2/4/6 seats, unrelated to the declared capacity).
//
// Mix: mostly 2- and 4-tops with the occasional 6-top, the bread-and-butter of a
// real dining room. We lay them out greedily until the running seat total
// reaches the target, then trim/pad the LAST table so the sum lands EXACTLY on
// the declared number (clamped to a sane 2..300 range).
// The upper bound is just a runaway guard (a typo of 99999 shouldn't mint
// thousands of tables); a real 51-seat venue must NOT be silently truncated.
//
// Zones: ONLY split half-inside/half-out when the owner declared a terrace in the
// wizard (settings.features.terrace). Without a terrace every table is "inside" —
// otherwise a venue that said "no terrace" was still born with an outside room
// ("sala esterna"), contradicting the toggle.
export function buildTablesForCapacity(tenantId: string, declaredSeats: number, hasTerrace: boolean) {
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

  // No terrace → everything inside (insideCount = all). With a terrace, half out.
  const insideCount = hasTerrace ? Math.ceil(sizes.length / 2) : sizes.length;
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
        // The WhatsApp number the owner typed in the wizard. Read by the CRM
        // (pending/reservations/waitlist) as settings.owner_phone to notify the
        // RIGHT owner. Without this it was dropped and every tenant fell back to
        // the bot's hardcoded Picnic number — owners got each other's bookings.
        owner_phone: input.owner_phone.startsWith("+") ? input.owner_phone : `+${input.owner_phone}`,
        // restaurant_phone + review_url live at the TOP LEVEL of settings: this is
        // the source of truth the Settings → Bookings tab edits AND the value the
        // bot-engine Worker reads LIVE at runtime for reminders/follow-up/etc.
        // Persisting them here is what makes a freshly-onboarded tenant use ITS OWN
        // phone + review link.
        restaurant_phone: input.restaurant_phone,
        review_url: input.review_url,
        last_reservation_offset: input.last_reservation_offset || { lunch: 45, dinner: 60 },
        avg_spend: 25,
        avg_cost: 10,
        ai_monthly_cost: 450,
        no_show_baseline_pct: 15,
        ai_enabled_channels: ["whatsapp", "voice"],
        currency: "EUR",
        // Voice tier: every new tenant is born on the BASE provider (Vapi), served
        // by the shared engine assistant. A premium upgrade (Retell) flips
        // voice.provider later via the admin switch — see voice-provider.ts.
        voice: { provider: "vapi" as const },
        // Feature flags from the wizard answers (terrace/pets/events/languages/
        // double-shift). Read by Settings → Features and the bot's info source.
        ...(input.features ? { features: input.features } : {}),
        // Booking-confirmation venue subset, read by /api/ai/book to repeat the
        // address (+ maps link), parking, deposit and cancellation in the recap.
        ...(input.venue ? { venue: input.venue } : {}),
        // Provisioning markers written at row creation. sandbox_routable is what
        // makes a tenant appear in the shared "which restaurant?" test menu — but
        // on the Cloudflare engine that menu is driven by the KV `sandbox:tenants`
        // list (populated in step 6 below), NOT by this flag; the flag stays as the
        // DB record of "this tenant is a sandbox test tenant". engine:"cloudflare"
        // is set explicitly: every NEW tenant is born on the Worker (the n8n branch
        // is legacy-only). See docs/SANDBOX_ROUTER.md + getBotEngine().
        provisioning: { ...resolveProvisioningMarkers(undefined, input.slug), engine: "cloudflare" as const },
      };
      // Booking-policy thresholds + primary language the bot reads from
      // settings.bot_config. Merged (not replaced) onto whatever bot_config the tenant
      // already had, so a new tenant enforces ITS OWN thresholds/default-language
      // instead of the bot's hardcoded Picnic defaults — without clobbering any other
      // bot_config a prior step wrote.
      //
      // primary_language is the wizard's "star" (languages[0]). The bot reads
      // settings.bot_config.primary_language for the default/fallback reply language.
      // Without this it fell back to 'es' for every tenant regardless of the star —
      // e.g. an owner picking Italian still got a Spanish-defaulting bot.
      // Data-protection policy, derived from the venue's dialling prefix. Self-signup
      // has no phone yet, so this wizard is the first point where the market is
      // actually known — without it the tenant keeps `compliance` unset and the
      // retention cron skips it forever. Never overwrites a policy already set (an
      // admin may have configured it by hand), and stays absent for markets outside
      // ES/IT/DE/CH rather than inventing a legal regime. See lib/compliance/detect-country.
      const mergeCompliance = (existing: Record<string, any> | undefined) => {
        if (existing?.country) return existing;
        const derived = complianceSettingsForPhone(input.restaurant_phone || input.owner_phone);
        if (!derived) return existing;
        return { ...(existing || {}), ...derived };
      };

      const mergeBotConfig = (existing: Record<string, any> | undefined) => {
        const merged = {
          ...(existing || {}),
          primary_language: input.language,
          // The bot reads bot_config.responsible_phone to decide WHO gets the
          // "NUEVA RESERVA"/"GRUPO GRANDE" owner alerts. Without it the bot fell
          // back to a hardcoded Picnic number, so every tenant's owner alerts went
          // to Picnic's owner. Persist the wizard number so each tenant alerts ITS owner.
          responsible_phone: input.owner_phone.startsWith("+") ? input.owner_phone : `+${input.owner_phone}`,
        };
        if (input.booking_policy) Object.assign(merged, input.booking_policy);
        return merged;
      };

      if (input.tenant_id) {
        // Self-serve: the owner's trial tenant already exists. Merge the
        // provisioning settings onto whatever the signup wrote and flip it to
        // "active" (full bot now provisioned).
        const { data: cur, error: getErr } = await supabase
          .from("tenants").select("settings").eq("id", input.tenant_id).single();
        if (getErr || !cur) throw new Error(`tenant ${input.tenant_id} not found`);
        const prevSettings = (cur.settings as any) || {};
        const mergedSettings = { ...prevSettings, ...provisioningSettings };
        // Deep-merge provisioning so the early markers (sandbox_routable/slug) are
        // added to — not replacing — whatever signup already wrote (e.g. a
        // self_serve flag), and so a re-run never drops an attached number.
        mergedSettings.provisioning = resolveProvisioningMarkers(prevSettings.provisioning, input.slug);
        const mergedBotCfg = mergeBotConfig(prevSettings.bot_config);
        if (mergedBotCfg) mergedSettings.bot_config = mergedBotCfg;
        const mergedCompliance = mergeCompliance(prevSettings.compliance);
        if (mergedCompliance) mergedSettings.compliance = mergedCompliance;
        const { error: updErr } = await supabase
          .from("tenants")
          .update({ name: input.restaurant_name, status: "active", settings: mergedSettings })
          .eq("id", input.tenant_id);
        if (updErr) throw new Error(`tenant upgrade: ${updErr.message}`);
        tenantId = input.tenant_id;
        push({ step: "tenant", message: `Tenant upgraded (${tenantId})`, ok: true, data: { tenant_id: tenantId } });
      } else {
        // Admin wizard provisions the full bot → born "active" (ready for traffic).
        const createBotCfg = mergeBotConfig(undefined);
        const created = await createTenant(supabase, {
          name: input.restaurant_name,
          status: "active",
          // createTenant derives settings.compliance.country from this.
          phone: input.restaurant_phone || input.owner_phone,
          settings: createBotCfg
            ? { ...provisioningSettings, bot_config: createBotCfg }
            : provisioningSettings,
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
        const tables = buildTablesForCapacity(
          tenantId,
          input.capacity_seats,
          input.features?.terrace ?? false,
        );
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
        // Only real KB articles are stored now. The behavioural voice prompt is
        // NOT persisted per tenant anymore: the shared engine composes it from
        // the CODE template (buildVoicePrompt) + these KB articles at call time,
        // so there is no frozen "VOICE PROMPT" snapshot to drift out of date.
        const articles = input.kb_articles.map((a) => ({
          tenant_id: tenantId,
          title: a.title,
          content: a.content,
          category: a.category || "general",
          status: "published",
        }));
        const { error } = await supabase.from("knowledge_articles").insert(articles);
        if (error) throw new Error(`KB insert: ${error.message}`);
        push({ step: "kb", message: `${articles.length} KB articles inserted`, ok: true });
      }
    }

    // 4. Voice — nothing to provision. Every tenant is served by the SHARED
    //    engine assistant (lib/voice/engine.ts), which composes this tenant's
    //    prompt fresh from the code template + its DB KB/hours on every call.
    //    No per-tenant clone, no system-prompt sync. settings.voice.provider was
    //    set to "vapi" in step 1. To take web calls, add a slug→tenant_id line
    //    to the booking widget (one line, like the chat router).
    push({ step: "vapi", message: "Voice served by shared engine (no per-tenant clone)", ok: true });

    // 6. Chatbot engine (Cloudflare Worker) — nothing to clone. The bot-engine
    //    Worker resolves this tenant dynamically at runtime: on its OWN number via
    //    Supabase (meta_whatsapp_connections), or on the shared SANDBOX number via
    //    the KV `sandbox:tenants` list. All the Worker needs is the Supabase rows
    //    written above (+ engine:"cloudflare" from step 1). For the demo phase,
    //    register the tenant in the sandbox routing list so it appears in the
    //    "which restaurant?" menu on the shared number — the one thing the old n8n
    //    [Meta Router] clone did that has no DB equivalent.
    //
    //    Non-fatal: a sandbox-registry failure (Worker unreachable, no CRON_SECRET)
    //    must NOT fail onboarding — the tenant is fully provisioned in the DB and
    //    reachable on its own number regardless; only the shared test menu waits.
    //    A real customer on their own number isn't sandbox_routable, so we skip it.
    {
      // Read back the authoritative routability marker (step 1 already wrote it,
      // honouring any prior number-attach in self-serve) rather than recomputing.
      const { data: engRow } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
      const routable = ((engRow?.settings as any)?.provisioning?.sandbox_routable) === true;
      if (routable) {
        const added = await addSandboxTenant(tenantId, input.restaurant_name);
        push({
          step: "engine",
          message: added
            ? "Tenant registered in the Cloudflare sandbox routing list"
            : "Sandbox registration deferred (Worker unreachable / no CRON_SECRET) — retry via reconcile; tenant still reachable on its own number",
          ok: added,
        });
      } else {
        push({ step: "engine", message: "Own number — no sandbox registration needed", ok: true });
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

    // 8. Final commit: (self-serve) the provisioning markers + re-assert
    //    status:active. This is the step the chef-oraz incident lost, so it must be
    //    the LAST thing and must actually land: we read back the row and retry once
    //    if the markers aren't there. Marking onboarding.completed also stops the
    //    dashboard guard from bouncing the owner back into the wizard.
    {
      const writeFinal = async () => {
        const { data: cur } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
        const prev = (cur?.settings as any) || {};
        const merged: Record<string, any> = { ...prev };
        // sandbox_routable:true → while no real WA number is attached, this tenant
        // shares the single Meta sandbox number with the other test tenants. On the
        // Cloudflare engine, the shared "which restaurant?" menu is driven by the KV
        // `sandbox:tenants` list (written in step 6), not by this flag; the flag is
        // the DB record of "sandbox test tenant". Written for BOTH paths (admin +
        // self-serve). A real customer (own number) gets sandbox_routable cleared at
        // number-attach time. See docs/SANDBOX_ROUTER.md.
        // The routability markers are written EARLY (step 1), so here we only ensure
        // they exist without CLOBBERING a later number-attach (own number wins), and
        // re-assert engine:"cloudflare" so a re-run never leaves the flag off.
        merged.provisioning = { ...resolveProvisioningMarkers(prev.provisioning, input.slug), engine: "cloudflare" as const };
        if (input.self_serve) {
          merged.onboarding = { ...(prev.onboarding || {}), completed: true, completed_at: new Date().toISOString() };
          merged.provisioning.self_serve = true;
          merged.provisioning.completed_at = new Date().toISOString();
        }

        // Meta WhatsApp creds → tenants.secrets (NOT settings.bot_config, which is
        // member-readable; matches how Picnic stores them after the L5 security
        // hardening). The bot-engine reads the token from {bot_config ∪ secrets}
        // and sends via Meta when meta_phone_number_id + meta_access_token are both
        // present (META_ON). Without this, a new tenant has no Meta creds and
        // silently falls back to the Twilio sandbox — we want every new tenant to be
        // born on Meta. During the demo phase all tenants share the one sandbox number
        // (META_WHATSAPP_PHONE_NUMBER_ID); a real customer gets their own number later.
        // Sourced from env (single source of truth — rotate the env, new tenants follow).
        const metaToken = process.env.META_ACCESS_TOKEN || "";
        const metaPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "";
        // ENGINE creds → tenants.secrets. The unified chatbot engine reads
        // {bot_config ∪ secrets} at runtime and calls OpenAI with `openai_key`
        // and gates the CRM /api/ai/* routes with `ai_secret`. Without these a
        // fresh tenant calls OpenAI with an empty Bearer token → 401 →
        // the engine's catch fires the "no consigo procesar tu mensaje" fallback.
        // This was the ryan-onir / Lugares-Mágicos failure mode: born with only
        // the Meta creds. Sourced from env (single source of truth — rotate the
        // env, new tenants follow), same pattern as the Meta creds below.
        const openaiKey = process.env.OPENAI_API_KEY || "";
        const aiSecret = process.env.AI_WEBHOOK_SECRET || "";
        const metaSecrets = await (async () => {
          const { data: curSec } = await supabase
            .from("tenants").select("secrets").eq("id", tenantId).single();
          const mergedSecrets: Record<string, string> = {
            ...((curSec?.secrets as any) || {}),
            ...(openaiKey ? { openai_key: openaiKey } : {}),
            ...(aiSecret ? { ai_secret: aiSecret } : {}),
            ...(metaToken && metaPhoneId
              ? {
                  meta_phone_number_id: metaPhoneId,
                  meta_access_token: metaToken,
                  ...(process.env.META_WABA_ID ? { meta_waba_id: process.env.META_WABA_ID } : {}),
                }
              : {}),
          };
          const { error: secErr } = await supabase
            .from("tenants").update({ secrets: mergedSecrets }).eq("id", tenantId);
          return {
            wrote: !secErr,
            error: secErr?.message,
            engineCreds: Boolean(openaiKey && aiSecret),
            metaCreds: Boolean(metaToken && metaPhoneId),
          };
        })();

        // Re-assert active here too (not only in step 1): the markers and the
        // status now land together, so a tenant is never "active but unmarked"
        // nor "marked but trial".
        const { error } = await supabase
          .from("tenants")
          .update({ status: "active", settings: merged })
          .eq("id", tenantId);
        if (!error) {
          if (!metaSecrets.wrote) {
            push({ step: "secrets", message: `Tenant secrets write failed: ${metaSecrets.error}`, ok: false });
          } else {
            // Engine creds are the hard requirement — without openai_key the bot
            // can't answer at all (the "no consigo procesar" fallback).
            if (metaSecrets.engineCreds) {
              push({ step: "engine-creds", message: `Engine creds written (openai_key + ai_secret)`, ok: true });
            } else {
              push({ step: "engine-creds", message: `Engine creds NOT set (env OPENAI_API_KEY / AI_WEBHOOK_SECRET missing) — chatbot will reply with the error fallback`, ok: false });
            }
            if (metaSecrets.metaCreds) {
              push({ step: "meta", message: `Meta WhatsApp creds written (shared sandbox number ${metaPhoneId})`, ok: true });
            } else {
              push({ step: "meta", message: `Meta creds NOT set (env META_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID missing) — bot will fall back to Twilio`, ok: false });
            }
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

      // Verify it actually landed before reporting success. We check the
      // routability marker too: a tenant that's active but NOT sandbox_routable
      // (and without its own number) is exactly the invisible-in-test-menu bug we
      // fixed — never report "done" in that state.
      const { data: check } = await supabase
        .from("tenants").select("status, settings").eq("id", tenantId).single();
      const cs = (check?.settings || {}) as Record<string, any>;
      const prov = cs.provisioning || {};
      const routableOrAttached = prov.sandbox_routable === true || prov.whatsapp_attached === true;
      const onCloudflare = prov.engine === "cloudflare";
      const ok = check?.status === "active" &&
        routableOrAttached &&
        onCloudflare &&
        (!input.self_serve || cs?.onboarding?.completed === true);
      if (!ok) throw new Error("final commit did not persist (status/routability/engine markers missing)");
    }

    push({ step: "done", message: "Onboarding complete", ok: true });
    return { ok: true, tenant_id: tenantId, details: log };
  } catch (e: any) {
    push({ step: "error", message: e.message || String(e), ok: false });
    return { ok: false, tenant_id: tenantId || undefined, details: log };
  }
}
