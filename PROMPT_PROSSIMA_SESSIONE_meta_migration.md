# Prompt prossima sessione — Migrazione Twilio→Meta WhatsApp (SECONDA METÀ: n8n + cutover)

> Copia-incolla il blocco qui sotto come primo messaggio della prossima sessione.

---

Riprendiamo la migrazione di **BaliFlow CRM da Twilio WhatsApp → Meta WhatsApp Cloud API**. **La prima metà (backend CRM Next.js) è FATTA, verificata e pushata** (commit `0fa4b48` su `main`). Ora tocca la **seconda metà: i workflow n8n + il cutover finale**.

**Leggi per primi**, in quest'ordine:
1. `/Users/amplaye/.claude/plans/temporal-bouncing-rainbow.md` — piano completo + audit + appendice dei 38 workflow con credenziali Twilio hardcoded.
2. Memoria: `project_baliflow_meta_migration.md` (3 decisioni confermate + endpoint Meta + baseline) e `_index_baliflow_crm.md`.
3. Credenziali Meta: sezione "Meta WhatsApp Cloud API" in `credentials.md` (token system-user che NON scade, phone_number_id, verify token).

## ✅ Già fatto (prima metà — NON rifare)
- **Decisioni architetturali (confermate a voce):** UN numero Meta condiviso `1095078260361095` adesso (per-tenant in futuro, tieni tutto config-driven); UN token Meta centrale `META_ACCESS_TOKEN`; Twilio scollegato da WhatsApp ma `TWILIO_ACCOUNT_SID/AUTH_TOKEN` TENUTI per la voce futura.
- **Token Meta verificato:** SYSTEM_USER, `expires_at:0` (non scade), scope whatsapp_business_*. Webhook Meta oggi puntano a `n8n.../webhook/meta-whatsapp-router` (phone) e `.../oraz-2b21-whatsapp` (application).
- **Env Vercel (prod+preview+dev) + `.env.local`:** `META_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID=1095078260361095`, `META_GRAPH_VERSION=v21.0`, `META_WEBHOOK_VERIFY_TOKEN=baliflow-meta-42a50e05e86af14b25865171a2323990`.
- **Backup n8n:** tutti i **97** workflow in `CRM/N8N/backups/2026-05-29_pre_meta/` (gitignored: contengono i secret). Conteggio riconciliato: 97, non 96.
- **Backend CRM migrato (commit `0fa4b48`):** nuovo helper unico `src/lib/whatsapp/meta.ts` (`sendWhatsAppMeta`), `src/lib/meta-signature.ts` (HMAC-SHA256 + GET handshake), `from.ts` ora ritorna un Meta phone_number_id, 4 send-route migrate (`send-whatsapp`, `admin/bali/send`, `ai/waitlist-process`, `ai/waitlist-reassurance`), `incoming-message` (dedup `wam_id` + GET verify), nuova route `whatsapp-delivery`, vecchia `twilio/delivery-callback` deprecata (tenuta per non dare 404 durante il cutover), testo UI onboard aggiornato. Invarianti+test aggiornati. **tsc 0 · vitest 226/226 · build 0 · zero `api.twilio.com` send in `src`.**

## 🔴 Da fare (seconda metà) — ordine confermato PICNIC-first

**⚠️ Prima cosa, da chiedere all'utente A VOCE (istruzioni globali, italiano semplice):**
1. **`META_APP_SECRET`** — è l'unico env Meta mancante. Serve SOLO per verificare la firma dei webhook in arrivo (sicurezza anti-spoofing). Si prende da developers.facebook.com → app **`1259805589309723`** ("BALI Flow") → Settings → Basic → App Secret. Chiedigli se può recuperarlo; intanto la verifica firma resta OFF (default skip) e l'invio funziona lo stesso.
2. **Template Meta** — i messaggi proattivi (reminder, daily summary, no-show, follow-up, post-call, menu del día) fuori dalla finestra 24h richiedono **template approvati da Meta** (review lenta). Chiedi conferma che vuole procedere e spiegagli che vanno sottomessi presto perché Meta li approva con calma. Senza, i cron proattivi non partono.

**Poi, fase per fase (chiedi conferma sui passi LIVE):**
- **Fase 2 — PICNIC pilota (gold standard):** bonifica i workflow `[Picnic]*` (Chatbot `166QnQsGHqXDpBxa`, Reminders, No-Show, Pre-Turno, Daily Summary `2t5TL552kz3HL0By`, Follow-up, Menu, Nightly Audit `w2J411dX5JcOZZsJ`, Deflector `fenoM2b2Q9MMa0Kd`, Voice Webhooks `31yGmF9OJ9EFFHO7` solo il recap WA). Rimuovi ramo Twilio + token hardcoded. **Estrai un sub-workflow n8n unico `[ALL] Send WhatsApp (Meta)`** (gemello di `sendWhatsAppMeta`) per non duplicare il nodo Graph in decine di posti. **Valida ricezione+invio reali su Picnic PRIMA di propagare.**
- **Fase 3 — Router:** quando i tenant ricevono via Meta, attiva `[Meta Router] WhatsApp` (`Zjjv2YVvDrm4Y9w0`, oggi OFF), dismetti `[Router] WhatsApp` Twilio (`mI2jXmQZPrA60xUX`, oggi attivo), consolida (ci sono DUE Meta Router + un Router Twilio).
- **Fase 4 — Replica per tenant:** oraz → BALI Rest → BALI → Dental → DC Clinic → Casanova → Patricia → MojoSurf. I chatbot **solo-Twilio** (Dental `pbYCi3JKztHLbf2b`, DC Clinic `aGwrIpB7QGQfSqhm`, Patricia `XZ8i1xxN34LAsObY`, Casanova `mom9Fymb9dLkDm9P`) sono i più pesanti (anche la **ricezione** da migrare, usano la Twilio Messages.json come storico). `[oraz] Chatbot` (`JxCRqloFjJI65U39`) ha pure il **JWT Supabase hardcoded** da ruotare. Aggiorna `src/lib/onboarding/orchestrator.ts` + i workflow `[Picnic]*` sorgente-template così i cloni futuri nascono Meta-only; deprecа il flag `sandbox_routable`.
  - **⚠️ Numeri LIVE +34641459479 (traffico BALI reale, testare con cautela, chiedere conferma):** `QHgTiaeJge2JWAEN` Inbound, `yuLvZr2N1QvHJ47v` Post-Call (ContentSid→template Meta), `ES5E1p5bGKlVkPbT` ChatBot Webhooks (template), `3qZvS8UBJieQfdRx` Tool Book Appointment (template).
  - **⚠️ Fallback "LIVE mascherati da morti"** (`lUfUipdtPX94qWlJ`, `z1Akph5impMRh28Y`, `zoLhECgUOjeTeIzq`): il ramo Twilio è attivo perché i default hardcoded sono non-vuoti.
- **Fase 5 — Cutover & cleanup (passi distruttivi → conferma esplicita):** spegni i webhook Twilio; **REVOCA/rigenera il token Twilio** sul portale (38 workflow lo contengono in chiaro — vedi appendice del piano) + **ruota il JWT Supabase di oraz** + ruota `TWILIO_AUTH_TOKEN` su Vercel; rimuovi gli env Twilio-WhatsApp (`TWILIO_WHATSAPP_FROM`, `BALI_WHATSAPP_FROM`, `TWILIO_VERIFY_SIGNATURE`) — ma **NON** `TWILIO_ACCOUNT_SID/AUTH_TOKEN` (servono alla voce); rimuovi la route `twilio/delivery-callback` + `twilio-signature.ts` quando nessun numero invia più WhatsApp; bonifica i testi UI residui (`admin/tenant/health` "sandbox"→"Meta test mode", `admin/page.tsx`).

## Verifica finale (end-to-end)
1. Repo: `npx tsc --noEmit` (0) · `npx vitest run` (verde) · `npm run build` (0).
2. Scan anti-Twilio su **tutti i workflow n8n via API** (`grep` del SID `AC169253...`, token `405c7358...`, JWT Supabase oraz → **0**) oltre che su `src`.
3. **Live n8n:** WhatsApp reale al numero Meta → Meta Router instrada → il bot risponde via `graph.facebook.com` (nei log NON deve comparire `api.twilio.com`). Tenant nuovo post-Fase 4 → nasce Meta-only. Cleanup dati test.
4. Notifiche proattive (Reminder/Daily Summary/Post-Call) → inviate via template Meta approvato.

## Note operative
- Lavoro su `main` (no branch), commit+push automatico a fine task. Le chiamate n8n/Supabase/Meta/Vercel via `curl` richiedono `dangerouslyDisableSandbox`.
- n8n REST: header `X-N8N-API-KEY`, base `N8N_BASE_URL` (in `.env.local` e credentials.md). Endpoint workflow: `GET/PUT $N8N_BASE_URL/api/v1/workflows[/{id}]`.
- Le domande all'utente SEMPRE a voce: `/Users/amplaye/.claude/voice/ask_voice.sh "<domanda in italiano semplice>"` (l'utente non è tecnico — spiega pro/contro in parole povere e consiglia tu).
