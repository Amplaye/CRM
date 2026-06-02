# Motore Unico Chatbot WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidare i chatbot WhatsApp dei ristoranti (oggi cloni divergenti per-tenant) in UN unico "motore" basato sul template legacy Picnic, dove ogni tenant è risolto a runtime e personalizzabile interamente da config su Supabase — così un fix vale per tutti i tenant e i nuovi tenant non richiedono di clonare codice.

**Architecture:** Esiste già un `[Meta Router] WhatsApp` (id `zuYx8raoBVz88Erj`) che riceve i messaggi dal numero Meta condiviso e li smista al webhook del chatbot leggendo `tenants.settings.bot_config.chatbot_webhook_path` da Supabase. I 3 chatbot ristorante (Oraz `zXEYdw8Zbs5seCci`, Picnic `166QnQsGHqXDpBxa`, BALI Rest `9liGOnPCOuTSMyrM`) sono cloni 94-99.9% identici dello stesso codice; l'unica cosa veramente per-tenant è la const `TENANT_ID` in cima ai Code node + alcuni default. Il piano ha due fasi: **Fase A** allinea Picnic (template legacy) alla versione più aggiornata di Oraz tramite un MERGE bidirezionale (Oraz ha fix nuovi; Picnic ha 5 blocchi funzionali che Oraz non ha → non sovrascrivere ciecamente). **Fase B** trasforma Picnic nel motore unico risolvendo il tenant dinamicamente dal webhook path e spostando i residui hardcoded in config.

**Tech Stack:** n8n (self-hosted Hostinger, REST API v1), Code node JavaScript, Supabase (Postgres + REST), OpenAI gpt-5.1, WhatsApp via Meta Cloud API.

---

## ⏱️ STATO ESECUZIONE (aggiornato 2026-06-02 notte)

**🎉 FASE B COMPLETATA — Picnic `166QnQsGHqXDpBxa` è il MOTORE UNICO attivo. Oraz e BALI Rest disattivati. Meta Router instrada tutto al motore con `tenant_id`.**

**✅ FASE B (Task B0→B4) — fatta e testata 2026-06-02 notte:**
- **A5 BALI Rest: SALTATO** (deciso: dato l'obiettivo "solo Picnic", BALI Rest viene assorbito e ritirato, non ha senso allineare il suo codice).
- **B1 — tenant dinamico:** in ogni Code node (Fetch/OpenAI/Send/Book) iniettato in cima `const __TENANT_ID__ = $('Extract Message').first().json.tenant_id || <fallback Picnic>`; tutte le 41 occorrenze UUID letterali → `' + __TENANT_ID__ + '` (resta 1 fallback documentato per nodo). Aggiunto `tenant_id` come assignment nel Set node `Extract Message` (legge `body.tenant_id`). Script: `N8N/picnic/build_b1.py`.
  - **BUG CRITICO TROVATO E FIXATO:** prima versione leggeva da `$('WhatsApp Webhook').first().json.body` → in un Code node quel `.first()` torna vuoto (a differenza di `.item` nel Set node), quindi il resolver cadeva sul fallback Picnic → **fuga di config cross-tenant** (Oraz riceveva KB/menu/persona di Picnic). Fix: leggere da `$('Extract Message').first().json.tenant_id` (provato affidabile). Lezione: il fallback silenzioso al literal Picnic MASCHERA i fallimenti di risoluzione — è un rischio; con il router che inietta sempre `tenant_id` non scatta, ma resta da irrobustire (fail-loud).
- **B2 — config-driven persona + workflow_id:** in OpenAI `Eres Sofía … (restaurante en Las Palmas)` → `Eres ${ASSISTANT_NAME_CFG} … (restaurante en ${VENUE_CITY_CFG})` via `picnicCfgGet(_bc,'assistant_name','Sofía')`/`'venue_city','Las Palmas'`. `workflow_id: '166QnQsGHqXDpBxa'` (Fetch+Book, era un bug di logEvt mai aggiornato su Oraz) → `$workflow.id` con fallback. Aggiunte chiavi `bot_config`: `assistant_name`, `venue_city`, e `restaurant_name` (Picnic e BALI Rest non l'avevano → defaultavano a 'BALI REST', latent bug fixato). Script: `N8N/picnic/build_b2.py`.
- **B3 — segreti:** `OPENAI_KEY` ora da `picnicCfgGet(_bc,'openai_key','')`; blank dei fallback inline Twilio SID/token e ai_secret (0 plaintext residuo). Valori reali messi in `tenants.secrets` (openai_key, ai_secret, twilio_*) per i 3 tenant (il config loader fa già `select=settings,secrets` e merge in bot_config). **La JWT Supabase di bootstrap RESTA inline** (54 occ.): serve per leggere la colonna secrets stessa → non eliminabile senza env var/credenziale n8n (infra, fuori sessione). Script: `N8N/picnic/build_b3.py`.
- **B4 — migrazione:** Meta Router (`zuYx8raoBVz88Erj`) modificato: `forwardToBot(_ctx, tenantId)` inietta `tenant_id` nel body e inoltra a `ENGINE_PATH='picnic-whatsapp'` (sticky usa `t.id`, selezione usa `selected.id`). Picnic reso `sandbox_routable=true` (appare nel menu). **Oraz e BALI Rest DISATTIVATI** (workflow inattivi). Script: `N8N/picnic/build_router_b4.py`.

**Test (tutti su engine `166QnQsGHqXDpBxa`, seriale, dati puliti):**
- Oraz-via-engine (tenant_id in payload) **12/12 100%** sia post-B1 sia sul motore finale completo B1+B2+B3.
- B3 post-secrets: Oraz booking/modify/cancel **100%**.
- **Anti-leak end-to-end via Meta Router** (selezione tenant + query): Picnic→`restaurant_name=Picnic`, Oraz→`Oraz`, BALI Rest→`BALI Rest`. Ogni tenant risolve la PROPRIA config sullo stesso motore.

**Stato finale workflow:** Picnic=ACTIVE (motore unico), Oraz=inactive, BALI Rest=inactive, Meta Router=active. **Aggiungere un nuovo tenant = solo config Supabase + renderlo routable nel Router. Niente clone di codice.**

**Residui / follow-up (non bloccanti):**
- Resolver tenant: fallback silenzioso al literal Picnic → valutare fail-loud se `tenant_id` assente.
- JWT Supabase ancora inline (bootstrap) → spostare in env var/credenziale n8n quando si ha accesso al server Hostinger.
- Dialetto "canario" ancora fisso nel prompt (corretto per tutti e 3 i tenant attuali, tutti a Las Palmas) → parametrizzabile come `dialect` se arriva un tenant non-canario.
- `picnic-confirm-booking`/`picnic-store-reminder`/`picnic-sticky-lang`: webhook helper condivisi (passano `tenant_id` nel body) → restano così, sono engine-internal non tenant-specifici.

---

### (storico) ⏱️ STATO ESECUZIONE FASE A (2026-06-02 sera)

**✅ FASE A — Picnic (Task A0→A4) COMPLETATA e TESTATA.** Restano A5 (BALI Rest) e tutta la Fase B → **prossima sessione** (deciso con l'utente).

**Fatti reali emersi (correggono/precisano l'audit iniziale):**
- Il workflow live Picnic `166QnQsGHqXDpBxa` **è già `template_166`** (308KB, `active=false`). I "5 blocchi da preservare" (langStrong, kbContext, business-rejection, ignoreHttpStatusErrors, return ricco) sono **TUTTI nel nodo Fetch**, NON in OpenAI (OpenAI Picnic aveva langStrong/kbContext=0).
- **Merge Picnic che ha funzionato (replicabile):**
  - *OpenAI*: preso il nodo **Oraz in blocco** + ripristinate **3 sole righe identità** → UUID `93eebe9c…`→`626547ff…` (replace_all, 2 occ.) e `picnicCfgGet(_bc,'restaurant_name','Oraz')`→`…'BALI REST'`. (Funziona perché l'OpenAI di Picnic non aveva contenuti unici.)
  - *Fetch*: partito da **Picnic** + 3 edit: debounce `setTimeout(…,6000)`→`3000`(+commento); inserite `_LANG2LOCALE`/`_calLang`/`_isoReadable` prima di `const calLines = [];`; `calLines.push('- '+ds+' ('+tag+'): '+hrs)`→ versione con `' · '+_isoReadable(d)`.
  - *Send*: sostituito il return muto `if (!input.cleanResponse && !hasAction) { return [{ json:{...input,done:true} }]; }` col blocco `_fl` di Oraz (nudge localizzato 4 lingue).
  - Validazione: 0 leak UUID/path Oraz, 41 UUID Picnic intatti, tutti i fix presenti, blocchi Picnic preservati, `node --check` OK su 5 nodi.
- **Deploy+test**: PUT su `166QnQsGHqXDpBxa`, attivato temporaneamente (Oraz non disturbato nonostante webhookId condiviso `986da7f7…` perché i **path differiscono**), E2E seriale 5 round = **9/12 100%**. I 3 fail = **assertion Oraz-specifiche**, NON regressioni: (1)+(2) Picnic chiede "interior/exterior" (Reserva+Waitlist) perché ha più zone reali; logica zona **identica** Picnic↔Oraz → pre-esistente. (3) Carta: get_menu **confermato chiamato** (8 ref in exec), ma risponde con la cucina italiana reale di Picnic vs i piatti attesi di Oraz. Poi: cleanup dati test, Picnic **ri-disattivato** (stato originale), salvato `N8N/picnic/live_picnic.MERGED.json`.
- **Harness**: `scripts/oraz-e2e/harness.mjs` ora legge override `ORAZ_WORKFLOW_ID`/`ORAZ_WEBHOOK_PATH`/`ORAZ_TENANT_ID` (default = Oraz).

**🟢 CONTESTO (confermato dall'utente 2026-06-02): NESSUN cliente reale — tutti i tenant sono di TEST.** Quindi si può deployare/attivare/testare qualsiasi workflow senza cautela da "produzione live". **Obiettivo finale: resta SOLO Picnic come legacy = motore unico**; Oraz e BALI Rest vengono assorbiti (i loro tenant instradati a Picnic dal Meta Router con `tenant_id`) e poi disattivati/ritirati.

**A5 — BALI Rest (`9liGOnPCOuTSMyrM`, active, tenant `a085e5bb-11f3-47f9-96da-c6cfdbff2ea0`, path `bali-rest-a085-whatsapp`): profilo di divergenza DIVERSO da Picnic — NON ripetere il merge wholesale.** (Nota: dato l'obiettivo finale "solo Picnic", A5 è opzionale/di riduzione-drift; in alternativa si può saltare e portare direttamente i tenant di BALI Rest sul motore Picnic in Fase B. Decidere a inizio prossima sessione.)
- OpenAI BALI Rest (46986B) ha la **persona "trattoria napolitana / BALI REST" hardcoded nel prompt** (`BALI REST`×10, `trattoria`/`napolitana`) → **NON copiare il nodo Oraz in blocco** (cancellerebbe la persona). Serve merge **CHIRURGICO**: portare solo executor(_httpWithRetry/_normalizeDate/_diag/timeout)+MAX_TURNS=3+payload(2000/none/parallel)+4 regole prompt, **preservando la persona**.
- Fetch BALI Rest (134403B) ha **già `_isoReadable`** (calendario leggibile) → no merge calendario; verificare solo il debounce. **Non** ha langStrong/business-rejection (come Oraz) — sono innovazioni solo-Picnic, fuori scope per "allinea a Oraz".
- Send BALI Rest: portare `_fl` (verificare se assente).

**✅ B0 RISOLTO (raccomandazione):** il `[Meta Router] WhatsApp` (`zuYx8raoBVz88Erj`, active) ha già `forwardToBot(this, t.path)` e conosce `session.tenant_id`/`t.id`. **Strada 1 (payload)** è fattibile e pulita: iniettare `tenant_id` nel body inoltrato; il motore unico lo legge da `body.tenant_id` con fallback al path. Tutti e 3 i bot condividono `webhookId 986da7f7…` (path diversi) → la Fase B deve gestire questo se si va verso UN solo workflow.

---

## Stato di partenza accertato (audit 2026-06-02)

**I 3 chatbot ristorante** hanno struttura identica di 8 nodi:
`WhatsApp Webhook` → `Respond to Twilio` → `Extract Message` → `Fetch History + Check Availability` (Code ~127-134KB) → `OpenAI` (Code ~47-52KB) → `Process AI Response` → `Send WhatsApp Reply` → `Book + Notify Owner` (Code ~80KB).

**Divergenza Oraz vs Picnic (bidirezionale):**

Oraz HA, Picnic NON ha (da portare a Picnic):
- `_httpWithRetry` (retry 3x, backoff 0.4s/0.8s) — avvolge le chiamate `check_availability` e `get_menu`
- `_normalizeDate` (normalizza hoy/mañana/tomorrow/oggi/domani/heute/morgen, ISO, dd/mm/yyyy, fallback tomorrowStr)
- Blocco `_diag` nel catch di check_availability (`{name, code, status, stack.slice(0,300)}`)
- `timeout: 12000` sulle httpRequest tool
- `MAX_TURNS = 3` (Picnic = 4)
- Payload OpenAI: `max_completion_tokens: 2000, reasoning_effort: 'none', parallel_tool_calls: true` (Picnic: 4500/medium)
- 4 regole system prompt: anti-derail "se mezclaron las cosas", orari in cifre 24h, get_menu-first cuisine, modify/cancel-must-call-tool
- Calendario leggibile multilingua (`_LANG2LOCALE`, `_calLang`, `_isoReadable`, ` · martes 3 de junio de 2026` accanto a ogni data)
- Debounce burst 3000ms (Picnic 6000ms)
- Fallback anti-ghost `_fl` nel nodo Send (nudge localizzato 4 lingue quando reply vuota)

Picnic HA, Oraz NON ha (da PRESERVARE — NON sovrascrivere):
- `langStrong` (STICKY-LANG FIX v2): `let langStrong = !!lang || (_det.lang && _det.strong)`, esportato nel return, usato dal nodo OpenAI per latchare la lingua
- Blocco BUSINESS-RULE REJECTION (B-FIX 2026-06-01, ~38 righe): gestisce `data.success===false` con reason `closed_day/outside_hours/past_date/past_time` → messaggi localizzati 4 lingue, mantiene pending, logEvt `confirm.business_rejected`
- `ignoreHttpStatusErrors: true` su 2 httpRequest (prerequisito del business-rejection per leggere body 4xx)
- `kbContext` ("INFORMACIÓN ACTUALIZADA DEL RESTAURANTE (Knowledge Base)") assegnato dalla KB e passato nel return
- Return finale Picnic più ricco (include `kbContext` e `langStrong`)

**`_alreadyInHistory` (dedup ultimo messaggio):** già presente e IDENTICO in entrambi → NON toccare.

**Punti tenant-specifici hardcoded (per Fase B):**
- UUID tenant: 41 occorrenze per workflow (Fetch 29, OpenAI 2, Send 2, Book 8). Picnic `626547ff-bc44-4f35-8f42-0e97f1dcf0d5`, Oraz `93eebe9c-8af5-4ca5-a315-3376ef4976e5`.
- `workflow_id` hardcoded in logEvt = `166QnQsGHqXDpBxa` in ENTRAMBI (Oraz mai aggiornato → BUG; usare `$workflow.id`)
- Webhook verify_token Meta = `picnic_meta_2026` in ENTRAMBI
- Webhook path nodo: `picnic-whatsapp` / `oraz-93ee-whatsapp`
- Webhook path interni httpRequest: `picnic-confirm-booking`(×2), `picnic-store-reminder`(×2), `picnic-sticky-lang`(×1)
- Default `restaurant_name`: incoerente — Fetch `'PICNIC'`/`'ORAZ'`, OpenAI `'BALI REST'`/`'Oraz'`, Card `Reserva Restaurante Picnic`/`…Oraz`
- Default `restaurant_phone`: Picnic `+34828712623` / Oraz `+3434641790137`
- **SEGRETI IN CHIARO nel codice (sicurezza):** Supabase service_role JWT (43 occorrenze prefisso solo in Fetch), OpenAI API key `sk-proj-…` (OpenAI riga ~300), Twilio SID/token, ai_secret. La colonna `secrets` su Supabase esiste ma NON è usata dal workflow.

**Config già letta da `picnicCfgGet(cfg,'chiave',default)` (da `settings.bot_config`):** restaurant_phone, responsible_phone, timezone, twilio_from_number, crm_api_base, ai_secret, restaurant_name, primary_language, future_days_limit, party_size_max, party_size_threshold_large, party_size_block_threshold, closing_time_offset_min, fake_names, twilio_account_sid, twilio_auth_token, bot_paused_cooldown_sec, meta_phone_number_id, meta_waba_id, meta_access_token.

**Schema settings DIVERGENTE tra Oraz e Picnic** (bot_config: Oraz 6 chiavi, Picnic 10; top-level diversi; Oraz=Vapi, Picnic=Retell per la voce). Da normalizzare in Fase B.

**Stima config-driven attuale: ~55-60%.** Gap principali: TENANT_ID (0%, causa del fork), segreti (0%, in chiaro), persona+tono+prompt narrativo (~20%, corpo fisso).

**BALI agency** (`ES5E1p5bGKlVkPbT`) NON è un chatbot ristorante (è tool GoHighLevel) → ESCLUSO dal motore unico.

---

## Procedura operativa di base (vale per TUTTE le task)

**Caricamento credenziali n8n + Supabase** (da `/Users/amplaye/CRM/.env.local`):
```bash
cd /Users/amplaye/CRM
export N8N_BASE=$(grep -o 'N8N_BASE_URL=[^[:space:]]*' .env.local | head -1 | cut -d= -f2- | tr -d '"')
export N8N_KEY=$(grep -o 'N8N_API_KEY=[^[:space:]]*' .env.local | head -1 | cut -d= -f2- | tr -d '"')
export SUPA_URL="https://azhlnybiqlkbhbboyvud.supabase.co"
export SUPA_KEY=$(grep -o 'SUPABASE_SERVICE_ROLE_KEY="[^"]*"' .env.local | sed 's/.*="//;s/"$//')
```

**Pull di un workflow:** `GET $N8N_BASE/api/v1/workflows/<id>` header `X-N8N-API-KEY: $N8N_KEY`.
**Deploy di un workflow:** `PUT $N8N_BASE/api/v1/workflows/<id>` con body JSON `{name, nodes, connections, settings}` (SOLO questi 4 campi, niente id/active/tags), header `X-N8N-API-KEY` + `Content-Type: application/json`.

**SEMPRE backup prima di modificare:** salvare il pull in `N8N/picnic/live_picnic.PRE_MERGE_<timestamp>.json` prima di ogni PUT.

**Editing del jsCode:** i Code node hanno il codice in `node.parameters.jsCode`. Modificarlo via script Python (json.load → trova nodo per `name` → string replace nel jsCode → json.dump → PUT). Mai editare il JSON a mano (escaping fragile).

**REGOLA DI SICUREZZA TEST:** NON mandare MAI POST ai webhook dei bot durante l'analisi. Il test E2E si fa SOLO con l'harness dedicato, e SOLO serialmente (`--concurrency 1`) per non sovraccaricare l'n8n condiviso. Pulire SEMPRE i dati di test dopo (`node scripts/oraz-e2e/run.mjs --cleanup`).

**Harness E2E esistente** (`scripts/oraz-e2e/`): drive il bot live via webhook + legge reply dall'execution log. Vedi `scripts/oraz-e2e/STATE.md` e memoria `reference_oraz_e2e_bot_harness.md`. Per testare Picnic va adattato il webhook path / tenant (vedi Task A0).

---

# FASE A — Allineare Picnic (template legacy) a Oraz

Obiettivo: portare a Picnic i fix di Oraz tramite MERGE bidirezionale, preservando i 5 blocchi che solo Picnic ha. Risultato: Picnic diventa il template migliore e allineato. È software funzionante e testabile da solo.

### Task A0: Setup — backup, harness Picnic, baseline

**Files:**
- Create: `N8N/picnic/live_picnic.PRE_MERGE_<timestamp>.json` (backup)
- Create: `N8N/picnic/live_oraz.REFERENCE.json` (sorgente fix)
- Create: `scripts/oraz-e2e/STATE_PICNIC.md` (note per il test Picnic)

- [ ] **Step 1: Carica credenziali e fai backup di Picnic e Oraz**

```bash
cd /Users/amplaye/CRM
export N8N_BASE=$(grep -o 'N8N_BASE_URL=[^[:space:]]*' .env.local | head -1 | cut -d= -f2- | tr -d '"')
export N8N_KEY=$(grep -o 'N8N_API_KEY=[^[:space:]]*' .env.local | head -1 | cut -d= -f2- | tr -d '"')
TS=$(date +%Y%m%d_%H%M%S)
curl -s "$N8N_BASE/api/v1/workflows/166QnQsGHqXDpBxa" -H "X-N8N-API-KEY: $N8N_KEY" > "N8N/picnic/live_picnic.PRE_MERGE_$TS.json"
curl -s "$N8N_BASE/api/v1/workflows/zXEYdw8Zbs5seCci" -H "X-N8N-API-KEY: $N8N_KEY" > "N8N/picnic/live_oraz.REFERENCE.json"
echo "backup picnic: $(wc -c < N8N/picnic/live_picnic.PRE_MERGE_$TS.json) bytes"
```

Expected: due file scritti, dimensione > 400KB ciascuno.

- [ ] **Step 2: Verifica quale tenant di test usare per Picnic**

Picnic tenant = `626547ff-bc44-4f35-8f42-0e97f1dcf0d5`, webhook path = `picnic-whatsapp`. Picnic è INATTIVO (active=false). Per testarlo va riattivato temporaneamente.

```bash
curl -s "$N8N_BASE/api/v1/workflows/166QnQsGHqXDpBxa" -H "X-N8N-API-KEY: $N8N_KEY" | python3 -c "import json,sys; w=json.load(sys.stdin); print('active:', w.get('active')); print('webhook path:', [n['parameters'].get('path') for n in w['nodes'] if n['type']=='n8n-nodes-base.webhook'])"
```

Expected: `active: False`, path `picnic-whatsapp`.

- [ ] **Step 3: Scrivi STATE_PICNIC.md con i parametri di test**

Contenuto del file `scripts/oraz-e2e/STATE_PICNIC.md`:
```markdown
# Test Picnic — parametri
- Workflow id: 166QnQsGHqXDpBxa (INATTIVO di default — riattivare per testare, poi rivalutare)
- Tenant id: 626547ff-bc44-4f35-8f42-0e97f1dcf0d5
- Webhook path: picnic-whatsapp
- Per testare con l'harness oraz-e2e: serve un override del path/tenant (vedi harness.mjs WEBHOOK_PATH / TENANT_ID).
- Riattivazione temporanea: POST /api/v1/workflows/166QnQsGHqXDpBxa/activate ; a fine test valutare con l'utente se lasciare attivo.
- Cleanup dati test: phone 34699* sul tenant Picnic.
```

- [ ] **Step 4: Commit del setup**

```bash
git add N8N/picnic/live_picnic.PRE_MERGE_*.json N8N/picnic/live_oraz.REFERENCE.json scripts/oraz-e2e/STATE_PICNIC.md
git commit -m "chore(picnic): backup pre-merge + parametri test Picnic"
```

---

### Task A1: Merge nel nodo "OpenAI" di Picnic — porta i fix di Oraz

**Files:**
- Modify: workflow Picnic `166QnQsGHqXDpBxa`, nodo `OpenAI` (`parameters.jsCode`)
- Reference: `N8N/picnic/live_oraz.REFERENCE.json` nodo `OpenAI`

Da portare DA Oraz: `_httpWithRetry`, `_normalizeDate`, blocco `_diag`, `timeout:12000`, `MAX_TURNS=3`, payload OpenAI (2000/none/parallel_tool_calls), 4 regole prompt. NON toccare `_alreadyInHistory`. PRESERVARE l'uso di `langStrong` e `kbContext` se referenziati nel nodo OpenAI di Picnic.

- [ ] **Step 1: Estrai i blocchi sorgente da Oraz**

```bash
cd /Users/amplaye/CRM
python3 - <<'PY'
import json
oraz=json.load(open('N8N/picnic/live_oraz.REFERENCE.json'))
code=[n['parameters']['jsCode'] for n in oraz['nodes'] if n['name']=='OpenAI'][0]
# estrai _httpWithRetry
i=code.find('async function _httpWithRetry'); j=code.find('async function _execCheckAvailability')
open('/tmp/blk_httpretry.js','w').write(code[i:j])
# estrai _normalizeDate (precede _execCheckAvailability nella versione Oraz)
i=code.find('function _normalizeDate'); j=code.find('async function _execCheckAvailability')
open('/tmp/blk_normalizedate.js','w').write(code[i:j] if i>=0 else '')
print('httpRetry bytes:', len(open('/tmp/blk_httpretry.js').read()))
print('normalizeDate bytes:', len(open('/tmp/blk_normalizedate.js').read()))
PY
```

Expected: blocchi estratti con dimensione > 0.

- [ ] **Step 2: Ispeziona il nodo OpenAI di Picnic per i punti di innesto**

```bash
python3 - <<'PY'
import json
p=json.load(open([f for f in __import__('glob').glob('N8N/picnic/live_picnic.PRE_MERGE_*.json')][-1]))
code=[n['parameters']['jsCode'] for n in p['nodes'] if n['name']=='OpenAI'][0]
for kw in ['_httpWithRetry','_normalizeDate','MAX_TURNS','reasoning_effort','max_completion_tokens','parallel_tool_calls','_alreadyInHistory','langStrong','kbContext','this.helpers.httpRequest']:
    print(f'{kw}: {code.count(kw)}')
PY
```

Expected: Picnic mostra `_httpWithRetry: 0`, `_normalizeDate: 0`, `MAX_TURNS` presente (valore 4), `reasoning_effort` presente (medium), `_alreadyInHistory > 0`, `langStrong > 0`, `kbContext` referenziato.

- [ ] **Step 3: Applica il merge nel nodo OpenAI di Picnic**

Script Python che: (a) inserisce `_normalizeDate` + `_httpWithRetry` prima di `_execCheckAvailability`; (b) sostituisce le chiamate `this.helpers.httpRequest` delle tool availability/menu con `_httpWithRetry(this, {...})` aggiungendo `timeout:12000`; (c) avvolge l'uso di `args.fecha` con `const fecha=_normalizeDate(args.fecha)`; (d) sostituisce il catch availability con la versione `_diag`; (e) `MAX_TURNS = 4` → `3`; (f) payload OpenAI `max_completion_tokens` → 2000, `reasoning_effort` → 'none', aggiunge `parallel_tool_calls: true`; (g) inserisce le 4 regole prompt dopo l'anchor del system prompt esistente.

```bash
python3 - <<'PY'
import json, glob
path=sorted(glob.glob('N8N/picnic/live_picnic.PRE_MERGE_*.json'))[-1]
# Lavoriamo su una copia di lavoro live_picnic.WORK.json
work='N8N/picnic/live_picnic.WORK.json'
import shutil; shutil.copy(path, work)
wf=json.load(open(work))
norm=open('/tmp/blk_normalizedate.js').read()
retry=open('/tmp/blk_httpretry.js').read()
for n in wf['nodes']:
    if n['name']!='OpenAI': continue
    c=n['parameters']['jsCode']
    # (a) inserisci normalizeDate + httpRetry prima di _execCheckAvailability
    anchor='async function _execCheckAvailability'
    assert c.count(anchor)==1
    c=c.replace(anchor, norm + retry + anchor, 1)
    # (e) MAX_TURNS 4 -> 3
    c=c.replace('MAX_TURNS = 4','MAX_TURNS = 3')
    # (f) payload OpenAI
    c=c.replace("reasoning_effort: 'medium'","reasoning_effort: 'none'")
    c=c.replace('max_completion_tokens: 4500','max_completion_tokens: 2000')
    if 'parallel_tool_calls' not in c:
        c=c.replace("tool_choice: 'auto'","tool_choice: 'auto', parallel_tool_calls: true",1)
    n['parameters']['jsCode']=c
json.dump(wf, open(work,'w'), ensure_ascii=False)
print('OpenAI merge step a/e/f applicato su', work)
PY
```

Nota: i passi (b) sostituzione httpRequest→_httpWithRetry, (c) normalizeDate su args.fecha, (d) catch _diag, (g) 4 regole prompt richiedono string-replace mirati che dipendono dal testo esatto presente in Picnic. Eseguirli uno per uno verificando `count==1` dell'anchor prima di ogni replace, e abortire se l'anchor non è unico. Usare come testo-sorgente esatto i frammenti del nodo OpenAI di Oraz in `live_oraz.REFERENCE.json` (le 4 regole prompt sono dopo l'anchor `Si ya tienes todos los datos, pasa directo a la herramienta; no reabras la conversación.`).

- [ ] **Step 4: Verifica sintassi del jsCode modificato (node --check)**

```bash
python3 - <<'PY'
import json
wf=json.load(open('N8N/picnic/live_picnic.WORK.json'))
c=[n['parameters']['jsCode'] for n in wf['nodes'] if n['name']=='OpenAI'][0]
open('/tmp/openai_picnic.js','w').write('async function _wrap(){\n'+c+'\n}')
PY
node --check /tmp/openai_picnic.js && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`. Se errore, correggere il replace e ripetere.

- [ ] **Step 5: Verifica presenza dei fix e preservazione dei blocchi Picnic**

```bash
python3 - <<'PY'
import json
c=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_picnic.WORK.json'))['nodes'] if n['name']=='OpenAI'][0]
checks={'_httpWithRetry':1,'_normalizeDate':1,'MAX_TURNS = 3':1,"reasoning_effort: 'none'":1,'_alreadyInHistory':'>0','langStrong':'>0'}
for k,v in checks.items():
    n=c.count(k)
    ok = (n>0) if v=='>0' else (n>=v)
    print(('OK ' if ok else 'FAIL'), k, n)
PY
```

Expected: tutte OK. In particolare `_alreadyInHistory` e `langStrong` ancora presenti (preservati).

- [ ] **Step 6: Commit (solo file locale, ancora NO deploy)**

```bash
git add N8N/picnic/live_picnic.WORK.json
git commit -m "feat(picnic): merge OpenAI node — porta _httpWithRetry/_normalizeDate/_diag/MAX_TURNS=3/payload/regole prompt da Oraz, preserva langStrong+_alreadyInHistory"
```

---

### Task A2: Merge nel nodo "Fetch History + Check Availability" di Picnic

**Files:**
- Modify: `N8N/picnic/live_picnic.WORK.json`, nodo `Fetch History + Check Availability`
- Reference: `N8N/picnic/live_oraz.REFERENCE.json` stesso nodo

Da portare DA Oraz: calendario leggibile multilingua (`_LANG2LOCALE`, `_calLang`, `_isoReadable`, ` · ` accanto alle date), debounce 6000→3000ms. PRESERVARE: `langStrong`, business-rule-rejection + `ignoreHttpStatusErrors`, `kbContext`, e il return Picnic (kbContext+langStrong). Il merge corretto del return = return Picnic + campo calendario leggibile.

- [ ] **Step 1: Estrai le funzioni calendario da Oraz**

```bash
python3 - <<'PY'
import json
c=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_oraz.REFERENCE.json'))['nodes'] if n['name']=='Fetch History + Check Availability'][0]
for fn in ['_LANG2LOCALE','_calLang','_isoReadable']:
    i=c.find(fn)
    print(f'--- {fn} @ {i}')
    print(c[i-10:i+200] if i>=0 else 'NOT FOUND')
PY
```

Expected: le 3 funzioni trovate in Oraz. Copiarne il testo esatto per l'innesto.

- [ ] **Step 2: Verifica i blocchi da preservare in Picnic**

```bash
python3 - <<'PY'
import json, glob
c=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_picnic.WORK.json'))['nodes'] if n['name']=='Fetch History + Check Availability'][0]
for kw in ['langStrong','ignoreHttpStatusErrors','kbContext','business_rejected','setTimeout','_isoReadable']:
    print(f'{kw}: {c.count(kw)}')
PY
```

Expected: Picnic ha `langStrong>0`, `ignoreHttpStatusErrors>0` (=2), `kbContext>0`, `business_rejected>0`, `setTimeout>0`, `_isoReadable: 0`.

- [ ] **Step 3: Applica il merge (calendario leggibile + debounce)**

Inserire le funzioni `_LANG2LOCALE`/`_calLang`/`_isoReadable` prima del punto dove si costruisce `calLines`, e modificare il push delle righe calendario per appendere ` · ${_isoReadable(iso, lang)}`. Sostituire il debounce `6000` → `3000`. NON toccare langStrong/business-rejection/kbContext/return.

```bash
python3 - <<'PY'
import json
wf=json.load(open('N8N/picnic/live_picnic.WORK.json'))
for n in wf['nodes']:
    if n['name']!='Fetch History + Check Availability': continue
    c=n['parameters']['jsCode']
    # debounce
    c=c.replace('6000','3000') if c.count('6000')==1 else c  # se >1 occorrenza, fare replace mirato sul setTimeout
    n['parameters']['jsCode']=c
json.dump(wf, open('N8N/picnic/live_picnic.WORK.json','w'), ensure_ascii=False)
print('debounce step applicato; calendario leggibile da innestare manualmente con anchor verificato')
PY
```

Nota: l'innesto delle funzioni calendario e del ` · ` richiede di individuare l'anchor esatto del push calLines in Picnic (varia leggermente). Verificare `count==1` dell'anchor prima del replace. Se il debounce ha >1 occorrenza di `6000`, fare il replace solo sulla riga `setTimeout(..., 6000)`.

- [ ] **Step 4: Verifica sintassi**

```bash
python3 -c "import json; c=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_picnic.WORK.json'))['nodes'] if n['name']=='Fetch History + Check Availability'][0]; open('/tmp/fetch_picnic.js','w').write('async function _w(){\n'+c+'\n}')"
node --check /tmp/fetch_picnic.js && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`.

- [ ] **Step 5: Verifica preservazione + nuovi blocchi**

```bash
python3 - <<'PY'
import json
c=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_picnic.WORK.json'))['nodes'] if n['name']=='Fetch History + Check Availability'][0]
for kw,exp in [('langStrong','>0'),('ignoreHttpStatusErrors','>0'),('kbContext','>0'),('business_rejected','>0'),('3000','>0')]:
    print(('OK' if c.count(kw)>0 else 'FAIL'), kw, c.count(kw))
PY
```

Expected: tutte OK (i blocchi Picnic preservati + debounce 3000).

- [ ] **Step 6: Commit**

```bash
git add N8N/picnic/live_picnic.WORK.json
git commit -m "feat(picnic): merge Fetch node — calendario leggibile multilingua + debounce 3000ms da Oraz, preserva langStrong/business-rejection/kbContext"
```

---

### Task A3: Merge nel nodo "Send WhatsApp Reply" — fallback anti-ghost

**Files:**
- Modify: `N8N/picnic/live_picnic.WORK.json`, nodo `Send WhatsApp Reply`
- Reference: `N8N/picnic/live_oraz.REFERENCE.json` stesso nodo

Da portare DA Oraz: blocco `_fl` (nudge localizzato 4 lingue quando `!cleanResponse && !hasAction`, invece del `return {done:true}` muto di Picnic).

- [ ] **Step 1: Estrai il blocco `_fl` da Oraz e l'anchor di Picnic**

```bash
python3 - <<'PY'
import json
oc=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_oraz.REFERENCE.json'))['nodes'] if n['name']=='Send WhatsApp Reply'][0]
pc=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_picnic.WORK.json'))['nodes'] if n['name']=='Send WhatsApp Reply'][0]
i=oc.find('_fl'); print('ORAZ _fl @', i, '\n', oc[i-40:i+260] if i>=0 else 'NF')
print('--- PICNIC done:true context:')
j=pc.find('done: true') if 'done: true' in pc else pc.find('done:true')
print(pc[j-120:j+40] if j>=0 else 'NF')
PY
```

Expected: trovato `_fl` in Oraz e il `return {done:true}` muto in Picnic.

- [ ] **Step 2: Sostituisci il return muto con il fallback _fl**

Replace mirato verificando `count==1` dell'anchor `return {done:true}` (o variante) in Picnic con la versione Oraz che invia il nudge localizzato. Copiare il testo esatto dal nodo Oraz.

- [ ] **Step 3: Verifica sintassi**

```bash
python3 -c "import json; c=[n['parameters']['jsCode'] for n in json.load(open('N8N/picnic/live_picnic.WORK.json'))['nodes'] if n['name']=='Send WhatsApp Reply'][0]; open('/tmp/send_picnic.js','w').write('async function _w(){\n'+c+'\n}')"
node --check /tmp/send_picnic.js && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`.

- [ ] **Step 4: Commit**

```bash
git add N8N/picnic/live_picnic.WORK.json
git commit -m "feat(picnic): merge Send node — fallback anti-ghost _fl localizzato 4 lingue da Oraz"
```

---

### Task A4: Deploy del merge su Picnic + test E2E seriale

**Files:**
- Modify: workflow live Picnic `166QnQsGHqXDpBxa` (PUT)
- Test: `scripts/oraz-e2e/` (adattato a Picnic)

- [ ] **Step 1: Deploy del WORK su Picnic (PUT)**

```bash
cd /Users/amplaye/CRM
python3 - <<'PY'
import json, urllib.request, os
base=os.popen("grep -o 'N8N_BASE_URL=[^[:space:]]*' .env.local | head -1 | cut -d= -f2- | tr -d '\"'").read().strip()
key=os.popen("grep -o 'N8N_API_KEY=[^[:space:]]*' .env.local | head -1 | cut -d= -f2- | tr -d '\"'").read().strip()
wf=json.load(open('N8N/picnic/live_picnic.WORK.json'))
payload={"name":wf["name"],"nodes":wf["nodes"],"connections":wf["connections"],"settings":wf.get("settings",{})}
req=urllib.request.Request(f"{base}/api/v1/workflows/166QnQsGHqXDpBxa",data=json.dumps(payload).encode(),method="PUT",headers={"X-N8N-API-KEY":key,"Content-Type":"application/json"})
print("PUT OK:", json.load(urllib.request.urlopen(req)).get("updatedAt"))
PY
```

Expected: `PUT OK: <timestamp>`.

- [ ] **Step 2: Riattiva temporaneamente Picnic per il test**

```bash
curl -s -X POST "$N8N_BASE/api/v1/workflows/166QnQsGHqXDpBxa/activate" -H "X-N8N-API-KEY: $N8N_KEY" | python3 -c "import json,sys; print('active:', json.load(sys.stdin).get('active'))"
```

Expected: `active: True`.

- [ ] **Step 3: Adatta l'harness e lancia il test E2E seriale su Picnic**

Override del webhook path e tenant per Picnic (variabili d'ambiente o flag). Lanciare la suite serialmente:

```bash
ORAZ_WEBHOOK_PATH=picnic-whatsapp ORAZ_TENANT_ID=626547ff-bc44-4f35-8f42-0e97f1dcf0d5 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa \
  node scripts/oraz-e2e/run.mjs --rounds 5 --concurrency 1 --json scripts/oraz-e2e/results_picnic.json
```

Nota: se l'harness non legge ancora questi env, aggiungerli in `harness.mjs` (leggere `process.env.ORAZ_WEBHOOK_PATH || 'oraz-93ee-whatsapp'`, ecc.) come micro-task prima del run.

Expected: ≥ 11/12 funzioni al 100%; i fallimenti residui devono essere falsi-negativi di assertion o blip n8n, non bug logici (confrontare con il comportamento Oraz già verde).

- [ ] **Step 4: Cleanup dati di test + ripristina stato attivo Picnic**

```bash
node scripts/oraz-e2e/run.mjs --cleanup
# chiedere all'utente se Picnic deve restare attivo o tornare inattivo:
# se inattivo: curl -s -X POST "$N8N_BASE/api/v1/workflows/166QnQsGHqXDpBxa/deactivate" -H "X-N8N-API-KEY: $N8N_KEY"
```

Expected: 0 guest di test residui. Stato Picnic deciso con l'utente.

- [ ] **Step 5: Aggiorna il backup "buono" e committa i risultati**

```bash
cp N8N/picnic/live_picnic.WORK.json N8N/picnic/live_picnic.MERGED.json
git add N8N/picnic/live_picnic.MERGED.json scripts/oraz-e2e/results_picnic.json scripts/oraz-e2e/harness.mjs
git commit -m "test(picnic): deploy merge + E2E seriale verde; Picnic allineato a Oraz"
```

---

### Task A5: Propaga i fix anche a BALI Rest (stesso merge)

**Files:**
- Modify: workflow BALI Rest `9liGOnPCOuTSMyrM`

BALI Rest è anch'esso indietro come Picnic. Applicare lo STESSO merge (A1-A3) ma su BALI Rest, partendo da backup. Questo riduce il drift su tutti i tenant vivi prima della Fase B.

- [ ] **Step 1: Backup BALI Rest**

```bash
TS=$(date +%Y%m%d_%H%M%S)
curl -s "$N8N_BASE/api/v1/workflows/9liGOnPCOuTSMyrM" -H "X-N8N-API-KEY: $N8N_KEY" > "N8N/picnic/live_balirest.PRE_MERGE_$TS.json"
echo "backup: $(wc -c < N8N/picnic/live_balirest.PRE_MERGE_$TS.json) bytes"
```

- [ ] **Step 2: Verifica le divergenze inverse di BALI Rest**

Ripetere l'audit: BALI Rest potrebbe avere blocchi propri (es. testo prompt "trattoria napolitana" hardcoded) da preservare/spostare in config. Eseguire i grep di A1-Step2 e A2-Step2 su BALI Rest e annotare le differenze prima di mergiare.

```bash
python3 - <<'PY'
import json, glob
f=sorted(glob.glob('N8N/picnic/live_balirest.PRE_MERGE_*.json'))[-1]
for nodo in ['OpenAI','Fetch History + Check Availability','Send WhatsApp Reply']:
    c=[n['parameters']['jsCode'] for n in json.load(open(f))['nodes'] if n['name']==nodo][0]
    print(f'== {nodo} ==')
    for kw in ['_httpWithRetry','_normalizeDate','MAX_TURNS','langStrong','business_rejected','trattoria','napolitana','BALI REST']:
        print(' ', kw, c.count(kw))
PY
```

Expected: lista delle divergenze; se compaiono stringhe come "trattoria"/"napolitana"/"BALI REST" hardcoded, annotarle come candidate config (Fase B).

- [ ] **Step 3: Applica lo stesso merge di A1-A3 a BALI Rest**

Ripetere la procedura di merge (porta fix Oraz, preserva blocchi propri). Verificare sintassi con `node --check`.

- [ ] **Step 4: Deploy + test E2E seriale su BALI Rest**

```bash
python3 -c "..."  # PUT come A4-Step1 con id 9liGOnPCOuTSMyrM (BALI Rest è già attivo)
ORAZ_WEBHOOK_PATH=bali-rest-a085-whatsapp ORAZ_TENANT_ID=a085e5bb-11f3-47f9-96da-c6cfdbff2ea0 ORAZ_WORKFLOW_ID=9liGOnPCOuTSMyrM \
  node scripts/oraz-e2e/run.mjs --rounds 5 --concurrency 1 --json scripts/oraz-e2e/results_balirest.json
node scripts/oraz-e2e/run.mjs --cleanup
```

Expected: ≥ 11/12 al 100%.

- [ ] **Step 5: Commit**

```bash
git add N8N/picnic/live_balirest.* scripts/oraz-e2e/results_balirest.json
git commit -m "feat(balirest): merge fix Oraz + E2E seriale verde"
```

**🎯 CHECKPOINT FINE FASE A:** Oraz, Picnic, BALI Rest allineati (stessi fix). Drift azzerato. Software funzionante e testato. Procedere alla Fase B solo dopo conferma utente.

---

# FASE B — Picnic come motore unico (tenant dinamico + config-driven)

Obiettivo: trasformare Picnic nel motore unico dove il tenant è risolto a runtime dal webhook path e tutto ciò che è tenant-specifico vive in config Supabase. **Dipende dal completamento della Fase A.**

> **NOTA DI DESIGN (da decidere con l'utente prima di B):** ci sono due strade per il "motore unico":
> 1. **Un solo workflow** con webhook a path multipli/wildcard che risolve il tenant dal path → richiede che n8n supporti il match dinamico del path (verificare); oppure il Meta Router passa `tenant_id` nel payload e il chatbot lo legge da lì invece che dal path.
> 2. **Workflow-template + sync**: si mantiene un workflow "template" (Picnic) e i tenant restano workflow separati, ma generati/sincronizzati automaticamente dal template via API (un solo posto da modificare, deploy propagato). Meno elegante ma compatibile con l'attuale routing per-path.
> La Fase B assume la **strada 1 via payload** (il Meta Router già conosce il tenant e può passarlo), che è la più vicina al "motore unico" vero. Confermare con l'utente prima di Task B1.

### Task B0: Decisione architetturale + verifica routing

- [ ] **Step 1: Ispeziona come il Meta Router passa il tenant**

```bash
curl -s "$N8N_BASE/api/v1/workflows/zuYx8raoBVz88Erj" -H "X-N8N-API-KEY: $N8N_KEY" | python3 -c "
import json,sys; w=json.load(sys.stdin)
for n in w['nodes']:
    if n['type'] in ('n8n-nodes-base.code','n8n-nodes-base.httpRequest','n8n-nodes-base.set'):
        c=json.dumps(n['parameters'])
        if 'tenant' in c.lower() or 'chatbot_webhook_path' in c or 'forward' in c.lower():
            print('NODE', n['name'], '::', c[:300])
"
```

Expected: capire se il Router può aggiungere `tenant_id` al body forwardato al chatbot. Documentare.

- [ ] **Step 2: Decisione utente (strada 1 payload vs strada 2 template-sync)**

Presentare all'utente le due strade con trade-off. Registrare la scelta in `docs/superpowers/plans/2026-06-02-motore-unico-chatbot.md` (aggiornare questa nota). Le task B1+ assumono strada 1 via payload; se si sceglie strada 2, riscrivere B1-B3 di conseguenza.

### Task B1: Risoluzione dinamica del tenant nel nodo OpenAI + Fetch

**Files:**
- Modify: workflow motore (Picnic `166QnQsGHqXDpBxa`), nodi `OpenAI` e `Fetch History + Check Availability`

Sostituire la const `TENANT_ID`/`PICNIC_CFG_TENANT_ID` hardcoded con la lettura dal payload/webhook. Il Router passa `tenant_id`; il nodo `Extract Message` lo mette in un campo; i Code node lo leggono da `$json.tenant_id` con fallback al path.

- [ ] **Step 1: Aggiungi estrazione tenant_id nel nodo Extract Message**

Verificare che `Extract Message` propaghi `tenant_id` dal body. Se assente, aggiungere il campo (Set node) leggendo `{{$json.body.tenant_id}}` con fallback alla risoluzione da path (`picnic-whatsapp` → lookup tenants per `chatbot_webhook_path`).

- [ ] **Step 2: Sostituisci la const hardcoded con la lettura dinamica**

```bash
python3 - <<'PY'
import json
wf=json.load(open('N8N/picnic/live_picnic.MERGED.json'))
for n in wf['nodes']:
    if n['name'] in ('OpenAI','Fetch History + Check Availability'):
        c=n['parameters']['jsCode']
        # esempio: const TENANT_ID = '626547ff-...'  ->  const TENANT_ID = $input.first().json.tenant_id || <resolve-from-path>
        # NB: in un Code node n8n, l'input è accessibile via items/$input; usare il pattern già presente nel nodo per leggere altri campi.
        print(n['name'], 'occorrenze UUID Picnic:', c.count('626547ff-bc44-4f35-8f42-0e97f1dcf0d5'))
PY
```

Sostituire la DICHIARAZIONE della const tenant con la lettura dinamica, e assicurarsi che TUTTE le altre 41 occorrenze UUID usino la variabile `TENANT_ID` (non l'UUID letterale). Molte già usano `TENANT_ID`; verificare che non restino UUID letterali sparsi (grep dopo la modifica deve dare 0 UUID Picnic hardcoded a parte la riga di fallback).

- [ ] **Step 3: Verifica 0 UUID letterali residui (a parte fallback)**

```bash
python3 -c "import json; c=' '.join(n['parameters'].get('jsCode','') for n in json.load(open('N8N/picnic/live_picnic.WORK_B.json'))['nodes'] if n['type']=='n8n-nodes-base.code'); print('UUID Picnic letterali:', c.count('626547ff-bc44-4f35-8f42-0e97f1dcf0d5'))"
```

Expected: ≤ 1 (solo l'eventuale fallback documentato), idealmente 0.

- [ ] **Step 4: node --check su tutti i Code node modificati**

Expected: SYNTAX OK su ciascuno.

- [ ] **Step 5: Commit**

```bash
git add N8N/picnic/live_picnic.WORK_B.json
git commit -m "feat(motore): risoluzione dinamica TENANT_ID da payload/path nel nodo OpenAI+Fetch"
```

### Task B2: Parametrizza i restanti hardcoded tenant-specifici

**Files:**
- Modify: workflow motore, vari Code node
- Modify: Supabase `tenants.settings.bot_config` (aggiungere chiavi mancanti)

Spostare in config: `workflow_id` (→ `$workflow.id`), verify_token Meta (→ per-tenant), webhook path interni (`picnic-confirm-booking` ecc. → da config o derivati dal path), default `restaurant_name`/`restaurant_phone` (uniformare via `picnicCfgGet`), persona/città/dialetto del prompt (→ `bot_config.assistant_name`, `settings.venue.city`, `bot_config.dialect`).

- [ ] **Step 1: Sostituisci workflow_id hardcoded con $workflow.id**

```bash
python3 -c "import json; print(sum(n['parameters'].get('jsCode','').count('166QnQsGHqXDpBxa') for n in json.load(open('N8N/picnic/live_picnic.WORK_B.json'))['nodes'] if n['type']=='n8n-nodes-base.code'))"
```

Sostituire ogni `'166QnQsGHqXDpBxa'` usato come workflow_id nel logEvt con il valore runtime (in un Code node n8n: `this.getWorkflow().id` o equivalente; verificare l'API disponibile).

- [ ] **Step 2: Aggiungi le chiavi config mancanti su Supabase per ogni tenant**

```bash
# Esempio per Picnic: aggiungere assistant_name, dialect, e normalizzare bot_config
python3 - <<'PY'
import json, urllib.request, os
supa=os.popen('echo $SUPA_URL').read().strip() or "https://azhlnybiqlkbhbboyvud.supabase.co"
key=os.popen("grep -o 'SUPABASE_SERVICE_ROLE_KEY=\"[^\"]*\"' .env.local | sed 's/.*=\"//;s/\"$//'").read().strip()
# leggere settings attuale, aggiungere chiavi, PATCH. (dettaglio per ogni tenant: Oraz, Picnic, BALI Rest)
print('Definire le chiavi: assistant_name, dialect, venue.city, verify_token; PATCH tenants.settings')
PY
```

Definire e PATCHare per OGNI tenant (Oraz/Picnic/BALI Rest) le chiavi: `assistant_name` (es. "Sofía"), `dialect`, `venue.city`, `venue.address`, `verify_token`, e normalizzare lo schema bot_config (stesse chiavi per tutti).

- [ ] **Step 3: Sostituisci persona/città/dialetto hardcoded nel prompt con i valori config**

Nel nodo OpenAI, sostituire `Sofía`/`en Las Palmas`/dialetto canario con `${ASSISTANT_NAME_CFG}`/`${VENUE_CITY_CFG}`/`${DIALECT_CFG}` letti via `picnicCfgGet`.

- [ ] **Step 4: Verifica + node --check + commit**

```bash
git add N8N/picnic/live_picnic.WORK_B.json
git commit -m "feat(motore): parametrizza workflow_id, persona, città, dialetto, verify_token in config"
```

### Task B3: Sposta i segreti fuori dal codice (sicurezza)

**Files:**
- Modify: workflow motore (rimuovere JWT/key inline)
- n8n: creare credenziali; oppure usare colonna `secrets` di Supabase

I segreti in chiaro nel codice: Supabase service_role JWT, OpenAI API key, Twilio SID/token, ai_secret. La colonna `secrets` esiste ma è inutilizzata.

- [ ] **Step 1: Inventario delle occorrenze segrete**

```bash
python3 - <<'PY'
import json
c=' '.join(n['parameters'].get('jsCode','') for n in json.load(open('N8N/picnic/live_picnic.WORK_B.json'))['nodes'] if n['type']=='n8n-nodes-base.code')
import re
print('JWT eyJ...:', len(re.findall(r'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', c)))
print('sk-proj:', c.count('sk-proj-'))
PY
```

- [ ] **Step 2: Scegli il meccanismo (credenziale n8n vs colonna secrets)**

Decidere con l'utente: (a) credenziali n8n native (più sicuro, ma i Code node devono accedervi — verificare come), oppure (b) leggere da `tenants.secrets` a runtime (coerente col config-driven, ma serve un secret "bootstrap" per leggere Supabase stesso → quello resta credenziale n8n). Raccomandato: bootstrap key Supabase come credenziale n8n; il resto (OpenAI, Twilio, ai_secret) da `tenants.secrets`.

- [ ] **Step 3: Implementa la lettura dei secret + rimuovi gli inline**

- [ ] **Step 4: Test E2E seriale (il bot deve ancora funzionare leggendo i secret dal nuovo posto)**

```bash
ORAZ_WEBHOOK_PATH=picnic-whatsapp ORAZ_TENANT_ID=626547ff-bc44-4f35-8f42-0e97f1dcf0d5 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa \
  node scripts/oraz-e2e/run.mjs --rounds 5 --concurrency 1
node scripts/oraz-e2e/run.mjs --cleanup
```

Expected: suite verde con i secret spostati.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "security(motore): sposta segreti da inline a credenziali/secrets, nessun JWT in chiaro"
```

### Task B4: Migra tutti i tenant sul motore unico + test multi-tenant

**Files:**
- Modify: routing (Meta Router) per puntare tutti i tenant al motore unico

- [ ] **Step 1: Fai puntare Oraz e BALI Rest al motore Picnic**

A seconda della strada scelta in B0: aggiornare il Meta Router perché inoltri TUTTI i tenant al webhook del motore unico passando `tenant_id`, oppure (strada 2) sincronizzare i workflow tenant dal template.

- [ ] **Step 2: Test E2E su OGNI tenant attraverso il motore unico (seriale)**

```bash
for T in "picnic-whatsapp 626547ff-bc44-4f35-8f42-0e97f1dcf0d5" "oraz-93ee-whatsapp 93eebe9c-8af5-4ca5-a315-3376ef4976e5" "bali-rest-a085-whatsapp a085e5bb-11f3-47f9-96da-c6cfdbff2ea0"; do
  set -- $T
  echo "=== tenant $2 ==="
  ORAZ_WEBHOOK_PATH=$1 ORAZ_TENANT_ID=$2 ORAZ_WORKFLOW_ID=166QnQsGHqXDpBxa node scripts/oraz-e2e/run.mjs --rounds 3 --concurrency 1
done
node scripts/oraz-e2e/run.mjs --cleanup
```

Expected: ogni tenant ≥ 11/12 al 100% attraverso lo stesso motore. Ogni tenant risponde con il PROPRIO nome/menu/orari (config-driven), non con quelli di Picnic.

- [ ] **Step 3: Verifica isolamento config (anti-leak)**

Test specifico: chiedere il nome del ristorante e il menu a ogni tenant; verificare che Oraz risponda "Oraz/sushi" e Picnic risponda con il proprio, anche girando sullo stesso workflow. Nessun leak di config tra tenant.

- [ ] **Step 4: Commit finale + aggiorna documentazione**

```bash
git add -A
git commit -m "feat(motore): tutti i tenant ristorante sul motore unico Picnic, config-driven, test multi-tenant verde"
```

- [ ] **Step 5: Aggiorna memoria e STATE**

Aggiornare `reference_oraz_e2e_bot_harness.md` e creare `reference_motore_unico_chatbot.md` con l'architettura finale (motore unico, come si aggiunge un nuovo tenant = solo config, niente clone).

**🎯 CHECKPOINT FINE FASE B:** un solo motore, tutti i tenant config-driven, segreti fuori dal codice, nuovo tenant = solo una riga di config. Drift impossibile per costruzione.

---

## Self-Review (eseguito)

**Spec coverage:** Allineamento Picnic↔Oraz (Fase A: merge bidirezionale A1-A4) ✓; propagazione a tutti i tenant vivi (A5) ✓; motore unico/tenant dinamico (B1) ✓; config al massimo (B2) ✓; sicurezza segreti (B3) ✓; migrazione+test multi-tenant (B4) ✓. Picnic come template legacy mantenuto ✓.

**Gap noti (volutamente lasciati a decisione utente, non placeholder):**
- B0 richiede una decisione architetturale (strada 1 payload vs strada 2 template-sync) che non posso prendere da solo perché dipende da come n8n gestisce i webhook path dinamici e dalle preferenze operative dell'utente. Le task B1+ assumono strada 1 e lo dichiarano.
- L'innesto esatto di alcuni blocchi (calendario in Fetch, _fl in Send, 4 regole prompt) usa anchor che vanno verificati `count==1` a runtime perché il testo Picnic può differire di poco; la procedura lo dice esplicitamente e indica la fonte (nodo Oraz di REFERENCE) da cui copiare il testo esatto. Questo è inevitabile con merge su Code node da ~50-130KB e NON è un placeholder: è una verifica di sicurezza pre-replace.

**Type/naming consistency:** nomi file (`live_picnic.WORK.json` → `.MERGED.json` → `.WORK_B.json`), id workflow (Picnic `166QnQsGHqXDpBxa`, Oraz `zXEYdw8Zbs5seCci`, BALI Rest `9liGOnPCOuTSMyrM`, Router `zuYx8raoBVz88Erj`), env override harness (`ORAZ_WEBHOOK_PATH`/`ORAZ_TENANT_ID`/`ORAZ_WORKFLOW_ID`) coerenti in tutte le task.
