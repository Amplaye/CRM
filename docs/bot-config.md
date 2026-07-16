# `tenants.settings.bot_config` reference

Every Picnic n8n workflow loads its tenant-scoped policy and credentials
from `tenants.settings.bot_config` via the shared `picnicLoadTenantConfig`
loader (see [`Picnic_Chatbot_WhatsApp.json`](../../N8N/picnic/Picnic_Chatbot_WhatsApp.json)).

This file documents every key currently in use on the Picnic tenant
(`626547ff-bc44-4f35-8f42-0e97f1dcf0d5`). To add a new key, write it to
the DB JSONB and add a row here.

Live keys (verified 2026-05-12 via Supabase Management API):

| Key | Type | Used by | Notes |
|---|---|---|---|
| `restaurant_name` | string | greeting templates, voice prompt | "Restaurante Picnic" |
| `restaurant_phone` | string (E.164) | apology fallback (FIX B7) | `+34828712623` |
| `responsible_phone` | string (`whatsapp:+...`) | owner notifications, fallback escalation | `whatsapp:+34641790137` |
| `timezone` | string | end-time calc, date math | `Atlantic/Canary` |
| `lang_default` | string | first-message reply when language can't be detected | `es` |
| `lang_supported` | string[] | sticky-language guard | `["es","en","it","de"]` |
| `lang_canary_dialect` | bool | adjusts greeting register | true |
| `greetings` | object | per-language greeting templates | keys: `es`,`en`,`it`,`de` |
| `smalltalk_acks` | object | per-language ack templates ("perfecto", "ok", etc.) | |
| `fake_names` | string[] | placeholder names accepted as "anonymous" | |
| `zones` | object | restaurant area allocation rules | `{ "inside": …, "outside": … }` |
| `future_days_limit` | int | max days ahead a booking can be made | 60 |
| `session_ttl_seconds` | int | bot_sessions TTL before reset | 7200 (2h) |
| `bot_paused_cooldown_sec` | int | cooldown after staff takeover | 60 |
| `closing_time_offset_min` | int | last-booking cutoff before close | 45 (lunch), 60 (dinner) |
| `party_size_threshold_large` | int | manual-review threshold | 7 |
| `crm_api_base` | string | CRM URL for `/api/ai/*` calls | `https://crm.baliflowagency.com` |
| `ai_secret` | string | header value sent as `x-ai-secret` | matches `AI_WEBHOOK_SECRET` on CRM |
| `twilio_account_sid` | string | outbound WA via Twilio REST | `AC...` |
| `twilio_auth_token` | string | outbound WA Basic auth | 32 hex |
| `twilio_from_number` | string (`whatsapp:+...`) | outbound WA From | `whatsapp:+14155238886` (Sandbox) |
| `retell_agent_id` | string | voice agent reference | `agent_...` |
| `retell_llm_id` | string | voice LLM ref | `llm_...` |
| `retell_voice_name` | string | TTS voice id | `custom_voice_...` |
| `version` | string | bot config schema version | `2026-05-11` |
| `updated_at` | timestamptz | last hand-edit | |

## Reading from code

Inside a Code node, after the loader runs:

```js
const _picnicTenantCfg = await picnicLoadTenantConfig(this);
const _bc = _picnicTenantCfg.bot_config || {};
const TWILIO_SID = picnicCfgGet(_bc, 'twilio_account_sid', '');
const TWILIO_TOKEN = picnicCfgGet(_bc, 'twilio_auth_token', '');
const TWILIO_FROM = picnicCfgGet(_bc, 'twilio_from_number', 'whatsapp:+14155238886');
```

Fallbacks (the third `picnicCfgGet` argument) were redacted to empty
strings in Tier 1.6 cleanup — empty SID/TOKEN fail-loudly via Twilio
401 rather than silently using a leaked hardcoded key.

## Editing values

Use the Supabase SQL editor (or the Management API) — there's no UI yet
(future: `/admin/bot-config` page).

```sql
update public.tenants
set settings = jsonb_set(settings, '{bot_config,future_days_limit}', '"45"', true)
where id = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';
```

Reload happens lazily — `picnicLoadTenantConfig` caches per workflow
execution, so a new value lands on the next bot turn.

## Security note

`twilio_*` and `ai_secret` are sensitive. RLS on `tenants` allows reads
only via service role; the n8n workflows authenticate via the Supabase
service-role JWT (hardcoded in each Code node's `PICNIC_CFG_SB_KEY`
constant). Rotating that JWT is a global break-change and needs a
coordinated workflow update — leave for the Tier 5.7 token rotation
playbook.
