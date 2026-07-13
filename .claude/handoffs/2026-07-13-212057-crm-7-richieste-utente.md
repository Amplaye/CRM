# Handoff: CRM — 7 richieste utente (staff, buoni regalo, clienti, notifiche, widget, scanner)

## Session Metadata
- Created: 2026-07-13 21:20:57
- Project: /Users/amplaye/CRM
- Branch: main
- Session duration: ~2h30 (una sessione, esecuzione autonoma senza domande)

### Recent Commits (for context)
  - 14121f7 Handoff: sessione 7 richieste CRM (staff, buoni regalo, clienti, notifiche, widget, scanner)
  - 4a31617 Staff self-view, gift-card designs, guest columns, web badge, stepper widget, camera scanning
  - d822104 Email: una chiave Resend "Sending access" non e' una chiave sbagliata
  - 42014f9 Email: niente piano condiviso, si invia solo con la chiave Resend del cliente
  - 7f8857f Marketing: quota email del mese nel form + logo del locale nell'email

## Handoff Chain

- **Continues from**: [2026-07-13-161815-verifactu-fiscal-cassa.md](./2026-07-13-161815-verifactu-fiscal-cassa.md)
  - Previous title: VeriFactu — la cassa del CRM diventa un SIF spagnolo (piano eseguito, Fasi 0-5)
  - ⚠️ NB: quella sessione è **indipendente** da questa. Nessuna sovrapposizione di file o di dominio (lì fiscale/cassa, qui front-of-house). Non serve leggerla per capire questa.
- **Supersedes**: None
- **Nota**: esiste anche un draft manuale della STESSA sessione, `2026-07-13-crm-7-richieste.md`, scritto prima di invocare lo skill. Contenuto equivalente; **questo file è quello canonico** (naming convention dello skill). L'altro può essere cancellato.

## Current State Summary

L'utente ha dato **7 richieste in un unico messaggio**, con istruzione esplicita: *"esegui tutto uno alla volta e non chiedermi niente perché non ci sarò a risponderti"*. Quindi: zero domande, esecuzione autonoma, riassunto finale.

**Tutte e 7 sono state affrontate e chiuse.** La #1 (recensioni) si è risolta con una decisione motivata di **non-azione**; le altre 6 con codice. Tutto è committato e pushato su `main` (`4a31617`), quindi **già deployato da Vercel in automatico**. La migrazione DB è **già applicata sul progetto live**.

**Non c'è lavoro in sospeso.** Una sessione nuova non deve riprendere niente: deve solo sapere cosa è stato deciso e perché, in caso l'utente faccia follow-up.

## Codebase Understanding

## Architecture Overview

- CRM SaaS **multi-tenant** per ristoranti. Next.js 16 (App Router) + React 19 + Supabase (Postgres/Auth/Storage/Realtime con RLS) + Vercel.
- Le **differenze fra ristoranti sono DATA, non codice**: vivono come feature flag in `tenants.settings` (JSONB) e si leggono via `getFeatures()`. Aggiungere una capacità = aggiungere UN flag, mai un branch per tenant.
- Le pagine dashboard leggono **direttamente da Supabase via RLS** con il client browser; le scritture sensibili passano da route `/api/*` con service role + check di ruolo (`verifyTenantMembership`).
- Ruoli DB: `owner` / `manager` / `host` (host = cameriere). `platform_admin` è promosso a owner-equivalente.
- Le pagine pubbliche guest-facing (`/m` menu, `/s` sito, `/g` buoni regalo, `/b` widget, `/rv` recensioni) sono **service-role, senza auth**, e ricevono le stringhe **pre-localizzate dal server** in base a `tenants.settings.crm_locale`.
- Le migrazioni di queste feature vivono in **`scripts/migrations/`** (eseguite a mano / via Management API), NON in `supabase/migrations/`.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/lib/types/tenant-settings.ts` | Feature flag + shape tipizzato di `tenants.settings`. `getFeatures()` è la fonte unica. | Ogni nuova capacità passa da qui. Ho aggiunto `gift_designs`. |
| `src/lib/gift-cards/designs.ts` | **NUOVO** — modulo puro: tipo `GiftDesign`, validazione, `publishedGiftDesigns()`, resa CSS. | Cuore della feature buoni regalo. Non leggere mai i design grezzi: passa da qui. |
| `src/app/api/gift-cards/checkout/route.ts` | Checkout pubblico Stripe. | Qui vive la regola di sicurezza sul prezzo (vedi Important Context). |
| `src/components/gift-cards/GiftCardPreview.tsx` | **NUOVO** — la card, condivisa da editor e pagina pubblica. | È il pezzo che impedisce a "quel che disegni" e "quel che comprano" di divergere. |
| `src/components/scanner/CameraScanner.tsx` | **NUOVO** — scanner fotocamera, `mode: "qr" \| "barcode"`. | Un solo componente per entrambi gli usi (menu + inventario). |
| `src/app/b/[slug]/BookingWidget.tsx` | Widget prenotazione (usato standalone e dentro il pannello flottante dei siti). | Riscritto a schermate esclusive. |
| `src/lib/site/booking-strings.ts` | Copy del widget nelle 4 lingue + `resolveSiteLocale()`. | La lingua del widget viene da `crm_locale`, risolta lato server. |
| `src/components/layout/Topbar.tsx` | Campanella notifiche (derivate, non una tabella). | Qui vive `SourceBadge`. |
| `src/lib/i18n/dictionaries/{en,it,es,de}.ts` | Dizionari. **Il tipo `Dictionary` è derivato da `en.ts`** (`typeof en`). | Ogni chiave nuova va in tutti e 4 o `tsc` fallisce. |

## Key Patterns Discovered

- **Pagine pubbliche = stringhe pre-localizzate dal server.** Il client component riceve un oggetto di stringhe già tradotte; non ha i18n proprio. (`BOOKING_STRINGS[locale]`, `STRINGS[locale]` in `/g`.)
- **Un solo componente per il preview condiviso.** Se un dato viene "disegnato" in dashboard e "mostrato" al cliente, usa lo stesso componente in entrambi i posti, altrimenti divergono.
- **Il server non si fida mai del prezzo del browser.** Vedi la regola sui buoni regalo.
- **Fallback silenzioso e retro-compatibile.** Ogni feature nuova degrada al comportamento di prima se il tenant non l'ha configurata (nessun design → preset storici; loyalty off → nessuna colonna e nessuna query).
- **Upload immagini** → `uploadSitePhoto()` (bucket pubblico `branding`, compressione WebP client-side). Riusato per le foto delle card.
- **Le griglie/tabelle dashboard** usano `memo` + handler `useCallback` stabili (es. `IngredientCard`): passare una prop non memoizzata rirenderizza tutte le righe ad ogni tasto.

## Work Completed

## Tasks Finished

- [x] **Recensioni** — valutate e **deliberatamente NON rimosse** (vedi Decisions)
- [x] **Staff** — vista "I miei turni" per il personale (default per host)
- [x] **Buoni regalo** — editor card + rendering sulla pagina pubblica + prezzo autorevole server-side
- [x] **Clienti** — colonne email e punti fedeltà in tabella (desktop + mobile)
- [x] **Notifiche** — badge icona browser per le prenotazioni dal sito (`source: 'web'`)
- [x] **Widget prenotazione** — uno step = una schermata, con "indietro" e recap; lingua del sito verificata
- [x] **Scanner fotocamera** — QR nell'import menu + barcode nell'inventario (lookup + assign)
- [x] Migrazione `ingredients.barcode` **applicata sul DB live** e verificata
- [x] tsc pulito · 1076 test / 97 file · build di produzione · E2E Playwright (widget 2 locali + pagina buoni regalo)
- [x] Dati di test ripuliti, script temporanei cancellati, server fermato
- [x] Commit + push su `main` (`4a31617`)

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `src/lib/gift-cards/designs.ts` | NUOVO — tipo `GiftDesign`, `isValidGiftDesign`, `publishedGiftDesigns`, `findGiftDesign`, `giftDesignBackground`, `newGiftDesign`, `MAX_GIFT_DESIGNS=8` | Modulo puro → testabile e importabile da client, route e webhook |
| `src/lib/gift-cards/designs.test.ts` | NUOVO — 20 test | Copre validazione, card nascoste, cap, colori malformati |
| `src/components/gift-cards/GiftCardPreview.tsx` | NUOVO | La card, resa identica in editor e pagina pubblica |
| `src/components/gift-cards/GiftDesignEditor.tsx` | NUOVO | Editor owner/manager (titolo, sottotitolo, importo, sfondo, foto, visibilità) |
| `src/components/scanner/CameraScanner.tsx` | NUOVO | Scanner ZXing QR+barcode, con errori camera leggibili |
| `scripts/migrations/2026-07-13-inventory-barcode.sql` | NUOVO — colonna `barcode` + unique index parziale per tenant | **Già applicata sul live** |
| `src/app/api/gift-cards/checkout/route.ts` | Prezzo preso dal design salvato; 409 su card nascosta/cancellata; 400 se ci sono card ma manca `design_id`; snapshot `design_id`/`design_title` nei metadata Stripe | **Sicurezza**: altrimenti si compra la card da 200 € pagandone 10 |
| `src/lib/gift-cards/fulfill.ts` | Titolo della card nell'email di consegna | L'email dice quale regalo è stato comprato, e resta corretta anche se la card viene ridisegnata dopo |
| `src/app/g/[slug]/GiftForm.tsx` + `page.tsx` | Griglia card se pubblicate, altrimenti fallback preset storici | Tenant che non apre l'editor: pagina invariata |
| `src/app/(dashboard)/gift-cards/page.tsx` | Monta l'editor (`canEdit` = owner/manager/platform_admin) | Un host che legge i buoni venduti non vede l'editor |
| `src/app/(dashboard)/staff/page.tsx` | Stato `rotaView` ("mine"/"team"), memo `myWeek`, lista verticale della propria settimana | Il cameriere ha una domanda sola: "quando lavoro?" |
| `src/app/(dashboard)/guests/page.tsx` | Colonne email + punti; fetch bulk `loyalty_accounts` (solo se `loyalty_enabled`) | Prima i punti si leggevano uno alla volta nel drawer |
| `src/components/layout/Topbar.tsx` | `SourceBadge` unico (aggiunge `web` → Globe); `source` propagato anche sulle UPDATE | Il badge era duplicato in 2 punti e le cancellazioni perdevano `source` |
| `src/app/b/[slug]/BookingWidget.tsx` | Render esclusivo su `step`, freccia indietro, riga di recap | Gli step si impilavano: il pulsante finiva sotto la piega |
| `src/lib/site/booking-strings.ts` | +`detailsLabel`, `backBtn`, `peopleShort` (×4 lingue) | Servono al nuovo header/recap |
| `src/app/globals.css` | `.bw2-head`, `.bw2-back`, `.bw2-recap` | Stile dell'header di step |
| `src/app/(dashboard)/menu/page.tsx` | Bottone "Scansiona con la fotocamera" nel tab "URL del QR" | Il testo di aiuto chiedeva letteralmente di aprire il QR a mano e incollare l'URL |
| `src/app/(dashboard)/inventory/page.tsx` | Scan barcode (lookup da toolbar, assign dalla riga), campo `barcode`, ricerca per barcode | Mettere via una consegna puntando il telefono sulla scatola |
| `src/lib/types/tenant-settings.ts` | `gift_designs?: GiftDesign[]` | Dove vivono le card |
| `src/lib/i18n/dictionaries/{en,it,es,de}.ts` | ~45 chiavi nuove | `Dictionary` deriva da `en.ts`: vanno messe in tutti e 4 |
| `package.json` / `package-lock.json` | +`@zxing/browser`, `@zxing/library` | Unica lib che decodifica QR **e** barcode 1D dallo stesso stream |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| **Recensioni: NON rimuoverle** | (a) rimuovere la sezione (b) lasciarla com'è | Ho verificato prima di toccare: è **reale end-to-end** (tabella `reviews`, raccolta via link HMAC dopo la visita, risposta AI, redirect 4-5★ a Google, resa sul micro-sito) ed è **già spenta di default** (`reviews_enabled: false`). Il problema che l'utente teme non esiste: chi non la vuole non l'accende. Rimuoverla avrebbe distrutto una feature funzionante e già venduta nel piano "7 funzioni". |
| **Staff: NON ricostruire la pagina** | (a) creare una pagina turni per gli host (b) cambiare cosa mostra quella esistente | Trappola evitata: `/staff` era **già** nella whitelist host, la RLS già faceva leggere la rota, la richiesta ferie/scambio c'era già. Il difetto vero era che mostrava la griglia dell'**intero team** (7×N, scroll orizzontale) — illeggibile su telefono e non è la domanda del cameriere. |
| **Buoni regalo: prezzo dal SERVER, mai dal browser** | (a) fidarsi di `amount_cents` del body (b) ricaricare il design e usare il suo importo | (a) permetteva di **comprare la card da 200 € pagandone 10** con un body craftato. Ora: `design_id` → il server ricarica il design e usa il **suo** `amount_cents`. |
| **Card nascosta/cancellata → 409, non fallback** | (a) ripiegare su importo libero (b) rifiutare | Una tab stantia che compra una card che il titolare ha tolto deve **fallire**, non comprare qualcosa che il titolare non offre più. |
| **Un solo `GiftCardPreview` per editor e pagina pubblica** | (a) due render separati (b) componente condiviso | Due render divergono al primo cambio. Con uno solo, "quel che disegni" **è** "quel che comprano", per costruzione. |
| **Snapshot `design_title` nei metadata Stripe** | (a) leggere il design al momento dell'email (b) snapshottarlo alla vendita | Se il titolare ridisegna la card dopo la vendita, l'email di un buono già venduto deve continuare a dire la cosa giusta. |
| **Widget: schermate esclusive, non sezioni impilate** | (a) tenere le sezioni che si rivelano sotto (b) uno step = una schermata | Il pannello è 380px × max 86vh: impilando, al 3° step il pulsante di conferma finiva **sotto la piega**. Richiesta esplicita dell'utente ("non verso il basso ma cambiando sezione"). |
| **ZXing e non `BarcodeDetector` nativo** | (a) API nativa del browser (b) `@zxing/browser` | `BarcodeDetector` **non esiste su Safari/iOS** — cioè proprio il telefono del target. ZXing copre QR **e** EAN/UPC con una lib sola. Audit: **zero vulnerabilità su zxing** (verificato, dato il precedente scarto di SheetJS per advisory). |
| **`ingredients.barcode` unique PER TENANT, indice parziale** | (a) unique globale (b) unique per tenant | Due ristoranti possono ovviamente avere lo stesso EAN in magazzino. Indice **parziale** (`where barcode is not null`) così i tanti NULL non collidono. |

## Pending Work

## Immediate Next Steps

**Nessuno.** Il lavoro è completo, verificato, committato, pushato e deployato. Una sessione nuova **non deve riprendere niente**.

Se l'utente fa follow-up, questi sono i punti di ingresso plausibili (NON iniziarli senza che lo chieda):
1. Provare lo scanner barcode dal telefono su `crm.baliflowagency.com` — richiede l'add-on gestionale attivo per vedere `/inventory` (flag `management_enabled`).
2. Comporre le prime card buoni regalo su un tenant reale — `bali-rest-ghl8po` e `oraz-t0221f` hanno già `gift_cards_enabled: true`.
3. Se segnala che le card dei buoni regalo su mobile sono troppo alte: il punto da toccare è `aspectRatio: "16 / 10"` in `GiftCardPreview.tsx`.

## Blockers/Open Questions

- [ ] Nessun blocker.
- [ ] Nessuna domanda aperta (l'utente aveva detto esplicitamente di non chiedere nulla, e ogni scelta ambigua è stata risolta con un default motivato e documentato qui sopra).

## Deferred Items

- **Prezzi pacchetti crediti su Stripe LIVE** — nulla a che vedere con questa sessione, ma resta aperto da prima (memoria: prezzi provvisori, non creare i prodotti su Stripe LIVE).
- Le card buoni regalo su mobile vanno in colonna singola e risultano un po' alte. **Non è un difetto bloccante** e l'utente non l'ha chiesto — lasciato com'è per non fare iniziativa non richiesta.

## Context for Resuming Agent

## Important Context

**1. Il lavoro di questa sessione è FINITO.** Tutto è su `main` (`4a31617` + handoff `14121f7`), Vercel ha già deployato. Non c'è niente da riprendere. Questo handoff serve a spiegare *cosa è stato deciso e perché*, non a passare un testimone.

**2. La regola di sicurezza sui buoni regalo è la cosa più importante da non rompere.** Le card hanno un importo fisso. In `src/app/api/gift-cards/checkout/route.ts` il server **ricarica il design da `tenants.settings.gift_designs` e usa il SUO `amount_cents`**, ignorando quello del browser. Se qualcuno "semplifica" quella route fidandosi del body, si torna a poter comprare la card da 200 € pagandone 10.

**3. Non leggere mai `settings.gift_designs` grezzo.** Passa sempre da `publishedGiftDesigns()` (filtra invalidi + nascosti, cappa a 8). L'editor salva solo card valide (`filter(isValidGiftDesign)`), quindi l'array su DB è affidabile — ma i lettori non devono dipendere da quell'assunzione.

**4. La fotocamera funziona SOLO su https** (o localhost). In produzione va; da un IP locale in http lo scanner mostra `scan_err_insecure` — **è voluto, non un bug**. Già comunicato all'utente.

**5. Le recensioni sono state lasciate apposta.** Se l'utente ritorna sull'argomento, il punto non è "ho dimenticato": è che la sezione è reale, funzionante, e già off di default. Se davvero la vuole via, la mossa giusta è discuterne, non rimuovere codice funzionante.

## Assumptions Made

- **Si lavora su `main`, senza feature branch** — è la convenzione registrata per questo progetto (fase demo, nessun cliente reale ancora). Confermata dalla memoria `feedback_baliflow_crm_no_branches`.
- **"Anteprima dei buoni regalo" = card vendibili con importo fisso**, non un semplice mockup grafico. Interpretato dalla frase "si potessero creare come delle cards che poi si riflettano anche nella pagina online": card che il cliente **compra**, non solo che guarda.
- **"Staff vede i propri turni"** interpretato come vista personale, non come nuovo permesso: il permesso c'era già.
- Le card sono **8 al massimo** per tenant — scelta mia, per tenere la pagina pubblica una scelta e non un catalogo, e `settings` (un JSONB letto ad ogni pagina) piccolo.

## Potential Gotchas

- **`Dictionary` è derivato da `en.ts`** (`typeof en`): ogni chiave nuova va aggiunta a **tutti e 4** i dizionari (en/it/es/de) o `tsc` fallisce.
- **In `src/app/(dashboard)/inventory/page.tsx`, `patchIngredient` DEVE stare prima di `handleScan`** (handleScan lo usa nel ramo "assign"). Attualmente righe ~340 vs ~351. Non riordinare.
- **`IngredientCard` è `memo`**: se aggiungi una prop, passala come `useCallback` (così ho fatto per `onScanFor`), altrimenti tutte le card si rirenderizzano ad ogni tasto.
- **Nel widget, `.bw2-chip` è usato SIA dai chip sala (step 0) SIA dagli slot orari (step 1).** Un test E2E che aspetta `.bw2-chip` per dire "sono avanzato di step" dà **falso positivo** sui tenant multi-sala (es. BALI Rest). Aspetta invece che l'input data sia **sparito** — è quello il segnale che la schermata è cambiata. Ci sono cascato e l'ho corretto.
- **`Sidebar.tsx:169`** chiama `isHost` una variabile che include **anche `manager`**: i manager vedono la sidebar ridotta a 4 voci pur essendo trattati come manager pieni dentro la pagina staff. Preesistente, non toccato, ma confonde alla lettura.
- **Supabase Management API**: serve uno `User-Agent` da browser o Cloudflare risponde 403 code 1010 (vedi memoria `reference_supabase_mgmt_cloudflare_ua`).
- **Mai `npm run dev`** su questo progetto (regola utente). Per gli E2E ho usato `npm run build` + `npx next start -p 3111`.

## Environment State

## Tools/Services Used

- **Supabase** progetto CRM `azhlnybiqlkbhbboyvud` — usata la **Management API** per applicare la migrazione `barcode` e per seminare/ripulire i dati di test. Token in `~/.claude/projects/-Users-amplaye/memory/credentials.md` (NON in questo file).
- **Playwright** (già nel repo) per gli E2E su `localhost:3111`.
- **Vercel** — deploy automatico da GitHub su push a `main`. `4a31617` è già in produzione.
- Tenant usati per i test: `oraz-t0221f` (locale `it`), `bali-rest-ghl8po` (locale `es`, multi-sala). Entrambi hanno `website_enabled` e `gift_cards_enabled` a true.

## Active Processes

- **Nessuno.** Il server `next start -p 3111` usato per gli E2E è stato **fermato** (`pkill`). Gli script temporanei `widget-e2e.tmp.mjs` e `gift-e2e.tmp.mjs` sono stati **cancellati** dal repo.

## Environment Variables

Nessuna variabile nuova introdotta da questa sessione. Rilevanti (solo NOMI, mai valori):
- `NEXT_PUBLIC_APP_URL` — usata dalla route checkout per costruire success/cancel URL
- `STRIPE_SECRET_KEY` — checkout buoni regalo (già configurata)
- `POS_CRED_ENC_KEY`, `EMAIL_CRED_ENC_KEY`, `CRON_SECRET`, `AI_WEBHOOK_SECRET` — preesistenti, non toccate

### Cleanup eseguito

- `gift_designs` seminati su Oraz per l'E2E → **rimossi** (`settings - 'gift_designs'`, verificato `still_has: false`)
- Script E2E temporanei → cancellati
- Server di test → fermato

## Related Resources

- [scripts/migrations/2026-07-13-inventory-barcode.sql](../../scripts/migrations/2026-07-13-inventory-barcode.sql) — migrazione già applicata sul live
- [src/lib/gift-cards/designs.ts](../../src/lib/gift-cards/designs.ts) — contratto dei design (leggi questo prima di toccare i buoni regalo)
- [src/lib/types/tenant-settings.ts](../../src/lib/types/tenant-settings.ts) — feature flag e shape di `tenants.settings`
- [CLAUDE.md](../../CLAUDE.md) — convenzioni e trappole del progetto
- Memoria: `_index_baliflow_crm.md` (sub-index del progetto), `feedback_baliflow_crm_no_branches` (si lavora su main), `reference_supabase_mgmt_cloudflare_ua` (User-Agent obbligatorio)

---

**Security Reminder**: Nessun segreto in questo documento — solo nomi di variabili e riferimenti al file credenziali in memoria.
