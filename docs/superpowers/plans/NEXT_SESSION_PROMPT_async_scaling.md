# Prompt prossima sessione — Async/Scaling: resta SOLO il concurrency limit (Task 3)

> Stato aggiornato 2026-06-02 sera. La parte software della Fase 1 async è FATTA e deployata.
> Resta UN solo knob lato server, che richiede l'accesso Hostinger.

---

## Cosa è già FATTO (Fase 1 async sul motore unico `166QnQsGHqXDpBxa`)

- **Task 1 — respond-first: già presente, verificato.** Sia il motore (`Respond to Twilio` = 2° nodo, `responseMode:responseNode`) sia il Meta Router (`Respond` = 2° nodo) rispondono 200 PRIMA del lavoro pesante. → niente 502, niente retry/duplicati Meta. Nessuna modifica necessaria.
- **Task 2 — filtro webhook di stato Meta: FATTO + deployato.** Early-out in cima a `Route Message` del Meta Router (`N8N/picnic/build_router_status_filter.py`): payload con `value.statuses[]` e senza `messages` → `{skip:true, reason:'status_webhook'}`, niente catalog fetch né forward al motore. Smoke test OK. Backup `N8N/picnic/live_metarouter.PRE_STATUSFILTER_*`.
- **Task 4 — memoria su Supabase: verificato OK.** History su `bot_messages`; staticData solo per debounce/pending/sticky-lang (OK in main mode).
- **Load test motore** (`scripts/oraz-e2e/loadtest.mjs` ora punta a `picnic-whatsapp`+tenant_id → `loadtest-engine.json`): 8=8/8 OK; 12=accept ~700ms ma e2e ~100s; 16=e2e ~90s, molti oltre il poll-window. **Respond-first da solo NON regge 12+: serve il concurrency limit.**
- **Funzionale seriale invariato 12/12** (waitlist era un flake, 2/2 al re-run). Test data ripulito.

## Task 3 — concurrency limit: FATTO, ma serve hardening (timeout)

**`N8N_CONCURRENCY_PRODUCTION_LIMIT=8` è stato impostato sul server** (Sofía, 2026-06-02).
⚠️ Setup REALE Hostinger: compose in **`/docker/n8n/docker-compose.yml`**, env nel blocco **`environment:`** (NON `.env`/`/root`). Backup `/docker/n8n/docker-compose.yml.bak`. Restart = `cd /docker/n8n && docker compose restart`.

**⚠️ INCIDENTE da non ripetere:** verificando col load test (burst 8/12/16), col limite attivo **8 esecuzioni si sono incastrate in `running`** occupando tutti gli slot → motore DOWN (webhook HTTP 000). L'API `stop`/`delete` NON le libera. Si sono sbloccate da sole dopo qualche minuto (timeout interno) → motore recuperato senza restart. **Senza limite la raffica completava (lenta); col limite si bloccava.**

**RESTA DA FARE — hardening (rende il limite sicuro sotto carico):**
1. Aggiungere nello stesso blocco `environment:` di `/docker/n8n/docker-compose.yml`:
   `EXECUTIONS_TIMEOUT=120` (opz. `EXECUTIONS_TIMEOUT_MAX=180`), poi `docker compose restart`.
   → un'esecuzione incastrata muore a 120s e libera lo slot (normale ~20-30s).
2. **SOLO DOPO il timeout**, ri-verificare in sicurezza: `cd CRM && node scripts/oraz-e2e/loadtest.mjs --levels 8,12,16 --gap 30 --out loadtest-after-timeout.json`. Atteso: 12/16 **0 persi** (in coda ma completano).

> ⚠️ NON rifare burst load test (8+ simultanee) finché `EXECUTIONS_TIMEOUT` non è in place — riblocca il motore. Traffico reale = 1-3 simultanee, il limite a 8 è innocuo per l'uso attuale.

## Verifica standard (invariata)
- Funzionale: `ORAZ_WEBHOOK_PATH=picnic-whatsapp ORAZ_TENANT_ID=93eebe9c-8af5-4ca5-a315-3376ef4976e5 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa node scripts/oraz-e2e/run.mjs --rounds 1 --concurrency 1` (deve restare 12/12), poi `--cleanup`.
- Anti-leak via Router: ogni tenant risponde con la PROPRIA `restaurant_name`.

## Procedura
Credenziali da `CRM/.env.local`. Backup `N8N/picnic/live_*.PRE_*.json` prima di ogni PUT (solo `{name,nodes,connections,settings}`); edit jsCode via Python + `node --check` (wrappare in `(async function(){...})` perché i Code node usano top-level await). Aggiorna piano e memoria a fine sessione.

## Follow-up non bloccanti (opzionali, dal motore unico)
- Resolver tenant: fallback silenzioso al literal Picnic se `tenant_id` manca → valuta fail-loud.
- JWT Supabase di bootstrap inline (stesso accesso server del Task 3) → env var/credenziale n8n.
- Dialetto "canario" fisso → `bot_config.dialect`.
