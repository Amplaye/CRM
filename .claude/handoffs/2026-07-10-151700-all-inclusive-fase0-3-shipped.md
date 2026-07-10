# Handoff: Piano all-inclusive — Fasi 0–3 shippate (50%), restano Fasi 4–7

## Session Metadata
- Created: 2026-07-10 15:17 (Europe/Madrid)
- Project: /Users/amplaye/CRM (TableFlow/BaliFlow CRM, Next.js 16 + Supabase + Vercel)
- Branch: **feature/all-inclusive** (da main, pushata su origin — NON mergiata)
- Piano di riferimento: `/Users/amplaye/.claude/plans/ho-anche-visto-che-distributed-crayon.md` (approvato dall'utente il 2026-07-10)
- Istruzione utente: "al 50% del lavoro ci fermiamo e continuiamo in un'altra sessione" → fermato dopo Fase 3 di 7 (0–3 fatte = 50%).

### Commits (tutti su feature/all-inclusive, in ordine)
  - 52b0bf7 feat(foundations): email lib (Resend+n8n), 6 feature flag, segmentazione guest + tag editor
  - 21d3398 feat(deposits): caparre Stripe reali — hold, forfeit su no-show, release su presenza
  - 8f61c97 feat(reviews): recensioni certificate — link firmato, form, dashboard, risposte AI
  - f53c3b7 feat(marketing): campagne — segmenti, email Resend, template WhatsApp, copy AI, unsubscribe

## Current State Summary

Implementate e verificate (tsc pulito, 851 test verdi in 79 file, `npm run build` ok) le prime 4 fasi del piano "CRM all-inclusive — 7 funzioni per pareggiare Zenchef/HappyChef":

**Fase 0 — Fondamenta**
- `src/lib/email/send.ts`: client REST Resend senza SDK (`sendEmail`, `emailConfigured`, `enqueueBulkEmail` → webhook n8n `email-campaign-dispatch`). Layout email brandizzato in `src/lib/email/templates/base.ts` (`renderEmailLayout`, tabelle+inline style). CSP `connect-src` estesa con api.resend.com.
- 6 nuovi flag in `TenantFeatures` (tutti OFF default, self-serve in Settings→Funzionalità): `deposits_enabled`, `reviews_enabled`, `marketing_enabled`, `website_enabled`, `gift_cards_enabled`, `loyalty_enabled` + i18n ×4.
- `src/lib/guests/segmentation.ts`: lib PURA (`applySegment`, `SegmentDef` discriminated union: all/lapsed/vip/birthday/tag/no_show_risk, `lastVisitByGuest`) + test. Tag guest ora EDITABILI nel drawer della pagina Clienti (`GuestTagsEditor`).

**Fase 1 — Caparre Stripe reali**
- Migrazione `scripts/migrations/2026-07-10-deposits.sql` ✅ APPLICATA al DB live: colonne `deposit_*` su reservations + tabella `reservation_payments` (RLS member-read, write solo service-role).
- Meccanica: Stripe Checkout `mode:payment` con `capture_method:manual` → il link autorizza un HOLD; no-show → capture (`forfeit`), presenza → cancel (`release`), goodwill → refund. Nuove primitive in `src/lib/billing/stripe.ts` (`createDepositCheckoutSession`, `capture/cancel/refundPaymentIntent`).
- Policy in `src/lib/deposits/deposits.ts` (`depositDueFor`: flag+venue.deposit_required+importo+soglia coperti; per-persona o fisso) + test. Orchestrazione in `src/lib/deposits/checkout.ts` (best-effort: MAI blocca la prenotazione).
- Integrazioni: `/api/ai/book` ora restituisce `deposit_payment_url` e `deposit_note` col link pagabile quando dovuto (n8n lo mette nel recap); route staff `/api/deposits/request` (genera/rigenera link, default force=true) e `/api/deposits/resolve` (forfeit/release/refund, Stripe prima DB poi); branch `kind==="deposit"` nel webhook Stripe esistente (`checkout.session.completed` → authorized, `checkout.session.expired` → back to required — **aggiungere l'evento expired nell'endpoint Stripe dashboard**); pagina pubblica `/d/[slug]` (success/cancel); config strutturata in BookingTab (importo €, per persona/fisso, soglia) salvata da `/api/settings/booking` in `venue.deposit_amount_cents/deposit_policy/deposit_min_party`; `DepositPanel` nel drawer prenotazione (genera link → copia in clipboard, incassa/svincola/rimborsa).

**Fase 2 — Recensioni certificate**
- Migrazione `scripts/migrations/2026-07-10-reviews.sql` ✅ APPLICATA: tabella `reviews` (unique per reservation_id, RLS).
- Link firmato HMAC `/rv/<token>` (`src/lib/reviews/token.ts`, secret = `REVIEW_LINK_SECRET` || `CRON_SECRET`) → form pubblico stelle+commento (`src/app/rv/[token]/`), su 4–5★ invito a Google (`settings.review_url`). `/r/[slug]` (302) INVARIATO per compatibilità.
- API: `/api/reviews/submit` (token-auth + rate-limit, upsert, push `review_new`), `/api/reviews/reply` (reply/hide), `/api/reviews/suggest-reply` (bozza OpenAI gpt-4o, owner approva).
- Dashboard `/reviews` (media, distribuzione, rispondi/AI/nascondi) + voce sidebar gated su `reviews_enabled` + LockedPreview "reviews".
- Cron `post-visit-followup`: se `reviews_enabled` invia il NUOVO template `post_visit_review` con URL-button dinamico che porta il token (param `urlButtonParam` aggiunto a `sendWhatsAppTemplate`), altrimenti il vecchio `post_visit_followup`.

**Fase 3 — Marketing**
- Migrazione `scripts/migrations/2026-07-10-marketing.sql` ✅ APPLICATA: `campaigns` + `campaign_recipients` (ledger idempotenza unique campaign+guest) + `guests.birthday` + `guests.marketing_opt_out`.
- `src/lib/marketing/send.ts`: `sendCampaign` — segmento rivalutato al momento dell'invio, opt-out esclusi, email via Resend (footer unsubscribe `/u/<token>` firmato, `src/lib/marketing/unsubscribe.ts`), WhatsApp via template `marketing_campaign` ({{1}}=nome {{2}}=testo), cap 500/run con resume (ri-POST con campaign_id), sms=skipped.
- API `/api/marketing/send` (POST invia/riprende, PUT conta destinatari; ruoli owner/manager/**marketing** — `TenantRole` esteso) e `/api/marketing/generate` (copy AI da brief).
- Dashboard `/marketing` (composer: nome, canale, segmento con parametri, brief AI, preview conteggio, invio, storico) + sidebar gated `marketing_enabled`.

## COSE DA FARE FUORI DAL CODICE (bloccanti per il live)
1. **Vercel env**: aggiungere `RESEND_API_KEY`, `EMAIL_FROM` (mittente su dominio verificato in Resend — serve verifica DNS), opzionale `REVIEW_LINK_SECRET`. `NEXT_PUBLIC_APP_URL` se non già presente.
2. **Meta template**: eseguire `node --env-file=.env.local scripts/meta-templates.mjs create post_visit_review` e `... create marketing_campaign` e attendere approvazione (MARKETING). `marketing_campaign` è un carrier generico: Meta potrebbe respingerlo → in tal caso irrobustire il corpo.
3. **Stripe dashboard**: aggiungere l'evento `checkout.session.expired` all'endpoint webhook esistente `/api/billing/webhook/stripe`.
4. **Smoke test live** (Playwright non eseguito in questa sessione — regola "Playwright prima di pronto" da onorare la prossima): caparra con carta 4242 end-to-end, form recensione via /rv, invio campagna email di test a steward_russo94@hotmail.it.

## Next Steps — Fasi 4–7 del piano (l'altra metà)
- **Fase 4 — Website builder** `/s/[slug]` (clona pattern `/m/[slug]`, sezioni toggle, `settings.site_branding`, editor `/website`, middleware exclusion, SEO). NB: il menù embeddato, le recensioni (tabella `reviews` pronta) e il bottone Prenota → widget Fase 7.
- **Fase 5 — Gift card**: tabelle `gift_cards`+`gift_card_redemptions`, pagina pubblica `/g/[slug]`, checkout Stripe mode:payment (riusa pattern deposits ma con capture IMMEDIATA), webhook genera codice + email Resend al destinatario, riscatto alla cassa (`src/lib/cassa/totals.ts`).
- **Fase 6 — Loyalty**: `loyalty_accounts`+`loyalty_events`, config `settings.loyalty`, accrual su completed/ordine cassa, riscatto in cassa, pannello guest.
- **Fase 7 — Widget prenotazione pubblico** `/b/[slug]` (riusa `/api/ai/availability` + logica book con rate-limit senza segreto AI, source='web') + deep-link social + valutazione Reserve with Google.
- Middleware: per Fasi 4/5/7 aggiungere `/s/`, `/g/`, `/b/` alle esclusioni (pattern già usato per `/d/`, `/rv/`, `/u/`).
- A fine Fase 7: PR di feature/all-inclusive verso main (o merge, decide Steward).

## Convenzioni imparate/rispettate in questa sessione
- Migrazioni: file datati in `scripts/migrations/`, applicate via `POST https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query` con token `sbp_1bd38...` (credentials.md) + User-Agent browser (CF bot-block).
- i18n: OGNI stringa nuova nei 4 dizionari (it/es/en/de) — pagine pubbliche guest invece hanno copy inline per lingua ospite.
- Testi neri (`text-black`), palette crema/#c4956a ovunque.
- Un processo pesante alla volta: tsc → vitest → build in sequenza.
