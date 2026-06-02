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

## Cosa RESTA — Task 3 (l'UNICO fix che fa reggere 12+), BLOCCATO su accesso server

Impostare la env var **`N8N_CONCURRENCY_PRODUCTION_LIMIT=8`** sul server n8n Hostinger e riavviare n8n.
Da CLI NON è possibile (l'API n8n non setta env var; nelle credenziali non c'è SSH/pannello, solo l'API key).

**Come farlo (per chi ha l'accesso Hostinger — pannello hPanel del VPS `srv1468837`):**
1. hPanel → VPS → il server di n8n → **Browser terminal** (o SSH).
2. n8n gira in Docker. Trovare il compose: `cd /root` (o dove sta `docker-compose.yml`); `ls`.
3. Aprire il file env del compose (di solito `.env` accanto al `docker-compose.yml`) e aggiungere la riga:
   `N8N_CONCURRENCY_PRODUCTION_LIMIT=8`
4. Riavviare: `docker compose down && docker compose up -d` (oppure `docker restart <container_n8n>` se env passata via `-e`).
5. Verifica: dopo il restart, ri-eseguire il load test e confrontare con `loadtest-engine.json`:
   `cd CRM && node scripts/oraz-e2e/loadtest.mjs --levels 8,12,16 --gap 30 --out loadtest-after-limit.json`
   Atteso: a 12/16 **0 persi** (alcune in coda → e2e più alto ma completano), nessun 502.

> In alternativa, se l'utente dà il login hPanel/SSH, guidarlo a voce passo-passo (è non-tecnico).

## Verifica standard (invariata)
- Funzionale: `ORAZ_WEBHOOK_PATH=picnic-whatsapp ORAZ_TENANT_ID=93eebe9c-8af5-4ca5-a315-3376ef4976e5 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa node scripts/oraz-e2e/run.mjs --rounds 1 --concurrency 1` (deve restare 12/12), poi `--cleanup`.
- Anti-leak via Router: ogni tenant risponde con la PROPRIA `restaurant_name`.

## Procedura
Credenziali da `CRM/.env.local`. Backup `N8N/picnic/live_*.PRE_*.json` prima di ogni PUT (solo `{name,nodes,connections,settings}`); edit jsCode via Python + `node --check` (wrappare in `(async function(){...})` perché i Code node usano top-level await). Aggiorna piano e memoria a fine sessione.

## Follow-up non bloccanti (opzionali, dal motore unico)
- Resolver tenant: fallback silenzioso al literal Picnic se `tenant_id` manca → valuta fail-loud.
- JWT Supabase di bootstrap inline (stesso accesso server del Task 3) → env var/credenziale n8n.
- Dialetto "canario" fisso → `bot_config.dialect`.
