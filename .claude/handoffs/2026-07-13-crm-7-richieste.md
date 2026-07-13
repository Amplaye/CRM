# Handoff — CRM: 7 richieste utente (staff, buoni regalo, clienti, notifiche, widget, scanner)

**Data:** 2026-07-13 · **Repo:** `/Users/amplaye/CRM` (github.com/Amplaye/CRM)
**Branch:** `main` · **Commit:** `4a31617` — **già committato e pushato** (deploy auto Vercel)
**Stato:** ✅ TUTTO COMPLETATO E VERIFICATO. Nessun lavoro in sospeso.

---

## 1. Obiettivo della sessione

L'utente ha dato 7 richieste in un colpo solo, con istruzione esplicita: *"esegui tutto uno alla volta e non chiedermi niente perché non ci sarò a risponderti"*. Quindi: zero domande, esecuzione autonoma, riassunto finale.

Le 7 richieste (testuali):
1. "la sezione recensioni non so se è utile nel crm sinceramente"
2. staff deve poter vedere i propri turni nel CRM
3. creare/modificare l'anteprima dei buoni regalo come cards, riflesse anche sulla pagina online
4. tabella clienti da migliorare con punti fedeltà ed email
5. nel modal notifiche, le prenotazioni dal sito devono avere l'icona browser
6. widget prenotazione: lingua del sito + step "cambiando sezione ad ogni step", non verso il basso
7. scanner con fotocamera del telefono: QR nel menu + barcode nell'inventario

**Tutte e 7 sono state affrontate.** La #1 si è chiusa con una decisione motivata (non-azione), le altre 6 con codice.

---

## 2. Decisioni prese (col PERCHÉ, non solo l'esito)

### 2.1 Recensioni — NON rimosse (decisione deliberata di non-azione)
L'utente era incerto ("non so se è utile"). Ho **verificato prima di toccare** ed è emerso che:
- La sezione è **reale end-to-end**, non uno stub: tabella `reviews` (migrazione `scripts/migrations/2026-07-10-reviews.sql`), raccolta via link HMAC firmato dopo la visita (`/rv/[token]` + cron `post-visit-followup`), risposta manuale + suggerimento AI (`/api/reviews/suggest-reply`, consuma crediti), redirect 4-5★ a Google, e le recensioni compaiono anche sul micro-sito pubblico.
- È **già spenta di default**: flag `reviews_enabled` con default `false` in `src/lib/types/tenant-settings.ts`. La voce sidebar è filtrata (`Sidebar.tsx:190`).

**PERCHÉ non l'ho rimossa:** il problema che l'utente teme (sezione inutile che ingombra) non esiste — chi non la vuole semplicemente non l'accende. Rimuoverla avrebbe distrutto una feature funzionante e già venduta nel piano "7 funzioni". Coerente con [[feedback_verify_before_rebuild]].

### 2.2 Staff — la pagina esisteva già, il problema era COSA mostrava
Trappola evitata: un'analisi superficiale avrebbe detto "manca la pagina staff per gli host" e l'avrebbe ricostruita. **Falso**: `/staff` era già nella whitelist host (`Sidebar.tsx:185`), la RLS `staff_shifts member read` fa già leggere tutta la rota, e la richiesta di ferie/scambio già c'era.

Il vero problema: al cameriere mostrava la **griglia dell'intero team** (7 giorni × N membri, con scroll orizzontale) — illeggibile su telefono e non risponde alla sua unica domanda ("quando lavoro?").

**Soluzione:** vista `"mine"` (default per host/manager non-owner) = la propria settimana in lista verticale; toggle "I miei turni / Team" per tornare alla griglia. Nessuna modifica a RBAC o API.

### 2.3 Buoni regalo — il prezzo viene dal SERVER, non dal browser (sicurezza)
Questa è la decisione più importante della sessione. Le card hanno un importo fisso. Se il checkout si fosse fidato di `amount_cents` mandato dal browser, un body craftato avrebbe comprato **la card da 200 € pagando 10 €**.

**Regola implementata** in `src/app/api/gift-cards/checkout/route.ts`:
- Se arriva `design_id` → il server ricarica il design da `tenants.settings.gift_designs` e usa **il suo** `amount_cents`. `amount_cents` del browser viene ignorato.
- Design inesistente/nascosto/cancellato (tab stantia) → **409 `design_not_available`**, non fallback silenzioso.
- Se il tenant ha pubblicato card ma la richiesta non ha `design_id` → **400 `design_required`** (il percorso importo-libero si chiude).
- Nessun design pubblicato → fallback ai preset storici, pagina invariata byte-per-byte.

Altre scelte: `design_id`/`design_title` **snapshottati** nei metadata Stripe → l'email consegnata dice il titolo della card comprata, e resta corretta anche se il titolare ridisegna la card dopo.

Un **solo** componente (`GiftCardPreview`) rende sia l'editor sia la pagina pubblica → "quello che disegni" e "quello che comprano" non possono divergere.

### 2.4 Widget prenotazione — la lingua c'era già, il layout no
Verificato: le stringhe erano **già** pre-localizzate lato server da `tenants.settings.crm_locale` (`booking-strings.ts` + `resolveSiteLocale`). Quindi la metà "lingua" della richiesta era già soddisfatta — ho solo confermato con E2E.

Il vero difetto: gli step **si impilavano** (step 1 e 2 renderizzati *sotto* lo step 0, mai smontati). In un pannello da 380px con `max-h:86vh` il pulsante di conferma finiva sotto la piega. Ora **uno step = una schermata** (render esclusivo su `step`), con freccia indietro e riga di riepilogo compatta.

### 2.5 Scanner — una libreria per entrambi i lavori
Scelto `@zxing/browser` + `@zxing/library` perché decodifica **sia QR sia barcode 1D (EAN/UPC)** dallo stesso stream video → un solo componente `CameraScanner` con prop `mode: "qr" | "barcode"`.
- **Audit fatto** (memoria dice che SheetJS era stato scartato per advisory): `npm audit` → **nessuna vulnerabilità su zxing**. Le 7 preesistenti non c'entrano.
- Scartato `BarcodeDetector` nativo: non c'è su Safari/iOS, cioè proprio il telefono del target.

---

## 3. File toccati

**Nuovi:**
- `src/lib/gift-cards/designs.ts` — modulo puro: tipo `GiftDesign`, `isValidGiftDesign`, `publishedGiftDesigns`, `findGiftDesign`, `giftDesignBackground`, `newGiftDesign`, `MAX_GIFT_DESIGNS=8`
- `src/lib/gift-cards/designs.test.ts` — 20 test
- `src/components/gift-cards/GiftCardPreview.tsx` — la card, condivisa editor+pubblico
- `src/components/gift-cards/GiftDesignEditor.tsx` — editor (owner/manager)
- `src/components/scanner/CameraScanner.tsx` — scanner QR+barcode
- `scripts/migrations/2026-07-13-inventory-barcode.sql`

**Modificati:**
- `src/app/(dashboard)/staff/page.tsx` — vista "I miei turni" (`rotaView`, memo `myWeek`)
- `src/app/(dashboard)/gift-cards/page.tsx` — monta l'editor (`canEdit` = owner/manager/platform_admin)
- `src/app/g/[slug]/GiftForm.tsx` + `page.tsx` — griglia card o fallback preset
- `src/app/api/gift-cards/checkout/route.ts` — prezzo autorevole dal design
- `src/lib/gift-cards/fulfill.ts` — titolo card nell'email
- `src/app/(dashboard)/guests/page.tsx` — colonne email + punti (fetch bulk `loyalty_accounts`, solo se `loyalty_enabled`)
- `src/components/layout/Topbar.tsx` — `SourceBadge` unico (aggiunge `web`→Globe), `source` propagato anche sulle UPDATE
- `src/app/b/[slug]/BookingWidget.tsx` — stepper a schermate
- `src/lib/site/booking-strings.ts` — +`detailsLabel`, `backBtn`, `peopleShort` (×4 lingue)
- `src/app/globals.css` — `.bw2-head`, `.bw2-back`, `.bw2-recap`
- `src/app/(dashboard)/menu/page.tsx` — bottone scan QR nel tab "URL del QR" di `ImportMenuModal`
- `src/app/(dashboard)/inventory/page.tsx` — scan barcode (lookup da toolbar + assign da riga), colonna `barcode`, ricerca per barcode
- `src/lib/types/tenant-settings.ts` — `gift_designs?: GiftDesign[]`
- `src/lib/i18n/dictionaries/{en,it,es,de}.ts` — ~45 chiavi nuove (staff_view_*, gift_design_*, guests_email_col/points_col, scan_*, inventory_barcode*)
- `package.json` / `package-lock.json` — +zxing

---

## 4. DB — migrazione GIÀ APPLICATA sul live

`scripts/migrations/2026-07-13-inventory-barcode.sql` è stata **eseguita sul progetto live** `azhlnybiqlkbhbboyvud` via Supabase Management API, e la colonna è stata verificata esistente (`information_schema` → `barcode | text`).

```sql
alter table public.ingredients add column if not exists barcode text;
create unique index if not exists ingredients_tenant_barcode_uniq
  on public.ingredients (tenant_id, barcode) where barcode is not null;
```
Nullable (i prodotti esistenti restano validi) e unique **per tenant** (due ristoranti possono avere lo stesso EAN), indice **parziale** (i tanti NULL non collidono).

⚠️ Serve `User-Agent` da browser sulle chiamate Management API o Cloudflare dà 403/1010 (vedi memoria `reference_supabase_mgmt_cloudflare_ua`).

---

## 5. Verifiche eseguite (tutte verdi)

- `npx tsc --noEmit` → 0 errori
- `npx vitest run` → **1076 test / 97 file, tutti passati**
- `npm run build` → build di produzione OK (solo warning preesistente sul workspace root, non mio)
- **E2E Playwright reali** contro `next start -p 3111`:
  - **Widget** su `oraz-t0221f` (locale `it`) e `bali-rest-ghl8po` (locale `es`): confermato che il campo data **si smonta** passando allo step 1 (gli step si sostituiscono davvero, non si impilano), il "indietro" torna allo step precedente, il recap mostra "Jul 14 · 2 pers. · inside", e le stringhe sono nella lingua del sito. Zero errori JS.
  - **Pagina buoni regalo** su `oraz-t0221f`: le 2 card pubblicate compaiono con titolo/sottotitolo/prezzo, la card `enabled:false` **non** è vendibile, il campo importo-libero sparisce quando ci sono card, la selezione funziona.
- **Dati di test ripuliti**: i `gift_designs` seminati su Oraz sono stati rimossi (`settings - 'gift_designs'`, verificato `still_has: false`), gli script `.tmp.mjs` cancellati, il server fermato.

---

## 6. Trappole / gotcha da ricordare

1. **La fotocamera funziona SOLO su https** (o localhost). In produzione (`crm.baliflowagency.com`) va; da un IP locale in http lo scanner mostra `scan_err_insecure` — è voluto, non un bug. Detto all'utente.
2. **Il tipo `Dictionary` è derivato da `en.ts`** (`typeof en`): ogni chiave nuova va messa in **tutti e 4** i dizionari o `tsc` fallisce.
3. **`patchIngredient` deve essere dichiarato prima di `handleScan`** in `inventory/page.tsx` (handleScan lo usa nel ramo "assign"). Attualmente: 340 vs 351. Non riordinare.
4. In `inventory/page.tsx` `IngredientCard` è `memo` con handler stabili — se aggiungi prop, passa callback `useCallback` (ho aggiunto `onScanFor` così), altrimenti si rirenderizzano tutte le card ad ogni tasto.
5. **Non leggere mai `settings.gift_designs` grezzo**: passa sempre da `publishedGiftDesigns()` (filtra invalidi/nascosti + cappa a 8). L'editor salva solo le card valide (`filter(isValidGiftDesign)`).
6. Nel widget, il selettore `.bw2-chip` è usato **sia** dai chip sala (step 0) **sia** dagli slot orari (step 1) — un test che aspetta `.bw2-chip` per "sono avanzato" dà falso positivo sui tenant multi-sala. Aspetta invece che l'input data sia sparito.
7. `Sidebar.tsx:169` chiama `isHost` una variabile che include **anche `manager`** — i manager vedono la sidebar ridotta a 4 voci pur essendo trattati come manager pieni dentro la pagina staff. Preesistente, non toccato.

---

## 7. Prossimi passi

**Nessuno obbligatorio** — il lavoro è chiuso, committato, pushato, e Vercel ha già deployato `4a31617`.

Cose che l'utente potrebbe voler fare (NON iniziare senza che lo chieda):
- Provare lo scanner barcode dal telefono su `crm.baliflowagency.com` (serve add-on gestionale attivo per vedere `/inventory`: flag `management_enabled`).
- Comporre le prime card buoni regalo dalla dashboard di un tenant reale (BALI Rest o Oraz hanno `gift_cards_enabled: true`).
- Le card sui buoni regalo su mobile vanno in colonna singola e sono un po' alte — se l'utente lo segnala, l'`aspectRatio: 16/10` in `GiftCardPreview.tsx` è il punto da toccare.
