# PIANO-MONITO — Bali Flow da "agenzia mascherata" a SaaS vero

> **Posizione ufficiale:** questo piano vive in `/Users/amplaye/CRM/docs/PIANO_SAAS.md` (dentro il progetto, insieme alla bussola). La copia in `~/.claude/plans/` è di lavoro. Tenere allineate le due.
>
> **Come usare questo documento.** Piano di riferimento permanente. Nelle prossime sessioni, ridammi questo file (o di' "continua il piano SaaS Bali Flow") e io riparto da solo senza rifare l'analisi.

## ⚙️ REGOLA DI AUTO-TRACCIAMENTO (leggere SEMPRE per prima)

Questo piano si tiene aggiornato da solo. All'inizio di ogni sessione in cui lavoriamo a questo piano:
1. Leggo il **Cruscotto di avanzamento** qui sotto e individuo la **prima mossa non ✅**.
2. Riparto **in automatico** da quella mossa (default), senza richiedere conferma — salvo che l'utente dica diversamente.
3. **Appena completo e verifico una fase**, aggiorno DUE cose, sempre:
   - il campo `Stato:` della mossa → `✅ fatto`
   - una riga nel **Log avanzamento** in fondo (data + cosa è stato fatto + commit hash se c'è).
4. Se una mossa è solo iniziata, la metto `🔄 in corso` e annoto nel log a che punto sono, così alla riapertura riprendo esattamente da lì.

Legenda stato: `⬜ da fare` · `🔄 in corso` · `✅ fatto` · `⏸️ futuro (gated)`.

## 📊 CRUSCOTTO DI AVANZAMENTO

| # | Mossa | Stato | Impatto | Rischio |
|---|-------|-------|---------|---------|
| 0 | Allineare la bussola (doc) | ✅ | — | nessuno |
| 1 | Pulizia ripieghi Picnic (~19 punti) | ✅ | ALTO | basso |
| 1B | Focus ristorante: semplificare la registrazione | ✅ | ALTO (narrativa) | basso |
| 2 | Picnic → Template Ufficiale (1 solo template) | ✅ | ALTO | basso-medio |
| 3 | Feature flags (CRM adattabile) | ✅ | ALTO | basso |
| 4 | Registro varianti (criterio fusione) | ✅ | MEDIO | nessuno |
| 5 | Stato tenant ✅ · Twilio auto ⏸️ | 🔄 | ALTO | medio |
| 6 | Motore unico (Opzione A) | ⏸️ | ALTO | alto |

> **Prima mossa non ✅ = da dove riparto.** Mossa 5 è **a metà**: la parte **"stato tenant"** è fatta ora (lifecycle `pending`/`trial`/`active`/`suspended` + gate sul traffico + creazione tenant unificata). Resta solo l'**automazione Twilio/WhatsApp per cliente**, deliberatamente in attesa dei primi clienti reali (numeri veri, non sandbox). Prossima volta: completare quella parte quando arrivano i clienti, poi **Mossa 6**.

---

## CONTEXT — perché esiste questo piano

L'investitore teme che Bali Flow sia **un'agenzia travestita da software**: se ogni ristorante richiede logica/menù/CRM/integrazioni/supporto custom, non scala e non è investibile. Diventa investibile solo dimostrando: setup standard, onboarding ripetibile, personalizzazione limitata, supporto ad alto margine, vendite ripetibili.

**Verdetto attuale (basato sul codice in `/Users/amplaye/CRM`): ~60% SaaS, ~40% agenzia.**
- ✅ Fondazione solida: dati isolati per tenant (RLS), differenze cliente = dati in `tenants.settings` (JSONB), onboarding wizard ~1 min, self-registration pubblica già esistente.
- ❌ 4 problemi "agenzia": (1) Picnic usato come stampo + fallback nascosti, (2) 13 workflow n8n + 1 agente Retell clonati per cliente, (3) Twilio/WhatsApp manuale, (4) manutenzione a mano per cliente.

**Decisione di focus presa con l'utente (2026-05-21):**
- **UN solo verticale: ristoranti.** Questo CRM è e resta il CRM *per ristoranti*. La pagina `/register` oggi offre 3 tipi (restaurant/ecommerce/services) ma dietro ecommerce/services non c'è nulla ("porta dipinta sul muro") → vanno tolti (Mossa 1B). Focus = investibilità; tre verticali pre-clienti = segnale "agenzia spruzza-e-prega".
- **Visione futura (preferenza utente): sistemi separati per business.** Se un domani si espande ad altri settori, prodotti distinti e dedicati, NON questo CRM gonfiato. Conseguenza positiva sul presente: niente complessità multi-business qui dentro; `business_type` resta come colonna ma fissa a `restaurant`. Nota di buon senso per quel futuro lontano: riusare questo come *scheletro* (account/fatturazione/infra AI sono comuni), non ripartire da zero. Decisione da prendere col mercato, non ora.

**Decisione architetturale presa con l'utente:**
- **Destinazione:** motore unico condiviso (l'utente vuole centinaia/migliaia di ristoranti → il clone non regge a quei numeri).
- **Strada:** NON costruire il motore unico ora (zero clienti = costruirlo al buio). Si parte da **"clone-trampolino"**: clone versionato ma scritto già orientato al motore unico, così la migrazione futura è evoluzione, non riscrittura.
- **Quando migrare al motore unico:** quando il "registro varianti" (vedi Mossa 4) smette di crescere — cioè quando 3-4 clienti di fila non chiedono niente di strutturalmente nuovo (tipicamente 5-15 clienti). Non una data: un segnale dai dati.
- **Storia investitori scelta dall'utente:** "funziona ed è affidabile" prima di "scala all'infinito". Quindi rischio basso, robustezza prima.

**Concetto guida (la metafora):** SaaS = *un motore, mille configurazioni*. Agenzia = *mille copie dello stesso motore*. Domanda-test per ogni scelta futura: *"per il cliente nuovo sto configurando (dati nel DB) o costruendo (codice/workflow nuovi)?"* Configuro = SaaS. Costruisco = agenzia.

**Documenti collegati:**
- `/Users/amplaye/CRM/docs/SAAS_ARCHITECTURE.md` — la "bussola" non tecnica (già scritta). Va aggiornata con le scoperte di questo piano (vedi Mossa 0).
- Copia PDF in `~/Downloads/SAAS_ARCHITECTURE.pdf`.

---

## SCOPERTE CHIAVE DELL'ANALISI (fatti, non opinioni)

1. **`business_type` è un gancio scollegato.** La colonna esiste (`supabase-schema.sql:25`, check restaurant/ecommerce/services), viene scritta in 3 punti (`register-tenant/route.ts:18`, `guest-setup/route.ts:27`, `orchestrator.ts:163`) ma **NON è mai letta per cambiare comportamento** (nessun if/where/case). → Collegare questo filo è il cuore dei template per-tipo.
2. **3 modi diversi di creare un tenant**, non centralizzati:
   - `src/app/api/register-tenant/route.ts:14-26` — self-signup pubblico da `/register` (sceglie business_type)
   - `src/app/api/guest-setup/route.ts:23-31` — guest demo (hardcoded "restaurant")
   - `src/lib/onboarding/orchestrator.ts:159-169` — wizard admin (hardcoded "restaurant")
3. **Nessuno stato del tenant.** `tenants` non ha colonne `status`/`active`/`plan`/`trial`. Un tenant creato è subito "vivo", nessun filtro tra registrazione e go-live.
4. **`tenants.settings` (JSONB) è il posto giusto per i feature flag**, ma oggi è usato come `any` ovunque (nessun tipo `TenantSettings`). Flag esistenti germinali: `ai_enabled_channels[]`, `vapi_voicemail.enabled`.
5. **Pattern config consolidato da riusare:** lettura via `useTenant()` (`src/lib/contexts/TenantContext.tsx:220`); salvataggio via `supabase.from("tenants").update({settings})` + `refreshActiveTenant()` (`src/components/settings/GeneralTab.tsx:146-170`). I tab settings vivono in `src/app/(dashboard)/settings/` + `src/components/settings/`.
6. **Audit fallback-Picnic completo: ~19 punti**, classificati A/B/C/D/E (sotto, Mossa 1).

---

## LE 6 MOSSE (in ordine di esecuzione)

### MOSSA 0 — Allineare la bussola (doc) alle scoperte
**Stato: ✅ fatto** · Rischio: nessuno (solo doc) · Effort: XS

Aggiornare `/Users/amplaye/CRM/docs/SAAS_ARCHITECTURE.md` con: la decisione "clone-trampolino", il criterio "registro varianti" per la migrazione, e le scoperte (business_type scollegato, 3 vie di creazione tenant, niente stato tenant). Rigenerare il PDF in `~/Downloads/` con lo script `/tmp/md2pdf.py` (interprete: `/opt/homebrew/Cellar/weasyprint/68.1/libexec/bin/python`).

---

### MOSSA 1 — Pulizia: togliere i "ripieghi su Picnic"
**Stato: ✅ fatto** · Rischio: basso · Effort: S · **Impatto investitore: ALTO** (toglie il segnale d'allarme #1)

> **Due scoperte durante l'esecuzione (importanti per le mosse future):**
> 1. **Non esiste la colonna `tenants.slug`.** Il codice di `resume-bot` la presupponeva. Risolto derivando lo slug dal nome del tenant (come fa l'onboarding: "PICNIC" → `picnic`). Da tenere a mente in Mossa 2/5.
> 2. **La config di Picnic viveva SOLO nei ripieghi hardcoded** (Picnic non aveva `settings.retell`/`settings.vapi`/`settings.owner_phone`). Togliere i ripieghi l'avrebbe rotto. Risolto **migrando i valori identici dentro `settings` di Picnic** (modo SaaS: il dato vive nel DB). Confermato con l'utente che siamo in demo puro (numero sandbox Twilio, nessun cliente reale).

Trasformare ogni fallback nascosto a Picnic in **errore esplicito** o **valore derivato dal tenant**. Picnic deve restare solo come *template* (Mossa 2), mai come ripiego runtime.

**A — Fallback pericolosi (→ errore esplicito):**
- `src/app/api/sync-kb-retell/route.ts:16-28` — rimuovere `TENANT_CONFIG_FALLBACK` (Picnic). Se manca `settings.retell` → errore "Run onboarding first".
- `src/app/api/sync-vapi-voicemail/route.ts:7-12` — rimuovere `TENANT_VAPI_FALLBACK`. Se manca `settings.vapi.assistantId` → errore.
- `src/app/api/ai/waitlist-process/route.ts:48` — `owner_phone || '+34641790137'` → leggere da tenant, errore se assente.

**B — Webhook hardcoded (→ derivare dal tenant):**
- `src/app/api/conversations/resume-bot/route.ts:4` — `PICNIC_WEBHOOK` fisso → costruire `…/webhook/${tenant.slug}-whatsapp` dal tenant del guest.

**C — Default UI/testo (→ placeholder neutro o `tenant.name`):**
- `src/components/settings/GeneralTab.tsx:71-78` — `DEFAULT_VOICEMAIL` con "restaurante Picnic" (es/en/it/de) → placeholder `{nome ristorante}` o vuoto.
- `src/components/settings/GeneralTab.tsx:479` — placeholder `+34641790137` → generico `+XX …`.
- `src/app/api/sync-vapi-voicemail/route.ts:117` — `"Hola, restaurante Picnic."` → `tenant.name`.
- `src/app/(dashboard)/pending/page.tsx:303` — numero Picnic nel msg di rifiuto → `settings.restaurant_phone`.
- `src/app/(dashboard)/pending/page.tsx:260` — notifica owner a `+34641790137` (bug noto, oss. #3340) → `settings.owner_phone`.
- `src/app/(dashboard)/reservations/page.tsx:379` — `owner_phone || '+34641790137'` → errore/derivazione.
- `src/lib/i18n/dictionaries/{es,en,it,de}.ts` (~480) — hint con `+34641790137` → placeholder generico.

**D — NON toccare (è il template, vedi Mossa 2):** `src/lib/onboarding/substitute.ts`, `orchestrator.ts:54-69`.
**E — Innocui (lasciare):** test `restaurant-rules.test.ts`, trello-sync (scope Picnic-only voluto), commenti.

**Verifica:** creare un tenant di test SENZA config Retell/Vapi → le sync devono dare errore chiaro, non comportarsi come Picnic. Poi cancellare il tenant di test.

---

### MOSSA 1B — Focus ristorante: semplificare la registrazione
**Stato: ✅ fatto** · Rischio: basso · Effort: S · **Impatto: ALTO sulla narrativa** (un verticale = storia investitori forte)

> **Fatto:** rimosso del tutto il selettore di tipo-attività da `/register` (il form parte subito); `business_type` forzato a `"restaurant"` in `register-tenant` (anche se il client invia altro). La colonna `business_type` resta nel DB come gancio dormiente. Nessuna chiave i18n per-verticale orfana da togliere (le label del selettore erano hardcoded in inglese, non i18n).

Rendere il prodotto onesto e focalizzato: questo è il CRM ristoranti, non una piattaforma multi-settore vuota.
- `src/app/register/page.tsx` (~36, dropdown 55-83): rimuovere le opzioni `ecommerce` e `services`; lasciare solo ristorante (o togliere del tutto il selettore e fissare `restaurant`).
- `src/app/api/register-tenant/route.ts:18`: forzare `business_type = "restaurant"` (non leggerlo da form non fidato).
- i18n: rimuovere/neutralizzare le label `auth_business_type` relative agli altri tipi se restano orfane.
- **NON rimuovere** la colonna `business_type` dal DB: resta come gancio dormiente (visione futura = sistemi separati, ma il campo non dà fastidio).

**Verifica:** un nuovo utente su `/register` può creare solo un ristorante; il tenant nasce con `business_type="restaurant"`. Cancellare il tenant di test.

---

### MOSSA 2 — Promuovere Picnic da "cliente" a "Template Ufficiale"
**Stato: ✅ fatto** · Rischio: basso-medio · Effort: M · È il **primo gradino del trampolino**

> **Fatto:** rinominate le costanti `PICNIC_*` → `TEMPLATE_RESTAURANT_*` in `substitute.ts` (9 costanti) e `PICNIC_WORKFLOW_IDS` → `TEMPLATE_RESTAURANT_WORKFLOW_IDS` in `orchestrator.ts`. Aggiunti commenti "golden-source rule" (le patch al comportamento bot vanno fatte sul template, mai sul singolo cliente). Rimossa la costante morta `PICNIC_TENANT_ID` in `orchestrator.ts` (definita, mai usata). `business_type` resta hardcoded a `restaurant` con commento "single vertical by design". `trello-sync` lasciato com'è (scope Picnic-only voluto, cat. E di Mossa 1). I literal regex `picnic-*`/`PICNIC`/`[Picnic]` restano verbatim: matchano il testo ancora dentro i workflow live del template, rinominarli romperebbe la sostituzione. Pure rename → comportamento identico (stessi 13 ID, stessi valori sostituiti). Verifica: `tsc` exit 0 + 62/62 test (nessun onboarding live eseguito per non creare workflow/agenti reali; il cambiamento è solo-nomi quindi i test coprono).

Oggi `orchestrator.ts` clona da `PICNIC_WORKFLOW_IDS` e `substitute.ts` ha costanti `PICNIC_*`. Concettualmente Picnic *è già* il template, ma travestito da cliente. **Dato il focus ristorante-only (Mossa 1B), c'è UN SOLO template** — niente mappa multi-business da costruire ora.

- Rinominare le costanti `PICNIC_*` → `TEMPLATE_RESTAURANT_*` in `orchestrator.ts` e `substitute.ts` (chiarezza: è il "template ristorante v1", non il cliente Picnic). Comportamento invariato.
- Aggiungere un commento/struttura che renda ovvio che questo è IL template ufficiale e che ogni patch va fatta lì (golden source), mai sul singolo cliente.
- `business_type` resta letto ma con un solo valore valido (`restaurant`) → predispone il gancio senza costruire varianti inesistenti.
- (Quando/se servirà un secondo template, sarà un *sistema separato* per scelta utente — non una mappa qui dentro.)

**File:** `src/lib/onboarding/orchestrator.ts` (54-69, 257-283), `src/lib/onboarding/substitute.ts` (10-18).
**Verifica:** onboarding di un tenant `restaurant` produce gli stessi 13 workflow di oggi (nessuna regressione); il codice non nomina più "Picnic" come cliente ma come template ristorante.

---

### MOSSA 3 — CRM adattabile: interruttori di funzionalità (feature flags)
**Stato: ✅ fatto** · Rischio: basso · Effort: M · **È il punto che l'utente vuole di più** ("adattabile a più esigenze fin dall'inizio")

> **Fatto:** creato il tipo `TenantSettings` + blocco `features` (7 flag) in `src/lib/types/tenant-settings.ts` con `DEFAULT_FEATURES`, `FEATURE_FLAGS` (lista per la UI) e l'helper `getFeatures()` (unica fonte: app e futuro motore leggono i flag da qui). `Tenant.settings` ora è tipato (`index.ts`) ma resta retro-compatibile (index signature `[key]: any` → i tanti `(as any)` esistenti non si rompono). Nuovo tab **Funzionalità** in `/settings` (`FeaturesTab.tsx`): toggle semplici sì/no (no rule-builder, rispetta `feedback_no_power_user_features`), visibile a owner + platform_admin, salva fondendo nei settings senza toccare gli altri campi + `refreshActiveTenant()`. **Filo collegato end-to-end:** il flag `waitlist_enabled` nasconde/mostra la voce "Lista d'attesa" nella Sidebar — config che cambia comportamento, zero codice per cliente. Default scelti per NON cambiare il comportamento attuale (waitlist/doppio turno/multilingua ON). i18n in es/en/it/de. Verifica: `tsc` 0, 67/67 test (5 nuovi su `getFeatures` default/merge), `next build` 0. Il **motore n8n/Retell** che legge i flag a runtime è Mossa 6 (motore unico): qui il filo è dimostrato lato CRM.
>
> **Aggiornamento 2026-05-21 — tutti gli interruttori ora fanno qualcosa.** Su richiesta dell'utente (cameriere esperto: i 4 flag-fatto sono ad alta probabilità di richiesta, meglio front-loadarli) NON li abbiamo rimossi. Wiring reale: `waitlist_enabled`→Sidebar (già), `multi_room`→pulsante aggiungi-zona nella pianta tavoli (sicuro: zone esistenti mai nascoste), `double_shift`→selettore Pranzo/Cena (off = servizio unico, tutte le prenotazioni insieme). Gli altri 4 (`terrace`/`pet_friendly`/`events_enabled`/`multi_language`) sono "fatti" che l'assistente racconta agli ospiti → helper `restaurantFacts()` + blocco `facts` in ogni risposta di `/api/ai/restaurant-info` (config che l'assistente legge, non testo KB per cliente). Il consumo guest-facing pieno di quei 4 arriva con la Mossa 6, ma la config ora c'è ed è verificabile (curl).

Aggiungere a `tenants.settings` un blocco **`features`** (booleani) che accende/spegne comportamenti, così le varianti diventano configurazione invece di codice. Quando dimenticheremo una variante, si aggiunge **un interruttore al template una volta** → tutti i clienti futuri ce l'hanno.

- Definire un tipo TypeScript `TenantSettings` con `features` (oggi `settings` è `any` ovunque) e usarlo nei punti critici. File nuovo suggerito: `src/lib/types/tenant-settings.ts`; estendere `Tenant` in `src/lib/types/index.ts:12-21`.
- Set iniziale di flag (da confermare con l'utente, vedi "Registro varianti"): `waitlist_enabled`, `multi_room`, `double_shift`, `multi_language`, `events_enabled`, `pet_friendly`, `terrace`. Default sensati per ristorante medio.
- UI: nuova sezione/tab in `src/components/settings/` (riusa pattern GeneralTab save → `refreshActiveTenant()`), togglabile dall'owner e dal platform_admin (impersonation).
- Il **motore** (workflow/prompt) deve leggere questi flag e comportarsi di conseguenza — qui è dove il "trampolino" conta: la logica condizionale vive in un punto leggendo i flag dal DB, non in copie diverse per cliente.

**Verifica:** accendere `waitlist_enabled` su un tenant di test → il comportamento lista d'attesa cambia solo per lui, senza toccare codice né altri tenant. Spegnerlo → torna come prima.

---

### MOSSA 4 — Registro varianti (il criterio del "giorno della fusione")
**Stato: ✅ fatto** · Rischio: nessuno · Effort: XS · È la **bussola per decidere quando fare il motore unico**

> **Fatto:** creato `docs/REGISTRO_VARIANTI.md` con la tabella a 3 colonne (variante · cliente · risolta come), le 3 modalità 🟩flag/🟦template/🟥custom + regola d'oro ("2 clienti chiedono la stessa cosa custom → promuovila a flag una volta"), il criterio del "giorno della fusione" (3-4 clienti di fila con 0 varianti nuove), e 13 varianti note pre-popolate (orari/turni/lista d'attesa/sale/eventi/lingue/terrazza/animali/segreteria/menù/voce/valuta/numero WA) per mostrare che l'elenco è finito e già in gran parte coperto.

Creare `/Users/amplaye/CRM/docs/REGISTRO_VARIANTI.md`: una tabella dove ogni volta che un cliente chiede qualcosa che il motore non fa, si segna. Tre colonne: *variante richiesta · cliente · risolta come (flag/template/custom-a-pagamento)*.
- Serve a dimostrare che le esigenze NON sono infinite (curva che si appiattisce) — arma con investitori.
- Il "giorno della fusione" al motore unico = quando 3-4 clienti di fila aggiungono 0 varianti nuove.
- Pre-popolare con le varianti note (orari/sale/turni/lista d'attesa/eventi/lingue) per mostrare che è un elenco finito.

---

### MOSSA 5 — Automazione Twilio/WhatsApp + stato tenant
**Stato: 🔄 in corso** (stato tenant ✅ · Twilio ⏸️) · Rischio: medio · Effort: M-L

Due gap che bloccano il "più clienti attivi insieme". **La parte "stato tenant" è fatta** (2026-05-21); la parte Twilio resta in attesa dei clienti reali.

> **✅ FATTO — Stato tenant (scoperta #3 + #2).** Aggiunta la colonna `tenants.status` (`pending`/`trial`/`active`/`suspended`, default `active`, applicata via Management API — il presunto blocco "DDL non applicabile" della sessione prima era falso: esiste un token Management per BaliFlow). **Una sola fonte di verità** in `src/lib/tenants/status.ts` (`tenantReceivesTraffic`, `TENANT_STATUSES`, `isTenantStatus`), letta da app + admin + futuro motore. **Gate sul traffico** in un solo punto-imbuto: `src/app/api/webhooks/route.ts` rifiuta (403) un tenant non live (`pending`/`suspended`) → non consuma AI/conversazioni. **3 vie di creazione unificate** in un solo helper `src/lib/tenants/create-tenant.ts` (self-signup→`trial`, demo guest→`active`, wizard admin→`active`), così lo stato iniziale è coerente. **Admin:** stato visibile + modificabile (badge + dropdown) sulla pagina tenant `/admin/tenant/[id]` (solo platform_admin; PATCH ora protetto da `assertPlatformAdmin`). I 3 tenant demo restano `active` (comportamento invariato). Test live: tenant sospeso→403, attivo→passa il gate; self-signup→`trial`; dati di test cancellati. tsc 0, 74/74 test (7 nuovi), build 0.

> **⏸️ RESTA — Twilio manuale (gated ai clienti reali).** Oggi un solo numero attivo (sandbox) — vedi `reference_onboard_wizard.md`. Automatizzare l'assegnazione del canale WhatsApp per tenant (numero dedicato o routing per slug) dentro l'orchestrator. Da fare quando arrivano i primi clienti veri (numeri reali, non sandbox).

**Verifica (parte Twilio):** due tenant attivi contemporaneamente ricevono e rispondono ai propri messaggi WhatsApp senza interferenze.

---

### MOSSA 6 (FUTURA) — Migrazione al motore unico (Opzione A)
**Stato: ⬜ futuro** · Da decidere SOLO quando Mossa 4 segnala che le varianti si sono stabilizzate

Spostare la logica condivisa dai 13 workflow clonati a **un set unico** che legge il tenant + i suoi flag dal DB. Requisiti per farlo in sicurezza (la storia "affidabile"):
- **Rollout graduale** (1% → 10% → 50% → 100%), non big-bang.
- **Backup/ridondanza** per il rischio "crash core" (l'unico vero contro del motore unico).
- Migrazione = spostare logica già testata sui clienti veri (grazie al trampolino), non riscriverla.

---

## ORDINE CONSIGLIATO & DIPENDENZE

```
Mossa 0 (doc)  ─┐
Mossa 1 (pulizia Picnic) ── indipendente, FARE PER PRIMA (alto impatto, basso rischio)
Mossa 1B (focus ristorante: registrazione) ── indipendente, piccola, alto impatto narrativa
Mossa 2 (template ufficiale, 1 solo) ── richiede concettualmente Mossa 1 + 1B fatte
Mossa 3 (feature flags) ── indipendente, ma il motore (Mossa 2) deve leggerli
Mossa 4 (registro varianti) ── farla presto, è solo un doc, guida tutto il resto
Mossa 5 (Twilio + stato) ── quando arrivano clienti reali
Mossa 6 (motore unico) ── FUTURO, gated dal segnale della Mossa 4
```

**Prossimo passo immediato (default se mi dici "vai"):** Mossa 0 (allineare doc) + Mossa 1 (pulizia fallback Picnic) + Mossa 1B (focus ristorante). Piccole, sicure, alto impatto.

---

## VINCOLI DI LAVORO (preferenze utente, da rispettare sempre)

- **Lingua:** italiano. Utente **non-tecnico** — spiegare con parole semplici, niente gergo non spiegato.
- **Branch:** lavorare SEMPRE su `main`, no feature branch (fase demo, nessun cliente reale) — vedi `feedback_baliflow_crm_no_branches`.
- **Commit + push automatici** a fine task — vedi `feedback_always_commit_push`.
- **Just fix:** non chiedere prima di fixare cose ovvie; agire e riassumere alla fine — vedi `feedback_just_fix`, `feedback_silent_execution`.
- **Test loop completo** + cleanup dei dati di test creati — vedi `feedback_test_loop`.
- **No business-policy initiative:** non cambiare valori di policy nel DB (soglie, telefoni, orari) per testare — vedi `feedback_no_business_init`.
- **No power-user features** per utenti non-tecnici (niente builder di regole/automazioni esposti al ristoratore) — vedi `feedback_no_power_user_features`.
- **Next.js "non quello che conosci":** leggere `node_modules/next/dist/docs/` prima di scrivere codice Next — vedi `/Users/amplaye/CRM/AGENTS.md`.
- **Vercel:** funzioni stateless, segreti in env, no KV/Postgres Vercel — vedi `/Users/amplaye/CRM/CLAUDE.md`.

## VERIFICA GLOBALE (come provare che è "più SaaS" dopo ogni mossa)

1. Creare un tenant di test (via `/register` o wizard) con `business_type` scelto.
2. Onboarding completo senza toccare codice → tenant attivo.
3. Cambiare una variante via feature flag → comportamento cambia solo per quel tenant.
4. Nessun riferimento runtime a Picnic se la config manca → errore chiaro, non comportamento-Picnic.
5. Cancellare i dati di test.
6. `git add -A && git commit && git push` (su main).

---

## 📒 LOG AVANZAMENTO (aggiornato a ogni fase completata)

> Formato riga: `AAAA-MM-GG — Mossa N — cosa fatto — commit <hash>`. La riga più recente in cima.

- 2026-05-21 — Mossa 3 (estensione: interruttori → comportamento) — collegati i flag finora "decorativi" a comportamenti REALI, così ogni interruttore visibile fa qualcosa. **`multi_room`** → pulsante "aggiungi zona/sala" nella pianta tavoli (`floor/page.tsx`): se off = ristorante a sala unica, niente gestione zone; se on = puoi crearle. Sicuro: le zone già esistenti restano sempre visibili (`canManageZones = features.multi_room || zones.length > 1`), niente sparisce. **`double_shift`** → selettore Pranzo/Cena (`floor/page.tsx`): se off = servizio unico, il toggle sparisce e si vedono tutte le prenotazioni del giorno insieme (mai nascoste). Default on → comportamento invariato. **`terrace`/`pet_friendly`/`events_enabled`/`multi_language`** → sono "fatti" che l'assistente racconta agli ospiti: nuovo helper `restaurantFacts()` in `tenant-settings.ts` e blocco `facts` aggiunto a ogni risposta di `/api/ai/restaurant-info` (config → l'assistente li legge, non testo KB scritto a mano per cliente). **Decisione utente (cameriere esperto):** NON rimuovere i 4 flag-fatto (alta probabilità di richiesta dai ristoranti reali → front-load capacità ora = meno lavoro dopo); diverso dalle "porte dipinte" della Mossa 1B (quelle erano verticali sbagliati, mai in arrivo; questi sono feature giuste in arrivo). Verifica: tsc 0, 76/76 test (+2 su `restaurantFacts`), `next build` 0, curl live a `restaurant-info` → blocco `facts` presente e derivato dai flag del tenant (nessun dato mutato). — commit <hash>
- 2026-05-21 — Mossa 5 (parte "stato tenant") — colonna `tenants.status` (pending/trial/active/suspended, default active) via Management API; fonte unica `src/lib/tenants/status.ts` (`tenantReceivesTraffic`); gate traffico in `src/app/api/webhooks/route.ts` (403 se non live → non consuma); creazione tenant unificata in `src/lib/tenants/create-tenant.ts` (self-signup→trial, demo→active, wizard→active); admin: stato visibile+modificabile su `/admin/tenant/[id]` (PATCH protetto da assertPlatformAdmin). 3 demo tenant restano active. Test live: sospeso→403/attivo→passa, self-signup→trial, cleanup ok. tsc 0, 74/74 (7 nuovi), build 0. Resta solo l'automazione Twilio (gated ai clienti reali). — commit 12477df
- 2026-05-21 — Mossa 3 — feature flags: nuovo tipo `TenantSettings` + blocco `features` (7 flag) in `src/lib/types/tenant-settings.ts` (`DEFAULT_FEATURES`, `FEATURE_FLAGS`, helper `getFeatures()`), `Tenant.settings` tipato e retro-compatibile, tab **Funzionalità** in `/settings` (`FeaturesTab.tsx`, toggle semplici per owner+platform_admin), flag `waitlist_enabled` collegato alla Sidebar (config→comportamento, zero codice per cliente), i18n es/en/it/de. Default = comportamento attuale invariato. Test: tsc 0, 67/67 (5 nuovi su `getFeatures`), `next build` 0. — commit de787c2
- 2026-05-21 — Mossa 4 — creato `docs/REGISTRO_VARIANTI.md`: tabella 3 colonne + 3 modalità (flag/template/custom) + regola d'oro + criterio "giorno della fusione" + 13 varianti note pre-popolate (elenco finito, già in gran parte coperto). — commit de787c2
- 2026-05-21 — Mossa 2 — Picnic promosso a Template Ufficiale: rinominate costanti `PICNIC_*` → `TEMPLATE_RESTAURANT_*` (substitute.ts + orchestrator.ts), aggiunti commenti golden-source, rimossa costante morta `PICNIC_TENANT_ID` da orchestrator, `business_type` annotato "single vertical by design". Rename behavior-preserving (literal regex `picnic-*`/`PICNIC`/`[Picnic]` lasciati verbatim — matchano il contenuto live del template). Test: tsc exit 0, 62/62 test verdi. — commit f9986c6
- 2026-05-21 — Mossa 1B — focus ristorante: tolto il selettore tipo-attività da `/register` (form diretto, niente ecommerce/services); `business_type` forzato a `restaurant` in `register-tenant`. Test: pagina senza selettore + API crea sempre `restaurant` anche se inviato `ecommerce`; tenant+utente di test cancellati. — commit 02dc704
- 2026-05-21 — Mossa 1 — rimossi tutti i ripieghi Picnic runtime (sync-kb-retell, sync-vapi-voicemail, waitlist-process → errore esplicito; resume-bot → webhook da slug derivato dal nome; default voicemail e telefoni → neutri/dal tenant; hint i18n generici). Scoperte: niente colonna `slug` (derivato dal nome) + config Picnic viveva solo nei ripieghi → **migrata nelle settings di Picnic** (stessi valori). Test loop: tenant senza config → 3 errori "Run onboarding first"; Picnic supera il gate; tenant di test cancellato. tsc OK, 62/62 test. — commit 02dc704
- 2026-05-21 — Mossa 0 — bussola `docs/SAAS_ARCHITECTURE.md` allineata (clone-trampolino, registro varianti + criterio fusione, focus ristorante-only, 3 scoperte tecniche); PDF rigenerato in `~/Downloads/SAAS_ARCHITECTURE.pdf` (387KB). — commit 02dc704
- _(piano creato il 2026-05-21.)_
