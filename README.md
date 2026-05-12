# BaliFlow CRM (`tableflow-ai`)

Multi-tenant restaurant operations dashboard. WhatsApp + voice AI bots ingest
into the CRM via `/api/ai/*` routes; staff use the Next.js dashboard to
manage reservations, guests, conversations, and incidents.

Live tenant: **Restaurante Picnic** (Las Palmas). Production at
`https://crm.baliflowagency.com`.

## Stack
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Supabase Postgres + RLS (multi-tenant)
- Vercel deploy (Fluid Compute, Cron, Web Analytics, Speed Insights)
- n8n workflows on Hostinger drive the bots; CRM is the system of record
- Retell for voice; Twilio Sandbox WhatsApp for chat

## Local dev

Requires Node 20+.

```bash
npm install
cp .env.local.example .env.local   # populate from credentials.md
npm run dev                        # http://localhost:3000
npm test                           # vitest, 56 tests at last commit
npm run build                      # static analysis + route map
```

Required env vars (all of these are in [the user's `credentials.md`](../.claude/projects/-Users-amplaye/memory/credentials.md)):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_WEBHOOK_SECRET          # n8n / Retell shared secret
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SIGNATURE    # opt-in: "1" to enforce HMAC on twilio webhooks
OPENAI_API_KEY             # used by translate-note + conversation-summary
AI_GATEWAY_API_KEY         # optional: route OpenAI calls via Vercel AI Gateway
RATE_LIMIT_ENABLED         # opt-in: "1" to enable Supabase-backed rate limit
N8N_BASE_URL
N8N_API_KEY
RETELL_API_KEY
```

## Smoke test

`scripts/smoke-test.mjs` runs 7 checks (build, tests, n8n workflows alive,
system_logs clean, webhook dedup, api-key auth, E2E chatbot, availability
route). Required env: `N8N_API_KEY`, `SUPABASE_MGMT_TOKEN`,
`AI_WEBHOOK_SECRET`, `SMOKE_API_KEY`.

```bash
node scripts/smoke-test.mjs
```

The script is idempotent — every fake guest/conversation it creates is
deleted in cleanup. Should be **the first** thing run before any Picnic
change.

## Layout

- [`src/app/(dashboard)`](src/app/(dashboard)) — authenticated dashboard
- [`src/app/api`](src/app/api) — route handlers
  - `/api/ai/*` — bot ingestion (book, modify, cancel, waitlist, availability)
  - `/api/webhooks` — generic bearer-auth gateway for AI agents
  - `/api/webhooks/incoming-message` — Twilio-shaped inbound from n8n
  - `/api/twilio/delivery-callback` — outbound message delivery status
  - `/api/admin/*` — platform-admin only (tenant onboarding, api-key rotation,
    GDPR export+erase)
  - `/api/conversations/[id]/markdown` — conversation as MD
- [`src/lib`](src/lib) — shared helpers (booking validation, restaurant rules,
  ai-auth, admin-auth, cors, rate-limit, conversation-md, openai-base-url, etc.)
- [`schemas`](schemas) — JSON schemas (BookingIntent for Stage 5 target arch)
- [`docs`](docs) — ADRs, bot-config reference, audit reports
- [`scripts`](scripts) — smoke test, n8n cleanup helpers, audit

## Operational docs

- [`REFACTOR_DIAGNOSIS.md`](REFACTOR_DIAGNOSIS.md) — full risk register +
  refactor plan, kept in sync with `main`
- [`docs/INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md) — when the bot
  silently breaks at 1 AM
- [`docs/ONBOARDING_NEW_TENANT.md`](docs/ONBOARDING_NEW_TENANT.md) — clone
  Picnic for a new restaurant
- [`docs/bot-config.md`](docs/bot-config.md) — every `tenants.settings.bot_config`
  key documented
- [`docs/adr`](docs/adr) — decision records (why n8n, why Retell, etc.)

## n8n workflows

Owned + tracked in [`/Users/amplaye/N8N/picnic`](../N8N/picnic), 12 active
`[Picnic]` workflows. Each workflow's `picnicLoadCfg` bootstrap reads
`tenants.settings.bot_config` so credentials and policy values live in DB,
not in workflow JSON.

Backups go in `/Users/amplaye/picnic_backups/` (gitignored). Always
re-fetch the live workflow before an incremental PUT, otherwise stale
local exports overwrite live fixes.

## License

Proprietary — internal BaliFlow Agency tooling.
