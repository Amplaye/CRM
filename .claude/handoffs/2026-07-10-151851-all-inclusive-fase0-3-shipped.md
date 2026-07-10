# Handoff: Piano all-inclusive — Fasi 0–3 shippate (50%), prossima sessione Fasi 4–7

## Session Metadata
- Created: 2026-07-10 15:18:51
- Project: /Users/amplaye/CRM (TableFlow/BaliFlow CRM, Next.js 16 + Supabase + Vercel)
- Branch: feature/all-inclusive (da main, pushata su origin — NON mergiata)
- Session duration: ~45 minuti, esecuzione autonoma del piano approvato
- Piano di riferimento: `/Users/amplaye/.claude/plans/ho-anche-visto-che-distributed-crayon.md`
- Istruzione utente: "al 50% del lavoro ci fermiamo e continuiamo in un'altra sessione" → fermato dopo Fase 3 di 7 (Fasi 0–3 = 50%).

### Recent Commits (for context)
  - 636af42 docs(handoff): enrich all-inclusive handoff — context, files, gotchas, next steps (score 92)
  - fc097c1 docs(handoff): all-inclusive Fasi 0-3 shipped, next session continues Fasi 4-7
  - f53c3b7 feat(marketing): campaign suite — segments, email via Resend, WhatsApp template, AI copy, unsubscribe
  - 8f61c97 feat(reviews): certified guest reviews — signed link, in-house form, dashboard, AI replies
  - 21d3398 feat(deposits): real Stripe booking deposits — hold, forfeit on no-show, release on show-up
  - 52b0bf7 feat(foundations): email lib (Resend+n8n), 6 all-inclusive feature flags, guest segmentation + tag editor

## Handoff Chain

- **Continues from**: [2026-07-08-015236-quattro-feature-shipped-export-push-qr-turni.md](./2026-07-08-015236-quattro-feature-shipped-export-push-qr-turni.md)
  - Previous title: 4 feature CRM shippate — export report, web push, QR self-order, turni staff
- **Supersedes**: [2026-07-10-151700-all-inclusive-fase0-3-shipped.md](./2026-07-10-151700-all-inclusive-fase0-3-shipped.md) (stessa sessione, versione precedente di questo stesso handoff — contenuto equivalente)

## Current State Summary

Implementate, testate e pushate le prime 4 fasi (0–3) del piano "CRM all-inclusive — 7 funzioni per pareggiare Zenchef/HappyChef": fondamenta (email Resend, 6 feature flag, segmentazione guest), caparre Stripe reali con pre-autorizzazione, recensioni certificate con link firmato e dashboard, e suite marketing con campagne a segmenti. Verifiche superate PRIMA di ogni push: `npx tsc --noEmit` pulito, `npm test` 851 test verdi in 79 file (21 test nuovi), `npm run build` ok. Le 3 migrazioni SQL sono GIÀ applicate al DB Supabase di produzione (project ref azhlnybiqlkbhbboyvud) via Management API. Il lavoro vive su `feature/all-inclusive`: niente è in produzione finché non si mergia in main. Restano le Fasi 4–7 (website builder, gift card, loyalty, widget prenotazione) più 4 azioni fuori dal codice (env Resend, 2 template Meta da approvare, evento Stripe, Playwright E2E).

## Codebase Understanding

### Architecture Overview

- Multi-tenant: ogni route API prende `tenant_id` dal body e chiama `verifyTenantMembership()`; scritture via service-role client, letture dashboard via client anon+RLS (`private.is_tenant_member` / `get_tenant_role` / `is_platform_admin`).
- Gating a due livelli per le 7 funzioni nuove: piano attivo (`hasActivePlan`) + flag `*_enabled` gratuito in `settings.features` (default OFF, self-serve in Settings→Funzionalità). NON sono add-on a pagamento — decisione utente "all-inclusive a prezzo fisso".
- Pagine pubbliche guest (pattern `/m/[slug]`): service-role read, nessuna auth, esclusione esplicita nel middleware (`src/lib/supabase/middleware.ts`). Nuove in questa sessione: `/d/[slug]` (esito caparra), `/rv/[token]` (form recensione), `/u/[token]` (unsubscribe).
- WhatsApp = Meta Cloud API; fuori finestra 24h SOLO template approvati (registrati in `scripts/meta-templates.mjs`).
- Client REST senza SDK per i provider (Stripe, Resend, OpenAI Responses) — idioma consolidato del repo.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| /Users/amplaye/.claude/plans/ho-anche-visto-che-distributed-crayon.md | Il piano completo approvato (Fasi 0–7) | Fonte di verità per le Fasi 4–7 da fare |
| src/lib/types/tenant-settings.ts | TenantFeatures + FEATURE_FLAGS + TenantSettings | I 6 flag nuovi vivono qui |
| src/lib/guests/segmentation.ts | SegmentDef + applySegment (lib pura) | Riusata da marketing; loyalty/reviews possono riusarla |
| src/lib/deposits/{deposits.ts,checkout.ts} | Policy caparra + creazione Checkout | Fase 5 (gift card) riusa lo stesso pattern Stripe |
| src/lib/email/{send.ts,templates/base.ts} | Client Resend + layout email | Fase 5 invia il codice gift via email da qui |
| src/lib/reviews/token.ts, src/lib/marketing/unsubscribe.ts | Token HMAC firmati | Pattern da riusare per ogni link pubblico firmato |
| src/app/api/billing/webhook/stripe/route.ts | Webhook Stripe unico (billing + deposits) | Fase 5 aggiunge qui il branch gift card |
| scripts/meta-templates.mjs | Registro template WhatsApp (ora con URL-button) | 2 template nuovi da creare/approvare |
| scripts/migrations/2026-07-10-{deposits,reviews,marketing}.sql | Le 3 migrazioni della sessione | GIÀ applicate al DB live |
| src/components/layout/Sidebar.tsx | Nav con filtri per feature flag | Fasi 4–6 aggiungono voci qui |

### Key Patterns Discovered

- Migrazioni: file datati in `scripts/migrations/`, applicati con `POST https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query` (token `sbp_1bd38...` in credentials.md) + **User-Agent browser** obbligatorio (Cloudflare bot-block). Risposta `[]` = successo.
- i18n: ogni stringa dashboard nei 4 dizionari `src/lib/i18n/dictionaries/{it,es,en,de}.ts`; le pagine pubbliche guest hanno invece copy inline per lingua ospite (i dizionari sono per la UI CRM).
- UI: testi neri (`text-black`, mai grigi), palette crema `#fcf6ed` / accento `#c4956a`, bordi `border-2`.
- `getFeatures()` deriva `management_enabled` dal billing (add-on pagato); i flag nuovi sono raw — NON copiare quel pattern.
- system_logs: colonne `title`+`description`, categoria da enum chiuso (usato `api_error`), logging sempre in try/catch.
- Un processo pesante alla volta: tsc → vitest → build in sequenza, MAI `npm run dev`.

## Work Completed

### Tasks Finished

- [x] Fase 0.1 — `src/lib/email/send.ts` (Resend REST: `sendEmail`, `emailConfigured`, `enqueueBulkEmail`→n8n) + `templates/base.ts` (`renderEmailLayout`) + CSP `connect-src` api.resend.com
- [x] Fase 0.2 — 6 flag (`deposits/reviews/marketing/website/gift_cards/loyalty_enabled`, tutti OFF) in TenantFeatures/DEFAULT_FEATURES/FEATURE_FLAGS + i18n ×4
- [x] Fase 0.3 — `segmentation.ts` (all/lapsed/vip/birthday/tag/no_show_risk) con 7 test; tag guest editabili nel drawer Clienti (`GuestTagsEditor`)
- [x] Fase 1 — caparre: migrazione applicata (deposit_* su reservations + `reservation_payments`), `depositDueFor` (7 test), Checkout manual-capture, integrazione `/api/ai/book` (risposta ora ha `deposit_payment_url` + `deposit_note` col link), route `/api/deposits/request` e `/api/deposits/resolve`, branch deposit nel webhook (completed+expired), `/d/[slug]`, config in BookingTab (importo €/per-persona-fisso/soglia), `DepositPanel` nel drawer prenotazione, i18n ×4
- [x] Fase 2 — recensioni: migrazione applicata (`reviews` unique per reservation), token HMAC (3 test), `/rv/[token]` form pubblico (stelle+commento, bounce Google su 4–5★), `/api/reviews/{submit,reply,suggest-reply}`, dashboard `/reviews` + sidebar + LockedPreview "reviews", push `review_new`, cron follow-up invia `post_visit_review` con token quando `reviews_enabled`, `sendWhatsAppTemplate` ora supporta `urlButtonParam`, i18n ×4
- [x] Fase 3 — marketing: migrazione applicata (`campaigns`+`campaign_recipients`+`guests.birthday`+`guests.marketing_opt_out`), `sendCampaign` (cap 500, ledger idempotente, resume), `/api/marketing/send` (POST/PUT) + `/api/marketing/generate` (copy AI), `/u/[token]` unsubscribe, template `marketing_campaign`, dashboard `/marketing` + sidebar, ruolo `marketing` in TenantRole, i18n ×4
- [x] tsc pulito + 851 test verdi + build ok, commit+push per fase, memoria aggiornata (`project_crm_all_inclusive_7_features.md` + MEMORY.md)

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| src/lib/types/tenant-settings.ts | +6 flag in interface/defaults/FEATURE_FLAGS | Gate self-serve delle 7 funzioni |
| src/lib/i18n/dictionaries/{it,es,en,de}.ts | ~90 chiavi nuove ×4 lingue | Regola i18n del repo |
| next.config.ts | connect-src + api.resend.com | CSP per Resend |
| src/app/(dashboard)/guests/page.tsx | +GuestTagsEditor nel drawer | I tag alimentano i segmenti marketing |
| src/lib/billing/stripe.ts | +createDepositCheckoutSession, capture/cancel/refundPaymentIntent | Primitive caparre (manual capture) |
| src/lib/onboarding/kb-generator.ts | VenueInfo + deposit_amount_cents/policy/min_party | Config strutturata caparra |
| src/app/api/ai/book/route.ts | select name/slug; genera link caparra; deposit_note→link | Il bot consegna il link pagabile nel recap |
| src/app/api/billing/webhook/stripe/route.ts | branch kind=deposit + case checkout.session.expired | Stato caparra scritto solo da Stripe firmato |
| src/app/api/settings/booking/route.ts | accetta/persiste i 3 campi deposit strutturati | Editabile da BookingTab |
| src/components/settings/BookingTab.tsx | +importo €, per-persona/fisso, soglia coperti | UI config caparra |
| src/app/(dashboard)/reservations/page.tsx | +DepositPanel (genera link/incassa/svincola/rimborsa) | Operatività staff sulle caparre |
| src/lib/types/index.ts | Reservation + deposit_status/amount/currency | Tipi per la UI |
| src/lib/supabase/middleware.ts | esclusioni /d/ /rv/ /u/ | Pagine pubbliche guest |
| src/lib/whatsapp/meta.ts | +urlButtonParam su sendWhatsAppTemplate | URL-button dinamico del template recensione |
| src/lib/push/send.ts | +evento review_new | Notifica staff su nuova recensione |
| src/app/api/cron/post-visit-followup/route.ts | template condizionale + token firmato | Recensioni certificate dal follow-up |
| src/components/billing/LockedPreview.tsx | +sezione "reviews" con demo | Plan-gate coerente col resto |
| src/components/layout/Sidebar.tsx | +Reviews e +Marketing (gated sui flag) | Navigazione |
| src/lib/tenant-membership.ts | TenantRole + "marketing" | Ruolo dedicato campagne (solo API) |
| scripts/meta-templates.mjs | +post_visit_review (URL button) +marketing_campaign; buildComponents supporta URL button | Invii fuori finestra 24h |
| Nuovi file | vedi elenco commit (lib email/deposits/reviews/marketing, route api, pagine /d /rv /u /reviews /marketing, 3 migrazioni, 3 file di test) | — |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Caparra = pre-autorizzazione (capture_method:manual) | Addebito immediato + refund; card-imprint off-session | Miglior UX guest (nessun rimborso da attendere se si presenta); no-show → capture. Limite accettato: hold Stripe scade ~7gg |
| Webhook deposits nell'endpoint billing esistente | Endpoint dedicato stripe-deposit con secret proprio | Un solo signing secret da gestire; `metadata.kind` discrimina |
| Recensioni via NUOVO template `post_visit_review` + `/rv/<token>` | Modificare `post_visit_followup`; form aperta su /r/[slug] | I template Meta approvati non si modificano; il token HMAC rende le recensioni CERTIFICATE (solo veri clienti); /r resta invariato per compatibilità |
| Email con template-string, niente react-email | @react-email/render | Zero dipendenze nuove (idioma no-SDK del repo); le email sono statiche |
| Invio campagne inline cap 500 + ledger resume | Orchestrazione n8n subito | Il workflow n8n non esiste ancora; in dev senza clienti il cap basta; `enqueueBulkEmail` già predisposto per il passaggio |
| Flag nuovi = raw flags (non derivati dal billing) | Pattern management_enabled (derivato da add-on) | Sono funzioni core del piano, non add-on a pagamento (decisione utente) |
| Fermarsi dopo Fase 3 | Continuare con Fase 4 | Istruzione esplicita utente: stop al 50% del lavoro |

### Assumptions Made

- L'account Stripe unico (della piattaforma) va bene in dev; Stripe Connect si valuta prima del primo cliente reale che incassa (nota aperta nel piano).
- `CRON_SECRET` esiste già su Vercel (usato dai cron) → fallback valido per i token HMAC finché non si aggiunge `REVIEW_LINK_SECRET`.
- Il template "carrier" `marketing_campaign` passa l'approvazione Meta (rischio noto, vedi gotchas).
- `NEXT_PUBLIC_APP_URL` risolve a https://crm.baliflowagency.com (fallback hardcoded coerente col checkout billing esistente).

## Important Context

1. **Branch, non main**: tutto su `feature/all-inclusive` (52b0bf7→636af42). Deploy Vercel auto parte solo da main → nulla è live. Le 3 migrazioni però sono GIÀ nel DB di produzione (additive e innocue: tutto gated da flag OFF).
2. **Il flusso caparra completo**: bot/staff genera link → guest paga → webhook `checkout.session.completed` (kind=deposit) → `deposit_status='authorized'` → staff da drawer prenotazione: "Incassa (no-show)" = capture, "Svincola (presentato)" = cancel, "Rimborsa" = refund su forfeited. Sessione scaduta → `checkout.session.expired` riporta a 'required'.
3. **Il flusso recensione**: cron post-visit-followup (trigger n8n/esterno, non vercel.json) → se `reviews_enabled` template `post_visit_review` con bottone URL `https://crm.baliflowagency.com/rv/{{1}}` (var = token HMAC) → form → `/api/reviews/submit` (upsert per reservation) → push staff → dashboard `/reviews`.
4. **Il flusso campagna**: `/marketing` → segmento (SegmentDef jsonb) → PUT conta destinatari → POST crea+invia (email Resend con footer unsubscribe firmato; WhatsApp template `marketing_campaign`) → ledger `campaign_recipients`; ri-POST con `campaign_id` riprende pending/failed.
5. **Secret**: nessun secret nuovo in git. Da aggiungere su Vercel: `RESEND_API_KEY`, `EMAIL_FROM`, opzionale `REVIEW_LINK_SECRET`.

## Potential Gotchas

- Hold Stripe scade ~7 giorni → caparre su prenotazioni molto in anticipo possono perdere il hold; la resolve route ritorna l'errore Stripe (502) in quel caso.
- `applySegment` "lapsed" esclude di proposito chi non ha MAI visitato (prospect ≠ lapsed).
- `deposit_min_party` assente/0 → fallback a `bot_config.party_size_threshold_large` (default 7); 1 = sempre; la route staff `/api/deposits/request` forza la soglia di default (intenzionale).
- `marketing_campaign` è un template carrier generico: Meta può respingerlo in approvazione → irrobustire il corpo attorno alla variabile se succede.
- I dizionari i18n sono typed sul file en.ts: una chiave aggiunta in una lingua sola rompe tsc — sempre ×4.
- Playwright E2E NON eseguito in questa sessione (regola "Playwright prima di pronto" da onorare prima del merge).

## Pending Work — azioni fuori dal codice (bloccanti per il live)

- [ ] Vercel env: `RESEND_API_KEY`, `EMAIL_FROM` (dominio verificato su Resend, serve DNS), opzionale `REVIEW_LINK_SECRET`
- [ ] `node --env-file=.env.local scripts/meta-templates.mjs create post_visit_review` e `... create marketing_campaign` + attendere approvazione Meta
- [ ] Dashboard Stripe: aggiungere evento `checkout.session.expired` all'endpoint `/api/billing/webhook/stripe`
- [ ] Smoke test live + Playwright E2E: caparra carta 4242, form `/rv`, campagna email di test a steward_russo94@hotmail.it

## Immediate Next Steps

1. Restare sul branch `feature/all-inclusive`; rileggere il piano (`ho-anche-visto-che-distributed-crayon.md`) sezioni FASE 4–7.
2. **Fase 4 — Website builder**: clonare il pattern `/m/[slug]` in `src/app/s/[slug]/page.tsx` (hero, orari, contatti, mappa, menù embeddato, recensioni dalla tabella `reviews`, CTA Prenota→Fase 7, gift→Fase 5); editor a sezioni (NO drag-drop) in `src/app/(dashboard)/website/page.tsx`; `settings.site_branding` (`hero_url, sections[], brand_color, font, about_text, gallery[]`); esclusione `/s/` nel middleware; sidebar gated `website_enabled`; opengraph/sitemap.
3. **Fase 5 — Gift card**: tabelle `gift_cards`+`gift_card_redemptions`; `/g/[slug]` pubblica; checkout Stripe mode:payment con capture IMMEDIATA (a differenza delle caparre); webhook genera codice + email Resend al destinatario; riscatto alla cassa (`src/lib/cassa/totals.ts`); gestione in dashboard.
4. **Fase 6 — Loyalty**: `loyalty_accounts`+`loyalty_events`; config `settings.loyalty`; accrual su completed/ordine cassa; riscatto in cassa; pannello nel dettaglio guest.
5. **Fase 7 — Widget prenotazione** `/b/[slug]`: riusa `/api/ai/availability` + logica book con rate-limit senza segreto AI, `source='web'`; deep-link social; Reserve-with-Google come follow-up se serve partner.
6. Dopo ogni fase: tsc → vitest → build, commit+push. A fine: Playwright E2E sui flussi guest, poi PR verso main.
