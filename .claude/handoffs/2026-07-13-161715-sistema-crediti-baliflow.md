# Handoff: Sistema Crediti BaliFlow CRM — SHIPPED (manca solo il deploy del gate n8n)

## Session Metadata
- Created: 2026-07-13 16:17:15
- Project: /Users/amplaye/CRM
- Branch: `feature/verifactu` (ma **il lavoro crediti è su `main`**, vedi Gotchas)
- Session duration: ~3h

### Recent Commits (for context)
  - d7359e4 VeriFactu: la cassa diventa un SIF spagnolo — **NON MIO** (altra sessione, committato mentre lavoravo)
  - 6ea2cc2 Crediti: metering translate-note, ricarica manuale per tenant (admin), icona Coins — **MIO**
  - 5c65c47 Sistema crediti: catalogo, metering runtime, API, badge topbar e tab Impostazioni — **MIO**
  - 2370776 Marketing email: campagne send-only (no-reply)
  - ea10d3e Marketing: campagne cliccabili + identità mittente email

## Handoff Chain

- **Continues from**: [2026-07-11-194613-website-templates-colors-menu-overlay.md](./2026-07-11-194613-website-templates-colors-menu-overlay.md)
  - Previous title: Website templates — palette per-sezione (6 colori), fix bottone Trattoria, widget overlay, menù in-site (SHIPPED)
- **Supersedes**: None

## Current State Summary

Ho costruito **da zero il sistema di crediti prepagati** del CRM (piano: `~/.claude/plans/creami-questo-sistema-di-golden-lemur.md`). Prima di questa sessione il CRM **non misurava nulla** di ciò che consumava: ogni chiamata OpenAI, ogni conversazione Meta, ogni minuto di voce era un costo vivo senza tetto (`/api/admin/usage` *fingeva* di misurare: contava righe DB × costanti hardcoded).

Ora: 2 tabelle + 2 RPC atomiche, catalogo prezzi puro, metering su **9 call-site reali**, badge in topbar (realtime), tab Impostazioni → Crediti, ricarica Stripe, reset mensile, e ricarica manuale per-tenant dall'admin.

**Tutto committato e pushato su `main` (5c65c47 + 6ea2cc2). Migration applicata sul DB live e testata.**

**L'UNICA cosa non finita: il gate nel motore n8n è scritto, validato (dry-run + `node --check`) ma NON DEPLOYATO** perché il server n8n rifiuta l'handshake TLS (è giù). Vedi "Immediate Next Steps".

## Codebase Understanding

## Architecture Overview

**Modello economico**: 1 credito = €0,20. Salvato in **millicrediti** (`bigint`, 1 cr = 1000 mc) — mai float. Un messaggio bot costa 0,04 cr = 40 mc; come float, sottratto centinaia di migliaia di volte, il saldo driftterebbe. Come intero, no.

**Due tipi di credito**:
- `included_remaining_mc` — quota del piano, **resettata** a ogni rinnovo (use-it-or-lose-it). Premium 2.000 cr/mese, Business 1.250.
- `purchased_remaining_mc` — comprati (pacchetti Stripe one-off) o regalati dall'admin. **Non scadono mai.**
- Ordine di spesa: **prima gli inclusi, poi gli acquistati** (i perituri per primi — è quello che sceglierebbe il cliente).

**A crediti zero si blocca SOLO ciò che costa** (bot WhatsApp, voce, campagne, OCR, import menu, generazioni AI). **Prenotazioni, tavoli, ospiti, POS continuano a funzionare.** Un ristorante non deve mai smettere di lavorare per un problema di billing.

**Fail-OPEN nel metering** (al contrario di `guard.ts` che è fail-CLOSED): se Supabase fa un blip o la RPC manca, l'azione **passa** e ci mangiamo i centesimi. Un bug del *nostro* metering non deve zittire il bot durante il servizio. `guard.ts` fallisce chiuso perché è un gate su feature *pagate*; il metering è un *contatore*, non un cancello.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `supabase/migrations/20260713_credits.sql` | Tabelle `credit_balances` + `credit_events`, RPC `consume_credits` + `grant_credits`, RLS, publication realtime | **Già applicata sul DB live** e testata |
| `src/lib/billing/credits-catalog.ts` | Catalogo puro: `ACTION_MC`, `PLAN_CREDITS_MC`, `CREDIT_PACKS`, `mcFor()`, `formatCredits()` | Unica fonte di verità dei prezzi. Importato sia da server sia da client |
| `src/lib/billing/credits.ts` | Runtime: `assertCredits()` (gate, non addebita), `consumeCredits()` (addebita, RPC atomica), `grantPurchasedCredits()`, `resetIncludedCredits()`, `getCreditBalance()` | Il pattern `assertX → NextResponse\|null` ricalca `guard.ts` |
| `src/lib/billing/credits-catalog.test.ts` | 23 test | Hanno pescato un bug vero (vedi Gotchas) |
| `src/app/api/credits/{balance,events,consume}/route.ts` | API tenant-scoped. `/consume` è per il motore n8n (auth `x-ai-secret`) | `/consume` **CHECK+DEBIT in un colpo solo** (vedi Decisioni) |
| `src/app/api/admin/credits/route.ts` | GET saldo + POST ricarica/storno per-tenant (`assertPlatformAdmin`) | L'unico modo di dare crediti |
| `src/app/api/cron/credits-reset/route.ts` | Backstop giornaliero del reset mensile | Cron in `vercel.json` (`20 5 * * *`) |
| `src/components/layout/CreditsBadge.tsx` | Badge topbar, realtime, rosso sotto il 10% | Icona `Coins` |
| `src/components/settings/CreditsTab.tsx` | Saldo + 3 pacchetti + **tabella prezzi** + storico | La tabella prezzi è generata da `ACTION_MC`: non può divergere dall'addebito |
| `N8N/picnic/deploy_credits_gate.mjs` | **Script di deploy del gate nel motore 166 — DA ESEGUIRE** | Gitignored (`N8N/`). Idempotente |

### Key Patterns Discovered

- **`grant_credits` è REVOCATA da `authenticated`/`anon` a livello DB** (`grant execute ... to service_role` only). Verificato sul DB live. Un tenant loggato **non può auto-ricaricarsi** anche se chiamasse la RPC direttamente.
- **`credit_balances` è nella publication `supabase_realtime`** (come `tenants`, che ha avuto bisogno della stessa migration). Senza, il badge si iscrive con successo e poi **non riceve niente in silenzio**.
- Il webhook Stripe discrimina con `metadata.kind` (`deposit` | `gift_card` | `plan` | `addon` | `bundle` | **`credits`** nuovo).
- Cron Vercel Hobby: **solo minuto+ora fissi** (no `*/N`) o il deploy fallisce.
- i18n: `Dictionary = typeof en` → una chiave nuova va messa in **tutti e 4** i dizionari (en/it/es/de) o `tsc` fallisce.

## Work Completed

### Tasks Finished

- [x] Migration DB (2 tabelle, 2 RPC atomiche, RLS, realtime publication) — **applicata sul live e testata**
- [x] `credits-catalog.ts` puro + 23 test
- [x] `credits.ts` (gate + consumo + grant + reset)
- [x] 4 route API (`/credits/balance`, `/events`, `/consume`, `/cron/credits-reset`)
- [x] Metering su **9 call-site**: invoice OCR, transcribe, marketing/generate, reviews/suggest-reply, conversation-summary, **translate-note**, marketing send (WA+email), menu import, **voce (end-of-call)**
- [x] Checkout pacchetti crediti + branch `credits` nel webhook Stripe + reset su `invoice.paid`
- [x] Badge topbar (realtime) + tab Impostazioni + i18n ×4 lingue
- [x] **Admin: ricarica/storno manuale per-tenant** (`/api/admin/credits` + card in `/admin/tenant/[id]`)
- [x] Icona crediti `Zap` → `Coins` (badge, tab, admin)
- [x] Gate n8n **scritto e validato** (dry-run OK, `node --check` OK) — **non deployato**

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `src/app/api/voice/assistant-request/route.ts` | Intercetta `end-of-call-report` (**prima veniva BUTTATO VIA**) → `meterCall()` con durata+costo reali. + gate: rifiuta di rispondere al telefono a saldo zero | La voce era il costo **più fuori controllo**: nessuno sapeva nemmeno che una chiamata fosse avvenuta. Una chiamata non si può fermare a metà → il gate deve stare al momento della risposta |
| `src/lib/marketing/send.ts` | Pre-flight sul **totale** prima del loop; consumo **per destinatario** con `costEur` = prezzo Meta reale del paese | Un check per-destinatario finirebbe i crediti al 180° di 300 → campagna mezza inviata, Meta ci ha già fatturato 180. Rifiutare **tutto** in anticipo è l'unico esito recuperabile |
| `src/app/api/translate-note/route.ts` | Gate + consumo `ai_text`; tenant risolto **server-side** dalla membership | Il componente chiamante (`TranslateNoteButton`) riceve **solo il testo**, non ha tenant. Passare `tenant_id` dal client andrebbe comunque verificato → tanto vale risolverlo lato server |
| `src/app/api/ai/conversation-summary/route.ts` | Aggiunto `tenant_id` ai `select` (**non c'era**) + gate sincrono prima di `after()` | Il job gira dopo la risposta: un rifiuto lì sarebbe invisibile al chiamante |
| `src/app/api/billing/webhook/stripe/route.ts` | Branch `kind === "credits"`; grant allowance su piano/bundle; **nuovo case `invoice.paid`** per il reset al rinnovo | Il pack si legge **dal catalogo per id**, mai dall'importo della sessione |
| `src/app/api/billing/checkout/route.ts` | `kind: "credits"` + `pack`, `mode: "payment"` | I crediti comprati non scadono → non c'è nulla di ricorrente da modellare |
| `src/lib/billing/credits.ts` | `grantPurchasedCredits` ora accetta `action` (`topup` \| `admin_grant`) | Un regalo e un acquisto pagato aggiungono entrambi crediti, ma confonderli nel ledger **farebbe mentire i ricavi** |
| `src/app/(dashboard)/admin/tenant/[id]/page.tsx` | Card Crediti: saldo, ricarica/storno + motivo, ultime ricariche | Rimettere in piedi un ristorante a secco di sabato sera (un checkout Stripe richiede minuti che non hanno) |
| `src/app/(dashboard)/settings/page.tsx` | Tab "credits" + icona `Coins` | ⚠️ **Contiene anche le tab Fiscale/Email di un'altra sessione** — vedi Gotchas |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| **Millicrediti interi**, non float | Float `0.04` | Un float sottratto 100k volte drifta. `40` no. `formatCredits()` è l'unico posto dove si divide per 1000 |
| **RPC atomica** `consume_credits` con `FOR UPDATE` | Read-then-write in app | Il bot risponde a più conversazioni **in parallelo**: due consumi concorrenti leggerebbero entrambi "40 mc rimasti", passerebbero entrambi, e andrebbero in rosso. Il row-lock serializza |
| `/api/credits/consume` **CHECK+DEBIT in una sola chiamata** | `/check` poi `/consume` | Due chiamate separate lascerebbero passare due conversazioni parallele sugli stessi ultimi 40 mc. Con una sola, decide il lock e il perdente riceve `ok:false` |
| **Fail-OPEN** nel metering | Fail-closed come `guard.ts` | Il metering è un *contatore*, non un *cancello*. Se si rompe, il ristorante deve continuare a lavorare e noi ci mangiamo i centesimi |
| Gate campagne **sul totale, in anticipo** | Per-destinatario | Vedi sopra: mezza campagna inviata non è recuperabile |
| Ledger `admin_grant` ≠ `topup` | Riusare `topup` | Confonderli falserebbe i ricavi |
| Storno **limitato a quanto ha davvero** | Permettere saldo negativo | Un saldo negativo verrebbe letto come "esaurito" **per sempre** da ogni gate |
| Tetto ricarica admin **50.000 cr** | Nessun limite | Un errore di battitura con tre zeri di troppo deve rimbalzare, non passare |
| Alert titolare **max 1 ogni 6h** | A ogni messaggio | Un sabato pieno con wallet vuoto lo spammerebbe decine di volte |
| Gate n8n **in fondo al nodo Fetch** | In un nodo nuovo / all'inizio | Deve stare **dopo** tutti gli skip (pausa bot, debounce, reset) — così non si addebita un messaggio a cui il bot non avrebbe risposto — **dopo** che `lang` è risolto (messaggio di cortesia nella lingua giusta) e **prima** del nodo OpenAI |

## Pending Work

## Immediate Next Steps

> **AGGIORNAMENTO 2026-07-13 ~16:50 (sessione di verifica).** Ricontrollati tutti i punti qui sotto.
> Risultato: **resta aperto solo il deploy del gate n8n (#1), e non per colpa nostra.**
>
> - ~~#2 env Stripe~~ e ~~#3 evento `invoice.paid`~~ → **RINVIATI SU DECISIONE DEL TITOLARE.** I prezzi
>   dei pacchetti (€19/€49/€149) sono **provvisori**: i prodotti su Stripe si creano quando i prezzi
>   saranno decisi. **Non creare prodotti/prezzi su Stripe LIVE** finché non arriva il via libera —
>   anche se `CREDIT_PACKS` in `credits-catalog.ts` li mostra come se fossero definitivi. Verificato
>   sull'account LIVE: **zero prezzi crediti** e **nessuno dei due webhook endpoint è iscritto a
>   `invoice.paid`** (il *case* `invoice.paid` nel codice c'è già, `webhook/stripe/route.ts:228` — è
>   solo Stripe che non glielo manda). Conseguenza accettata: il reset mensile dell'allowance arriva
>   dal cron giornaliero, quindi **fino a 24h di ritardo**. Non è rotto.
> - ~~blocker `settings/page.tsx` non committato~~ → **RISOLTO**: `feature/verifactu` è stato mergiato
>   in `main` (`1695df0`) e anche l'email BYO-key è dentro. Working tree pulito.
> - **Icona crediti** → cambiata: non più `Coins` di lucide ma una **moneta fisica in euro**
>   (`src/components/ui/CoinIcon.tsx`, SVG inline). Ionicons — chiesta esplicitamente — **non ha
>   nessuna icona moneta**: l'unico match su "coin" è `logo-bitcoin`. Commit `85fa10c` su `main`.

1. **DEPLOYARE IL GATE n8n** (l'unica cosa non finita). Quando `n8n.srv1468837.hstgr.cloud` torna su:
   ```bash
   cd /Users/amplaye/CRM
   N8N_API_KEY=<chiave da memory credentials.md, sezione "n8n"> node N8N/picnic/deploy_credits_gate.mjs
   ```
   È **idempotente** (marker `PATCH:credits-gate-v1`), scrive uno snapshot di rollback, fa `node --check` prima di pushare, e **si rifiuta di partire se il nodo ha cambiato forma**. Dry-run per provare senza deployare: `node N8N/picnic/deploy_credits_gate.mjs --dry`.
   Verificare poi con un E2E (`scripts/motore-e2e/`, keyword utente "stress test chat"): una conversazione normale deve scalare 40 mc/messaggio; a saldo zero il bot manda il messaggio di cortesia e **non chiama OpenAI**.

2. **Env Stripe su Vercel** (senza, il checkout ricarica risponde 503 pulito, non crasha):
   `STRIPE_PRICE_CREDITS_500`, `STRIPE_PRICE_CREDITS_1500`, `STRIPE_PRICE_CREDITS_5000`

3. **Aggiungere l'evento `invoice.paid`** all'endpoint webhook Stripe. Senza, il reset mensile dell'allowance arriva **solo** dal cron di backup (`/api/cron/credits-reset`, giornaliero) — funziona, ma con un giorno di ritardo.

### Blockers/Open Questions

- [ ] **n8n irraggiungibile — BLOCCANTE, ancora aperto.** Ri-diagnosticato il 2026-07-13 ~16:45, più
  preciso di prima: **non è "il TLS che viene rifiutato", è il server che non parla proprio.**
  - TCP sulla 443 si apre, ma l'handshake muore con `SSL handshake has read 0 bytes and written 1564`:
    gli mandiamo il ClientHello e **lui non risponde un solo byte**. Non è un errore TLS, è silenzio.
  - **Porta 80: nessuna risposta.** **ICMP: 100% packet loss.** Non risponde su *niente*.
  - DNS coerente su locale, `8.8.8.8` e `1.1.1.1` → `187.124.30.125` (record autoritativo, non è
    avvelenamento DNS locale).
  - **Non è la nostra rete**: `crm.baliflowagency.com` risponde `307` dalla stessa macchina nello
    stesso istante.
  - ⚠️ Correzione a una nota precedente: *non* è il caso "openssl funziona, LibreSSL/curl no". **Non
    funziona con nessuno dei due.** Se una sessione passata ha concluso il contrario, era un
    artefatto: `s_client` stampa `Verification: OK` e `Protocol: TLSv1.3` **anche quando l'handshake
    fallisce**, e lì sotto c'è `Cipher is (NONE)`.
  - **Conclusione: è giù l'intera VPS Hostinger, non solo n8n o il suo reverse proxy.** Fuori dal
    nostro controllo: va riacceso il server (o rifatto puntare il DNS). Nessuna azione possibile da
    qui — lo script di deploy è pronto e idempotente, si lancia appena l'host risponde.
- [x] ~~`settings/page.tsx` non committato~~ → **RISOLTO**: mergiato in `main` con `1695df0`.

### Deferred Items

- **Colonna "Crediti" nella tabella tenant dell'admin home** (`/admin`): richiederebbe di aggiungere il saldo a `/api/admin/overview`. Non richiesto, non fatto.
- **Metering di `sendWhatsAppTemplate` globale** (reminder, no-show, follow-up recensioni): oggi si misurano solo le campagne marketing. I template transazionali costano comunque a Meta. Non richiesto.

## Context for Resuming Agent

## Important Context

**Il lavoro crediti è su `main` (5c65c47 + 6ea2cc2), MA il branch checked-out è `feature/verifactu`.** Entrambi puntavano allo stesso commit a un certo punto; poi un'altra sessione ha committato VeriFactu (`d7359e4`) sopra. Prima di committare qualsiasi cosa: **controlla su che branch sei e cosa stai per staggiare.**

**NEL WORKING TREE C'È LAVORO DI ALTRE SESSIONI, NON COMMITTATO** (VeriFactu/cassa/fiscal, email BYO-key Resend). **NON fare `git add -A`** — trascineresti dentro lavoro altrui a metà. Io ho staggiato solo i miei file, uno per uno.

**Due test rossi nel repo NON sono miei**: `src/lib/types/tenant-settings.test.ts` (FEATURE_FLAGS: il file ha guadagnato un flag che il test non si aspetta ancora) e `src/lib/email/live-roundtrip.manual.test.ts` (test *manuale* che richiede rete live). Appartengono al lavoro email/VeriFactu in corso. **I miei: 105/105 billing verdi, tsc pulito, build ok.**

## Assumptions Made

- Il progetto lavora **direttamente su `main`** (memoria: `feedback_baliflow_crm_no_branches` — fase demo, nessun cliente reale). Ho pushato su `main`.
- I prezzi per azione (`ACTION_MC`) e i pacchetti sono quelli **già decisi col cliente** nel piano. Non li ho rinegoziati.
- `costEur` è una **stima** del nostro costo vivo, tranne per WhatsApp marketing (prezzo Meta reale per paese via `whatsappPriceForPhone()`) e voce (`cost` reale da Vapi).

## Potential Gotchas

- ⚠️ **`toLocaleString("es-ES")` NON mette il separatore sui numeri a 4 cifre.** Un saldo di 1.847 crediti sarebbe uscito come `"1847"` mentre 12.500 usciva `"12.500"` — due convenzioni sulla stessa schermata. Risolto con `useGrouping: "always"` in `formatCredits()`. **I test l'hanno pescato**, non io.
- ⚠️ La tabella **`campaigns` NON ha una colonna `error`** (e non è nemmeno nel SQL del repo — vive solo sul DB live, come `atomic_book_tables`). Non provare a scriverci sopra.
- ⚠️ `credit_balances` **deve stare nella publication `supabase_realtime`** o il badge si iscrive e non riceve nulla, **in silenzio**.
- ⚠️ Nel motore n8n, `this.helpers.httpRequest` **lancia** sui non-2xx: senza `ignoreHttpStatusErrors: true` il 403 `credits_exhausted` finirebbe nel catch → fail-open → un tenant senza crediti continuerebbe a bruciare il nostro budget OpenAI. È nel gate, non toglierlo.
- ⚠️ Una nuova chiave i18n va in **tutti e 4** i dizionari o `tsc` fallisce (`Dictionary = typeof en`).
- ⚠️ Supabase Management API dietro Cloudflare: serve uno **User-Agent da browser** o risponde 403 (code 1010).
- Il token Management API del CRM è **specifico per progetto** (`azhlnybiqlkbhbboyvud`) — in `credentials.md` sotto "BaliFlow CRM (Supabase)", **non** quello di RaffleMania in cima al file.

## Environment State

### Tools/Services Used

- **Supabase** (`azhlnybiqlkbhbboyvud`): migration applicata via Management API SQL endpoint. Testata la RPC (atomicità, ordine di spesa, RLS, grants). **Dati di test ripuliti** (0 righe in entrambe le tabelle).
- **n8n** (`n8n.srv1468837.hstgr.cloud`): **GIÙ** (TLS refused). Motore unico = workflow `166QnQsGHqXDpBxa`, nodo `Fetch History + Check Availability`.
- **Stripe**: pacchetti crediti da configurare (env, vedi Next Steps).
- Git: `main` = 6ea2cc2 (pushato).

### Active Processes

- Nessuno. (Mai `npm run dev` in questo progetto — usa `npx tsc --noEmit`, `npx vitest run`, `npm run build`, uno alla volta.)

### Environment Variables

Nomi soltanto (valori: Vercel / `credentials.md`, MAI in git):
- `STRIPE_PRICE_CREDITS_500`, `STRIPE_PRICE_CREDITS_1500`, `STRIPE_PRICE_CREDITS_5000` — **da creare**
- `AI_WEBHOOK_SECRET` (auth `x-ai-secret` per `/api/credits/consume`), `CRON_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `STRIPE_WEBHOOK_SECRET`
- `N8N_API_KEY` (per lo script di deploy del gate)

## Related Resources

- Piano originale: `~/.claude/plans/creami-questo-sistema-di-golden-lemur.md`
- Migration: [supabase/migrations/20260713_credits.sql](../../supabase/migrations/20260713_credits.sql)
- Catalogo: [src/lib/billing/credits-catalog.ts](../../src/lib/billing/credits-catalog.ts)
- Runtime: [src/lib/billing/credits.ts](../../src/lib/billing/credits.ts)
- Deploy gate n8n: `N8N/picnic/deploy_credits_gate.mjs` (gitignored)
- Memoria: `reference_stress_test_chat.md` (E2E motore), `reference_supabase_mgmt_cloudflare_ua.md`, `reference_crm_atomic_book_tables_rpc.md`, `feedback_no_dev_server.md`

---

**Security Reminder**: nessun segreto in questo file — solo NOMI di env var e riferimenti a `credentials.md`.
