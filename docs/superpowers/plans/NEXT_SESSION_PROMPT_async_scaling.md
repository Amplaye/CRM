# Prompt per la prossima sessione — Async/Scaling Fase 1 sul motore unico

> Copia-incolla il blocco qui sotto come primo messaggio della prossima sessione.

---

Lavoriamo sullo **scaling del bot WhatsApp ristoranti**: ora che il **motore unico** è fatto (Picnic `166QnQsGHqXDpBxa` = unico workflow attivo, tenant dinamico da payload, config-driven, Oraz+BALI Rest disattivati, Meta Router instrada tutto con `tenant_id`), voglio fare la **Fase 1 async UNA VOLTA SOLA sul motore**, come deciso. Obiettivo: eliminare i 502 e le esecuzioni/risposte duplicate nei picchi serali.

**Contesto chiave (NON rifare audit/load-test da zero):**
- Diagnosi e piano: memoria `project_n8n_scaling.md`. Architettura motore: `reference_motore_unico_chatbot.md`. **NESSUN cliente reale, tutti tenant di TEST** → deploy/attiva/testa liberamente.
- **Baseline misurata 2026-06-02:** 1/2/4/8 conversazioni simultanee = 0 errori (~14-17s); **12 simultanee CROLLA** (10/12, 2 persi, 84s). Muro architetturale, non VPS: in default mode n8n è single-process e il webhook resta **bloccato 10-40s durante OpenAI gpt-5.1** (fino a ~10-12 HTTP esterne/turno). WhatsApp ritenta i webhook non risposti → **duplicati**.
- Motore = 8 nodi: `WhatsApp Webhook` → `Respond to Twilio` → `Extract Message` → `Fetch History + Check Availability` → `OpenAI` → `Process AI Response` → `Send WhatsApp Reply` → `Book + Notify Owner`. Webhook path `picnic-whatsapp`. Entry reale = `[Meta Router] WhatsApp` `zuYx8raoBVz88Erj` (path `meta-whatsapp-router`).

**Lavoro Fase 1 (async, ~0€):**
1. **Verifica l'ordine di risposta:** controlla se `Respond to Twilio`/Respond-to-Webhook risponde GIÀ subito (in cima) o solo a fine flusso. Se non è immediato, sposta la risposta webhook **prima** del lavoro pesante (rispondi 200 subito, poi processa) — sia sul motore sia, se serve, sul Meta Router. Questo elimina 502 + retry duplicati.
2. **Filtra i webhook di stato Meta** (`statuses` delivered/read/sent): scartali in cima al Router/motore così non bruciano esecuzioni.
3. **`N8N_CONCURRENCY_PRODUCTION_LIMIT`** (5-10): va impostata come env var sul server n8n Hostinger → **richiede accesso SSH/pannello Hostinger che non ho da CLI**; se non riesci, fammelo presente a voce e dimmi come procedere (te la imposto io, o la saltiamo per la Fase 1).
4. **Memoria conversazione SEMPRE su Supabase, mai in RAM/staticData** per i dati che devono sopravvivere tra esecuzioni async: verifica che history/sticky-lang/pending usino Supabase (parte già lo fa); lo staticData non è affidabile in async.

**Verifica:**
- Test funzionale seriale invariato: `ORAZ_WEBHOOK_PATH=picnic-whatsapp ORAZ_TENANT_ID=93eebe9c-8af5-4ca5-a315-3376ef4976e5 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa node scripts/oraz-e2e/run.mjs --rounds 1 --concurrency 1` (deve restare 12/12), poi `--cleanup`.
- **Re-run del load test** `scripts/oraz-e2e/loadtest.mjs` (baseline in `loadtest-before.json`) a 8/12/16 simultanee e confronta: l'async deve reggere 12+ senza persi/duplicati.
- Anti-leak ancora ok: ogni tenant risponde con la PROPRIA `restaurant_name` (Picnic/Oraz/BALI Rest) via Router.

**Procedura:** credenziali da `CRM/.env.local` (N8N_BASE_URL, N8N_API_KEY, SUPABASE_SERVICE_ROLE_KEY). Backup `N8N/picnic/live_*.PRE_*.json` prima di ogni PUT (solo `{name,nodes,connections,settings}`); edit jsCode via Python + `node --check`. Aggiorna piano e memoria a fine sessione. Lavora in autonomia, fammi domande solo a voce e solo se davvero bloccanti.

**Mentre tocchi il motore, opzionale (follow-up non bloccanti dal motore unico):**
- Resolver tenant: oggi fa **fallback silenzioso** al literal Picnic se `tenant_id` manca → valuta fail-loud (logga/scarta invece di servire Picnic).
- JWT Supabase di bootstrap ancora **inline** nel codice (54 occ.) → spostala in env var/credenziale n8n (stesso accesso server del punto 3).
- Dialetto "canario" fisso nel prompt (ok per i 3 tenant attuali, tutti Las Palmas) → parametrizzabile come `bot_config.dialect`.
