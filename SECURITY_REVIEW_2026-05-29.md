# Security Review — BaliFlow / Picnic CRM

**Date:** 2026-05-29
**Scope:** Full codebase audit of the multi-tenant Next.js + Supabase CRM (`/Users/amplaye/CRM`). Picnic is one tenant inside this app.
**Method:** 5 specialized reviewers partitioned by trust boundary (AI/webhook routes, admin routes, auth/tenant-isolation, secrets/injection/SSRF, SQL/RLS schema) → every finding independently re-checked by an adversarial verifier that re-read the code to refute it. 35 raw findings → **33 confirmed, 2 refuted**. Highest-severity items also confirmed by hand against the source.

> Note: this is **not** a "pending diff" review — `main` is clean (one modified doc). It's a full-surface audit, which is far more useful for a system holding guest PII, multi-tenant data, and payment-incurring integrations.

## Result

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 7 |
| 🟠 HIGH | 16 |
| 🟡 MEDIUM | 4 |
| ⚪ LOW | 6 |

**Root cause, in one line:** the middleware exempts **every `/api/*` path** from auth (by design — APIs self-authorize), but a large fraction of routes either (a) forgot to add a check, (b) use a **fail-open** guard that allows everything when an env var is unset, or (c) use the RLS-bypassing **service-role** client while trusting a `tenant_id` taken straight from the request body. On top of that, one **RLS policy lets any logged-in user promote themselves to platform admin**.

---

## 🔴 CRITICAL

### C1 — Self-service privilege escalation to `platform_admin` (RLS)
**`supabase-schema.sql:388`** (policy), `345-351` (`is_platform_admin`)
```sql
create policy "Users can update own profile" on public.users
  for update using (id = auth.uid());   -- ⚠ no WITH CHECK, no column restriction
```
A `for update ... using` policy **without `with check`** lets a row that matches `using` be updated to *any* new value. The browser talks to Supabase directly with the **anon key** (`src/lib/supabase/client.ts`), so any authenticated user — including a freshly self-registered member or a `host` added by QR — can issue:
```
PATCH /rest/v1/users?id=eq.<their-own-uid>
apikey: <anon>   Authorization: Bearer <their-jwt>
{ "global_role": "platform_admin" }
```
The `using` clause still passes (own row), there's no `with check`, and the column `CHECK` permits `'platform_admin'`. They are now a platform admin: `private.is_platform_admin()` (used in the `or ...` branch of **every** core table policy) returns true → read/write of **every tenant's** data, and `assertPlatformAdmin()` hands them the whole `/api/admin/*` surface.
**Fix:** `... for update using (id = auth.uid()) with check (id = auth.uid() and global_role = (select global_role from public.users where id = auth.uid()))`. Better: move `global_role` writes behind a `SECURITY DEFINER` function callable only by platform admins, and `REVOKE UPDATE (global_role) ON public.users FROM authenticated`.

### C2 — `/api/ai/*` fails open → entire reservation engine unauthenticated
**`src/lib/ai-auth.ts:23-28`**
```ts
const expected = process.env.AI_WEBHOOK_SECRET;
if (!expected) {
  console.warn('[SECURITY] AI_WEBHOOK_SECRET not set — /api/ai/* accepting all requests');
  return null;   // ⚠ allow
}
```
`assertAiSecret` is the **sole** auth on all 13 `/api/ai/*` routes. When `AI_WEBHOOK_SECRET` is unset it allows everything. `.env.local` contains **no** `AI_WEBHOOK_SECRET`, there's no `vercel.json` env block, and the in-code comments describe this as an intended "safe rollout" window — i.e. an **active exposure**. Combined with C5, an anonymous attacker can drive the whole engine (create/modify/cancel reservations, read PII, trigger paid WhatsApp).
**Fix:** fail **closed** — if the secret is unset, refuse (or throw at boot in production). Set `AI_WEBHOOK_SECRET` in Vercel for all environments and verify every `/api/ai/*` route returns 401 without the header.

### C3 — Unauthenticated WhatsApp send as the platform
**`src/app/api/admin/bali/send/route.ts:5-58`** — no auth check at all; uses the service-role client.
```
POST /api/admin/bali/send  { "conversation_id": "...", "body": "anything" }
```
Sends an arbitrary WhatsApp message via the platform's Meta token to whatever phone is on that conversation, saves it as a "human" reply, and flips `human_takeover=true`. Anyone on the internet → message customers **as the business**, burn the Meta account's reputation, and incur send costs.
**Fix:** `assertPlatformAdmin()` at the top, and verify the conversation belongs to a tenant the caller is authorized for.

### C4 — Cross-tenant write/read on every AI + webhook route via attacker-supplied `tenant_id`
**`src/app/api/ai/book/route.ts:33-110`** (representative; same pattern across the AI surface)
The routes take `tenant_id` straight from the request body/query and query with the **service-role** client (RLS bypassed) — no check that the caller owns that tenant. With C2's fail-open auth, an anonymous attacker picks **any** `tenant_id` and creates/reads/writes reservations and guest rows for it. The guest `insert` writes `tenant_id: payload.tenant_id` unverified.
**Fix:** never trust a body-supplied `tenant_id`. Derive the tenant from the authenticated principal (per-tenant API key → its own tenant_id), and reject mismatches.

### C5 — `/api/webhooks/incoming-message` POST: no auth, no signature verification
**`src/app/api/webhooks/incoming-message/route.ts:17-25`** — POST reads `payload.tenant_id` from the body, uses the service-role client, and never calls `verifyMetaSignature` or `assertAiSecret` (the GET handshake is the only verification in the file). Anyone who knows a `tenant_id` (a non-secret UUID, leaked by the open admin routes below) can forge inbound WhatsApp messages: inject attacker-controlled text into `conversations.transcript`/`summary` (shown to staff **and** fed verbatim into the GPT-5.1 prompt in `conversation-summary` → prompt injection into a privileged LLM whose output is written back to the CRM), overwrite guest PII, and force `escalated`/`resolved` states.
**Fix:** verify `X-Hub-Signature-256` (fail-closed) and/or require `assertAiSecret`; authorize `tenant_id` instead of trusting it.

### C6 — Meta webhook signature verification is fail-open **and never invoked**
**`src/lib/meta-signature.ts:31-48`** — `verifyMetaSignature` returns `true` when `FACEBOOK_VERIFY_SIGNATURE !== '1'` (unset in `.env.local`), and grep shows it's **not called in any webhook POST**. The infrastructure is correct and well-written — it's just disabled and unwired. This is what makes C5 and the delivery routes (M1/M2) forgeable.
**Fix:** wire `verifyMetaRequest`/`verifyMetaSignature` into every Meta POST handler; set `FACEBOOK_VERIFY_SIGNATURE=1` + `META_APP_SECRET` in prod; make it fail-closed in production.

### C7 — Server actions trust client-supplied `tenantId` with service-role writes
**`src/app/actions/reservations.ts:17-51, 203-240`; `src/app/actions/waitlist.ts:9-27, 188-199`** — privileged server actions take `tenantId` from the caller and write with the service-role client without verifying the user belongs to that tenant. A logged-in user of demo tenant A can create/cancel reservations and read PII for tenant B by passing B's id.
**Fix:** in every server action, `getUser()` then verify `tenant_members` membership (with the required role) for the passed `tenantId` before any mutation.

---

## 🟠 HIGH

**Unauthenticated `/api/admin/*` routes** (no `assertPlatformAdmin`, all use service-role / RLS bypassed):

| Route | Method | Impact |
|-------|--------|--------|
| `admin/bali/conversations` (`:4-20`) | GET | Reads up to 200 conversations **across all tenants** — guest phones, previews, ids |
| `admin/bali/messages` (`:4-33`) | GET | Reads full message thread (≤500) of any conversation; resets `unread_count` (hides msgs from staff) |
| `admin/bali/takeover` (`:4-31`) | PATCH | Toggles bot on/off for any conversation (manipulate/DoS live support) |
| `admin/client-notes` (`:4-55`) | GET/POST/DELETE | Read all internal client notes across tenants; inject; delete by id |
| `admin/overview` (`:8-19`) | GET | Auth only runs `if (x-user-id header present)` — **omit the header** → all-tenant ops/revenue. Even present, it's a self-asserted id, not the session |
| `admin/system-logs` (`:4-55`) | GET/PATCH | Read all logs; PATCH any to `resolved` (suppress real alerts) |
| `admin/tenant` (`:6-92`) | GET | PATCH is correctly gated; **GET is not** → any tenant's reservations w/ guest name+phone, summaries, incidents |
| `admin/usage` (`:4-87`) | GET | Every tenant's monthly fee, per-channel cost, margins, volumes — full revenue/cost book |

**Fix for all:** add `const auth = await assertPlatformAdmin(); if (!auth.ok) return auth.res;` to the top of **every** handler (each HTTP method). Where data should be tenant-scoped, also filter by the caller's tenant.

Other HIGH:

- **H — Legacy bearer scheme: `Bearer <tenant_id>` is a valid API key.** `src/lib/tenant-auth.ts:8-38` resolves keys via `key_hash`, and the schema seeds `key_hash = sha256(tenant_id)` for every tenant. `tenant_id` is a non-secret UUID leaked by the open admin routes above → anyone who learns one authenticates as that tenant on every API-key-gated route. **Fix:** revoke all `legacy-bearer-tenant-id` rows; accept only the high-entropy keys from the api-keys route (`crypto.randomBytes(32)`, already implemented).
- **H — IDOR by phone (no auth):** `ai/cancel-by-phone:24-92`, `ai/confirm-pending`, `ai/conversation-summary` (phone fallback `:51-79`). With C2 fail-open, supply any `tenant_id` + any `guest_phone` (matched on last-9-digits) to cancel/confirm a stranger's nearest reservation or read their recent conversation. **Fix:** require tenant-bound auth + a possession proof for guest-initiated cancels.
- **H — Unauthenticated paid WhatsApp blast:** `ai/waitlist-process:31-64`, `ai/waitlist-reassurance`. POST `{tenant_id, date}` → creates holds and sends `sendWhatsAppMeta` to every waiting guest **and** the owner. Cost + spam abuse. **Fix:** real per-tenant auth (cron/n8n credential, not fail-open shared secret) + rate limit.
- **H — `/api/insights:32-71` fully unauthenticated.** No `getUser`/secret/admin check; not even under a CORS-guarded prefix. `GET /api/insights?tenant_id=<uuid>` → any tenant's reservation/conversation/revenue data. **Fix:** require a dashboard session + membership (or platform_admin).
- **H — `/api/send-whatsapp:8-44`** accepts **any** logged-in user (no tenant scoping). Resolves `tenant_from` from an attacker-supplied `tenant_id` and sends to an attacker-chosen `to`. A host of a demo tenant sends WhatsApp as any other tenant. **Fix:** verify membership of `tenant_id` before resolving the sender.
- **H — `/api/sync-kb-vapi` & `/api/sync-vapi-voicemail`** accept any logged-in user, take `tenant_id` from the body, and **PATCH the live Vapi assistant** (system prompt, KB, firstMessage, **transferCall destination**) of that tenant. Any user can hijack another tenant's voice agent — including redirecting calls. **Fix:** verify owner/manager membership of the body's `tenant_id` after `getUser()`.
- **H — SSRF in menu import:** `src/lib/menu/fetch-url.ts:39-87`. The guard validates only the literal hostname string, then `fetch(url, {redirect:'follow'})`. Bypasses: (1) cloud metadata IP `169.254.169.254`, (2) DNS rebinding, (3) a public URL that 30x-redirects to an internal address (no re-validation after redirect). Any authenticated staff of any tenant can probe the internal network / cloud metadata. **Fix:** `dns.lookup(host,{all:true})` before connecting; reject if **any** resolved IP is private/loopback/link-local/CGNAT/unspecified; set `redirect:'manual'` and re-validate each hop; cap response size/time.
- **H — Committed seed password.** `scripts/seed.ts:13-17` (git-tracked) creates auth users — including `admin@baliflow.com` with `global_role: 'platform_admin'` — with the static password `password123`. If ever run against staging/prod, that's an admin login with a known password. **Fix:** random per-user password printed once, or from env; never a static password for an admin; guard the script against non-local Supabase URLs.

---

## 🟡 MEDIUM

- **M1 — `/api/webhooks/whatsapp-delivery:26-83`** — no auth/signature; forges `audit_events` for any tenant. **Fix:** verify Meta signature (fail-closed), validate tenant ownership, whitelist persisted fields.
- **M2 — `/api/twilio/delivery-callback:41-73`** — Twilio signature check fail-open (`TWILIO_VERIFY_SIGNATURE` unset). **Fix:** enable + fail-closed, or remove the route (WhatsApp has moved to Meta).
- **M3 — `conversations/[id]/markdown:13-49`** — no tenant-membership check and fail-open secret → cross-tenant transcript/PII read by conversation id. **Fix:** require `getUser()` + membership of `data.tenant_id` for the dashboard path.
- **M4 — `/api/register-tenant` & `/api/guest-setup` (`:5-39`)** — create tenants with **no session** and an attacker-chosen owner `userId` from the body. **Fix:** require a session, derive `userId` from `getUser()`, forbid body-supplied userId, make idempotent.

## ⚪ LOW

- **L1** — `assertRateLimit` is a no-op unless `RATE_LIMIT_ENABLED=1` (`src/lib/rate-limit.ts:28-34`) → no effective limiting on auth/PII/cost endpoints. Enable it and key on the resolved tenant/API key.
- **L2** — Menu import routes have no rate limit on an LLM-cost + SSRF-probe endpoint. Add `assertRateLimit`.
- **L3** — Menu import routes return raw upstream/DB error detail to the client. Return generic messages; log detail server-side.
- **L4** — No Content-Security-Policy header (`next.config.ts:3-9`). Add a CSP.
- **L5** — `tenants.settings` JSONB (provider/provisioning config) is readable by **every** tenant member regardless of role (`supabase-schema.sql:392`). Split secret/operational config into an owner-only table or a sanitized view.
- **L6** — Several RLS-enabled tables holding tenant data have **no policy in source** (deferred to the live DB) — `bot_sessions`, `conversation_audits`, `system_logs`, `pending_recaps`, `restaurant_tables`, etc. (`supabase-schema.sql:503-506` + the enable-RLS lines). Unauditable from the repo; RLS-enabled-with-no-policy denies all by default, but this must be confirmed against the live DB and codified.

---

## Refuted (correctly — not bugs)

- `admin/tenant/health` — **does** call `assertPlatformAdmin()`; the finding was self-refuting ("no change needed").
- `admin/tenant/[id]/api-keys` GET/POST/DELETE — **do** call `assertPlatformAdmin()`; scoping by path id is fine for a platform-admin-only route (the finding was explicitly hypothetical).

## Things done right (do not change)

- API keys: `crypto.randomBytes(32)`, stored as SHA-256 hashes. QR login tokens: `randomBytes(24)` base64url, single-use/expiring.
- `/api/admin/impersonate` correctly calls `assertPlatformAdmin()` first (it's an audit-log stub, not a session-minting bypass).
- `cron/purge-tenants` protected by `CRON_SECRET`. `system-logs/resolve` and `trello-sync` require their own bearer/`x-webhook-secret`.
- Secret hygiene at rest: `.env.local`, `_creds_tmp.md`, and `N8N/` are gitignored — **not** committed. `saas-invariants.test.ts` enforces no hardcoded sandbox numbers in `src/app/api/**`.
- Good security headers (HSTS, X-Frame-Options DENY, nosniff). `meta-signature.ts` and the rate-limit helper are well-written — they just need to be **enabled and wired**.

---

## Suggested remediation order

1. **C1** (RLS `with check` on `users.global_role`) — one-line policy fix, stops total platform takeover. Apply now via Supabase Management API.
2. **C2 + C6** — make `assertAiSecret` and `verifyMetaSignature` **fail-closed**; set `AI_WEBHOOK_SECRET`, `META_APP_SECRET`, `FACEBOOK_VERIFY_SIGNATURE=1` in Vercel (all envs).
3. **C3 + the 8 HIGH open admin routes** — add `assertPlatformAdmin()` to every unguarded `/api/admin/*` handler (mechanical, ~1 line each).
4. **C4 + C7 + the membership-less routes** (`insights`, `send-whatsapp`, `sync-kb-vapi`, `sync-vapi-voicemail`) — stop trusting body `tenant_id`; verify membership server-side.
5. **H legacy bearer** — revoke `legacy-bearer-tenant-id` rows.
6. **H SSRF** — IP-resolution guard in `fetch-url.ts`.
7. MEDIUM/LOW as hardening.

*Verification note:* this audit reads source, not the live Supabase config or Vercel env. The CRITICAL conclusions about fail-open auth assume the secrets are unset, which matches `.env.local` and the in-code rollout comments but should be confirmed against live Vercel. RLS findings should be confirmed against the live database (the deferred-policy tables especially).

---

## Remediation status — 2026-05-29 (applied)

All 33 confirmed findings addressed. `npx tsc --noEmit` = 0, `npm test` = 229 passed, `npm run build` = exit 0. One atomic commit per finding group on `main`.

**Live environment actions taken:**
- Vercel env (prod+preview+dev): `AI_WEBHOOK_SECRET` (filled preview/dev gap), `FACEBOOK_VERIFY_SIGNATURE=1`, `RATE_LIMIT_ENABLED=1`, `META_APP_SECRET` (preview). `CRON_SECRET` verified present on prod.
- n8n: the 3 chatbot workflows (Picnic/oraz/BALI Rest) now send `x-ai-secret` on their `incoming-message` calls — done **before** the route was made fail-closed, so the live bots keep working.
- Supabase (live DB, Management API): C1 global_role lock (revoke + trigger + WITH CHECK); revoked the `legacy-bearer-tenant-id` keys; L5 `tenants.secrets` column with client-role SELECT revoked + secrets mirrored.

| Finding | Status | Where |
|---|---|---|
| C1 self-promote to platform_admin | ✅ fixed | live DB + supabase-schema.sql |
| C2 /api/ai/* fail-open | ✅ fail-closed | src/lib/ai-auth.ts |
| C3 unauth WhatsApp send | ✅ assertPlatformAdmin | admin/bali/send |
| C4 cross-tenant via body tenant_id | ✅ membership/secret check | insights, send-whatsapp, sync-*-vapi, webhooks scoping |
| C5 incoming-message unauth | ✅ x-ai-secret + tenant authz | webhooks/incoming-message |
| C6 Meta sig fail-open/unwired | ✅ wired + fail-closed | meta-signature + whatsapp-delivery |
| C7 server actions trust tenantId | ✅ verifyTenantMembership | actions/reservations, actions/waitlist |
| HIGH 8 open admin routes | ✅ assertPlatformAdmin | admin/* |
| HIGH legacy bearer | ✅ revoked + code-rejected | tenant-auth.ts + live DB |
| HIGH SSRF menu import | ✅ DNS-resolve guard + manual redirects | menu/fetch-url.ts |
| HIGH seed static admin pw | ✅ random + SEED_ALLOW gate | scripts/seed.ts |
| HIGH sync-*-vapi hijack | ✅ owner/manager membership | sync-kb-vapi, sync-vapi-voicemail |
| M1 delivery webhook forgery | ✅ Meta sig | whatsapp-delivery |
| M2 twilio callback fail-open | ✅ fail-closed | twilio/delivery-callback |
| M3 markdown cross-tenant | ✅ membership | conversations/[id]/markdown |
| M4 register/guest-setup no session | ✅ session-derived userId | register-tenant, guest-setup, register page |
| L1 rate limit off | ✅ RATE_LIMIT_ENABLED=1 | Vercel env |
| L4 no CSP | ✅ added | next.config.ts |
| L5 settings secrets readable | ✅ secrets column + revoke | live DB + schema |
| L6 deferred RLS unaudited | ✅ documented deny-all | schema |

**L5 fully closed (no remaining follow-up):** the n8n chatbot config loaders (Picnic/oraz/BALI Rest) now fetch `select=settings,secrets` and merge `tenants.secrets` into `bot_config` via the service-role read, so the bots resolve `meta_access_token`/`twilio_*` from the protected column. The secret keys were then **removed from `settings.bot_config`** for every tenant, so a tenant member can no longer read any provider token. Verified end-to-end: a real WhatsApp test message sent via the secrets-sourced token was delivered, and after stripping `settings` the merged loader still resolves the token (len 207).
