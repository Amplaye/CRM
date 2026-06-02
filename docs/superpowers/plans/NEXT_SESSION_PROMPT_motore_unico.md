# Prompt per la prossima sessione — Motore Unico Chatbot (Fase B)

> Copia-incolla il blocco qui sotto come primo messaggio della prossima sessione.

---

Continua il progetto "motore unico chatbot WhatsApp ristoranti". La Fase A su Picnic è già FATTA e testata (9/12 verde, 3 fail = assertion Oraz-specifiche, 0 regressioni). Ora voglio la **Fase B**: rendere **Picnic (`166QnQsGHqXDpBxa`) l'UNICO motore**, con tenant risolto a runtime e tutto il resto in config Supabase, così Oraz e BALI Rest vengono assorbiti e poi ritirati.

**Contesto chiave (NON ri-fare l'audit da zero):**
- Piano completo + stato esecuzione dettagliato: `docs/superpowers/plans/2026-06-02-motore-unico-chatbot.md` (leggi la sezione "STATO ESECUZIONE" in cima). Memoria: `project_motore_unico_chatbot.md`.
- **NESSUN cliente reale** — tutti tenant di test → deploy/attiva/testa liberamente, senza cautela "produzione".
- **Obiettivo finale: SOLO Picnic** come motore unico. Oraz `zXEYdw8Zbs5seCci` e BALI Rest `9liGOnPCOuTSMyrM` → loro tenant instradati a Picnic, poi disattivati.
- Picnic live = già `template_166` (308KB, inattivo); ha il merge Fase A deployato (`live_picnic.MERGED.json`). I blocchi langStrong/kbContext/business-rejection/ignoreHttpStatusErrors sono nel nodo **Fetch**.
- **B0 già deciso → strada 1 (payload):** il `[Meta Router] WhatsApp` (`zuYx8raoBVz88Erj`, active) ha `forwardToBot(this, t.path)` e conosce `t.id`/`session.tenant_id`. Iniettare `tenant_id` nel body inoltrato; il motore lo legge da `body.tenant_id` con fallback al path. Tutti e 3 i bot condividono `webhookId 986da7f7…` (path diversi).
- Harness E2E: `scripts/oraz-e2e/` con override env `ORAZ_WORKFLOW_ID`/`ORAZ_WEBHOOK_PATH`/`ORAZ_TENANT_ID`. Test SEMPRE seriale (`--concurrency 1`) + `--cleanup`. Credenziali in `CRM/.env.local` (N8N_BASE_URL, N8N_API_KEY, SUPABASE_SERVICE_ROLE_KEY).

**Lavoro Fase B (vedi Task B1–B4 nel piano):**
1. **A5 opzionale**: decidi se allineare BALI Rest o saltarlo (dato che verrà assorbito). Se lo allinei: merge CHIRURGICO sull'OpenAI (preserva la persona "trattoria napolitana/BALI REST" hardcoded; porta solo executor/retry/normalizeDate/_diag + MAX_TURNS=3 + payload + 4 regole prompt). Fetch ha già `_isoReadable`; porta solo `_fl` nel Send.
2. **B1 — tenant dinamico**: Meta Router inietta `tenant_id` nel body; `Extract Message` lo propaga; sostituisci `const TENANT_ID='626547ff…'` con lettura da `$json.tenant_id` (fallback path→lookup `chatbot_webhook_path`). Azzera gli UUID letterali (41 occorrenze) usando la variabile.
3. **B2 — config-driven**: `workflow_id` hardcoded→`$workflow.id`; persona/città/dialetto/`restaurant_name`/`restaurant_phone`/`verify_token` da `bot_config` via `picnicCfgGet`; normalizza lo schema `bot_config` per tutti i tenant; aggiungi chiavi mancanti su Supabase (assistant_name, dialect, venue.city…).
4. **B3 — sicurezza segreti**: togli dal codice Supabase JWT, OpenAI key, Twilio, ai_secret (oggi in chiaro). Raccomandato: bootstrap Supabase come credenziale n8n; il resto da colonna `tenants.secrets`.
5. **B4 — migrazione**: fai puntare TUTTI i tenant al motore Picnic via Meta Router (passando `tenant_id`); test E2E seriale su OGNI tenant attraverso il motore unico (ognuno deve rispondere col PROPRIO nome/menu/orari — verifica anti-leak config); poi disattiva Oraz e BALI Rest.

Procedi task per task con backup→PUT→test seriale→cleanup. Aggiorna il piano e la memoria a fine sessione. Lavora in autonomia (no domande inutili), fammi domande solo a voce e solo se davvero bloccanti.
