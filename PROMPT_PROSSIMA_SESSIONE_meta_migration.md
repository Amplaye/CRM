# Prompt prossima sessione — Migrazione Twilio→Meta WhatsApp (RESIDUO: solo cleanup sicurezza)

> Copia-incolla il blocco qui sotto come primo messaggio della prossima sessione.

---

La migrazione **BaliFlow CRM da Twilio WhatsApp → Meta WhatsApp Cloud API** è **funzionalmente COMPLETA**. Resta solo un cleanup di sicurezza, che l'utente ha deciso di fare **dopo, con un plugin di security**. NON rifare la migrazione: è fatta.

**Leggi per primi:** memorie `project_baliflow_meta_migration.md`, `feature_baliflow_meta_picnic_already_sending.md`, `_index_baliflow_crm.md`, sezione "Meta WhatsApp Cloud API" + "Twilio" in `credentials.md`.

## ✅ Stato reale (verificato dal vivo 2026-05-29)
- **Backend CRM Next.js**: migrato e pushato, commit `0fa4b48` (helper `src/lib/whatsapp/meta.ts`, `meta-signature.ts`, 4 send-route, incoming-message dedup wam_id, 226/226 test, build 0).
- **Picnic + oraz INVIANO E RICEVONO GIÀ via Meta.** `tenants.settings.bot_config` ha le creds Meta (token = `META_ACCESS_TOKEN` centrale, phone `1095078260361095`). Ricezione via **Meta Router `zuYx8raoBVz88Erj`** (ATTIVO, success). Webhook Meta phone→`meta-whatsapp-router`.
- **Router consolidati**: 1 solo attivo (Meta `zuYx8raoBVz88Erj`). Eliminato il doppione stale `Zjjv2YVvDrm4Y9w0`. Twilio Router `mI2jXmQZPrA60xUX` DISATTIVATO (non eliminato, reversibile).
- **Sub-workflow** `[ALL] Send WhatsApp (Meta)` = `a00dkoe6lwKi6Dv7` (Meta-only, no secret) — pronto se si vorrà centralizzare l'invio.
- **`META_APP_SECRET`** = `m6XFrj3x34nXe5EP7tEVbxoNJsI` (in credentials.md + `.env.local` + Vercel prod+dev). Firma webhook resta OFF finché non si setta `FACEBOOK_VERIFY_SIGNATURE=1`.
- **SCOPE**: SOLO Picnic + oraz (numero Meta condiviso). I bot **cliniche (Dental/DC Clinic/Patricia/Casanova) e MojoSurf** sono progetti separati su numeri Twilio propri → **lasciati su Twilio, IGNORATI** per decisione utente ("erano solo test"). Resteranno su Twilio finché non avranno ognuno il proprio numero Meta.

## 🔴 Unico residuo — cleanup sicurezza (GATED, l'utente lo fa col plugin Check Security)
Dentro i 30 workflow Picnic+oraz ci sono **secret in chiaro**:
- **Supabase service-role JWT** `eyJ...pBBJAeq7...` — **334 occorrenze**, accesso TOTALE al DB. Il più grave. → **da RUOTARE** (Supabase dashboard → API → rotate service_role).
- **Twilio SID/token** (`AC169253...` / `405c7358...`, 37+37) — fallback Twilio ormai morto.
- **Meta token** hardcoded (22) nei cron proattivi (Reminders/Daily Summary/ecc.).

**⚠️ NON fare un find/replace cieco verso `process.env.*`**: l'host n8n (hstgr.cloud) **non espone in modo verificabile** quelle env (il probe webhook non si registra via API), e i cron usano `process.env.X || '<hardcoded>'` → togliere il fallback senza prima settare l'env sull'host **rompe gli invii proattivi**. Sequenza corretta: (1) settare le env sull'host n8n, (2) verificare che gli invii usino l'env, (3) solo allora togliere i fallback hardcoded, (4) ruotare i secret esposti.

## Da fare quando si riprende (tutto GATED su conferma utente)
1. Ruotare il **JWT Supabase service-role** + il **token Twilio** + Vercel `TWILIO_AUTH_TOKEN`.
2. Rimuovere gli env Twilio-WhatsApp da Vercel (`TWILIO_WHATSAPP_FROM`, `BALI_WHATSAPP_FROM`, `TWILIO_VERIFY_SIGNATURE`) — **TENERE** `TWILIO_ACCOUNT_SID/AUTH_TOKEN` per la voce.
3. Repo: rimuovere `twilio/delivery-callback` + `twilio-signature.ts` quando nessuno invia più WhatsApp via Twilio; bonificare i testi UI "sandbox".
4. (Opzionale) cablare i 30 workflow al sub-workflow `a00dkoe6lwKi6Dv7` per togliere i secret duplicati in un punto solo.

## Note operative
- Lavoro su `main` (no branch), commit+push automatico. curl n8n/Supabase/Meta/Vercel → `dangerouslyDisableSandbox`.
- n8n REST: `X-N8N-API-KEY`, base `N8N_BASE_URL`. Workflow: `GET/PUT/DELETE /api/v1/workflows[/{id}]`, attiva/disattiva `POST /api/v1/workflows/{id}/{activate|deactivate}`. **Non c'è** endpoint pubblico per "run" (405) — serve un webhook trigger.
- Domande all'utente SEMPRE a voce: `/Users/amplaye/.claude/voice/ask_voice.sh "<domanda in italiano semplice>"` (l'utente non è tecnico — spiega in parole povere e consiglia tu).
