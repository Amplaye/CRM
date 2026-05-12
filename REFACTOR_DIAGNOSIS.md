# REFACTOR_DIAGNOSIS — Restaurante Picnic

> **🟢 Update 2026-05-12 18:50** — Tier 0 smoke test + 5 Tier 1 items landati. Smoke test 7/7 PASS sull'ultimo HEAD `a77daa5`:
>
> | # | Commit | Tier | Cosa | Stato |
> |---|---|---|---|---|
> | 8 | `c1ff510` | 0 | `scripts/smoke-test.mjs` — 7 check automatici (build+test, n8n, system_logs, dedup, api-key, E2E chatbot, availability) | ✅ in main |
> | 9 | `da29cb7` | 1.3 | `POST/GET /api/admin/tenant/[id]/api-keys` + `DELETE` per revoca + helper `assertPlatformAdmin` condiviso | ✅ in main |
> | 10 | `95b6ce7` | 1.5+1.4 | Nuova api-key `picnic-n8n-2026-05` inserita in `tenant_api_keys`; **dropped** `UUID_RE` fallback in `resolveTenantFromApiKey` — la seed row 'legacy-bearer-tenant-id' resta come backward-compat fino a revoca esplicita | ✅ in main + DB |
> | 11 | `83fcc2f` | 1.2 | `POST /api/twilio/delivery-callback?tenant_id=…` — riceve i webhook di status (queued→sent→delivered/failed), verifica firma quando `TWILIO_VERIFY_SIGNATURE=1`, logga in `audit_events` con dedup per `(MessageSid, status)` | ✅ in main |
> | 12 | `a77daa5` | 1.9 | Allow-list CORS esplicita per `/api/ai`, `/api/webhooks`, `/api/twilio` — server-to-server pass through, browser cross-origin non-whitelisted = 403 | ✅ in main |
>
> **Smoke test runtime**: `npm run build && npm test` + 6 check live, ~50s totali. Comando: `N8N_API_KEY=… SUPABASE_MGMT_TOKEN=… AI_WEBHOOK_SECRET=… SMOKE_API_KEY=… node scripts/smoke-test.mjs`.
>
> **Tier 1 deferred** (perché basso valore-oggi o serve infra esterna):
> - 1.1 (tenant_id env var nei workflow n8n) — cosmetico finché c'è solo Picnic
> - 1.6 (audit secrets restanti nei workflow non-chatbot: Supabase JWT, OpenAI key, Twilio in Follow-up/Pre-Turno) — incrementale, fattibile workflow-per-workflow
> - 1.8 (rate limiting) — richiede Upstash o RPC Supabase dedicata
> - 1.10 (rimuovere `credentials.md` plain-text) — operazionale, non codice
>
> ---

> **🟢 Update 2026-05-12 16:40** — 6 commit di hardening landati su `main` + 1 patch n8n live:
>
> | # | Commit | Cosa | Rischio | Stato |
> |---|---|---|---|---|
> | 1 | `89b3ccd` | Diagnosi + sync schema (10 tabelle) + webhook dedup helper | basso | ✅ in main |
> | 2 | `5ac0c41` | Vitest + 20 unit test su `restaurant-rules` | nullo | ✅ in main |
> | 3 | `dccbf12` | Estratti pure helpers da `book/route.ts` + 27 test | basso | ✅ in main |
> | 4 | `31fadff` | Mirror del refactor in `modify/route.ts` | basso | ✅ in main |
> | 5 | `4211b9c` | `tenant_api_keys` table + sha256 lookup (legacy fallback) | basso | ✅ in main + DB |
> | 6 | `e8db63e` | Rimossi tutti i `(payload as any)`, tipi allargati | nullo | ✅ in main |
> | n8n | live | `Picnic_Chatbot_WhatsApp` ora include `MessageSid` nei 2 POST a `/api/webhooks/incoming-message` → dedup attivo | medio (workflow in prod) | ✅ live, status 200, active=true |
> | n8n | live | **Risk #2 chiuso**: rimossi i fallback hardcoded di `TWILIO_SID`/`TWILIO_TOKEN` dai 4 Code node del chatbot (`Fetch History`, `OpenAI`, `Send WhatsApp Reply`, `Book + Notify Owner`). Le creds ora vengono solo da `tenants.settings.bot_config` (tenant-scoped). 0 literali SID/TOKEN nel workflow JSON. | medio | ✅ live, status 200, active=true |
> | n8n | live | **Risk #4 quasi chiuso** (FIX B39): le 3 scritture di session primer in staticData (`Fetch History` pre_confirmo + modify.trigger, `Book + Notify Owner` post-modify reset) ora vengono mirrorate su `bot_sessions` via RPC `commit_bot_session`. OpenAI legge già dal DB via `try_acquire_bot_lock` (FIX B33). Restano in staticData solo `pendingBookings`/`pendingWaitlist`/`customerLang` per design (read minutes-apart). | medio | ✅ live, status 200, active=true |
> | 7 | (in main) | Stage 5 prep: `schemas/booking_intent.schema.json` — 11 campi core + estensioni Picnic (`zona`, `delta_personas`, `shift`, `force_new`, `edge_hour`, `proposed_alternatives`) sotto `x_picnic`. Solo doc, nessun runtime change. Base per `/api/ai/extract-booking-intent`. | nullo | ✅ in main |
>
> **Sintesi quantitativa:**
> - **0 → 50 unit test** (vitest run, 234ms).
> - **2 file di pure helper** estratti (`booking-validation.ts`, `tenant-auth.ts`).
> - **10 tabelle** aggiunte al DDL; 1 nuova tabella creata in DB (`tenant_api_keys`) + 2 righe seed.
> - **Workflow n8n produzione** modificato (1 set node + 2 code nodes, +103 byte di JS), backup salvato in `picnic_backups/chatbot-pre-message-sid-*`.
> - `book/route.ts` da 688 a 642 LOC.
>
> **Rimasti aperti** (vedi §6 e §7):
> - Risk #4 (state in n8n staticData) — ⚠️ partial 2026-05-12 16:46. Session primer ora landa in `bot_sessions` (FIX B39). Pending caches (pendingBookings/pendingWaitlist/customerLang) restano in staticData by design.
> - Risk #6 (singolo 2000-LOC Code node) — grosso refactor n8n, va con calma
> - Risk #8 (tenant_id hardcoded in tutti i workflow n8n) — più tenant = più lavoro, su Picnic resta cosmetico
> - Risk #11 (Twilio Sandbox → WA Cloud API) — operational, serve Meta approval per HSM templates
> - Split aggressivo di `book/route.ts` e `modify/route.ts` oltre i pure helper — ora i pure helper sono testati, lo split del resto è meno rischioso ma richiede comunque cura

> **TL;DR (IT)** — Il sistema attuale non è un monolite né rispetta i 10 stage del target: l'intelligenza vive in **un singolo workflow n8n** (`Picnic_Chatbot_WhatsApp.json`) costruito intorno a un mega-Code-node che ospita _Parser LLM → JS Controller → Formatter LLM_ in sequenza, mentre il **CRM Next.js** è un'API REST passiva (book/modify/cancel/availability/waitlist) e **Retell** fa STT/LLM/TTS della voce. Mancano: file markdown delle conversazioni, evento `conversation_end`, payload `BookingIntent` con 11 campi, Switch node sull'intent, idempotency sul webhook chat, tabella `bot_config`, tabella `system_logs` (l'indice esiste ma la tabella no!), `restaurant_tables`/`reservation_tables` (referenziate dai workflow ma non nel DDL). Quello che invece c'è ed è buono: separation CRM/n8n, idempotency su book/modify/cancel, RLS multi-tenant, audit_events, sticky language, pending-recovery, bot-pause 60s. La parte più preziosa da estrarre nel refactor è il **prompt del Parser LLM** e il **JS Controller** (circa 2.000 righe di guardie battle-tested).

---

## 0. Scope of this document

This is a read-only diagnosis. **No code is modified.** It maps the current Picnic implementation against the 10-stage target architecture (WhatsApp/Voice → Conversation Store → LLM Extraction → BookingIntent.json → n8n Switch → action branches → confirmation → audit). The goal is to decide component-by-component what stays, what changes, and what gets replaced — before any refactor PR is opened.

Codebases surveyed:
- [`/Users/amplaye/CRM`](/Users/amplaye/CRM) — Next.js 16 + Supabase, `tableflow-ai` (the CRM/dashboard), git repo, ~106 TS/TSX files
- [`/Users/amplaye/N8N/picnic`](/Users/amplaye/N8N/picnic) — 13 exported n8n workflows (~800 KB of JSON), including the 529 KB `Picnic_Chatbot_WhatsApp.json`
- Supabase schema: [`supabase-schema.sql`](supabase-schema.sql) (398 lines)

---

## 1. Phase 1 — Territory map

### 1.1 Stack & runtime

**CRM** (Next.js)
- Framework: **Next.js 16.2.4**, App Router
- React 19.2.4, TypeScript 5, Tailwind 4
- Runtime: Vercel serverless (Node)
- DB/Auth: `@supabase/supabase-js@^2.100.1`, `@supabase/ssr@^0.9.0`
- No AI SDK — OpenAI called directly via `fetch` to `api.openai.com/v1/chat/completions`
- No Twilio SDK — direct HTTP to Twilio REST
- No n8n client — n8n is the caller, not the callee

**n8n** (self-hosted, calls live API at `crm.baliflowagency.com`)
- 13 workflows in `/Users/amplaye/N8N/picnic/` (one per business function)
- Largest by far: `Picnic_Chatbot_WhatsApp.json` (~529 KB, 8 nodes, but ~2000 LOC concentrated in 3 Code nodes)
- All workflows hardcode the tenant_id `626547ff-bc44-4f35-8f42-0e97f1dcf0d5`

**Voice agent**
- **Retell** (https://api.retellai.com) — owns STT, LLM, TTS, web-call token issuance, dynamic prompt variables
- LLM id: `llm_d19f792cd11a22132956f81dc7fe`
- 7 webhook tools exposed by `Picnic_Voice_Agent_Webhooks.json`

**Channels**
- **Twilio WhatsApp** Sandbox (`whatsapp:+14155238886`, SID `AC169…<redacted>`) — both inbound (webhook) and outbound (REST)
- Voice via Retell web-call + (future) telefono

### 1.2 Entry points (full inventory)

#### CRM HTTP routes ([src/app/api/](src/app/api/))

| Path | Method | Purpose | LOC |
|---|---|---|---|
| [`/api/webhooks`](src/app/api/webhooks/route.ts) | POST | Main ingestion gateway w/ idempotency. Dispatches `reservation.create|cancel`, `chat.ingest`, `voice.ingest`. Auth: `Bearer {tenant_id}` | 159 |
| [`/api/webhooks/incoming-message`](src/app/api/webhooks/incoming-message/route.ts) | POST | Conversation upsert + transcript append + guest find-or-create. Fuzzy phone matching. | 167 |
| [`/api/ai/book`](src/app/api/ai/book/route.ts) | POST | Create reservation; opening-hours guard; ±3-day duplicate detect; table allocation | **688** |
| [`/api/ai/modify`](src/app/api/ai/modify/route.ts) | PUT | Modify reservation w/ partial deltas; 10-min idempotency window | **616** |
| [`/api/ai/cancel`](src/app/api/ai/cancel/route.ts) | DELETE | Soft-cancel + free matched waitlist offer | 84 |
| [`/api/ai/cancel-by-phone`](src/app/api/ai/cancel-by-phone/route.ts) | DELETE | Cancel by phone lookup (auto-noshow path) | 131 |
| [`/api/ai/availability`](src/app/api/ai/availability/route.ts) | POST | List bookable slots; respects `tenants.settings.opening_hours` | 299 |
| [`/api/ai/waitlist`](src/app/api/ai/waitlist/route.ts) | POST | Create waitlist entry | 112 |
| [`/api/ai/waitlist-process`](src/app/api/ai/waitlist-process/route.ts) | POST | Offer freed slot (15 min TTL); creates pending_confirmation | 485 |
| [`/api/ai/waitlist-reassurance`](src/app/api/ai/waitlist-reassurance/route.ts) | POST | Cron: keep waitlist warm with periodic message | 141 |
| [`/api/ai/confirm-pending`](src/app/api/ai/confirm-pending/route.ts) | POST | pending_confirmation → confirmed | 82 |
| [`/api/ai/conversation-summary`](src/app/api/ai/conversation-summary/route.ts) | POST | GPT-5.1 1–2 sentence summary in guest language; stores `conversations.summary` + `.language` | 177 |
| [`/api/ai/restaurant-info`](src/app/api/ai/restaurant-info/route.ts) | GET | KB topic lookup (horario/servicios/alérgenos/...) | 149 |
| [`/api/ai/log-event`](src/app/api/ai/log-event/route.ts) | POST | Trace wrapper/step into `system_logs` | 92 |
| [`/api/ai/incident`](src/app/api/ai/incident/route.ts) | POST | Open incident + optional handoff → `conversation.status='needs_human'` | 75 |
| [`/api/send-whatsapp`](src/app/api/send-whatsapp/route.ts) | POST | Twilio outbound WA send | 83 |
| [`/api/conversations/resume-bot`](src/app/api/conversations/resume-bot/route.ts) | POST | Clear `guests.bot_paused_at`, optional retrigger of n8n | 65 |
| [`/api/conversations/takeover`](src/app/api/conversations/takeover/route.ts) | POST | Mark conversation as taken over by human; refreshes `bot_paused_at` timestamp | 22 |
| [`/api/sync-kb-retell`](src/app/api/sync-kb-retell/route.ts) | POST | Push KB articles to Retell; special `VOICEPROMPT` article → `general_prompt` | 386 |
| [`/api/insights`](src/app/api/insights/route.ts) | GET | Dashboard insights aggregation | 215 |
| [`/api/weekly-report`](src/app/api/weekly-report/route.ts) | POST | LLM-synthesized weekly KPI report | 216 |
| [`/api/translate-note`](src/app/api/translate-note/route.ts) | POST | Translate free-text note | 62 |
| [`/api/admin/{overview,tenant,bali/send,usage,system-logs,client-notes,onboard}`](src/app/api/admin/) | mixed | Admin dashboard ops | 47–151 |
| [`/api/guest-setup`](src/app/api/guest-setup/route.ts) | POST | Guest provisioning helper | 50 |
| [`/api/register-tenant`](src/app/api/register-tenant/route.ts) | POST | Self-serve tenant onboarding | 45 |

> **NOTE — no `/api/audit-conversation` route yet.** Per project memory it was created recently (2026-05-12) and a `conversation_audits` table exists in Supabase; the route may live elsewhere or be unmerged. The `ConversationAudit` TypeScript interface is in [`src/lib/types/index.ts`](src/lib/types/index.ts). `[NEEDS HUMAN INPUT]`

#### n8n webhook surface (13 paths)

```
POST /picnic-whatsapp              # WhatsApp Chatbot (the big one)
POST /picnic-check-slots           # Voice: availability
POST /picnic-book                  # Voice: book
POST /picnic-waitlist              # Voice: waitlist
POST /picnic-update-notes          # Voice: append notes
POST /picnic-modify                # Voice: modify
POST /picnic-post-call             # Voice: end-of-call feedback
POST /picnic-cancel                # Voice: cancel
POST /picnic-crm-book              # CRM Sync ingestion
POST /picnic-crm-conversation      # CRM Sync ingestion
POST /picnic-crm-waitlist          # CRM Sync ingestion
POST /picnic-store-reminder        # Reminders: register a reminder
POST /picnic-confirm-booking       # Reminders: guest "SI" confirmation
POST /picnic-web-call              # Web Call Token issuer (Retell)
```

### 1.3 External integrations

| Service | Where | Auth | Notes |
|---|---|---|---|
| **Twilio WhatsApp** | n8n Code nodes (hardcoded SID/TOKEN) + [`/api/send-whatsapp`](src/app/api/send-whatsapp/route.ts) | HTTP Basic | Sandbox `+14155238886`. Bot sends Twilio-direct, CRM also sends via same env vars |
| **Retell** | [`/api/sync-kb-retell`](src/app/api/sync-kb-retell/route.ts), `Picnic_Update_Voice_Agent_Date.json`, `Picnic_Web_Call_Token.json` | Bearer `key_4c79…<redacted>` | Owns voice intelligence end-to-end. n8n only relays Retell tool calls |
| **OpenAI** | `Picnic_Chatbot_WhatsApp.json` (Parser+Formatter), [`/api/ai/conversation-summary`](src/app/api/ai/conversation-summary/route.ts), `/api/weekly-report`, daily audit | `Bearer OPENAI_API_KEY` | Model used: **gpt-5.1** (reasoning_effort: 'low' on chatbot; upgraded from gpt-4o-mini on 2026-05-12) |
| **Supabase** | Everywhere | service-role from CRM; apikey from n8n | Primary store; RLS enabled with `private.is_tenant_member()` helper |
| **WhatsApp Business Cloud API** | **NOT used** | — | The architecture target names it; reality uses Twilio as WA gateway |

### 1.4 Internal modules

- [`src/lib/audit.ts`](src/lib/audit.ts) — `logAuditEvent({action, entity_id, idempotency_key, source, details})` → `audit_events`
- [`src/lib/system-log.ts`](src/lib/system-log.ts) — `logSystemEvent(category, severity, ...)` → `system_logs`
- [`src/lib/ai-auth.ts`](src/lib/ai-auth.ts) — `assertAiSecret(req)` (timing-safe `x-ai-secret`)
- [`src/lib/restaurant-rules.ts`](src/lib/restaurant-rules.ts) — pure business rules: `getShift`, `getRotationMinutes`, `calculateEndTime`, `tablesNeeded`, `isOpen`, `getBookingAction`, `getTimeSlots`
- [`src/lib/booking-confirmation-message.ts`](src/lib/booking-confirmation-message.ts) — localized confirmation card builder
- [`src/lib/i18n/dictionaries/{es,en,it,de}.ts`](src/lib/i18n/dictionaries/) — 4 × ~712 LOC locale maps
- [`src/lib/types/index.ts`](src/lib/types/index.ts) — `Conversation`, `ConversationAudit`, `Reservation`, `WaitlistEntry`, `Guest`, `AuditEvent`, `CreateBookingRequest`, `ModifyBookingRequest`, `WebhookIngestionRequest`

---

## 2. Phase 2 — Target stages vs reality

For each of the 10 target stages: **does it exist? where? what's missing?**

### Stage 1 — Input Channels (WhatsApp + Voice)

| | Status | Location |
|---|---|---|
| WhatsApp Cloud API webhook | ❌ Replaced by **Twilio** | Twilio webhook → `POST /picnic-whatsapp` in `Picnic_Chatbot_WhatsApp.json` |
| Inbound Voice (Twilio SIP) | ❌ Replaced by **Retell** | Retell web-call (and future PSTN) → 7 webhooks in `Picnic_Voice_Agent_Webhooks.json` |

**Gap**: target says WhatsApp Cloud + Twilio SIP. Reality: Twilio WA Sandbox + Retell. If the target architecture demands raw WhatsApp Cloud + raw Twilio SIP, **this is a channel-layer migration**, not just a refactor.

**Inputs/Outputs**:
- WA in: `{Body, From, ProfileName}` from Twilio
- Voice in: Retell-formatted JSON (`from_number`, transcript turns, tool-call payloads)
- Out: Twilio Messages API (URLEncoded POST) for both confirmation + recap cards

### Stage 2 — Conversation Automation Layer (WA agent + Voice agent)

| | Status | Location |
|---|---|---|
| Stateful WhatsApp Agent | ✅ Exists, **monolithic** | `Picnic_Chatbot_WhatsApp.json` node 4 "OpenAI" (Code, ~2000 LOC) |
| Voice Agent (STT→Dialog→TTS) | ✅ Owned by Retell | `Picnic_Voice_Agent_Webhooks.json` provides _tools_, Retell owns dialog |

**The WhatsApp agent is a single n8n Code node** that does Parser-LLM → JS-controller → Formatter-LLM in sequence — the very thing the target wants _split into stages_.

**Inputs**: WA message + session staticData + last 6 turns of history
**Outputs**: `aiResponse` text + side-effect data (`bookingData`/`modifyData`/`waitlistData`) consumed by downstream node "Book + Notify Owner"

**Does it do well**: extremely battle-tested guards (closing-time, bare-hora 24h, sticky language, pending recovery, off-topic, B-numbered fixes accumulated). The Parser prompt and Controller JS are the crown jewels.

**Does it do poorly**:
- All logic in one 2000-line Code node — unversioned, untested, untyped
- State in `n8n staticData` (volatile, single-instance) — see §4
- No separation between extraction (parser) and routing (controller) and rendering (formatter)
- ~~Twilio creds hardcoded in node 7~~ — risolto 2026-05-12 16:40 (fallback rimossi, creds solo da `tenants.settings.bot_config`)

### Stage 3 — Conversation Store `/conversations/{conv_id}.md`

| | Status | Location |
|---|---|---|
| Markdown per-turn append | ❌ **Does not exist** | — |
| Equivalent: JSONB transcript in DB | ✅ | `conversations.transcript jsonb` |

**Reality**: every turn is POSTed by n8n to [`/api/webhooks/incoming-message`](src/app/api/webhooks/incoming-message/route.ts), which appends to `conversations.transcript` as an array of `{role, content, timestamp}` objects (role ∈ `user|ai|system|staff`). One row per logical conversation (matched by `(tenant_id, guest_id, channel)` + status ∈ `active|escalated`).

**Field shape**:
```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "guest_id": "uuid",
  "channel": "whatsapp" | "voice",
  "transcript": [{"role":"user","content":"...","timestamp":12345}, ...],
  "intent": "string (flat)",
  "extracted_entities": null | object,
  "linked_reservation_id": null | "uuid",
  "status": "active|resolved|escalated|abandoned",
  "summary": "string",
  "sentiment": "positive|neutral|negative"
}
```

**Gaps vs target**:
- No file format; no `conversation_id.md` artifact
- No streaming append to disk — the DB row IS the transcript
- `extracted_entities` exists as JSONB **but is unused today** (always null in current writes)

### Stage 4 — LLM Extraction Service (end-of-conversation)

| | Status | Location |
|---|---|---|
| Triggered on `conversation_end` | ❌ | No such event |
| Structured output against `BookingIntent.json` | ⚠️ schema only | [`schemas/booking_intent.schema.json`](schemas/booking_intent.schema.json) (2026-05-12) — runtime extractor route still pending |
| Equivalent: inline Parser LLM mid-dialog | ✅ | `Picnic_Chatbot_WhatsApp.json` node 4 |

**Reality**: extraction is **interleaved per-turn**. The Parser LLM is invoked on every user message; its output (`{intent, personas, fecha, hora, zona, nombre, notas, ...}`) feeds the JS controller in the same execution. Once all required fields are gathered, the controller _itself_ builds the `bookingData` payload and dispatches it — not as a final extraction, but mid-flow.

**The Parser system prompt** (verbatim — preserve this in refactor):
```text
Eres un parser de mensajes para reservas.
Lee el mensaje del cliente y extrae campos en JSON estricto.
Pone null si el dato no aparece en el mensaje.

Formato de salida (SOLO JSON, sin comentarios):
{
  "intent": "book" | "modify" | "cancel" | "waitlist" | "info" | "offtopic" | "confirm_yes" | "confirm_no" | null,
  "personas": number | null,
  "delta_personas": number | null,
  "fecha": "YYYY-MM-DD" | null,
  "hora": "HH:MM" | null,
  "zona": "interior" | "exterior" | null,
  "nombre": string | null,
  "notas": string | null,
  "confirmacion": "yes" | "no" | null
}
[...full rules: delta_personas, hora ambigua, bare-day-of-month, AM→PM
correction, allergens-only-as-fact, off-topic detection, etc.]
HOY es ${todayStr} (${dayName}).
CALENDARIO: ${calendarBlock}
Mensaje del cliente: """${input.message}"""
```

Model: **gpt-5.1**, `reasoning_effort: 'low'`, `response_format: { type: 'json_object' }`, `max_completion_tokens: 3000`.

**Gaps vs target (11-field BookingIntent)**: see §4.2.

### Stage 5 — Extracted Payload (JSON BookingIntent)

See §4.2 for full field-by-field comparison.

**Top-line gaps**:
- No `conversation_id` injected
- No `channel` enum on the payload (it's a constant `'whatsapp'` in the chat, `'voice'` in the voice tools)
- No `service_type` (the restaurant has no service-type taxonomy)
- `allergies` is a free-text string inside `notas`, not a `string[]`
- `language` lives only in n8n staticData (`_sd.customerLang[phoneKey]`), partially mirrored on `conversations.language`

### Stage 6 — Orchestration Trigger `POST /webhook/booking-intake`

❌ **Does not exist.**

**Reality**: n8n calls _multiple_ specific endpoints directly:
- `POST /api/ai/book`
- `PUT /api/ai/modify`
- `DELETE /api/ai/cancel`
- `POST /api/ai/waitlist`

This is _de facto_ the intent routing already done — but inside n8n, not via an HTTP fan-in.

### Stage 7 — Intent Router (n8n Switch on `payload.intention`)

❌ **Does not exist as a Switch node.**

**Reality**: the routing is **inside a JS controller** (`Picnic_Chatbot_WhatsApp.json` node 4, lines ~800–1100):

```js
if (_sess.intent === 'book')      { ... }
else if (_sess.intent === 'modify')   { ... }
else if (_sess.intent === 'cancel')   { ... }
else if (_sess.intent === 'waitlist') { ... }
else if (_sess.intent === 'info')     { ... }
else if (_sess.intent === 'offtopic') { ... }
```

This is a clean target for a **Switch** refactor — see §3.

### Stage 8 — Action Branches (Create / Cancel / Modify)

✅ Branches exist as CRM HTTP routes. Reasonably clean.

| Branch | CRM endpoint | LOC | Idempotency | Notes |
|---|---|---|---|---|
| Create | [`/api/ai/book`](src/app/api/ai/book/route.ts) | 688 | `audit_events.idempotency_key` checked | Has opening-hours guard, ±3-day duplicate detect, table allocation. Largest file in repo |
| Modify | [`/api/ai/modify`](src/app/api/ai/modify/route.ts) | 616 | 10-min window | Supports `personas_delta`, `retraso_minutos`, zone change. Returns `ambiguous_reservation` when guest has multiple |
| Cancel | [`/api/ai/cancel`](src/app/api/ai/cancel/route.ts) | 84 | weak | Soft-delete, frees waitlist |
| Cancel by phone | [`/api/ai/cancel-by-phone`](src/app/api/ai/cancel-by-phone/route.ts) | 131 | weak | Auto-noshow path |

**Strength**: all routes share `assertAiSecret` + service-role Supabase client + `logAuditEvent` + RLS-bypass. Good separation of concerns.

**Anti-patterns to flag**:
- 688 LOC in one `book/route.ts` file is too big — split into validator/duplicate-check/table-allocator/persister
- Modify accepts both `reservation_id` AND `guest_phone` lookup — fine, but duplicates resolution logic that lives in `Picnic_Chatbot_WhatsApp.json` (`awaitingDisambig`)

### Stage 9 — Confirmation Dispatcher (WA template back to customer)

✅ Hybrid implementation.

- **Recap card** (after successful book): built and sent **inside the n8n Code node "Book + Notify Owner"** via direct Twilio REST call. See `Picnic_Chatbot_WhatsApp.json` node 8.
- **Reminders / day-before / 4h warning**: in `Picnic_Reminders.json`, Twilio direct.
- **Generic outbound** (used by CRM staff actions): [`/api/send-whatsapp`](src/app/api/send-whatsapp/route.ts).

**Gap**: no use of WhatsApp **template messages** (HSM). All messages are free-form text via the Twilio Sandbox, which works in sandbox but will hit Meta's 24-hour-session rule in production.

### Stage 10 — Audit Log + Analytics DB

✅ Partial.

| Table | Purpose | Written by |
|---|---|---|
| `audit_events` | Idempotency + change log for reservations/incidents | book, modify, cancel, incident, incoming-message |
| `system_logs` | Operational events (errors, low-severity rejections) | `/api/ai/log-event`, send-whatsapp failures, Error Catcher (n8n) |
| `conversation_audits` (new) | LLM-graded outcome / quality / divergence per conversation | nightly audit n8n workflow `w2J411dX5JcOZZsJ` |
| `reservation_events` | Append-only audit trail per reservation status change | DB triggers (not visible in app code) |
| `incidents` | Complaints / AI errors / safety flags | `/api/ai/incident` |

**Gap**: the schema file [`supabase-schema.sql`](supabase-schema.sql) does **not** declare `system_logs` or `conversation_audits` — they exist in the live DB but are missing from the DDL (and `idx_system_logs_tenant_status_created` is created against a non-declared table — **schema bug**, see §4.5).

---

## 3. Phase 3 — Logic gates / decision points

The current architecture has **many** branching points, all inside the chatbot workflow's Code nodes. Cataloged with literal conditions, file+line locations, and target-fit assessment.

### 3.1 Bot pause / 60s cooldown (deterministic, DB-driven)

**Location**: `Picnic_Chatbot_WhatsApp.json` node 3 "Fetch History", lines ~20–27.
**Inputs**: `guests.bot_paused_at` from Supabase (per-phone lookup).
**Condition**:
```js
const _pauseAge = g.bot_paused_at ? (Date.now() - new Date(g.bot_paused_at).getTime()) : Infinity;
const _pauseFresh = g.bot_paused_at && _pauseAge < 60000;
if (_gd.length >= 7 && (_gd.includes(_pauseDigits) || _pauseDigits.includes(_gd)) && _pauseFresh) {
  return [{ json: { skip: true, reason: 'bot_paused' } }];
}
```
Each staff message refreshes the timestamp via [`/api/conversations/takeover`](src/app/api/conversations/takeover/route.ts), so the timer extends while staff is typing.
**Target fit**: orthogonal to target — keep as-is.

### 3.2 Parser intent dispatch (LLM-driven)

**Location**: node 4 "OpenAI", JS Controller section.
**Inputs**: parser-LLM output `_extracted.intent` + session state `_sess.intent`.
**Branches**: `book | modify | cancel | waitlist | info | offtopic | confirm_yes | confirm_no | null`.
**Target fit**: ✅ **directly maps to target Switch node** — this is what should become an explicit Switch in n8n (Stage 7).

### 3.3 Sticky modify override (deterministic, guards LLM volatility)

```js
if (_sess.intent === 'modify' && Array.isArray(_exRes) && _exRes.length >= 1 && _extracted.intent === 'book') {
  const _msMsg = String(input.message || '');
  const _msStarter = /(voglio|vorrei|quiero|...)\s+(prenot|riserv|reserv|book|...)/i;
  if (!_msStarter.test(_msMsg)) _extracted.intent = 'modify';
}
```
**Why it matters**: this is one of many _trust-the-state-not-the-LLM_ guards that the current system has earned. A naive refactor that just delegates to a fresh extraction LLM at conversation_end would lose this.

### 3.4 Empty-modify guard (FIX B34)

```js
if ((_extracted.intent === 'modify' || _extracted.intent === 'cancel') && (!_exRes || _exRes.length === 0)) {
  _extracted.intent = 'book';
}
```
**Source**: parser may emit `modify` from a vague "ho cambiato idea" — but if there's no active reservation, fall back to book.

### 3.5 Past-date / too-far-future / past-datetime guards

Three independent guards in node 4 (~lines 730–745) that reset `f.fecha` to null and produce a polite re-ask in the user's language. Hard-coded 14-day booking horizon.

### 3.6 Closing-time / before-opening guard (FIX 2026-05-07 + B-before-opening)

Distinguishes:
- "demasiado cerca del cierre" (book/modify time > close-45min) → rejected
- "antes de la apertura" (time before opening) → separate template `beforeOpeningRejected` in ES/IT/EN/DE

Located on **3 chatbot nodes** per project memory; this is a cross-node guard.

### 3.7 Bare-hora 24h guard (FIX B38, 2026-05-12)

```js
// "13"–"23" sueltos aceptados como hora + guard contro parser context-blind
// che sovrascriveva personas/fecha
if (!_extracted.hora && _topic === 'hora') {
  const _h = _bareN === 12 ? 12 : (_bareN >= 1 && _bareN <= 11 ? _bareN + 12 : null);
  if (_h != null) _extracted.hora = String(_h).padStart(2,'0') + ':00';
}
```

### 3.8 Multi-topic modify (`pendingModifyTopics`)

When the user says "horario y notas" without numbers, the controller stashes both topics in `_sess.pendingModifyTopics` and asks each in turn; a bare "si" on `proposedHora` is accepted even while intent is `'modify'`. FIX 2026-05-12.

### 3.9 Off-topic guardrail (FIX B32)

Fixed-phrase response in 4 languages: _"no tengo tiempo que perder"_. Resets `_sess.fields` to null. Aligned with voice agent.

### 3.10 Disambiguation gate (`awaitingDisambig`)

Triggered by CRM `/api/ai/modify` returning `ambiguous_reservation` when the guest has >1 active reservation. Stores `lastModifyAttempt` and re-prompts user for `fecha_actual / hora_actual / personas_actual`.

### 3.11 Apology recovery (FIX B7)

```js
if (!aiText && !bookingData && !modifyData && !waitlistData) {
  aiText = fallbacks[_lang] || '... llama al +34 828 712 623 ...';
} else if (_hadFailure && aiText) {
  aiText = (apologies[_lang] || 'Perdona el silencio de antes, ya está todo resuelto.\n\n') + aiText;
}
```
Bot sends fallback with restaurant phone when it gets stuck, then prepends apology on next successful message.

### 3.12 Acknowledgment after modify (FIX B31)

After modify success, reply with prego/de nada/etc. — **never** re-send the recap card.

### 3.13 Sticky language detection (FIX 2026-05-08)

```js
function _detectLang(txt) {
  const esOnly = /\b(qué|cuándo|modificar|reserva|personas|...)\b/i;
  const itOnly = /\b(perché|però|più|prenotare|...)\b/i;
  const enOnly = /\b(the|and|please|thanks|modify|...)\b/i;
  const deOnly = /\b(reservierung|tisch|ändern|...)\b/i;
  // Returns {lang, strong} — strong = full-word marker, not single accent
}
// Override only on strong signal; weak signals ignored once locked
```
Stored in `_sd.customerLang[_phoneKey]` (n8n staticData) and mirrored on `conversations.language` via the CRM webhook.

### 3.14 Force-tool-call fallback (FIX 2026-05-06)

Deterministic safety net: when the LLM "promises" the booking in its reply but doesn't emit the structured payload, the controller forces the call.

### 3.15 Voice from_number validation (FIX 2026-05-04)

In `Picnic_Voice_Agent_Webhooks.json`: `{{from_number}}` is empty in Retell web calls → LLM hallucinates `+34600000000` placeholder. Server-side guard rejects placeholder phones in the Book Logic node.

### 3.16 Edge cases handled vs unhandled

**Handled (catalog)**:
- Low-confidence extraction → field-by-field re-ask via `nextInstruction`
- Multi-intent messages → state machine collapses to last clear intent
- Ambiguous datetime ("a las 2" → 14:00; "el 7" → next day-of-month 7; "1015" → 22:15)
- Missing required fields → controller asks the next missing field (`personas → fecha → hora → zona → nombre → notas`)
- Language mismatch → sticky language with strong-marker override
- Retries → `audit_events.idempotency_key` on CRM side; missing on chat webhook itself
- Idempotency → present on book/modify/cancel routes, **NOT** on `/api/webhooks/incoming-message`
- 4xx from CRM → n8n `try/catch` extracts `err.response.body` for actionable error (waitlist 409, etc.)
- Concurrent same-phone messages → FIX #7 merge in staticData write
- Session expiry → 30-minute TTL

**Unhandled**:
- WhatsApp message dedup (Twilio retries) — debounce was **removed** on 2026-04-29; risk of double-processing
- Voice + WhatsApp same-guest concurrent session — no cross-channel lock
- Long-running booking (CRM > 60s) — n8n timeout 60s, no async ack pattern
- Twilio webhook signature verification — not validated server-side

---

## 4. Phase 4 — Data inventory

### 4.1 Conversation data shape

**Storage**: single table `conversations`, JSONB array in `.transcript` column.

```sql
create table conversations (
  id uuid primary key,
  tenant_id uuid not null,
  guest_id uuid not null,
  channel text check (channel in ('whatsapp', 'voice')) not null,
  intent text default '',                     -- flat string, not enum
  extracted_entities jsonb,                   -- declared but always null in current writes
  linked_reservation_id uuid,
  status text check (status in ('active','resolved','escalated','abandoned')) default 'active',
  escalation_flag boolean default false,
  sentiment text check (sentiment in ('positive','neutral','negative')) default 'neutral',
  summary text default '',
  transcript jsonb default '[]',              -- [{role, content, timestamp}]
  language text,                              -- (added later, not in original DDL)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

**Per-turn append**: each WhatsApp turn goes through `Picnic_Chatbot_WhatsApp.json` node 7 → `POST /api/webhooks/incoming-message` with `transcript: [{user...}, {ai...}]` (two-element array per turn). The route does a find-or-create and appends.

**Retention**: no TTL declared. `conversations.status` transitions are the only end-of-life signal.

### 4.2 Extracted payload — field-by-field vs target 11-field BookingIntent

| Target field | Type | Exists today? | Where | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | ❌ | — | `conversations.id` exists but is NOT echoed back to the booking payload sent to CRM |
| `channel` | enum `whatsapp\|voice` | ⚠️ partial | hardcoded `'whatsapp'` in chat, `'voice'` in voice tools | not a payload field, just a constant in two callers |
| `intention` | enum `BOOKING\|CANCEL\|CHANGE` | ✅ different shape | parser output `intent: book\|modify\|cancel\|waitlist\|info\|offtopic\|confirm_yes\|confirm_no\|null` | more states than target enum |
| `booking_datetime` | ISO-8601 | ❌ split | parser emits `fecha: 'YYYY-MM-DD'` + `hora: 'HH:MM'` (separate fields) | DB also stores them separate (`reservations.date`, `reservations.time` both `text`) |
| `num_guests` | int | ✅ | parser `personas: number\|null` | also has `delta_personas` (relative changes) — richer than target |
| `allergies` | string[] | ⚠️ | parser `notas: string\|null` (free-text bundle) | DB has `reservations.allergies text[]` but bot writes everything into `notes` |
| `customer_name` | string | ✅ | parser `nombre` | guards against hallucinated names ("Amigo", "Cliente") |
| `customer_phone` | E.164 | ✅ | derived from Twilio `From`, normalized | voice version validates against `+34600000000` placeholder |
| `service_type` | string | ❌ | — | restaurant has no taxonomy; closest is `reservations.shift` (`lunch\|dinner`) computed from time |
| `special_requests` | string | ⚠️ | merged into `notas` | + `_sess.shadowNotes` (pet/celiac/etc. detected outside `notas`) |
| `language` | ISO-639-1 | ✅ | n8n `_sd.customerLang[phone]` + `conversations.language` | values: `es\|en\|it\|de` |

**Bonus current fields not in target**:
- `zona` (`interior|exterior`)
- `force_new` (re-book after duplicate detection)
- `edgeHour` (close-to-closing time review flag)
- `proposedZone`, `proposedHora`, `proposedDate` (counter-offers)
- `delta_personas` (relative party-size changes)

### 4.3 State storage

State lives in **three layers**:

| Layer | What | Volatility | Concurrency |
|---|---|---|---|
| **n8n staticData** | `sessions[phone]`, `pendingBookings[phone]`, `pendingWaitlist[phone]`, `customerLang[phone]`, `botFailures[phone]` | volatile, lost on n8n restart, single-instance only | FIX #7 merge mitigates same-phone races |
| **Supabase `guests`** | `bot_paused_at`, name, phone, visit/no-show/cancel counts, tags, notes, dietary | durable | per-row updates safe |
| **Supabase `reservations`** | date, time, party_size, status, source, cancellation_source, notes, allergies | durable | RLS + idempotency_key |

**Memory snapshot of session object** (current shape — see §G of parser-LLM report):
```ts
{
  phone, lang, intent,
  fields: { personas, fecha, hora, zona, nombre, notas, notas_asked, availability_checked },
  pending: null | 'notas_ask',
  proposedZone, proposedDate, proposedHora,
  awaitingDisambig, editingPending, lockedToModify,
  lastModifyTarget, lastModifyAttempt,
  lastInstructionTopic, shadowNotes,
  _infoOverlay, lastUpdate
}
```

**Gap**: this is rich state. If we move state to DB (recommended — see §5.2), we need either a dedicated `bot_sessions` table or to widen `conversations.extracted_entities` to a typed JSONB schema. Today neither exists explicitly; `bot_sessions` is referenced in project memory but not in the schema file.

### 4.4 Audit / analytics data

| Table | Declared in schema | Used by | Rows expected/day |
|---|---|---|---|
| `audit_events` | ✅ | book, modify, cancel, incident, incoming-message | ~50–500 |
| `system_logs` | ❌ (index exists, table does not) | `/api/ai/log-event`, Error Catcher n8n | ~50–200 |
| `reservation_events` | ✅ | DB triggers | ~50–200 |
| `incidents` | ✅ | `/api/ai/incident` | <5 |
| `conversation_audits` | ❌ (added live, not in DDL) | nightly audit workflow `w2J411dX5JcOZZsJ`, GPT-5.1 grader | ~5–20 |

**Schema/code divergence**: `supabase-schema.sql` is **out of date** with the live DB (per memory: "schema file sync" was part of phase 2 hardening). Reconcile before refactor.

### 4.5 Critical schema gaps

- `system_logs` table missing from DDL but index `idx_system_logs_tenant_status_created` declared → CREATE INDEX would fail on a clean restore. **Fix the schema file.**
- `conversation_audits` table not in DDL.
- `bot_config` table not in DDL but per memory has 15 keys wired across 11 workflows.
- `restaurant_tables` + `reservation_tables` queried by Pre-Turno + Daily Summary workflows; **not in DDL**.
- `reservations` has `linked_conversation_id uuid` but NO foreign key constraint to `conversations(id)` (the type is uuid, but the references clause is absent).
- `reservations` lacks a `channel` column — only `source` (`ai_chat|ai_voice|staff|web|walk_in`); not a clean enum match for target.

---

## 5. Refactor decisions — stay / change / replace

Component-by-component verdict, ordered by impact.

### 5.1 KEEP AS-IS (battle-tested, target-compatible)

| Component | Why keep |
|---|---|
| CRM action endpoints `/api/ai/{book,modify,cancel,waitlist,*}` | Clean REST surface, idempotency on the big three, RLS multi-tenant. Maps cleanly to Stage 8. |
| `audit_events`, `reservation_events`, `incidents` tables | Solid audit substrate. Add `conversation_audits` + `system_logs` to DDL. |
| `assertAiSecret` middleware ([`src/lib/ai-auth.ts`](src/lib/ai-auth.ts)) | Timing-safe shared-secret guard. |
| `Picnic_Reminders.json` + `Picnic_No-Show_Auto-Cancel.json` + `Picnic_Follow-up_Post-Cena.json` | Cron-driven outbound logic, decoupled from main chat. No refactor needed. |
| `Picnic_Pre-Turno_Summary.json`, `Picnic_Daily_Summary_10AM.json`, `Picnic_Weekly_AI_Report.json` | Operational reports. Self-contained. |
| `Picnic_Update_Voice_Agent_Date.json` | Keeps Retell prompt fresh. Hourly cron. |
| Sticky language detection algorithm | Hard-earned — preserve verbatim in any new dialog layer. |
| Parser LLM **system prompt** | The most valuable artifact in the codebase. Lift into `prompts/parser.es.md`. |
| All the FIX-numbered guards (B7, B11a, B14, B18, B21, B27, B31, B32, B34, B38, #6, #7, #9) | Each represents a real incident. Migrate as unit tests in the new dialog module. |

### 5.2 CHANGE (structural refactor, same intent)

| Component | What changes |
|---|---|
| **Single mega-Code-node** in `Picnic_Chatbot_WhatsApp.json` | Split into 3 separate n8n nodes: **Parser (OpenAI Tools)** → **Switch on `payload.intention`** → **Controller (Code)** → **Action HTTP** → **Formatter (OpenAI)**. This unlocks Stage 7 (intent router) for free. |
| **State in n8n staticData** | Move to a new `bot_sessions` table: `(tenant_id, guest_id, channel, state jsonb, updated_at, expires_at)`. Add a `private.bot_session_lock(...)` RPC for the concurrency guard (mirroring [`feature_picnic_bot_session_persistence.md`](memory) pattern). |
| **`conversations.transcript jsonb` → `conversation_messages` table** | Optional but recommended: `(id, conversation_id, role, content, lang, timestamp)` for queryable transcripts. Keeps `conversations.transcript` derivable via view for backward compat. |
| **No conversation_end event** | Emit an event when (a) booking succeeds + recap card sent, (b) cancel succeeds, (c) 2h-TTL inactivity, (d) staff takeover. Trigger nightly LLM extraction against final markdown render. |
| ~~**No `BookingIntent.json` schema**~~ | ✅ Done 2026-05-12 — [`schemas/booking_intent.schema.json`](schemas/booking_intent.schema.json) added (11 core fields + `x_picnic` extensions: `zona`, `delta_personas`, `shift`, `force_new`, `edge_hour`, `proposed_alternatives`). Ready to be used as structured-output schema for the future `/api/ai/extract-booking-intent` route. |
| **Hardcoded tenant_id everywhere** | Tenant-id should come from the `x-ai-secret` → tenant lookup (currently the secret IS the tenant_id, per [`src/app/api/webhooks/route.ts`](src/app/api/webhooks/route.ts#L19-L20)). Add a `tenant_api_keys` table for proper rotation. |
| ~~**Hardcoded Twilio creds in n8n node 7**~~ | ✅ Done 2026-05-12 16:40 — i 4 Code node che usavano SID/TOKEN come fallback (`Fetch History`, `OpenAI`, `Send WhatsApp Reply`, `Book + Notify Owner`) ora leggono solo da `tenants.settings.bot_config`. Zero literali nel workflow JSON. |
| **`book/route.ts` (688 LOC)** | Split into `validate.ts` (date/time/opening-hours), `duplicate-check.ts` (±3 day), `allocator.ts` (table assignment), `persist.ts`. |
| **Twilio Sandbox WhatsApp** | Migrate to WhatsApp Business Cloud API + approved HSM templates before production scale. Templates needed: `booking_confirm`, `reminder_24h`, `reminder_4h`, `noshow_cancelled`, `waitlist_offer`. |

### 5.3 REPLACE (target architecture demands different component)

| Component | Replacement |
|---|---|
| **Inline parser + controller + formatter in one node** | **Two-call design**: (1) per-turn lightweight intent classifier that fills slots into `conversations.extracted_entities`; (2) end-of-conversation **full BookingIntent extraction** against `BookingIntent.schema.json` from the rendered markdown. The current per-turn parser becomes (1); a new `/api/ai/extract-booking-intent` becomes (2). |
| **No markdown file format** | If the target architecture insists on `/conversations/{conv_id}.md` artifacts, build a render-on-write helper: on every transcript append, regenerate the MD in Supabase Storage at `conversations/{tenant_id}/{conv_id}.md`. Cheap (one write per turn). Alternative: keep DB as source of truth and render MD only on `conversation_end` for the extraction stage — preferable. |
| **Implicit intent routing in JS** | Explicit n8n **Switch node** wired off `payload.intention` (or `parser.intent`). One outgoing branch per intent. Cancel/modify/waitlist branches become separate sub-workflows with their own test surface. |
| **n8n `Picnic_CRM_Sync.json` 3-webhook fan-in** | Redundant with direct CRM endpoint calls. Decide: either route ALL traffic through Sync (single chokepoint, easier to observe) or remove Sync entirely. Today both paths coexist. |
| **Free-form `notas` string mixing allergies + special requests** | Split during extraction: `allergies: string[]` + `special_requests: string`. Update `reservations.allergies text[]` to actually be populated. |
| **`reservations.date text` + `.time text`** | Migrate to a single `booking_datetime timestamptz` (or keep separate but add a generated `booking_at` column). Eases sorting, indexing, timezone correctness. Today timezones are computed ad-hoc in JS with hardcoded `Atlantic/Canary` / `Europe/Madrid` strings. |

### 5.4 ADD (missing)

| Addition | Why |
|---|---|
| `system_logs` table in DDL | Index exists, table doesn't. Restore-blocker. |
| `conversation_audits` table in DDL | Live but undeclared. |
| `bot_config` table in DDL | 15 keys wired across 11 workflows per memory; should be queryable + auditable. |
| `restaurant_tables` + `reservation_tables` in DDL | Queried by 3 cron workflows but missing. |
| `tenant_api_keys` table | Currently the API key IS the tenant_id (cleartext). Single rotation incident = catastrophic. |
| Webhook signature verification on `/api/webhooks/incoming-message` | Twilio signature is sent but not validated. |
| WA message dedup (Twilio `MessageSid`) | Debounce was removed 2026-04-29; replace with explicit dedup key on `audit_events`. |
| `/api/audit-conversation` route (if not already present) | The DB table + nightly job exist; the HTTP surface is unclear. `[NEEDS HUMAN INPUT]` |
| `BookingIntent.schema.json` + structured-output extractor route | Stages 4–5 of target. |

### 5.5 OUT OF SCOPE for the refactor (don't touch)

- Retell voice agent prompt + tools (working, decoupled, owned by Retell)
- Dashboard pages under [`src/app/(dashboard)`](src/app/(dashboard))
- Nightly audit workflow `w2J411dX5JcOZZsJ` (just shipped today, 2026-05-12)
- i18n dictionaries (4 × ~712 LOC) — battle-tested, just append new keys

---

## 6. Risk register

Sorted by blast-radius.

| # | Risk | Where | Mitigation in refactor |
|---|---|---|---|
| 1 | ~~**API key = tenant_id (cleartext, no rotation)**~~ ✅ FIXED 2026-05-12 | [`src/app/api/webhooks/route.ts`](src/app/api/webhooks/route.ts) | `tenant_api_keys` table + sha256 lookup; legacy bearer-UUID still accepted via fallback |
| 2 | ~~**Twilio creds hardcoded in n8n**~~ ✅ FIXED 2026-05-12 16:40 | `Picnic_Chatbot_WhatsApp.json` nodes 4/5/7/8 | Fallback literals rimossi; creds solo da `tenants.settings.bot_config` |
| 3 | ~~**`system_logs` missing from DDL but indexed**~~ ✅ FIXED 2026-05-12 | [`supabase-schema.sql`](supabase-schema.sql) | DDL added for 10 missing tables |
| 4 | **State in n8n staticData volatile** ⚠️ partial 2026-05-12 | All workflows | Sessions: mirror in `bot_sessions` (FIX B33 = OpenAI read, FIX B39 = Fetch History + Book+Notify writes). Pending caches still in staticData by design (read minutes apart, n8n flush latency tolerable). |
| 5 | ~~**Debounce removed → Twilio duplicate webhook = double-processing**~~ ✅ FULLY FIXED 2026-05-12 | `Picnic_Chatbot_WhatsApp.json` nodes 3 + 7 | CRM-side dedup via `audit_events.idempotency_key`; n8n workflow updated live to pass `MessageSid` (verified active=true) |
| 6 | **Single 2000-LOC Code node = single point of bug** | `Picnic_Chatbot_WhatsApp.json` node 4 | Split into Parser/Controller/Formatter nodes |
| 7 | ~~**No idempotency on `/api/webhooks/incoming-message`**~~ ✅ FIXED 2026-05-12 | [`src/app/api/webhooks/incoming-message/route.ts`](src/app/api/webhooks/incoming-message/route.ts) | Accepts `message_sid`/`idempotency_key`; dedup via `audit_events` |
| 8 | **Hardcoded tenant_id in every workflow** | All 13 n8n workflows | Move to env / per-workflow var |
| 9 | **`book/route.ts` 688 LOC** ⚠️ partial 2026-05-12 (now 642) | [`src/app/api/ai/book/route.ts`](src/app/api/ai/book/route.ts) | Pure validation/opening-hours extracted to [`src/lib/booking-validation.ts`](src/lib/booking-validation.ts) with 27 tests. DB-coupled blocks (guest find-or-create, atomic_book_tables, manual_review path) still inline |
| 10 | **No Twilio signature verification** | [`src/app/api/webhooks/incoming-message/route.ts`](src/app/api/webhooks/incoming-message/route.ts) | ⚠️ Helper added 2026-05-12 ([`src/lib/twilio-signature.ts`](src/lib/twilio-signature.ts)) but not yet wired — webhook receives JSON from n8n, not Twilio directly. Activate when adding a Twilio-direct endpoint. |
| 11 | **WhatsApp Sandbox only — no HSM templates** | All outbound | Apply for HSM templates pre-launch |
| 12 | ~~**Schema file vs live DB drift**~~ ✅ FIXED 2026-05-12 | [`supabase-schema.sql`](supabase-schema.sql) | 10 missing tables + `tenant_api_keys` synced |

---

## 7. Sequence-of-work proposal (no PRs yet — for review)

A 5-stage rollout, each landable independently and reversible.

1. **Schema reconciliation** — get [`supabase-schema.sql`](supabase-schema.sql) to match live DB. Add `system_logs`, `conversation_audits`, `bot_config`, `restaurant_tables`, `reservation_tables`, `tenant_api_keys`, `conversation_messages` (proposed).
2. **Extract Parser prompt + Controller into versioned files** — `prompts/parser.{es,en,it,de}.md`, `lib/dialog/controller.ts` (with unit tests for each FIX-numbered guard). No behavior change — just moving code out of `Picnic_Chatbot_WhatsApp.json` into the CRM repo and importing back via n8n's HTTP-call-to-CRM pattern.
3. **Split chatbot workflow** — Parser node → Switch on `intent` → Controller → Action → Formatter. State persisted to `bot_sessions` table. Old workflow runs alongside (different webhook path) for canary.
4. **Add end-of-conversation BookingIntent extraction** — `/api/ai/extract-booking-intent` against `BookingIntent.schema.json`. Triggered on conversation_end events. **Optional MD render** to Supabase Storage if target-architecture compliance is required.
5. **Channel hardening** — migrate to WhatsApp Business Cloud API + HSM templates; add Twilio signature verification + `MessageSid` dedup; rotate creds.

Each stage shippable in ~1 sprint; stages 1 & 5 are independent of 2–4 and could run in parallel.

---

## 8. Open questions for the human

These are not assumptions — they need an answer before stage 2 starts.

1. **Is the `/api/audit-conversation` route already on a branch / not merged?** Memory entry 6126 (2026-05-12) says it was created. The file list above does not show it. `[NEEDS HUMAN INPUT]`
2. **Does the target architecture insist on `/conversations/{id}.md` files on disk, or is DB-rendered MD on conversation_end sufficient?** Big cost/benefit difference.
3. **Migrate off Twilio WA Sandbox to WhatsApp Business Cloud API now or after stages 1–4?** Templates require Meta approval (1–2 weeks).
4. **Voice agent: keep Retell, or migrate to in-house Whisper + LLM + ElevenLabs per the target text?** Retell does many things well; in-house gives full control. This is a strategic call, not a refactor call.
5. **Multi-tenancy in this refactor: do we need to support more than one restaurant in the chatbot workflow now, or is hardcoded tenant_id OK while we ship?** Affects every n8n change.
6. **Is `Picnic_CRM_Sync.json` actively used or vestigial?** If both paths exist and only one is hit in practice, removing the other simplifies stage 3.

---

*Compiled by survey of [/Users/amplaye/CRM](.) and [/Users/amplaye/N8N/picnic](/Users/amplaye/N8N/picnic) on 2026-05-12. No code modified.*
