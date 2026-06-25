# WhatsApp / Meta Embedded Signup — onboarding pipeline

Lets a restaurant connect its **own** WhatsApp Business number from inside the CRM
(“Connect with Meta” → Embedded Signup → QR / number verify) **without touching
Meta Developers, tokens, WABA IDs or webhooks**. Supports the **coexistence** case
(number already on the WhatsApp Business App) and the new-number case, plus a
**manual concierge fallback**.

> This is an integration into the EXISTING CRM. It reuses the tenant model
> (`tenants` + `tenants.secrets`/`settings`), the send layer
> (`src/lib/whatsapp/meta.ts` + `from.ts`), webhook verification
> (`src/lib/meta-signature.ts`) and logging (`audit.ts`/`system-log.ts`). No new
> app, no CRM rebuild.

---

## 0. Current Meta state (audited 2026-06-25 via Graph API)

| Thing | Status | Note |
|---|---|---|
| Meta App | ✅ exists | **“BALI Flow”**, App ID `1259805589309723`, system-user token works |
| WhatsApp product | ✅ added | token has `whatsapp_business_management` + `whatsapp_business_messaging` |
| Phone number on WABA | ⚠️ **TEST number** | `+1 555-642-2317` (`phone_number_id 1095078260361095`), `platform_type CLOUD_API` |
| WABA | ⚠️ TEST | `1743138427053257` (“Test WhatsApp Business Account”) under business **“BALI Academy - BusM”** (`905021967715680`) |
| Business verification | ❌ **pending_submission** | health error 141010 — *not* verified (Sofía may have verified a different business) |
| Payment method | ❌ **error 141006** | `can_send_message: BLOCKED` for business-initiated |
| Facebook Login for Business config (Embedded Signup) | ❌ **missing** | no `config_id` → this is the main thing to create |
| App Review / Advanced Access | ❌ not done | needed for Embedded Signup onboarding of others’ numbers |
| Templates | ✅ 29 approved | booking/reminder/missed-call/etc. in es/it/en/de |
| Webhook verify + HMAC | ✅ in code | `META_WEBHOOK_VERIFY_TOKEN` + `FACEBOOK_VERIFY_SIGNATURE=1` |

**Bottom line:** the *code* below can ship now, but Embedded Signup will not
function end-to-end until the **Meta manual steps (§A, §G)** are done by Sofía.

---

## A. Meta App setup checklist (manual, in developers.facebook.com → BALI Flow)

- [ ] **WhatsApp** product added ✅ (already present)
- [ ] **Facebook Login for Business** product added
- [ ] **Create a Facebook Login for Business configuration** using the
      **WhatsApp Embedded Signup** template → copy its **Configuration ID** →
      this becomes `META_CONFIG_ID` / `NEXT_PUBLIC_META_CONFIG_ID`
- [ ] **Valid OAuth Redirect URIs**: `https://crm.baliflowagency.com/`
      (+ `http://localhost:3000/` for local testing)
- [ ] **Allowed Domains for the JS SDK**: `crm.baliflowagency.com`
- [ ] **App Domains**: `crm.baliflowagency.com`
- [ ] **Webhook → Callback URL**: `https://crm.baliflowagency.com/api/webhooks/meta/whatsapp`
- [ ] **Webhook → Verify Token**: the value of `META_WEBHOOK_VERIFY_TOKEN`
      (already set: `baliflow-meta-…`)
- [ ] **Subscribe WhatsApp webhook fields**: `messages`, `message_template_status_update`,
      `account_update`, `phone_number_name_update`, `phone_number_quality_update`,
      and (coexistence) `smb_message_echoes`, `smb_app_state_sync`, `history`
- [ ] **Permissions / Advanced Access** (App Review): `whatsapp_business_management`,
      `whatsapp_business_messaging`, `business_management`
- [ ] **Business Verification** of the business that will OWN the WABAs (currently NOT done)
- [ ] **Add a payment method** to the WABA (currently error 141006)
- [ ] App in **Live mode**

> See §G for the human-ordered version of this list and what blocks what.

---

## B. Webhook URL & verify token to paste into Meta

- **Callback URL:** `https://crm.baliflowagency.com/api/webhooks/meta/whatsapp`
- **Verify token:** value of `META_WEBHOOK_VERIFY_TOKEN` (env, already set)
- The GET handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`) is handled by
  `handleMetaWebhookVerification()`; POST is HMAC-verified by `verifyMetaSignature()`
  (`FACEBOOK_VERIFY_SIGNATURE=1`).

---

## C. Environment variables

Already present (`.env.local` / Vercel): `META_ACCESS_TOKEN`,
`META_WHATSAPP_PHONE_NUMBER_ID`, `META_GRAPH_VERSION` (used as the API version),
`META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `META_WABA_ID`,
`FACEBOOK_VERIFY_SIGNATURE=1`, `POS_CRED_ENC_KEY`.

**Add:**

```
META_APP_ID=1259805589309723                 # server: code→token exchange
NEXT_PUBLIC_FB_APP_ID=1259805589309723        # client: FB.init
META_CONFIG_ID=                               # server (from §A — the FB-Login-for-Business config)
NEXT_PUBLIC_META_CONFIG_ID=                   # client: FB.login config_id
# Optional defaults for the test-send button:
WHATSAPP_DEFAULT_TEMPLATE_NAME=hello_world
WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE=en_US
```

Notes:
- We **reuse `META_GRAPH_VERSION`** instead of adding `META_API_VERSION`.
- We **do not add `ENCRYPTION_KEY`**: the per-tenant access token is stored in
  `tenants.secrets` (a **service-role-only** JSONB column — same place as
  `openai_key`/`ai_secret`), which is the codebase’s existing “stored securely
  server-side” guarantee and keeps the existing send path working unchanged.
  (`encryptCredentials()` in `src/lib/pos/credentials.ts` is available if we later
  want GCM-at-rest, but that would require teaching the send path to decrypt.)

---

## D. Database (migration `supabase/migrations/20260625_whatsapp_embedded_signup.sql`)

Two **new** tables; existing tables are **reused**, not duplicated:

- `whatsapp_setups` — the per-tenant onboarding **state machine**
  (`phone_number_usage`, `setup_status`, `last_error`, `notes`). 1 row/tenant.
- `meta_whatsapp_connections` — the connection **result**
  (`meta_business_id`, `waba_id`, `phone_number_id`, `connection_status`,
  `last_error`). 1 row/tenant. **No token column** — the token goes to
  `tenants.secrets.meta_access_token` (service-role-only).

Reused (NOT recreated): raw webhook payloads → `webhook_events`; messages →
`conversations`; errors/alerts → `system_logs`. So the spec’s
`whatsapp_webhook_events` / `whatsapp_message_logs` are intentionally **not** created.

The resolved `phone_number_id` is **also mirrored** into
`tenants.settings.whatsapp.from` so `resolveWhatsAppFrom()` makes the existing
send path send from the tenant’s own number with zero code change.

---

## E. Backend routes

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/whatsapp/setup` | POST | upsert `whatsapp_setups` (usage answer + status) | session + tenant membership |
| `/api/whatsapp/setup` | GET | read the tenant’s setup + connection status | session + tenant membership |
| `/api/whatsapp/embedded-signup` | POST | receive `{code, waba_id, phone_number_id}`, **exchange code→token server-side**, subscribe app to WABA, store creds | session + tenant membership |
| `/api/whatsapp/test-send` | POST | send one test template from the stored number | session + tenant membership |
| `/api/webhooks/meta/whatsapp` | GET/POST | Meta-native webhook (verify + HMAC + resolve tenant by `phone_number_id`) | Meta signature |
| `/api/admin/whatsapp-connection` | GET/POST | manual concierge: read/set business_id, waba_id, phone_number_id, status, notes | platform admin |

The code is **never** given a long-lived token; the FE only ever sends the
short-lived `code`. Tokens are exchanged and stored **server-side only**, never
logged in full.

---

## F. Frontend

- `src/app/(dashboard)/connect-whatsapp/page.tsx` — “Connect WhatsApp Business”
  (client component). Asks *“Is this number already used on WhatsApp?”*, loads the
  FB JS SDK, launches Embedded Signup via `FB.login({ config_id })`, captures the
  returned `code` + the `phone_number_id`/`waba_id` from the embedded-signup
  `message` event, POSTs to `/api/whatsapp/embedded-signup`. UI states:
  connecting / connected / needs-help / failed(reason) / retry. Linked from Settings.
- `src/app/(dashboard)/admin/tenant/[id]/page.tsx` — adds a **WhatsApp setup**
  card (status, WABA id, phone number id, last error) + manual-fallback fields.

Styling: bronze `#c4956a`, cream `rgba(252,246,237,0.85)`, Geist, `text-black`
(emerald only for the “done/connected” state). Matches existing settings/admin cards.

---

## G. Manual steps Sofía / Steward must do inside Meta (ORDERED — critical path)

1. **Confirm which business is verified.** Graph API shows *“BALI Academy - BusM”*
   as **not verified**. If you verified a different business, the Embedded Signup
   must run under THAT business (and we’ll get new credentials for it).
2. **Business Verification** of the owning business (Business Settings → Security
   Center) — required before Advanced Access / production.
3. **Add a payment method** to the WABA (clears error 141006; otherwise sends are blocked).
4. **Facebook Login for Business** → add product → **create a configuration** with
   the **WhatsApp Embedded Signup** template → send me the **Configuration ID**
   (`META_CONFIG_ID`).
5. Set **OAuth redirect URIs**, **Allowed domains**, **App domains** (§A).
6. Set the **webhook callback URL + verify token** and **subscribe the fields** (§A/§B).
7. **App Review → Request Advanced Access** for `whatsapp_business_management`,
   `whatsapp_business_messaging`, `business_management` (screencast of the CRM
   sending via Cloud API + a template — we already send live + have 29 approved
   templates, so the video is just recording what works).
8. Flip the app to **Live mode**.

Steps **1–3** are the current hard blockers. Step **4** gives me the
`config_id` that the “Connect with Meta” button needs.

---

## H. Likely failure cases & how the UI handles them

| Case | Detection | UI |
|---|---|---|
| `config_id` not set yet | env missing | Button disabled + “Setup in progress, our team is finishing the Meta config.” |
| User closes Embedded Signup early | `FB.login` returns no `authResponse`/`code` | “Connection cancelled — try again.” + retry |
| Business not verified | exchange/subscribe returns verification error | “Your Meta business needs verification” + concierge fallback |
| Payment method error (141006) | send/test returns 141006 | “Add a payment method in Meta to start sending” + link |
| Number already on WhatsApp App (coexistence) | usage = `business_app` | help text: “You’ll scan a QR in WhatsApp Business → keep the app, the bot works alongside.” |
| Token exchange fails | non-200 from `/oauth/access_token` | status → `failed_needs_manual_help`, `last_error` stored, concierge fallback shown |
| Test send fails | Meta error code in response | show code + message; `131030` (recipient not allowed) only relevant on the test number |
| Webhook not verified | Meta dashboard shows verify fail | check `META_WEBHOOK_VERIFY_TOKEN` matches; GET handler returns the challenge |

Every failure writes `whatsapp_setups.last_error` and a `system_logs` entry
(category `api_error`/`webhook_failure`), and surfaces the concierge fallback.

---

## I. MVP status — what works when

- **Now (code merged):** migration, all routes, connect page, admin card, manual
  fallback. Webhook verify already works. `test-send` works against the test number.
- **After Sofía finishes §G steps 1–4:** the “Connect with Meta” button launches a
  real Embedded Signup, we store the tenant’s `waba_id`/`phone_number_id`, the
  webhook receives that tenant’s events, and we can send a real test template.
- **Success milestone:** a restaurant clicks “Connect with Meta” → ES completes →
  backend exchanges/stores `waba_id` + `phone_number_id` → webhook verifies →
  webhook POST receives events → one test template sends → status → `live`, visible
  in admin.

**Out of MVP scope** (deliberately, per “don’t overbuild”): template-builder UI
(we draft/store for admin review only), analytics, multi-number per tenant.
