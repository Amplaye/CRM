# Handoff: WhatsApp / Meta Embedded Signup onboarding pipeline (in-CRM)

## Session Metadata
- Created: 2026-06-25 12:59:06
- Project: /Users/amplaye/CRM
- Branch: main (⚠️ work NOT yet committed — create a branch before committing)
- Session duration: ~3h (WhatsApp coexistence investigation → build of the Embedded Signup pipeline)

### Recent Commits (for context)
  - a7d0b2f fix(voice): migrate Retell publish to /publish-agent-version
  - 3bc34e7 fix(voice): sober UTILITY wording for missed-call template
  - (older voice fixes)

## Handoff Chain
- **Continues from**: 2026-06-25-111819-queste-modifiche-non-le-vedo-ancora-live.md (unrelated — susan-site)
- **Supersedes**: None

## Current State Summary

Building the **WhatsApp / Meta Embedded Signup onboarding pipeline INSIDE the existing
CRM** (no rebuild). Goal: a restaurant clicks "Connect WhatsApp Business" in the CRM and
completes Meta Embedded Signup (coexistence-capable) without touching Meta Developers;
backend exchanges the code → stores `waba_id`/`phone_number_id` → webhook verifies → one
test template sends. **Plan doc + DB migration + two server libs are DONE. The API routes,
the frontend connect page, the admin status card, and i18n are NOT yet written.** Work was
interrupted right after discovering that the existing `webhook_events` table has a
DIFFERENT shape than my planned webhook receiver assumed (see Gotchas — must adapt).

Nothing has been committed. `npx tsc --noEmit` / `npm run build` have NOT been run yet.

## Codebase Understanding

## Architecture Overview
- Next.js 16 (App Router) + React 19 + TS + Tailwind v4 + Supabase (Postgres+RLS), Vercel.
- **Multi-tenant**: a "restaurant" IS a row in `public.tenants`. Per-tenant secrets in
  `tenants.secrets` (jsonb, **service-role-only** column), per-tenant config in
  `tenants.settings` (jsonb, member-readable).
- WhatsApp = **Meta Cloud API** (NOT Twilio). Sends go through `src/lib/whatsapp/meta.ts`;
  sender number resolved by `src/lib/whatsapp/from.ts` from `settings.whatsapp.from`.
- The **n8n bot** (external repo) reads `tenants.secrets.{meta_access_token,
  meta_phone_number_id}` to send per-tenant → writing a connected tenant's own creds there
  is what actually wires up real sending.
- Webhook verify (GET hub.challenge) + HMAC (POST) ALREADY exist in
  `src/lib/meta-signature.ts`; `FACEBOOK_VERIFY_SIGNATURE=1` is set.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `docs/WHATSAPP_EMBEDDED_SIGNUP.md` | **The full plan/deliverables (A–I): Meta checklist, webhook URL, env, manual steps, failure cases.** | READ FIRST — it's the spec for the rest. |
| `supabase/migrations/20260625_whatsapp_embedded_signup.sql` | New tables `whatsapp_setups` + `meta_whatsapp_connections` (RLS done). | DONE. Not yet applied to DB. |
| `src/lib/whatsapp/embedded-signup.ts` | `exchangeCodeForToken(code)`, `subscribeAppToWaba(wabaId,token)`, `fetchWabaInfo(wabaId,token)` | DONE. |
| `src/lib/whatsapp/connection.ts` | `upsertSetupStatus(tenantId,patch)`, `storeMetaConnection(input)`, `readSetupView(tenantId)` + types | DONE. |
| `src/lib/whatsapp/meta.ts` | `sendWhatsAppMeta(to,body,fromId?,token?)`, `sendWhatsAppTemplate(to,template,language,bodyParams?,fromId?,token?)` | REUSE for test-send. |
| `src/lib/whatsapp/from.ts` | `resolveWhatsAppFrom(tenantFrom?)`, `tenantWhatsAppFrom(settings)` | sender resolution. |
| `src/lib/meta-signature.ts` | `handleMetaWebhookVerification(req)`→Response\|null, `verifyMetaSignature(rawBody,sig,appSecret?)` | REUSE in the new webhook route. |
| `src/app/api/webhooks/whatsapp-delivery/route.ts` | Reference for a Meta-native POST route (reads raw text, verifies HMAC, parses). | COPY this pattern. |
| `src/app/(dashboard)/settings/page.tsx` | `"use client"` page using `useTenant()`+`useLanguage()`. | pattern for the connect page. |
| `src/app/(dashboard)/admin/tenant/[id]/page.tsx` | per-tenant admin page; add WhatsApp card after the Health section (~line 464). | admin status card target. |
| `supabase-schema.sql` | full schema (tenants @22, system_logs @608, webhook_events @678). | column reference. |

### Key Patterns Discovered (exact import paths + signatures)
- `@/lib/supabase/server` → `createServerSupabaseClient()` (async, cookie/auth) · `createServiceRoleClient()` (sync, service-role, bypasses RLS).
- `@/lib/admin-auth` → `assertPlatformAdmin()` (no args) → `{ok:true,userId} | {ok:false,res}`.
- `@/lib/tenant-membership` → `verifyTenantMembership(tenantId, roles?)` → `{userId,role} | null` (has platform_admin bypass).
- `@/lib/system-log` → `logSystemEvent({tenant_id?, category, severity, title, description?, metadata?, error_key?})` + `resolveSystemEvents({error_key})`. system_logs columns = `title`+`description` (NEVER `message`). categories: booking_error|webhook_failure|message_failure|api_error|ai_error|system|n8n_error|health_check|silent_warning. severity: low|medium|high|critical.
- `@/lib/audit` → `logAuditEvent({tenant_id, action, entity_id, idempotency_key?, source, agent_id?, details})`.
- `@/lib/ai-auth` → `assertAiSecret(request)` (x-ai-secret header, fail-closed).
- `@/lib/pos/credentials` → `encryptCredentials(obj)` / `decryptSecret(blob)` (AES-256-GCM, key `POS_CRED_ENC_KEY`). **Available but intentionally NOT used** (token stored as plaintext in `tenants.secrets`, matching existing posture).
- Frontend: pages are `"use client"`; get tenant via `useTenant()` (`activeTenant.id`, `activeRole`, `globalRole`) from `@/lib/contexts/TenantContext`; translations via `useLanguage()` (`t`, `language`) from `@/lib/contexts/LanguageContext`. Fetch pattern: `fetch("/api/...", {method:"POST", body: JSON.stringify({tenant_id: activeTenant.id, ...})})`.
- i18n dictionaries: `src/lib/i18n/dictionaries/{en,es,it,de}.ts` (4 langs).
- Design tokens: bronze `#c4956a`, dark `#8b6540`, cream bg `rgba(252,246,237,0.85)`, Geist font, `text-black` is fine, emerald `#22c55e` ONLY for success/done. `cardStyle = { background:"rgba(252,246,237,0.85)", borderColor:"#c4956a" }`. Primary button gradient: `linear-gradient(135deg,#c4956a,#b8845c)`. Input: `block w-full rounded-lg border-2 px-3 py-2 text-sm focus:ring-1 focus:ring-[#c4956a]` with `{borderColor:"#c4956a", background:"rgba(252,246,237,0.6)"}`.
- No `next/script` usage; load FB SDK via `useEffect` injecting `https://connect.facebook.net/en_US/sdk.js` then `FB.init({appId: NEXT_PUBLIC_FB_APP_ID, version: META_GRAPH_VERSION})`.
- Production domain: **https://crm.baliflowagency.com**.

## Work Completed

### Tasks Finished
- [x] Inspected the whole codebase (data/api/frontend) via 3 parallel agents — see patterns above.
- [x] Audited the LIVE Meta state via Graph API (see Important Context).
- [x] Wrote `docs/WHATSAPP_EMBEDDED_SIGNUP.md` (deliverables A–I).
- [x] Wrote migration `supabase/migrations/20260625_whatsapp_embedded_signup.sql`.
- [x] Wrote `src/lib/whatsapp/embedded-signup.ts` and `src/lib/whatsapp/connection.ts`.

## Files Modified

(All NEW files, none pre-existing modified, nothing committed yet.)
| File | Status |
|------|--------|
| `docs/WHATSAPP_EMBEDDED_SIGNUP.md` | done |
| `supabase/migrations/20260625_whatsapp_embedded_signup.sql` | done |
| `src/lib/whatsapp/embedded-signup.ts` | done |
| `src/lib/whatsapp/connection.ts` | done |

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| **Coexistence** (owner keeps WhatsApp App on phone + bot on same number), not pure API | Owner explicitly requires using WhatsApp on the phone. See memory `baliflow-whatsapp-coexistence-decision`. |
| WA number = **Sofía's personal SIM** (NOT Zadarma) | Zadarma blocks WhatsApp verification; SIM already seasoned ≥1 week. (Flagged to owner: ties WA to a personal SIM.) |
| Store token in `tenants.secrets` (plaintext, service-role-only), NOT a new encrypted column | Matches existing posture (openai_key/ai_secret live there); also wires the n8n bot which reads `secrets.meta_access_token`. `access_token_encrypted` from the spec intentionally dropped. |
| Reuse `webhook_events`/`conversations`/`system_logs`; create only `whatsapp_setups` + `meta_whatsapp_connections` | "extend existing, don't overbuild." spec's `whatsapp_webhook_events`/`whatsapp_message_logs` NOT created. |
| Mirror `phone_number_id` → `settings.whatsapp.from` + `provisioning.whatsapp_attached=true` | makes existing send path (`resolveWhatsAppFrom`) use the tenant's own number with zero code change. |

## Pending Work

## Immediate Next Steps
1. **Write the 5 backend routes** (drafts fully specified in `docs/WHATSAPP_EMBEDDED_SIGNUP.md` §E; lib signatures above):
   - `src/app/api/whatsapp/setup/route.ts` — GET (read `readSetupView`) + POST (record `phone_number_usage` + bump status to `waiting_for_meta_login`). Guard: `verifyTenantMembership(tenant_id)`.
   - `src/app/api/whatsapp/embedded-signup/route.ts` — POST `{tenant_id, code, waba_id, phone_number_id}` → `exchangeCodeForToken` → `fetchWabaInfo` → `subscribeAppToWaba` → `storeMetaConnection` → `upsertSetupStatus`. NEVER return the token. Guard: membership.
   - `src/app/api/whatsapp/test-send/route.ts` — POST `{tenant_id, to, template?, language?}`; read `secrets.{meta_access_token, meta_phone_number_id}` via service-role; `sendWhatsAppTemplate(to, template||"hello_world", language||"en_US", [], fromId, token)`. Guard: membership.
   - `src/app/api/admin/whatsapp-connection/route.ts` — GET/POST manual concierge fallback (`assertPlatformAdmin()`); set identifiers via `storeMetaConnection` (no token) + status/notes via `upsertSetupStatus`.
   - `src/app/api/webhooks/meta/whatsapp/route.ts` — GET `handleMetaWebhookVerification` + POST (raw text → `verifyMetaSignature` → parse → resolve tenant by `phone_number_id` from `meta_whatsapp_connections` → store event). **⚠️ ADAPT to the real `webhook_events` schema — see Gotchas.**
2. **Frontend**: `src/app/(dashboard)/connect-whatsapp/page.tsx` (client) — "Is this number already on WhatsApp?" radio (business_app/normal_whatsapp/new_number/unknown) → POST `/api/whatsapp/setup` → "Connect with Meta" button that loads FB SDK + `FB.login({config_id: NEXT_PUBLIC_META_CONFIG_ID, response_type:'code', override_default_response_type:true, extras:{...}})`, listens for the embedded-signup `message` event to capture `phone_number_id`/`waba_id`, POSTs `{code, waba_id, phone_number_id}` to `/api/whatsapp/embedded-signup`. UI states: connecting / connected / needs-help / failed(reason) / retry. Link it from Settings. Button disabled if `NEXT_PUBLIC_META_CONFIG_ID` missing.
3. **Admin**: WhatsApp status card on `src/app/(dashboard)/admin/tenant/[id]/page.tsx` (~after line 464) reading `/api/admin/whatsapp-connection?tenant_id=` + manual-fallback inputs.
4. **i18n**: add keys in all 4 dictionaries (titles, button, statuses, help text).
5. **Verify**: `npx tsc --noEmit` then `npm run build`. Fix types. (⚠️ NEVER `npm run dev`; one heavy process at a time.)
6. **Commit on a branch** (not main): e.g. `feat/whatsapp-embedded-signup`. Apply the migration to Supabase.

### Blockers/Open Questions (Meta-side — Sofía must do; code is INERT until then)
- [ ] **No Embedded Signup `config_id` yet** → create a Facebook Login for Business config (WhatsApp Embedded Signup template) in the BALI Flow app → set `META_CONFIG_ID` + `NEXT_PUBLIC_META_CONFIG_ID`.
- [ ] **Business `BALI Academy - BusM` NOT verified** (pending_submission). Confirm which business Sofía actually verified — it may be a DIFFERENT one; ES must run under the verified business.
- [ ] **Payment-method error 141006** on the WABA → blocks business-initiated sends.
- [ ] **App Review / Advanced Access** for `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management` not done. (Screencast = record the CRM sending via Cloud API + a template; we already send live + have 29 approved templates.)
- [ ] Add env vars `META_APP_ID`, `NEXT_PUBLIC_FB_APP_ID`, `META_CONFIG_ID`, `NEXT_PUBLIC_META_CONFIG_ID` (+ optional template defaults).

### Deferred Items
- Wiring per-tenant token into the CRM's own `/api/send-whatsapp` (it currently uses env token + tenant number). The **n8n bot already uses per-tenant secrets**, so this is secondary.
- Routing ES-onboarded tenants' inbound messages into the bot (the meta-native webhook currently just stores events).
- Template-builder UI (deferred per "don't overbuild" — drafts stored for admin review only).

## Context for Resuming Agent

## Important Context
- **Live Meta state (audited via Graph API with our token on 2026-06-25):**
  - App = **"BALI Flow"**, App ID `1259805589309723`. System-user token is named "Sofía". Scopes: whatsapp_business_management, whatsapp_business_messaging, whatsapp_business_manage_events.
  - WABA `1743138427053257` = **TEST** ("Test WhatsApp Business Account"). Only phone = Meta **test number +1 555-642-2317** (`phone_number_id 1095078260361095`, platform_type CLOUD_API). **Sofía's real SIM is NOT connected anywhere yet.**
  - Owner business = **"BALI Academy - BusM"** (`905021967715680`) → **business_verification_status = pending_submission** + **payment error 141006** → `can_send_message: BLOCKED`.
  - 29 templates APPROVED (booking_confirmation/reminder, missed_call_notice, post_visit_*, waitlist_table_available in es/it/en/de; hello_world; jaspers_market samples).
- **The build can ship now but Embedded Signup won't function end-to-end until the Meta manual steps (docs §G) are done by Sofía.** The biggest immediate unblock is the `config_id`.
- **Sofía communication**: she's the on-the-ground contact in Spain (`+34684109244`); we message her in **Spanish as "Jarvis"** via the Meta number using a python sender at `<scratchpad>/send_sofia.py` (reads a `.txt` msg file; uses `META_ACCESS_TOKEN`/`META_WHATSAPP_PHONE_NUMBER_ID` from `.env.local`). 5 messages sent. **Her last open questions await answers (relayed by the user): (a) which business did she verify exactly? (b) does it have a payment method?** The user said "talk to Sofía directly and explain everything very simply." A prepared (UNSENT) answer about App Review demonstration + BSP fallbacks is in `<scratchpad>/sofia-msg4.txt` (superseded by the test-WABA findings — re-evaluate before sending).

## Assumptions Made
- "Restaurant/client" == `public.tenants` row (used `tenant_id` everywhere, NOT a new `restaurants` table).
- The connect page lives under `(dashboard)` and authenticates via the existing session/`useTenant()`.
- The Meta webhook callback URL for ES tenants will be `https://crm.baliflowagency.com/api/webhooks/meta/whatsapp`.

## Potential Gotchas
- 🔴 **`webhook_events` schema mismatch** (discovered just before pausing). Real columns (supabase-schema.sql:678): `id, tenant_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, type TEXT NOT NULL, payload jsonb, status('processing'|'success'|'failed'), error_log, handoff_to_human, created_at`. My draft webhook route assumed `event_type/raw_payload/processed/nullable tenant_id` — **WRONG**. Adapt: use `type` + `payload`; provide an `idempotency_key` (Meta message id, or `${phone_number_id}:${msg_or_status_id}`); `tenant_id` is TEXT + NOT NULL → only insert when the tenant is resolved (else `logSystemEvent` + still return 200). Drop `processed`.
- ⚠️ **NEVER run `npm run dev`** (project rule). Use `npx tsc --noEmit` / `npm test` / `npm run build`, and only ONE heavy process at a time.
- ⚠️ Next.js 16 has breaking changes — `AGENTS.md` says read `node_modules/next/dist/docs/` before writing Next code; don't trust memory.
- Webhook verify + HMAC already work and `FACEBOOK_VERIFY_SIGNATURE=1` — don't rebuild them; reuse `meta-signature.ts`.
- `.upsert(row, {onConflict:"tenant_id"})` works because both new tables have `unique(tenant_id)`.
- Migration not yet applied to Supabase — routes will 500 on missing tables until it is.
- Don't log full tokens; never put tokens/secrets in the frontend bundle (only `NEXT_PUBLIC_*` app id + config id are public).

## Environment State
### Tools/Services Used
- Supabase (service-role for server writes), Meta Graph API (v21.0 via `META_GRAPH_VERSION`), Vercel (Hobby — daily cron only).
- Sent test WhatsApp messages to Sofía via Graph API (worked: HTTP 200, 24h window open).

### Active Processes
- None. No build/test/dev running.

### Environment Variables (NAMES only)
- Present: `META_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` (=test number 1095078260361095), `META_GRAPH_VERSION` (v21.0), `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `META_WABA_ID` (=1743138427053257), `FACEBOOK_VERIFY_SIGNATURE` (=1), `POS_CRED_ENC_KEY`, plus Supabase/OpenAI/n8n/Trello/Vapi keys.
- **To ADD**: `META_APP_ID` (=1259805589309723), `NEXT_PUBLIC_FB_APP_ID`, `META_CONFIG_ID` (from Sofía after creating the FB-Login config), `NEXT_PUBLIC_META_CONFIG_ID`, `WHATSAPP_DEFAULT_TEMPLATE_NAME` (hello_world), `WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE` (en_US).

## Related Resources
- `docs/WHATSAPP_EMBEDDED_SIGNUP.md` — the authoritative plan (deliverables A–I).
- Memory: `baliflow-whatsapp-coexistence-decision.md` (decision + discovered state), `sofia-voice-contact-bali.md` (how to message Sofía).
- `supabase-schema.sql` (tenants @22, system_logs @608, webhook_events @678); `supabase/migrations/20260609_billing.sql` (RLS pattern reference).

---
**Security Reminder**: env section lists NAMES only. App ID / WABA ID / phone_number_id are non-secret identifiers; no tokens or app secret values are included.
