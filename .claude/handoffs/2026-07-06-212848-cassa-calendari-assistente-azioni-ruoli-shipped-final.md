# Handoff: Cassa calendari + assistente operativo + ruoli staff — SHIPPED (68c312b)

## Session Metadata
- Created: 2026-07-06 21:24:28
- Project: /Users/amplaye/CRM
- Branch: main
- Session duration: ~45 minuti

### Recent Commits (for context)
  - 68c312b feat(cassa+assistant+staff): assistente operativo, calendari cassa, responsive, ruolo Responsabile, menu read-only staff  ← QUESTA SESSIONE
  - fa67db2 feat(cassa+assistant): UX portate/coperti, flusso cassa aperta/chiusa guidato, assistente AI interno gratuito
  - df34053 fix(gestionale): traduzioni mancanti (59 chiavi × 4 lingue) + perf liste inventario/food-cost
  - 1e6ae7f restyle(gestionale): inventario, food cost e conto economico — pratici e automatici
  - 8f1dd8f docs: manuali utente Cassa & Inventario (IT/ES/EN)

## Handoff Chain

- **Continues from**: [2026-07-05-015704-cassa-v2-shipped-migration-applied.md](./2026-07-05-015704-cassa-v2-shipped-migration-applied.md)
  - Previous title: Cassa v2 (varianti, IVA, reparti) SHIPPED + migrazione DB APPLICATA
- **Supersedes**: None (i precedenti restano storia utile ma il loro lavoro è tutto shipped)

## Current State Summary

Sessione CONCLUSA. Tutti i task richiesti dall'utente (7 nella lista iniziale + 1 arrivato a metà sessione) sono implementati, testati e pushati su main in un unico commit `68c312b`; Vercel deploya in automatico dal push. Verifiche finali: 794 vitest verdi, `npx tsc --noEmit` pulito, `npm run build` ✓ Compiled successfully. Nessuna migration DB necessaria. Memoria di progetto aggiornata: `cassa-nativa-pos.md` (sezione v4), `crm-internal-assistant.md` (sezione v2 azioni), nuovo `staff-roles-responsabile.md`, index `MEMORY.md`. Non c'è lavoro in sospeso obbligatorio: la prossima sessione parte pulita, salvo richieste dell'utente dopo la verifica sul sito live.

Task consegnati:
1. **Cassa più veloce tra sezioni interne** — giornale scontrini prefetchato in background + stale-while-revalidate al cambio tab + refresh realtime quando il tab è a schermo.
2. **Assistente: saluto nuovo + typing 3s** — "Ciao, sono il tuo assistente, come posso aiutarti oggi?…" ×4 lingue; indicatore puntini animati per 3s prima di ogni risposta.
3. **Assistente OPERATIVO (zero LLM)** — crea/cancella prenotazioni con slot-filling e conferma, recap prenotazioni, incasso/recap giornata, apri/chiudi cassa.
4. **Responsive cassa** — PayModal scrollabile (il confirm era irraggiungibile in landscape!), modali con max-h dvh, touch target 40px, input 16px anti-zoom iOS, vh→dvh, split-row flex-wrap.
5. **Camerieri (host): menù in sola lettura** — gate `canEdit` su menu/page.tsx.
6. **Nuovo ruolo "Responsabile"** — DB role `manager` riusato: cassa completa + pagine camerieri; selettore ruolo nell'invito staff.
7. **Rimosso** il `<p>` sottotitolo "Ti aiuto con tutto il CRM — gratis, sempre." dall'header del widget (e il campo `subtitle` dal tipo UI in kb.ts).
8. **Calendario giornate di cassa** (aperte/chiuse) nella tab Giornata + **calendario nel giornale scontrini** (richiesta mid-session).

## Important Context

- L'utente verifica SEMPRE sul sito Vercel production (deploy automatico dal push su main). Regola di progetto: commit dritto su main, MAI branch/PR.
- Il commit `68c312b` è già pushato: qualunque follow-up parte da lì, non c'è nulla di non committato (solo file handoff in .claude/).
- L'assistente deve restare GRATUITO e zero-LLM (vincolo esplicito storico dell'utente) — non proporre API a pagamento.
- Il read-only del menù per staff è enforcement UI-only: le RLS di scrittura sono ancora aperte ai member (dettagli sotto in Decisions/Gotchas).

## Codebase Understanding

### Architecture Overview
- `/cassa` (src/app/(dashboard)/cassa/page.tsx, ~950 righe) è l'orchestratore: letture dirette supabase sotto RLS, scritture via `/api/cassa/*` (service-role + verifyTenantMembership + assertManagement). Realtime su `cassa_orders` con debounce 400ms.
- Assistente: `src/lib/assistant/` = `kb.ts` (KB 25 topic ×4 lingue) + `engine.ts` (matcher scoring) + **`actions.ts` (NUOVO: intent detection operativa)**; UI in `src/components/assistant/AssistantWidget.tsx`, montato in DashboardLayout solo su pagine tenant.
- Ruoli: `tenant_members.role` ∈ owner/admin/manager/host/marketing/readonly (CHECK a supabase-schema.sql:49). UI usa owner (Admin), manager (Responsabile), host (Staff/Cameriere). Nav gating in `src/components/layout/Sidebar.tsx` (`isHost` filtra a floor/reservations/menu + CTA cassa).
- Prenotazioni: scritture via server actions `src/app/actions/reservations.ts` (`createReservationAction` fa lookup/creazione guest per telefono, double-booking guard, `atomic_book_tables`; `updateReservationDetailsAction` per il soft-cancel via `status: "cancelled"`). `reservations.date/time` sono TEXT `YYYY-MM-DD`/`HH:mm`.

### Key Patterns Discovered
- **⚠️ Parser assistente**: `normalize()` (engine.ts) strappa `: / ,` → i parser slot in actions.ts fanno `soft()`-normalize interno (solo accenti/ß) e DEVONO ricevere testo RAW, mai output di `normalize()`, o "20:30" diventa "20 00" e "12/08" muore. Già corretto ovunque — vale per estensioni future.
- **⚠️ Postgres date literal**: mai `.lte("receipt_date", "YYYY-MM-31")` — nei mesi corti è una data invalida e la query esplode. Month-end calcolato in JS: `new Date(y, m, 0).getDate()` (fatto in ReceiptsView).
- **i18n**: ogni chiave nuova va in TUTTI e 4 i dizionari o `t()` ritorna la chiave raw (memoria i18n-t-fallback-gotcha). Aggiunte: `cassa_sessions_calendar`, `cassa_cal_day_empty`, `cassa_pick_day`, `team_role_responsabile`, `team_role_hint_responsabile`.
- Realtime + tab: per usare uno stato "vista corrente" dentro il callback del canale supabase senza risottoscrivere, mirror in un ref (`viewRef` in cassa/page.tsx).
- Le server actions Next si possono importare nei client component (diventano POST) — è così che il widget crea/cancella prenotazioni.

## Decisions Made (con il PERCHÉ)

- **Responsabile ≡ DB role `manager`** (non nuovo valore enum): il CHECK lo consente già → zero migration; le API cassa (void/close/settings) già permettevano `["owner","manager"]` → il Responsabile può chiudere giornata e annullare scontrini senza toccare il server.
- **Responsabile ha il menù read-only come i camerieri**: l'utente ha chiesto "gli stessi benefici dei camerieri" → `canEdit = activeRole === "owner" || globalRole === "platform_admin"`.
- **Read-only menu = UI-only** (guard sugli handler + bottoni nascosti + modali render-gated con `canEdit`): minima invasività su un file di 4100 righe. Le RLS write sul menu restano `is_tenant_member` for-all → enforcement DB richiederebbe migration manuale; segnalato all'utente, NON richiesto.
- **Velocità tab: solo prefetch/SWR, nessun cambio al data model** — il collo era il fetch-on-switch, non le query.
- **Calendari: `MonthCalendar.tsx` condiviso** (presentazionale puro) usato da `SessionsCalendar.tsx` (tab Giornata, fetch diretto `cassa_sessions` sotto RLS — le policy tenant-read esistono, verificate in `scripts/migrations/2026-07-04-cassa.sql:164-175`) e dal popover del giornale scontrini (markers da `cassa_orders.receipt_date`).
- **Assistente resta zero-LLM** (vincolo storico "gratis, nessuna API"): intent detection regex pura e testata; le domande "come si fa X?" restano alla KB via guard `HOWTO` (come/how/cómo/wie/posso/can i…), così "come apro la cassa?" spiega e "apri la cassa" ESEGUE.
- **Telefono opzionale nella prenotazione via assistente** («salta» → `guestPhone: ""`): coerente col form dashboard; il lookup guest per phone "" può riusare il guest anonimo — comportamento preesistente accettato.
- **Typing: 3s per input digitato** (richiesta esplicita), 1.2s per i chip, `max(operazione, 3s)` per le azioni async (`sayAsync`).

## Files Touched (commit 68c312b — 20 file, +1497/−112)

**Nuovi:**
- `src/lib/assistant/actions.ts` — detectAction + parser (parseDateWord/TimeWord/PartyWord/NameWord/PhoneWord/MoneyWord) + ACTION_TEXT ×4 lingue + YES/ABORT/SKIP_WORDS
- `src/lib/assistant/actions.test.ts` — parser + detection nelle 4 lingue (43 test totali col suite engine)
- `src/components/cassa/MonthCalendar.tsx` — grid mese condivisa (Monday-first, markers, maxDate, locale)
- `src/components/cassa/SessionsCalendar.tsx` — storico giornate cassa (verde=aperta, bronze=chiusa, dettaglio giorno)

**Modificati:**
- `src/components/assistant/AssistantWidget.tsx` — riscritto: typing (pending count + timersRef), flussi azione in `flowRef` (name→date→time→party→phone→confirm), esecutori (server actions prenotazioni, /api/cassa/session, letture supabase), sottotitolo header rimosso
- `src/lib/assistant/kb.ts` — welcome nuovo ×4, `subtitle` rimosso dal tipo UI, topic `assistant-meta` riscritto con esempi comandi
- `src/app/(dashboard)/cassa/page.tsx` — prefetch receipts + SWR, `viewRef` nel realtime, badge sessione h-10, nuove props a ReceiptsView (tenantId/today/onPickDay) e SessionView (tenantId)
- `src/components/cassa/ReceiptsView.tsx` — popover calendario con markers, arrows/bottoni 40px, colonne strette su mobile
- `src/components/cassa/SessionView.tsx` — card `SessionsCalendar` (refreshKey su id sessioni), input note 16px
- `src/components/cassa/OrderView.tsx` — 70vh→70dvh, bottoni riga 32→40px, chips categorie 40px, modali max-h dvh, input 16px
- `src/components/cassa/PayModal.tsx` — `max-h-[90dvh] overflow-y-auto` (fix bloccante), split row flex-wrap, bottoni 40px
- `src/components/cassa/OpenRegisterModal.tsx` — max-h dvh
- `src/app/(dashboard)/menu/page.tsx` — `canEdit` (owner/platform_admin): handler guardati, bottoni add/edit/delete/import/template/palette nascosti, modali editor render-gated
- `src/components/layout/Sidebar.tsx` — `isHost` include manager; roleLabel Responsabile; primaryLabel per QR-users
- `src/components/settings/StaffTab.tsx` — selettore ruolo host/manager nell'invito, QR re-issue anche per manager, icona Shield blu
- `src/app/api/team/add-staff/route.ts` — accetta role host|manager (`/qr-login` era già generico via `pending_role`)
- `src/lib/i18n/dictionaries/{en,it,es,de}.ts` — 5 chiavi nuove ×4 lingue

## Immediate Next Steps

1. **Niente di obbligatorio** — la sessione è chiusa e shippata. Attendere feedback dell'utente dopo la verifica sul sito live (lui verifica sempre su Vercel production).
2. (Solo se richiesto) **Migration RLS menu-write**: policy for-all → `private.get_tenant_role(tenant_id) = 'owner'` su menu_categories/menu_items/menu_collections; applicare via Management API (vedi memoria `applying-supabase-migrations-without-browser`).
3. (Solo se lamentato) il typing 3s anche sulle domande di slot-filling può sembrare lento: ridurre `TYPING_MS` in AssistantWidget.tsx o usare un delay più corto in `say()` per le domande di flusso.

## Potential Gotchas

- `SessionsCalendar` raggruppa le sessioni per giorno col fuso del BROWSER su `opened_at` (non il timezone del tenant): sessioni aperte a cavallo di mezzanotte possono finire sul giorno "sbagliato" rispetto al business_date server. Approssimazione accettata.
- Il FAB dell'assistente (fixed bottom-right z-40) può coprire contenuto in basso a destra nelle viste cassa su mobile; i modali cassa sono z-50 e vincono. Non richiesto fix.
- I test engine fanno KB-integrity: topic con lingua o related-id mancante = test rosso, by design.
- Il gate cassa lato assistente: la chiusura giornata è owner/manager server-side → un cameriere che dice "chiudi la cassa" riceve l'errore 403 come bolla di errore (comportamento voluto).
- **MAI `npm run dev`** in questo repo; verificare con `npm run build` / `npx tsc --noEmit` / `npm test` (un processo pesante alla volta).

## How to Verify

```bash
cd /Users/amplaye/CRM
npm test                 # 794 test verdi al momento dell'handoff
npx tsc --noEmit         # pulito
npm run build            # ✓ Compiled successfully
git log --oneline -2     # 68c312b (questa sessione), fa67db2 (precedente)
```

Verifica funzionale live (production Vercel): /cassa → tab istantanei + calendario in Giornata e nel giornale; assistente → «crea una prenotazione a nome Mario domani alle 20:30 per 4», «quanto abbiamo incassato?», «apri la cassa»; /settings staff → invito con selettore Staff/Responsabile; login cameriere → menù senza alcun bottone di modifica.
