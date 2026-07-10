# Handoff: Piano all-inclusive — Fasi 4–7 shippate (piano COMPLETO), restano solo azioni fuori dal codice + merge

## Session Metadata
- Created: 2026-07-10 16:21:41
- Project: /Users/amplaye/CRM (TableFlow/BaliFlow CRM, Next.js 16 + Supabase + Vercel)
- Branch: feature/all-inclusive (da main, pushata su origin — NON mergiata)
- Session duration: ~45 minuti, esecuzione autonoma delle Fasi 4–7 del piano approvato
- Piano di riferimento: `/Users/amplaye/.claude/plans/ho-anche-visto-che-distributed-crayon.md`

### Recent Commits (for context)
  - f70b1bb feat(booking-widget): public /b/[slug] widget — availability grid + booking via the full AI pipeline in-process
  - 66bc3ae feat(loyalty): points per visit + reward redemption — accrual on completed reservations, guest panel, config in Settings
  - cddbccb feat(gift-cards): sell vouchers online, redeem at the till — /g/[slug], webhook mints code + email, gift_card payment method in cassa
  - f428e6d feat(website): template micro-site /s/[slug] + section editor

## Handoff Chain

- **Continues from**: [2026-07-10-151851-all-inclusive-fase0-3-shipped.md](./2026-07-10-151851-all-inclusive-fase0-3-shipped.md)
  - Previous title: Piano all-inclusive — Fasi 0–3 shippate (50%), prossima sessione Fasi 4–7
- **Supersedes**: None

## Current State Summary

Il piano "CRM all-inclusive — 7 funzioni" è CODICE-COMPLETO: questa sessione ha shippato le Fasi 4–7 (website builder, gift card, loyalty, widget prenotazione) sul branch `feature/all-inclusive`. Verifiche superate prima di ogni push: `npx tsc --noEmit` pulito, `npm test` 863 verdi in 80 file (12 test nuovi), `npm run build` ok. Le 2 migrazioni nuove (gift-cards, loyalty) sono GIÀ applicate al DB Supabase di produzione (project ref azhlnybiqlkbhbboyvud) — in totale 5 migrazioni live, tutte innocue perché gated da flag OFF. Playwright E2E eseguito contro `next start` locale sul tenant demo bali-rest-ghl8po: 14/15 verdi (unico rosso: checkout gift senza STRIPE_SECRET_KEY in locale — env-only, le chiavi Stripe vivono solo su Vercel). Una prenotazione test dal widget è arrivata `source='web', status=confirmed` ed è stata ripulita dal DB. Nulla è in produzione finché non si mergia in main.

## Work Completed

- [x] **Fase 4 — Website builder** (f428e6d): `settings.site_branding` typed (hero_url, tagline, about_text, brand_color, font, gallery[], sections[] ordinate) + `SITE_SECTIONS`; pagina pubblica `src/app/s/[slug]/page.tsx` (hero sempre visibile con CTA Prenota→/b, menù→/m, gift→/g se flag; sezioni about/menu-teaser/gallery/reviews 4-5★/orari/contatti, copy inline ×4 lingue, font trio + --accent come /m); editor `src/app/(dashboard)/website/page.tsx` (upload hero/gallery→bucket `branding` via compressImageToWebp(1600), toggle+frecce ordine sezioni, NO drag-drop, persist diretto su tenants.settings sotto RLS); `src/app/sitemap.ts` (/m per tutti i trial/active, /s solo con website_enabled); middleware esclude `/s/`; sidebar "Website" gated.
- [x] **Fase 5 — Gift card** (cddbccb): migrazione `gift_cards`+`gift_card_redemptions` (code unique, uq su stripe_checkout_session_id per idempotenza webhook) + ALLARGATI i check `method` di `cassa_payments` e `pos_sales` con 'gift_card'; lib pura `src/lib/gift-cards/gift-cards.ts` (generateGiftCode GIFT-XXXX-XXXX alfabeto senza ambigui, normalizeGiftCode, bounds 10–500 euro, 8 test); `createGiftCardCheckoutSession` in billing/stripe.ts (capture IMMEDIATA, a differenza delle caparre); `/api/gift-cards/checkout` pubblica (rate-limit, slug→tenant, doppio gate piano+flag); webhook branch `kind=gift_card` → `src/lib/gift-cards/fulfill.ts` (mint con retry su collisione, email Resend al destinatario con idempotency key, mai throw); riscatto in cassa come METODO DI PAGAMENTO: `/api/gift-cards/validate` (staff, saldo live) + PayModal (4° metodo gated, input codice+verifica, clamp al saldo) + pay route (pre-check saldo PRIMA del claim, burn con optimistic lock DOPO, redemption ledger, fallito→system_logs critical); dashboard `/gift-cards` (KPI + tabella) + sidebar gated; pagina pubblica `/g/[slug]` + GiftForm (preset+custom, ?paid=1|0); middleware `/g/`.
- [x] **Fase 6 — Loyalty** (66bc3ae): migrazione `loyalty_accounts` (unique tenant+guest) + `loyalty_events` con unique parziale su reservation_id where points_delta>0 (idempotenza accrual); `settings.loyalty` typed + `getLoyaltyConfig` (defaults 10 punti/visita, premio a 100, clamping, 4 test); `src/lib/loyalty/accrue.ts` best-effort; hook in `updateReservationDetailsAction` su transizione →completed (con guest_id); `/api/loyalty/redeem` (owner/manager, optimistic lock, audit); `GuestLoyaltyPanel` nel drawer Clienti (saldo, progress bar, bottone riscatto) gated dal flag; `LoyaltyConfigCard` in Settings→Funzionalità (visibile solo con flag ON, salva on-blur).
- [x] **Fase 7 — Widget prenotazione** (f70b1bb): `/api/public/availability` e `/api/public/book` — shim pubblici con rate-limit stretto (30/min, 5/min) che risolvono slug→tenant e INVOCANO IN-PROCESS i handler `/api/ai/availability|book` con `x-ai-secret` (zero refactor del route da 920 righe, riuso completo: dedup guest per phone tail, atomic_book_tables, escalation large party, conferma WhatsApp, link caparra); risposta trimmata ai campi widget-safe; pagina `/b/[slug]` + `BookingWidget` two-step (data+persone→griglia slot→nome/telefono→esiti confirmed/pending/waitlist/full/caparra con bottone paga); middleware `/b/`; il bottone "Prenota" del micro-sito ora funziona.
- [x] Migrazioni gift-cards + loyalty applicate al DB live via Management API (risposta `[]` = ok, User-Agent browser obbligatorio).
- [x] Playwright E2E (script temporaneo, poi rimosso): micro-sito (hero/CTA/menu/orari/contatti), pagina gift (form+preset), widget (14 slot reali, prenotazione confermata end-to-end su DB live poi ripulita), middleware /s /g /b /rv pubblici. 14/15.
- [x] Flag `website/gift_cards/loyalty/reviews_enabled` ATTIVATI (e lasciati ON) sul tenant demo bali-rest-ghl8po.
- [x] Memoria aggiornata: `project_crm_all_inclusive_7_features.md` + riga MEMORY.md.

## Important Context

1. **Branch, non main**: tutto su `feature/all-inclusive` (52b0bf7→f70b1bb, 10 commit). Deploy Vercel parte solo da main → nulla è live. Le 5 migrazioni però sono GIÀ nel DB di produzione (additive, gated da flag OFF di default).
2. **Riscatto gift = metodo di pagamento, non sconto**: decisione presa per riusare lo split-payment esistente senza nuova matematica. La migrazione ha allargato i check constraint `method` su `cassa_payments` E `pos_sales` — se si rigenera lo schema, ricordare 'gift_card' nei due check.
3. **Fulfillment gift idempotente due volte**: unique su `stripe_checkout_session_id` (webhook re-delivery non conia due buoni) + Resend idempotency key `gift_<session_id>` (niente doppia email).
4. **Loyalty accrual**: scatta SOLO da `updateReservationDetailsAction` (dashboard/AI modify). L'unique parziale su reservation_id garantisce niente doppio accredito. Il riscatto è manuale dallo staff nel drawer guest — alla cassa lo sconto si applica col campo sconto esistente (v1 intenzionale, niente lookup guest al POS).
5. **Widget = proxy in-process**: `/api/public/book` costruisce una `Request` sintetica con il secret e chiama direttamente l'handler importato — nessun hop di rete, nessun refactor. Se `AI_WEBHOOK_SECRET` manca in env, il widget risponde 503 (fail-closed, come tutti i route /api/ai).
6. **Gate delle pagine pubbliche nuove**: /s richiede website_enabled; /g richiede hasActivePlan+gift_cards_enabled; /b richiede solo hasActivePlan (il widget non ha flag proprio, per design del piano).
7. **Secret**: nessun secret nuovo in git. Le chiavi Stripe/Resend vivono solo su Vercel; in locale `stripeConfigured()`/`emailConfigured()` degradano con grazia.
8. **Reserve-with-Google rimandato per design** (serve partner/aggregatore): il deep-link a /b/[slug] copre subito Instagram/Facebook, come previsto dal piano.

## Critical Files

| File | Purpose |
|------|---------|
| src/app/s/[slug]/page.tsx | Micro-sito pubblico (Fase 4) |
| src/app/(dashboard)/website/page.tsx | Editor sito a sezioni |
| src/app/g/[slug]/page.tsx | Acquisto gift card pubblico (+ GiftForm.tsx) |
| src/lib/gift-cards/gift-cards.ts | Codici + bounds (con fulfill.ts per il webhook) |
| src/app/api/gift-cards/checkout/route.ts | Checkout pubblico (+ validate/route.ts per la cassa) |
| src/app/api/cassa/orders/[id]/pay/route.ts | Burn buono: pre-check → claim → optimistic lock |
| src/components/cassa/PayModal.tsx | 4° metodo di pagamento gift_card |
| src/lib/loyalty/loyalty.ts | Config loyalty (+ accrue.ts per l'accrual) |
| src/app/actions/reservations.ts | Hook accrual su transizione →completed |
| src/app/api/loyalty/redeem/route.ts | Riscatto premio staff |
| src/app/b/[slug]/page.tsx | Widget prenotazione pubblico (+ BookingWidget.tsx) |
| src/app/api/public/book/route.ts | Shim pubblico → handler AI in-process (+ availability) |
| scripts/migrations/2026-07-10-gift-cards.sql | Migrazione gift (GIÀ applicata al DB live) |
| scripts/migrations/2026-07-10-loyalty.sql | Migrazione loyalty (GIÀ applicata al DB live) |
| src/lib/supabase/middleware.ts | Esclusioni /s/ /g/ /b/ aggiunte |

## Potential Gotchas

- Il rosso E2E "gift: checkout API returns Stripe url" è SOLO env locale (niente STRIPE_SECRET_KEY): rifare lo smoke su Vercel preview/prod con carta 4242.
- I preset del form gift sono 25/50/75/100 €; bounds server 10–500 € — form e route validano gli STESSI numeri esportati da `gift-cards.ts`.
- Il codice buono ha prefisso "GIFT-" che contiene la I: la regex anti-caratteri-ambigui va applicata solo al corpo random (il test lo documenta).
- PayModal mostra il metodo buono solo con prop `giftEnabled` (flag tenant), passato dalla cassa page.
- La sidebar deriva la label da `nav_<name>`: "Gift Cards" → `nav_gift_cards`; se si rinomina l'item, aggiornare la chiave nei 4 dizionari.
- I dizionari i18n sono typed su en.ts: chiave in una lingua sola = tsc rosso. ~70 chiavi nuove in questa sessione, sempre ×4.
- Su bali-rest-ghl8po i 4 flag nuovi sono rimasti ON (tenant demo, comodo per gli smoke test).

## Pending Work — azioni fuori dal codice (bloccanti per il live)

- [ ] Vercel env: `RESEND_API_KEY`, `EMAIL_FROM` (dominio verificato su Resend, serve DNS), opzionale `REVIEW_LINK_SECRET`
- [ ] `node --env-file=.env.local scripts/meta-templates.mjs create post_visit_review` e `... create marketing_campaign` + attendere approvazione Meta
- [ ] Dashboard Stripe: aggiungere evento `checkout.session.expired` all'endpoint `/api/billing/webhook/stripe`
- [ ] Smoke test su Vercel: gift checkout carta 4242 (fino a email col codice), riscatto in cassa, caparra
- [ ] PR `feature/all-inclusive` → main quando Steward decide di andare live

## Immediate Next Steps

1. Chiedere a Steward se procedere col merge in main (il codice è completo e testato) o se prima vuole vedere le funzioni su un preview deploy.
2. Eseguire le 4 azioni fuori dal codice qui sopra (env Resend, template Meta, evento Stripe, smoke su Vercel).
3. Dopo il merge: attivare i flag sui tenant reali che li vogliono (default OFF) e configurare per tenant importo caparra, premio loyalty e contenuti del sito.
4. Follow-up rimandati per design: Reserve-with-Google (serve partner), punti-per-euro alla cassa (serve link guest↔ordine POS), saldo loyalty sul micro-sito (serve auth guest).
5. In caso di dubbi sul dettaglio delle Fasi 0–3, leggere l'handoff precedente della catena.
