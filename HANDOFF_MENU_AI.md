# Handoff — Agente vocale + chatbot leggono il MENU dalla sezione Menu (live)

**Richiesta utente:** l'agente vocale e il chatbot devono leggere il menu **direttamente dalla sezione Menu** (tabelle `menu_categories`/`menu_items`), NON dal KB. + inserire un menu fittizio nei tenant esistenti.

**Decisioni utente (a voce):**
- Menu fittizio SOLO su **Oraz** (PICNIC aveva già 12 cat / 89 piatti reali, non toccato).
- Lettura **on-demand**: il bot interroga il menu SOLO quando serve, MAI recita tutta la carta.
- Piatto specifico → quel piatto (prezzo+allergeni). "Cosa avete?" → solo le categorie (+ link). 
- Vale per **tutti i tenant attivi** (anche PICNIC).

## FATTO e LIVE

### 1. Endpoint `/api/ai/menu` — DEPLOYATO (commit 3a3b08e su main)
`src/app/api/ai/menu/route.ts`. GET, header `x-ai-secret`. Param: `tenant_id` (req), `dish`, `category`.
- bare/generico → `mode:'categories'` (solo nomi categorie + `menu_url`).
- `dish=<frase>` → `mode:'dish'`, match tollerante (stopword IT/ES/EN rimosse, token OR-rank).
- piatto specifico vince su categoria ("pizza ortolana" → Ortolana, non tutte le Pizze).
- categoria generica ("che pizze") → `mode:'category'` con i piatti reali.
- sinonimi dieta come **sottostringa** ("senza glutine"/"sin gluten"/"vegano") → filtra per allergene assente/tag.
- solo `available=true`, cap 8.
- Testato a fondo in locale + prod: tutti i casi verdi.

### 2. Menu fittizio Oraz — INSERITO
7 categorie / 28 piatti italiani (Antipasti, Primi, Pizze, Secondi, Contorni, Dolci, Bevande) con prezzi/allergeni/tag corretti. Tenant Oraz = `b732c77a-8990-4501-b484-218661433efd`. PICNIC = `626547ff-bc44-4f35-8f42-0e97f1dcf0d5`.

### 3. VOCE (Vapi) — COMPLETO su ENTRAMBI i tenant ✅
- Tool `get_menu` aggiunto agli assistant Vapi: Picnic `6c92f776-abb2-4175-8a55-45d76ec01d1a`, Oraz `a6e853d3-8803-4a40-84fa-ced8549671db`. Punta ai webhook menu.
- Workflow n8n creati+attivi: `[Picnic] Voice Tool — Menu` (fwLjHfd1x6GsFqkf, path `/picnic-menu`), `[Oraz] Voice Tool — Menu` (BeMQAHP7AzTEnM45, path `/oraz-b732-menu`).
- Ramo `tenant-voice-menu` aggiunto al workflow multi-tenant `[ALL] Voice Agent Webhooks — Multi-Tenant` (KLRgoVjOp9iZfr2R) → risolve tenant da assistantId (per i FUTURI tenant clonati).
- `src/lib/onboarding/vapi.ts`: map `picnic-menu → tenant-voice-menu` (commit d3826ff) → i nuovi tenant ereditano il tool. 
- Webhook voce testati E2E: Oraz→tiramisù, Picnic→12 categorie, fail-safe assistant ignoto. ✅

### 4. CHATBOT WhatsApp — SCOPERTA ARCHITETTURALE chiave
Il chatbot NON usa i tool dell'LLM per il menu. Usa una **state machine**: parser LLM estrae `intent` → controller JS setta `nextInstruction` → formatter LLM genera `aiResponse`. Una domanda menu cade in **`intent:'info'`** con istruzione "usa la base de conocimiento". I tool (`check_availability` ecc.) NON sono nel percorso info.
→ Il wiring corretto NON è nei tool, ma nel **controller `intent:'info'`**: rilevare domanda menu → chiamare `/api/ai/menu?dish=<messaggio>` → riscrivere `nextInstruction` coi dati reali (vietando invenzioni).

**Chatbot Oraz (wXDEbfQ6FCO3ywnt) — wiring APPLICATO e LIVE** (solo via n8n API, NON è codice git):
- Nodo "OpenAI", ramo `if (_sess.intent === 'info')`: blocco `// === LIVE MENU (2026-05-31)` che fa il fetch e riscrive `nextInstruction`. Rami: `mode:categories` / `mode:category` / `mode:dish found` / not-found.
- Funziona: "Quanto costa la Ortolana?" → "10,5 EUR, gluten y lácteos" ✅; "senza glutine" → solo piatti gluten-free ✅; "tiramisù allergeni" → corretto ✅; "sushi" → "non in carta" ✅.

## COMPLETATO (2026-05-31, sessione 2)

1. ✅ **Chatbot Oraz — 2 casi rifiniti.** La regex `_isMenuQ` era già allargata (`\bpizz`, `\bpast`, `\bcontorn`, `\bbevand`, `\binsalat`, `\bensalad`, `\bvini`, …). Il ramo `mode:category` nomina solo piatti reali — verificato live, nessun piatto inventato.

2. ✅ **PICNIC chatbot (166QnQsGHqXDpBxa) — CABLATO.** Backup pre-modifica salvato in `N8N/_menu_work/picnic_chatbot.PREMENU_backup.json`. Applicati i 3 patch (idempotenti, con `node --check`):
   - `/tmp/wire_info_menu.mjs picnic` → blocco LIVE MENU nel ramo info
   - `/tmp/fix_category_branch.mjs picnic` → ramo mode:category
   - `/tmp/widen_regex.mjs picnic` → regex larga identica a Oraz
   Ora i due chatbot hanno blocco LIVE MENU + ramo category + regex identici.

3. ✅ **E2E completo.** Endpoint verde su entrambi i tenant (categories/dish+punteggiatura/category/dieta/miss/allergeni). Esecuzioni n8n reali: Oraz "Quanto costa la Ortolana?"→"10,5 EUR"; PICNIC "Che pizze avete?"→lista reale, "Quanto costa la Margherita?"→"9 EUR… allergie glutine e latticini", "avete il sushi?"→declina. Dati test puliti (4 guest TestMenu +34600111801-804 + conversazioni cancellati; 0 prenotazioni create).

4. ✅ **Fix endpoint (commit 0fa6fda, deployato):** i token query venivano lasciati con la punteggiatura attaccata (`ortolana?`) → "Quanto costa la Ortolana?" col `?` dava found=false. Ora i token sono ripuliti da punteggiatura iniziale/finale prima del match.

5. ✅ **Memoria aggiornata:** `feature_baliflow_menu_live_read.md` (COMPLETO), `_index_baliflow_crm.md`, `_index_picnic.md`.

Le modifiche n8n NON sono git (gitignored `N8N/`), vivono solo sull'host n8n.

## File/ID utili
- Endpoint: `src/app/api/ai/menu/route.ts`
- Map voce: `src/lib/onboarding/vapi.ts` (VOICE_WEBHOOK_PATH_MAP)
- n8n base: `N8N_BASE_URL` + `N8N_API_KEY` in `.env.local`; secret AI hardcoded fallback `bb2931a5...`; service role JWT visibile nei nodi.
- Backup nodi chatbot PULITI (pre-modifiche): `N8N/_menu_work/{picnic,oraz}_chatbot.json` (gitignored).
- Commits: d51f1f7 (endpoint base), d3826ff (phrase match + vapi map), 3a3b08e (diet synonyms).
