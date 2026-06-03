# Prompt prossima sessione — Chiudere Fase 1 async + opzionali (motore unico)

> Copia-incolla il blocco qui sotto come primo messaggio della prossima sessione.

---

Continuiamo sullo **scaling del bot WhatsApp ristoranti** (motore unico). La Fase 1 async è quasi chiusa: restano l'hardening del concurrency limit + la prova finale del carico, una verifica veloce del Router, e 3 opzionali. Lavora in autonomia, fammi domande **solo a voce** e solo se davvero bloccanti.

**Contesto fisso (NON rifare audit/load-test da zero):**
- Motore unico = `[Picnic] Chatbot WhatsApp` **`166QnQsGHqXDpBxa`** (UNICO attivo), webhook `picnic-whatsapp`, 8 nodi. Entry reale = `[Meta Router] WhatsApp` **`zuYx8raoBVz88Erj`**, webhook `meta-whatsapp-router`. Tenant risolto a runtime da `body.tenant_id`. Tutti tenant di TEST → deploy/testa liberamente. Architettura: memoria `reference_motore_unico_chatbot.md`; scaling: `project_n8n_scaling.md`.
- **Già FATTO (NON rifare):** respond-first verificato su motore+Router; filtro webhook di stato Meta live nel Router; memoria conversazione su Supabase (`bot_messages`) verificata; `N8N_CONCURRENCY_PRODUCTION_LIMIT=8` impostato sul server.
- **Accesso server n8n (Hostinger):** compose in **`/docker/n8n/docker-compose.yml`**, env nel blocco **`environment:`** (NON `.env`), backup `.bak`. Restart che rilegge il compose: `cd /docker/n8n && docker compose up -d`. Le modifiche al server le fa **Sofía** (io non ho SSH/pannello) → se serve, chiedi a voce e dai a Sofía istruzioni in spagnolo.

## ⚠️ Incidente da ricordare (NON ripeterlo)
Col limite a 8 attivo, un **burst load test** ha lasciato 8 esecuzioni incastrate in `running` che occupavano tutti gli slot → motore DOWN (webhook HTTP 000) finché non si sono auto-sbloccate (timeout interno). L'API `stop`/`delete` NON libera lo slot in-memory. **NON rifare burst (8+ simultanee) finché `EXECUTIONS_TIMEOUT` non è in place.** Traffico reale = 1-3 simultanee → limite a 8 innocuo per l'uso attuale.

## TASK A — Hardening del limite + PROVA FINALE (l'obiettivo della Fase 1)
1. Verifica con Sofía che sia stato aggiunto `EXECUTIONS_TIMEOUT=120` (opz. `EXECUTIONS_TIMEOUT_MAX=180`) nel blocco `environment:` di `/docker/n8n/docker-compose.yml` + `docker compose up -d`. (Messaggio già preparato la sessione scorsa.) Se non fatto, ridallo a Sofía a voce/spagnolo.
2. Conferma singola (NO burst): `curl -m40 -X POST .../webhook/picnic-whatsapp` con `tenant_id` Oraz → deve tornare 200 veloce; controlla che l'esecuzione **completi** (`status=success`).
3. **SOLO con il timeout attivo**, prova del carico in sicurezza: `cd CRM && node scripts/oraz-e2e/loadtest.mjs --levels 8,12,16 --gap 30 --out loadtest-after-timeout.json`. **Atteso/obiettivo: a 12 e 16 → 0 persi** (alcune in coda → e2e più alto ma COMPLETANO), nessun webwook a 000, nessuna esecuzione incastrata. Se ancora si incastra → indaga la causa-radice del wedge (httpRequest senza timeout nei Code node? sub-call? valore limite?) prima di dichiarare chiuso. Baseline pre-limite = `loadtest-engine.json`.

## TASK B — Verifica instradamento Router (dopo la mia modifica del filtro status)
La sessione scorsa ho modificato `Route Message` del Router; ho testato solo filtro-status + verify-challenge, NON un instradamento reale. Manda **1-2 messaggi SINGOLI sequenziali** (niente burst) al webhook `meta-whatsapp-router` in formato Meta (`entry[0].changes[0].value.messages[0]`) per due tenant diversi e conferma **anti-leak**: ogni tenant risponde con la PROPRIA `restaurant_name` (Picnic/Oraz/BALI Rest), ispezionando le execution del motore. Niente fuga cross-tenant.

## TASK C (opzionale) — Resolver tenant fail-loud
Oggi ogni Code node del motore fa `const __TENANT_ID__ = $('Extract Message').first().json.tenant_id || '<Picnic fallback>'`: se `tenant_id` manca → **fallback silenzioso a Picnic** = rischio fuga config cross-tenant. Cambiare in **fail-loud**: se manca `tenant_id`, logga l'anomalia e scarta/risponde generico, invece di servire Picnic. (Il motore riceve SEMPRE `tenant_id` dal Router o dall'harness, quindi un missing = vero bug.) Applicare coerentemente nei nodi Fetch/OpenAI/Send/Book. Backup + `node --check` + E2E 12/12 dopo.

## TASK D (opzionale, serve accesso server) — JWT Supabase di bootstrap fuori dal codice
La JWT service-role di bootstrap (serve a leggere la colonna `secrets`) è **inline nel codice in ~54 punti**. Spostarla in una **env var/credenziale n8n** (stesso metodo `/docker/n8n/.../environment:` + restart, via Sofía) e leggerla nei Code node da `process.env`. Riduce la superficie segreti. Vedi insidia in `reference_motore_unico_chatbot.md`.

## TASK E (opzionale) — Dialetto parametrizzabile
Il system prompt (nodo OpenAI) ha il dialetto **"canario" hardcoded** (ok per i 3 tenant attuali, tutti Las Palmas). Parametrizzarlo: `picnicCfgGet(_bc,'dialect','canario')` e iniettarlo nel prompt, così un futuro tenant non-canario è solo config. Backup + `node --check` + E2E dopo.

## Verifica standard (sempre)
- Funzionale seriale: `ORAZ_WEBHOOK_PATH=picnic-whatsapp ORAZ_TENANT_ID=93eebe9c-8af5-4ca5-a315-3376ef4976e5 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa node scripts/oraz-e2e/run.mjs --rounds 1 --concurrency 1` (deve restare 12/12; "waitlist" a volte flakka → re-run), poi `--cleanup`.

## Procedura
Credenziali da `CRM/.env.local` (N8N_BASE_URL, N8N_API_KEY, SUPABASE_SERVICE_ROLE_KEY). Backup `N8N/picnic/live_*.PRE_*.json` prima di ogni PUT (solo `{name,nodes,connections,settings}`; `N8N/` è gitignored → il deploy live via API è la source of truth). Edit jsCode via Python + `node --check` (wrappa in `(async function(){...})` perché i Code node usano top-level await). A fine sessione: aggiorna `project_n8n_scaling.md` + commit/push.
