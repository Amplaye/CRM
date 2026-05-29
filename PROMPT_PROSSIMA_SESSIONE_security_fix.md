# Prompt prossima sessione — Fix di sicurezza CRM (Picnic / BaliFlow)

Copia-incolla questo come primo messaggio della prossima sessione.

---

Riprendiamo il **fix di sicurezza del CRM** (`/Users/amplaye/CRM` — app Next.js 16 + Supabase multi-tenant, Picnic è un tenant). Nella sessione precedente (2026-05-29) ho fatto un **security review completo** (5 reviewer per trust boundary + verifica adversariale di ogni finding, 35 → **33 confermati, 2 respinti**). Report completo già nel repo: **`SECURITY_REVIEW_2026-05-29.md`** — leggilo prima di toccare codice.

**Esito:** 🔴 7 CRITICAL · 🟠 16 HIGH · 🟡 4 MEDIUM · ⚪ 6 LOW. **Nessun fix ancora applicato (review-only).**

**Causa radice (1 riga):** il middleware esenta *ogni* path `/api/*` dall'auth (le API devono auto-autorizzarsi), ma molte route (a) hanno dimenticato il check, (b) usano un guard **fail-open** che passa tutto se manca una env var, o (c) usano il client **service-role** (bypassa RLS) fidandosi di un `tenant_id` preso dal body. In più una **RLS policy permette a qualunque utente loggato di auto-promuoversi a platform_admin**.

## Cosa NON dimenticare (contesto verificato)

- **Stato git:** branch `main`, pulito (a parte i 2 doc di security). HEAD = `afab54f`. **Lavoro sempre su `main`** (decisione utente: niente feature branch finché non c'è un cliente reale — vedi memoria BaliFlow). Commit + push automatici a fine task.
- **`.env.local` (locale) — env MANCANTI che causano il fail-open:** `AI_WEBHOOK_SECRET`, `FACEBOOK_VERIFY_SIGNATURE`, `TWILIO_VERIFY_SIGNATURE`, `CRON_SECRET`, `RATE_LIMIT_ENABLED`. **Presenti invece:** `META_APP_SECRET`, `META_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `VAPI_PRIVATE_KEY`, ecc. → Queste env vanno **anche** settate su Vercel (tutti e 3 gli ambienti: Production, Preview, Development). `CRON_SECRET` su Vercel prod risulta già impostato da lavoro precedente — **verificare**, non assumere.
- **DDL su Supabase si applica via Management API** (token BaliFlow in `credentials.md`). NON è vero che "il DDL non si può applicare" — già fatto più volte. Per la fix RLS C1 serve questo.
- **Lo schema in `supabase-schema.sql` NON è la fonte viva** — il DB reale è stato modificato via Management API. Diverse tabelle hanno RLS ON ma policy **non** nel sorgente (deferred). Prima di concludere su RLS, **confrontare col DB vivo**.
- **Definizione di "fatto" per il CRM:** `npx tsc --noEmit` = 0 errori, `npm test` (vitest) tutto verde, `npm run build` = 0. C'è `src/lib/saas-invariants.test.ts` che blocca regressioni (es. numeri sandbox hardcoded in `src/app/api/**`).
- **Picnic è il banco di prova del cliente reale — non rompere il flusso live.** Le route AI/webhook sono chiamate da n8n; cambiare l'auth a fail-closed **richiede** che i secret siano su Vercel *prima*, altrimenti n8n inizia a prendere 401/403 e il bot Picnic smette di rispondere. Sequenza obbligata: **prima i secret su Vercel + aggiornare l'header `x-ai-secret` nei nodi n8n, poi** il fail-closed.

## Ordine di remediation consigliato (dal report)

1. **C1 — Privilege escalation RLS (FARE PER PRIMO, 1 riga, blocca takeover totale).** `supabase-schema.sql:388` — policy `Users can update own profile` ha `for update using (id = auth.uid())` **senza `WITH CHECK`** → chiunque fa `PATCH /rest/v1/users?id=eq.<self>` con `{"global_role":"platform_admin"}` via anon key e diventa platform admin. Fix: aggiungere `with check` che ricalcola `id = auth.uid()` **e** impedisce di cambiare `global_role` da sé; meglio ancora `REVOKE UPDATE (global_role) ON public.users FROM authenticated` + funzione SECURITY DEFINER per i platform admin. Applicare via Management API + codificare in `supabase-schema.sql`.
2. **C2 + C6 — Fail-open auth → fail-closed.** `src/lib/ai-auth.ts:23-28` (se manca `AI_WEBHOOK_SECRET` → rifiuta, non `return null`) e `src/lib/meta-signature.ts` (wire `verifyMetaSignature`/`verifyMetaRequest` in **ogni** POST webhook + fail-closed in prod). **PRIMA** settare `AI_WEBHOOK_SECRET`, `FACEBOOK_VERIFY_SIGNATURE=1` su Vercel e aggiornare n8n.
3. **C3 + 8 route admin aperte (HIGH) — aggiungere `assertPlatformAdmin()`** in cima a ogni handler (≈1 riga ciascuno): `admin/bali/send`, `admin/bali/conversations`, `admin/bali/messages`, `admin/bali/takeover`, `admin/client-notes` (GET/POST/DELETE), `admin/overview` (togliere il blocco `if (x-user-id)` self-asserted), `admin/system-logs` (GET/PATCH), `admin/tenant` (manca su **GET**, PATCH già ok), `admin/usage`.
4. **C4 + C7 + route senza membership — smettere di fidarsi del `tenant_id` dal body**, verificare membership server-side: route `/api/ai/*` (deriva tenant dalla API key per-tenant), server actions `src/app/actions/{reservations,waitlist}.ts`, `/api/insights`, `/api/send-whatsapp`, `/api/sync-kb-vapi`, `/api/sync-vapi-voicemail`.
5. **C5 — `/api/webhooks/incoming-message` POST**: verifica firma Meta + autorizza `tenant_id`.
6. **H — bearer legacy:** `src/lib/tenant-auth.ts` accetta `Bearer <tenant_id>` (hash = `sha256(tenant_id)`); i tenant_id sono UUID non-segreti. Revocare le righe `legacy-bearer-tenant-id`, accettare solo le chiavi `crypto.randomBytes(32)` (già implementate nella route api-keys).
7. **H — SSRF menu import:** `src/lib/menu/fetch-url.ts` — risolvere l'host a IP (`dns.lookup {all:true}`) **prima** di connettersi, bloccare privati/loopback/link-local/CGNAT/`169.254.169.254`, `redirect:'manual'` + re-validare ogni hop, cap dimensione/tempo.
8. **MEDIUM/LOW** come hardening (M1/M2 firma delivery webhook, M3 markdown export membership, M4 register-tenant/guest-setup senza sessione; L1 `RATE_LIMIT_ENABLED=1`, L4 CSP, L5 `tenants.settings` leggibile da ogni membro, L6 codificare le policy RLS deferred).

## Già OK — NON toccare
API keys (`crypto.randomBytes(32)`, hash SHA-256), QR token (`randomBytes(24)`), `impersonate` (gated), `cron/purge-tenants` (CRON_SECRET), header di sicurezza, `meta-signature.ts`/rate-limit (ben scritti, solo da abilitare/cablare). `.env.local`/`_creds_tmp.md`/`N8N/` sono gitignored (NON committati).

## Decisione da prendere a inizio sessione
Chiedimi (a voce) **fin dove arrivare**: solo i 7 CRITICAL? CRITICAL + HIGH? oppure tutto incluso MEDIUM/LOW? E se vuoi un **commit atomico per finding** (consigliato, più facile da revisionare e rollback) o raggruppati. Poi procedo: per ogni fix → modifica, `tsc`/test/build verdi, test live mirato dove serve (tenant usa-e-getta poi cancellato, mai toccare dati Picnic reali), commit+push.

**Caveat dal report:** le conclusioni "fail-open" assumono i secret non settati su Vercel (coerente con `.env.local` + commenti nel codice, ma **conferma su Vercel**); i finding RLS vanno confermati sul **DB vivo**.
