@AGENTS.md

# TableFlow / BaliFlow CRM

CRM SaaS multi-tenant per ristoranti (e cliniche). Next.js 16 + Supabase + **Cloudflare Workers** (OpenNext). Repo: `github.com/Amplaye/CRM`. `crm.baliflowagency.com` è servito da Cloudflare (worker `crm`); Vercel resta solo come rollback finché non dismesso.

## Stack
- **Next.js 16** (App Router) + React 19 + TypeScript. ⚠️ È una versione con breaking changes — consulta `node_modules/next/dist/docs/` prima di scrivere codice Next, non fidarti della memoria.
- **Supabase** (Postgres + Auth + Storage + Realtime), multi-tenant con RLS.
- **Tailwind v4** + lucide-react + recharts.
- Deploy **Cloudflare Workers** via OpenNext (`npm run deploy` / worker `crm`). ⚠️ n8n è SPENTO: il motore bot è il Worker `bot-engine.sofia-f88.workers.dev` (multi-tenant dinamico). I cron NON sono più su Vercel — girano nel Worker `bot-engine` (scheduled dispatch, `src/lib/cron/dispatch.ts`).

## Comandi
- `npm run build` — build di produzione (usalo per verificare i tipi/compilazione).
- `npm test` — vitest (test unit: booking-validation, restaurant-rules, saas-invariants, tenant-auth…).
- `npx tsc --noEmit` — type-check senza emettere.
- Playwright E2E: `src/` test + `scripts/motore-e2e/`.
- ⚠️ **MAI `npm run dev`** (no dev server Next). **Un solo processo pesante alla volta** — preferisci vitest / tsc / build separati, non in parallelo.

## Struttura
- `src/app/(dashboard)/` — pagine CRM: reservations, guests, menu, floor, analytics, inventory, food-cost, pl, knowledge, settings, staff, conversations, pending, waitlist, incidents, admin.
- `src/app/api/` — route handlers: ai, voice, whatsapp/twilio/webhooks, billing, pos, invoices, cron, onboard/register-tenant, settings, team.
- `src/lib/` — logica: `supabase/`, `ai/`, `voice/`, `whatsapp/`, `billing/` (entitlements!), `pos/`, `menu/`, `invoices/`, `management/`, `tenants/`, `i18n/`, `audit.ts`, `system-log.ts`, `rate-limit.ts`.
- `src/middleware.ts` — auth/routing. `supabase/` + `supabase-schema.sql` — schema DB.

## Convenzioni & trappole (IMPARATE — rispettale)
- **Multi-tenant**: ogni query/azione è tenant-scoped. Mai logica che ignori `tenant_id` (guard fa skip silenzioso se manca). Niente "branches" per tenant.
- **WhatsApp = Meta Cloud API**. Twilio è stato **rimosso del tutto** il 2026-07-20 (codice, route `/api/twilio/*`, helper firma, fallback nel bot-engine): non esiste più nessun path Twilio, né per WhatsApp né per voce/SMS. Non reintrodurlo.
- **Add-on gating**: gestionale/POS sono add-on → gate in `src/lib/billing/entitlements.ts`. Flag: `management_enabled`, `commercial_info_enabled`.
- **system_logs**: usa colonne `title` + `description`, MAI `message`. Wrappa il logging in try/catch.
- **Cron**: le route `/api/cron/*` sono chiamate dal Worker `bot-engine` (scheduled dispatch, `src/lib/cron/dispatch.ts`), auth `Authorization: Bearer ${CRON_SECRET}`. `vercel.json` è stato rimosso.
- **Motore bot / sandbox**: nuovo tenant → nasce `provisioning.engine="cloudflare"`, NESSUN workflow da clonare (Worker dinamico). Per il numero sandbox condiviso, l'onboarding lo aggiunge alla KV `sandbox:tenants` del Worker via `POST /internal/sandbox-tenants` (auth `x-internal-secret: CRON_SECRET`); teardown lo rimuove. Re-trigger bot dopo takeover: `POST /internal/retrigger` (vedi `sandbox-registry.ts`, `engine-health.ts`).
- **Auth latency**: nei presence-check usa `getSession()`, non `getUser()`.
- **Secret POS**: `POS_CRED_ENC_KEY` deve stare nell'env del worker `crm` (`wrangler secret put`) o `pos-sync` fallisce (serve redeploy).
- **Upload > 4.5MB**: usa signed URL su Storage (bucket `menu-imports`), non body diretto.
- **Token Stripe/PayPal/Meta**: solo secret del worker (`wrangler secret put`), MAI in git.
- **Assistente in-app** (`src/lib/assistant/kb.ts`): ogni nuova sezione/feature user-facing va INSEGNATA all'assistente — aggiungi/aggiorna il suo `KbTopic` (4 lingue it/en/es/de, keywords multilingua, link alla pagina) e, se è un'azione operativa, `actions.ts`. Il test `kb-coverage.test.ts` fallisce se una sezione della dashboard non è coperta: non silenziarlo con l'allowlist, scrivi il topic.

## Stile di lavoro (vedi memoria globale per il resto)
- **Agisci, non chiedere** conferma per fix ovvi; riassumi alla fine. Semplicità prima di tutto.
- **Verifica prima di ricostruire**: controlla che una cosa non esista già prima di rifarla.
- **Testa davvero** (vitest + Playwright E2E) prima di dire "pronto". No grigi nei testi (`text-black`).
- A fine task: **commit + push** (su branch, non direttamente su main se è il default).
- Niente email automatiche / feature da power-user / iniziative di business-policy non richieste.

> Dettaglio storico (bug, feature, decisioni) in memoria: `_index_baliflow_crm.md` e file `*_baliflow_*`.
