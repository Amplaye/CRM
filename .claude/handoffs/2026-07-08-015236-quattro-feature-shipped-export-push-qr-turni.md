# Handoff: 4 feature CRM shippate — export report, web push, QR self-order, turni staff

## Session Metadata
- Created: 2026-07-08 01:52:36 (Europe/Rome)
- Project: /Users/amplaye/CRM (TableFlow/BaliFlow CRM, Next.js 16 + Supabase + Vercel)
- Branch: main (pushed 8b010e8 → 10db0ff, deploy Vercel automatico partito)
- Session duration: ~50 minuti, sessione autonoma

### Recent Commits (for context)
  - 10db0ff feat(staff): full shift planner — weekly rota, time-off/swap requests, push
  - 25d1f5f feat(self-order): QR table ordering into the native cassa shared cart
  - ebfaa7c feat(push): web push notifications for the installed PWA
  - 4362d9e feat(reports): CSV + branded PDF export on Analytics and P&L
  - 8b010e8 fix(pwa): true offline boot — cache route HTML network-first + offline tenant context

## Handoff Chain

- **Continues from**: [2026-07-07-130816-cassa-realtime-cart-print-cash-guard-shipped.md](./2026-07-07-130816-cassa-realtime-cart-print-cash-guard-shipped.md)
  - Previous title: cassa realtime cart + print + cash guard shipped
- **Supersedes**: None

## Current State Summary

Sessione autonoma partita dal piano `/Users/amplaye/.claude/plans/fammi-un-piano-piano-peppy-snowflake.md` ("Piano prossima sessione — 4 feature CRM", scritto la sessione precedente). Tutte e 4 le feature sono implementate, committate una per una e pushate su `main`: (1) export CSV+PDF su Analytics e P&L, (2) web push per la PWA installata, (3) QR self-ordering dal tavolo verso il carrello condiviso della cassa nativa, (4) pianificatore turni staff completo con richieste ferie/cambio. Verifiche PRIMA del push: `npx tsc --noEmit` pulito, `npm test` 76 file / 834 test verdi (7 nuovi test export + 11 nuovi shift-rules), `npm run build` ok (unico warning pre-esistente turbopack root). Restano SOLO 2 migration manuali da applicare su Supabase e lo smoke test live.

## Important Context

1. **Le uniche cose NON fatte**: le 2 migration manuali su Supabase (`2026-07-08-push-subscriptions.sql`, `2026-07-08-staff-shifts.sql`) e lo smoke test live. Senza migration: il toggle push fa 500 e /staff resta vuota — tutto il resto del CRM funziona normalmente.
2. **VAPID già a posto** su Vercel production e `.env.local` (gitignored) — NON rigenerarle: rigenerare le chiavi invaliderebbe le subscription esistenti.
3. Il proprietario verifica sul sito live (deploy auto GitHub→Vercel da main); commit diretto su main è la prassi di questo repo.
4. Regole repo vincolanti: i18n in tutti e 4 i dizionari, MAI `npm run dev`, un solo processo pesante alla volta, Next.js 16 docs in `node_modules/next/dist/docs/`.

## Codebase Understanding

### Architecture Overview

- **Realtime cassa**: la dashboard /cassa è GIÀ sottoscritta a `cassa_order_items` per tenant → qualunque insert server-side di righe draft (comanda_no 0, status 'draft') appare live nel carrello condiviso, zero modifiche al codice cassa. Il self-order sfrutta esattamente questo.
- **Route cassa** gated da `requireCassaAccess()` (membership + add-on gestionale); route pubbliche = service role + risoluzione slug + validazioni esplicite + `assertRateLimit(req, scope, {max, windowSecs})` (chiave per-IP).
- **Feature flag self-serve**: aggiungere un campo a `TenantFeatures` + `DEFAULT_FEATURES` + `FEATURE_FLAGS` (+2 chiavi i18n ×4 dizionari) → FeaturesTab (Settings→Funzionalità) lo renderizza da solo; lettura effettiva via `getFeatures(settings)`.
- **Push architecture**: niente cron (Hobby = solo daily) → l'invio è agganciato ai write-path server (webhook/route AI). `sendPushToTenant(tenantId, event, params, opts)` in `src/lib/push/send.ts`: copy localizzata server-side (4 lingue via `tenants.settings.crm_locale`), fan-out alle `push_subscriptions` del tenant, cleanup endpoint morti (404/410), opts `onlyUserId` / `roles` / `excludeUserId` per targeting. Sempre fire-and-forget (`void`), mai bloccante.
- **Nav sidebar**: label = `t("nav_" + name.toLowerCase())`; visibilità host tramite filtro esplicito in `visibleNavItems` (Sidebar.tsx ~riga 168).
- **RLS pattern**: `private.is_tenant_member(tenant_id)` / `private.get_tenant_role(tenant_id) in ('owner','manager')` — copiato dalla migration cassa.
- **verifyTenantMembership(tenantId, roles?)** = gate standard per route server; per platform_admin ritorna `{role: "owner"}`.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `scripts/migrations/2026-07-08-push-subscriptions.sql` | tabella push_subscriptions + RLS own-row | ⚠️ DA APPLICARE A MANO su Supabase |
| `scripts/migrations/2026-07-08-staff-shifts.sql` | staff_shifts + shift_requests + RLS | ⚠️ DA APPLICARE A MANO su Supabase |
| `src/lib/push/send.ts` | fan-out web-push, eventi+copy 4 lingue | cuore del push; estendere qui per nuovi eventi |
| `src/app/api/push/subscribe/route.ts` | POST upsert / DELETE subscription (auth+membership) | endpoint client toggle |
| `src/lib/hooks/usePushSubscription.ts` | hook client subscribe/unsubscribe per-device | usato da GeneralTab |
| `public/sw.js` | v3: handler `push` + `notificationclick` in coda | SAFETY CONTRACT caching INTATTO; prossima modifica logica → v4 |
| `src/app/api/public/order/route.ts` | endpoint pubblico self-order (anonimo, rate-limited) | ri-deriva prezzi/IVA dal DB, solo append draft |
| `src/app/m/[slug]/SelfOrderMenu.tsx` | UI ordering mobile (client) | carrello, varianti, note, submit |
| `src/app/m/[slug]/page.tsx` | order-mode: `?table=` + flag + `SELF_ORDER_STRINGS` | select `variants` SOLO in order-mode |
| `src/components/floor/TableQrModal.tsx` | stampa foglio A4 2×2 QR per tavolo | bottone in /floor, visibile solo con flag ON |
| `src/lib/staff/shift-rules.ts` (+ .test.ts) | overlap/validazione turni, puro e testato | gestisce turni a cavallo di mezzanotte (end<=start = +24h) |
| `src/app/api/staff/shifts/route.ts` | GET settimana / POST / PATCH / DELETE (manager) | 409 `shift_conflict` su overlap |
| `src/app/api/staff/requests/route.ts` | crea richiesta (solo propria) / approva/rifiuta | approve time_off→cancella turni del giorno; swap→riassegna |
| `src/app/(dashboard)/staff/page.tsx` | pagina turni completa (era un redirect) | griglia settimana + Richieste + Team (StaffTab embedded) |
| `src/lib/export/to-csv.ts`, `to-pdf.ts` | export condiviso (CSV `;`, PDF pdf-lib brandizzato) | usati da /pl e /analytics |
| `src/lib/types/tenant-settings.ts` | flag `self_order_enabled` aggiunto | TenantFeatures + DEFAULT_FEATURES + FEATURE_FLAGS |

### Key Patterns Discovered

- La pagina pubblica `/m/[slug]` NON usa `t()`: stringhe in mappe locali server-side per le 4 lingue (`PUBLIC_STRINGS`, ora anche `SELF_ORDER_STRINGS`) — seguire questo pattern per future stringhe pubbliche.
- Copy delle notifiche push = server-side in `send.ts` (renderizzata dall'OS, non dalla UI); le stringhe UI del toggle invece stanno nei 4 dizionari come da regola i18n.
- "Push abilitate" = esiste una riga `push_subscriptions` per quel device; nessuna preferenza server separata. Subscribe SEMPRE da gesto utente (mai al load — iOS penalizza).
- `cassa_orders` creati dal QR: `opened_by null`, `opened_by_name "QR"`, covers 0, `cover_unit` snapshot dai settings (quando lo staff mette i coperti il coperto è già giusto).
- Commit per feature ma push su main SOLO a fine sessione dopo build verde (main auto-deploya su Vercel).

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| PDF con pdf-lib (già in deps), tabelle semplici, NIENTE grafici | pdf-lib è low-level; i chart recharts sono SVG client, rasterizzarli non vale la pena in v1 |
| `sanitize()` WinAnsi in to-pdf.ts | i font standard pdf-lib sono WinAnsi-only: unicode fuori set (emoji ecc.) → "?" invece di throw |
| UI self-order dedicata (`SelfOrderMenu`) invece di prop `orderMode` sui 4 template vetrina | ordinare richiede UI funzionale (carrello/varianti/submit); i template showcase restano intoccati. Deviazione consapevole dal piano |
| Endpoint pubblico riceve solo id+qty+nomi varianti+note; prezzi/IVA/reparto ri-derivati dal DB | mai fidarsi del client su soldi; può solo APPENDERE draft, mai modificare/pagare |
| Self-order richiede sessione cassa aperta (409 `cassa_closed`) | senza staff al lavoro l'ordine non ha dove andare; messaggio chiaro al cliente |
| Flag `self_order_enabled` in TenantFeatures (default OFF) invece di `settings.self_order` custom | riusa FeaturesTab/getFeatures gratis: toggle owner già pronto |
| QR = `/m/<slug>?table=<restaurant_tables.id>` | id stabile → sticker permanente, sopravvive a rename tavolo e modifiche menù |
| Turni: band lunch/dinner/all con preset orari ma orari liberi; overlap gestisce mezzanotte | i ristoranti chiudono dopo mezzanotte (cena 19:00–01:00) |
| Approve time_off → status 'cancelled' (non delete) | lascia traccia storica; delete hard esiste solo per errori del manager |
| Push mirate per i turni: `onlyUserId` (assegnatario/richiedente), `roles` owner+manager (nuove richieste) | evita spam a tutto il team; per questo send.ts ha guadagnato le opts di targeting |
| Push in `createReservationAction` SOLO per source ai_agent/online | lo staff che crea a mano dalla dashboard è già davanti all'app, notificarlo è rumore |
| Push su conversazioni: solo nuova conversazione + PRIMA escalation (`existing.status !== 'escalated'`) | pushare ogni messaggio appendato sarebbe spam |
| VAPID generate e messe su Vercel production via CLI dalla sessione stessa | CLI già loggata (`amplaye`), repo linkato; il piano lo prevedeva |
| chiavi i18n `staff_page_title`/`staff_page_subtitle` | `staff_title`/`staff_subtitle` GIÀ ESISTONO (tab staff in Settings) → duplicarle = errore TS1117 |

## Potential Gotchas

- **t() ritorna la KEY quando manca** → ogni chiave nuova va in TUTTI e 4 i dizionari (fatto per ~60 chiavi; se ne aggiungi, stessa regola).
- I dizionari sono oggetti letterali: chiave duplicata = TS1117 a build; grep prima di aggiungere.
- `public/sw.js`: bump `CACHE_VERSION` SOLO quando cambia la logica del SW (ora v3); NON toccare le regole di caching (contratto di sicurezza documentato in testa al file).
- Senza migration applicate: push subscribe → 500; /staff → griglia vuota (select falliscono in silenzio). Tutto il resto funziona.
- VAPID assenti (es. env preview) → push è no-op silenzioso by design, nessun errore.
- Vercel CLI `env add` in questa shell è interattiva-only per alcuni target: production è andata via stdin-pipe, preview no (non critico).
- `.env.local` contiene ora anche le VAPID — è gitignored, MAI committarlo.
- Un solo processo pesante alla volta (tsc / vitest / build in sequenza), MAI `npm run dev`.
- Next.js 16 con breaking changes: consultare `node_modules/next/dist/docs/` prima di scrivere codice Next nuovo.

## Pending Work

- [x] Feature 1–4 implementate, testate, committate, pushate su main
- [x] VAPID su Vercel production + `.env.local`; memoria aggiornata (`crm-2026-07-08-four-features.md` + MEMORY.md)
- [ ] **Migration `2026-07-08-push-subscriptions.sql` su Supabase SQL editor** (MANUALE — proprietario avvisato; idempotente)
- [ ] **Migration `2026-07-08-staff-shifts.sql` su Supabase SQL editor** (MANUALE — idempotente)
- [ ] Verifica deploy Vercel riuscito (build locale verde, sorprese improbabili)
- [ ] Smoke test live post-migration: (a) attivare notifiche da Settings→General su PWA installata → prenotazione via bot → notifica ad app chiusa; (b) accendere flag "Ordini dal tavolo (QR)" → /floor "QR tavoli" → stampa → cassa aperta → ordinare da telefono → draft in cassa realtime; (c) /staff: creare turni da admin, richiesta ferie da account cameriere, approvare
- [ ] (Opzionali rimandati) VAPID su env preview; WhatsApp per notifiche turni; grafici nel PDF

## Immediate Next Steps

1. Applicare (o far applicare al proprietario) le 2 migration nel SQL editor Supabase: `scripts/migrations/2026-07-08-push-subscriptions.sql` e `scripts/migrations/2026-07-08-staff-shifts.sql` (entrambe idempotenti, ri-incollabili).
2. Controllare che il deploy Vercel di `10db0ff` sia andato live.
3. Eseguire lo smoke test live dei 3 flussi (push / QR order / turni) come da checklist in Pending Work.

## Environment State

- Git: main pushato e pulito (tranne file handoff in `.claude/handoffs/` non ancora committati — il repo storicamente li committa, decidere alla prossima sessione).
- Dipendenze nuove installate: `web-push`, `@types/web-push` (npm install già fatto).
- Vercel CLI loggata come `amplaye`, progetto linkato in `.vercel/project.json`; VAPID in production env.
- Nessun processo attivo lasciato in esecuzione.
