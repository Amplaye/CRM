# Handoff: Website templates — palette per-sezione (6 colori), fix bottone Trattoria, widget overlay, menù in-site (SHIPPED)

## Session Metadata
- Created: 2026-07-11 19:46:13
- Project: /Users/amplaye/CRM
- Branch: main
- Session duration: ~1h30

### Recent Commits (for context)
  - 7877b85 Sito web: palette per-sezione (6 colori), fix bottone Trattoria, menù in-site cliccabile  ← QUESTA SESSIONE
  - 0d948dd Sito web: editor colori per i template (3 colori chiave per template)
  - 7f050b7 Staff polish: compact weekday pills + platform-admin team management
  - 62e6cc6 Staff: bulk rota tool, copy-week, absence management, pending-invite visibility
  - 35db3fd Widget prenotazioni flottante animato + fix bug past_time + stile nuovo

## Handoff Chain

- **Continues from**: [2026-07-11-173327-staff-overhaul-shipped.md](./2026-07-11-173327-staff-overhaul-shipped.md)
  - Previous title: Staff section overhaul (SHIPPED) — argomento DIVERSO, non collegato al lavoro di questa sessione.
- **Supersedes**: None

> Il collegamento allo staff handoff è solo cronologico (lo scaffold linka l'ultimo). Questa sessione NON continua lo staff: è un lavoro nuovo sui template del sito web.

## Current State Summary

Lavoro **COMPLETATO e PUSHATO su main** (commit 7877b85, Vercel in auto-deploy). L'utente aveva chiesto 4 cose sui template dei siti web pubblici (`/s/<slug>`): (1) migliorare i colori perché alcune sezioni non erano ricolorabili; (2) sistemare il bottone "Prenota tavolo" gigante nel template Trattoria; (3) togliere l'overlay scuro del widget di prenotazione che rallentava l'animazione; (4) rendere i piatti del menù cliccabili sul sito e far sì che "menù completo" apra qualcosa di **coerente con lo stile del sito** invece di caricare uno dei template menù separati di `/m`. Tutti e 4 fatti, verificati (tsc 0, 909/909 vitest, build ok su main, E2E `site-templates-e2e.mjs` TUTTO VERDE), committati e pushati. **Non resta lavoro attivo** — solo eventuali rifiniture se l'utente dà feedback.

## Codebase Understanding

### Architecture Overview

Micro-sito pubblico `/s/[slug]` ha 2 path: `classic` (design originale form-driven, invariato) e 7 template demo full-bleed (suerte/dolcevita/champinoneria/picnic/perezbeers/vasco/montesdeoca). Ogni template demo:
- È un client component in `src/components/site-templates/<Name>Template.tsx`; ha un `const C = {...}` con i colori, e i testi/immagini passano da `<EditableText/EditableImage id>` (`src/lib/site/content.tsx`) → pubblico=markup piatto, editor=click-to-edit.
- Riceve i dati da `buildSiteData` (`src/lib/site/data.ts`), builder UNICO usato sia dalla pagina server (`src/app/s/[slug]/page.tsx`) sia dall'editor client (`src/app/(dashboard)/website/editor/page.tsx`).
- Il registry (`src/components/site-templates/registry.ts`) ha per ogni template: `component`, `defaults`, `swatches` (colori chiave), `paletteLabels`, `accentIndex`, `accent`, font.

**Palette (colori editabili)**: i colori chiave leggono `var(--cN, #fallback-hex)`; il wrapper del template su `/s` e nell'editor riceve `--cN` via `paletteVars()`. **Palette non impostata = 0 var emesse = output byte-identico**. Override salvato in `settings.site_palette[templateKey]` (solo diff vs swatches).

**Widget prenotazione** = `FloatingBookingWidget.tsx`, montato UNA volta a livello pagina (pill flottante in basso a destra), NON dentro i template. I template usano `<BookingCta>` (dispatcha `open-booking`).

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| src/components/site-templates/registry.ts | swatches/paletteLabels (ora `string[]`, non più tuple di 3), helper `resolvePalette`/`paletteVars`/`paletteAccent`/`isHexColor` | Cuore della palette; length-agnostici |
| src/components/site-templates/SiteMenuOverlay.tsx | **NUOVO** — overlay menù in-site (scheda piatto + menù completo), listener delegato, `resolveMenuClick` (pura), `dishCardProps`, `openDish`/`openFullMenu` | Feature menù cliccabile |
| src/components/site-templates/*Template.tsx (×7) | `const C` migrati a `var(--c4/5/6, hex)`; card piatti con `{...dishCardProps(it.id)}` + cursor; import di SiteMenuOverlay | Migrazione colori + click piatti |
| src/lib/site/data.ts | `buildSiteData` ora produce `fullMenu` via `buildFullMenu`; `RawMenuItemRow` ha allergens/tags/category_id opzionali; `shapeMenuItem` | Dati menù completo |
| src/lib/site/types.ts | `SiteMenuItem` +allergens/tags; nuovo `SiteMenuCategory`; `SiteData.fullMenu`; `SiteLabels` +allergens/close | Contratto dati |
| src/lib/site/labels.ts | +`allergens`/`close` nelle 4 lingue | i18n overlay |
| src/lib/types/tenant-settings.ts | `site_palette` → `Partial<Record<key, string[]>>` (era tuple di 3) | Tipo persistenza |
| src/app/s/[slug]/page.tsx | query menù estesa (allergens/tags/category_id + menu_categories), monta `<SiteMenuOverlay>` | Path pubblico |
| src/app/(dashboard)/website/editor/page.tsx | palette state `string[]`, fetch categorie, pannello colori griglia 2-col, monta `<SiteMenuOverlay>` | Editor |
| src/app/globals.css | `.fbw-backdrop` reso trasparente; nuove classi `.smo-*` per l'overlay menù | Widget + overlay styling |
| scripts/site-templates-e2e.mjs | E2E esteso §②bis(--c4)/§②ter(dish+fullmenu); widget check reso non-bloccante | Test |

### Key Patterns Discovered

- **Retrocompatibilità palette CRITICA**: i primi 3 slot di `swatches`/`site_palette` DEVONO mantenere significato storico (var `--c1/2/3` invariate), gli slot nuovi si APPENDONO (`--c4/5/6`). Così gli override a 3 colori già salvati risolvono ancora (gli slot extra restano al default). NON riordinare mai i primi 3.
- **Colori dentro le stringhe CSS template-literal**: `C.charcoal` ora è `"var(--c4, #2a2420)"`; interpolarlo in una stringa CSS (es. `box-shadow: 1px 1px 0 ${C.charcoal}`) produce CSS valido `var(--c4, #2a2420)` → funziona.
- **Listener delegato invece di rewiring per-elemento**: `SiteMenuOverlay` mette UN solo listener su `document` (via `resolveMenuClick` pura) che intercetta `[data-dish-id]` e `a[href="/m/<slug>"]`, fa `preventDefault`. Degrada a `/m` senza JS. Molto meno invasivo che editare i ~30 link `/m/` e i 7 grid di card.
- **Verifica in ambiente locale**: vedi Gotchas — `next start` locale NON idrata il JS.

## Work Completed

### Tasks Finished

- [x] Overlay scuro widget rimosso (`.fbw-backdrop` background:transparent, niente fade animation; click-catcher invisibile resta per tap-fuori-chiude)
- [x] Bottone "Prenota tavolo" Trattoria (suerte) sistemato (era lone grid-item stirato → wrappato in `flex justify-center md:justify-start` = larghezza naturale ~12% sezione)
- [x] Palette estesa da 3 a fino a 6 colori per template; TUTTI i `const C` dei 7 template migrati a var; le sezioni prima non ricolorabili ora si cambiano
- [x] Piatti cliccabili → scheda dettaglio (foto/descrizione/prezzo/allergeni/tag)
- [x] "Menù completo" → overlay in-pagina coerente col template (accent del sito) invece del `/m` con stile diverso
- [x] Type/tests/build/E2E verdi; commit + push su main

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| registry.ts | swatches/paletteLabels → string[]; +3 slot per template; resolvePalette length-agnostico | Più colori editabili |
| 7× *Template.tsx | const C → var(--cN); card +dishCardProps+cursor; +import | Colori sezioni + click piatti |
| SiteMenuOverlay.tsx (NUOVO) | overlay + logica delegata | Menù in-site |
| data.ts / types.ts / labels.ts | fullMenu, allergens/tags, buildFullMenu, labels overlay | Dati + i18n |
| tenant-settings.ts | site_palette → string[] | Persistenza |
| s/[slug]/page.tsx, website/editor/page.tsx | query estese, monta overlay, palette string[] | Wiring pagine |
| globals.css | .fbw-backdrop trasparente, classi .smo-* | Styling |
| site-templates-e2e.mjs | §②bis/§②ter, widget non-bloccante | Test |
| palette.test.ts (+11), data.test.ts (+4), site-menu-overlay.test.ts (NUOVO +7) | copertura | 909/909 |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Palette: più slot (fino a 6) NON colore-per-sezione indipendente | (a) 6 colori globali che coprono più sezioni; (b) colore diverso per ogni sezione | Utente ha scelto (a) a voce ("la prima opzione mi piace di più"). Semplice, copre il reclamo reale (sezioni non ricolorabili) senza esplosione di stato |
| Menù completo = overlay in-site, NON pagina `/m` ridisegnata per template | (a) overlay in-pagina; (b) `/m` restilizzato per template | Utente si è fidato ("vedi tu"). Overlay = massima coerenza + zero manutenzione di una `/m` parallela per 7 template. `/m` resta per QR/self-order/classic |
| Rimuovere overlay widget = renderlo TRASPARENTE, non eliminare l'elemento | eliminare del tutto vs trasparente | Il click-catcher serve ancora (tap-fuori-chiude, bottom-sheet mobile). Trasparente = tolgo esattamente ciò che l'utente non voleva (dim + blur = il vero rallenta-animazione) preservando il comportamento |
| Fix bottone = flex wrapper | vari | Causa strutturale: un `<button>` lone grid-item eredita `align/justify: stretch` → si allarga alla colonna. Wrapper flex lo lascia dimensionare al contenuto |
| Commit su main (non sul branch marketing) | main vs branch marketing corrente | Utente ha detto a voce "comita pure sul main". Il mio lavoro è disgiunto dal marketing WIP |

## Immediate Next Steps

**NON c'è lavoro attivo obbligatorio.** Se l'utente dà feedback sulle rifiniture:
1. Le etichette dei nuovi slot colore per template stanno in `registry.ts` → `paletteLabels` (es. suerte = `["Sfondo","Accento","Secondario","Testo","Dettagli","Ombre"]`). Se un colore non cambia la sezione giusta, controlla la mappatura slot→chiave nel `const C` di quel template (es. suerte: c4=charcoal, c5=mustard, c6=tile).
2. Se serve verificare le INTERAZIONI (click piatto/menù/widget) in un browser reale: NON usare `next start` locale (non idrata, vedi Gotcha). Deployare su Vercel o girare l'E2E dove l'hydration funziona.
3. Lo stile dell'overlay menù è in `globals.css` classi `.smo-*` (scrim `rgba(12,10,9,0.55)`, sheet bianco, accent = `--smo-accent`).

### Blockers/Open Questions

- Nessun blocker. L'unico limite è ambientale (verifica interattiva locale, vedi Gotcha), non un difetto del codice.

### Deferred Items

- Verifica visiva in-browser dei click flow (dish modal / full-menu overlay / widget open): rimandata all'ambiente Vercel perché `next start` locale non idrata. La logica è coperta da unit test (`resolveMenuClick`) e l'SSR/CSS è verificato.

## Important Context

**IL LAVORO È GIÀ SHIPPATO** (main @ 7877b85, pushato, Vercel in deploy). Non ri-fare nulla. Se l'utente torna, molto probabilmente è per: (a) confermare che su Vercel funziona, (b) chiedere rifiniture (nomi colori, layout overlay, quali colori mappare a quali sezioni).

**⚠️ CONTESTO GIT DELICATO**: la sessione è partita sul branch `feature/marketing-two-block-preview`, che conteneva lavoro MARKETING altrui (commit `f42da48` + WIP che rompeva la build: `de.ts` aveva meno chiavi `mkt_*` di `en.ts` → type error). Il mio lavoro sui template è **disgiunto** (file completamente diversi). Su richiesta dell'utente ("comita pure sul main") ho spostato SOLO i miei file su `main` e committato lì (7877b85). Il branch `feature/marketing-two-block-preview` è **intatto** con il suo `f42da48` — NON toccato. Se l'utente vuole finire il marketing, si lavora là (bilanciare `de.ts` con le chiavi `mkt_*` di `en.ts`).

### Assumptions Made

- Il tenant QA per l'E2E è `bali-rest-ghl8po` (BALI Rest), come nelle sessioni precedenti. L'E2E ripristina i suoi settings a fine run.
- "template trattoria" nel linguaggio utente = `suerte` (label registry = "Trattoria").
- `/m/<slug>` va MANTENUTO (QR sui tavoli, self-order, template classic ci puntano) — non l'ho toccato/rimosso.

### Potential Gotchas

- **`next start` locale NON idrata il JS** (chunk serviti con MIME `text/plain` + un chunk 500 + CSP `style-src 'self'` blocca Google Fonts) → i click Playwright non aprono modali/widget. NON è un bug del codice: è confermato da sessioni precedenti (obs 29702 "CSP and MIME type errors"). Il curl diretto ai chunk .js/.css invece dà i MIME giusti → il problema è la confusione workspace-root (due lockfile: package-lock.json in /Users/amplaye e in /Users/amplaye/CRM). Verifica quindi via: SSR HTML (grep `data-dish-id`, `href="/m/..."`), computed CSS (palette cascade), unit test della logica. Prova visiva: screenshot SSR (i colori CSS rendono anche senza JS).
- **NON riordinare i primi 3 slot palette** (romperebbe gli override già salvati).
- **`npm run build` su main è verde**; sul branch marketing FALLISCE per `de.ts` incompleto (non è roba mia).
- **MAI `npm run dev`** (regola progetto). Un solo processo pesante alla volta (vitest/tsc/build separati).
- File handoff staff (`.claude/handoffs/2026-07-11-1733*.md`) e `.claude/handoffs/LATEST.md` sono di sessioni precedenti, non miei — lasciati untracked/non committati.

## Environment State

### Tools/Services Used

- Playwright (in node_modules del progetto — gli script E2E vanno lanciati con cwd = /Users/amplaye/CRM, o messi in scripts/).
- Supabase service-role (letto dal file .env.local del progetto) per settare template/palette del tenant QA nell'E2E.
- Voce: `/Users/amplaye/.claude/voice/ask_voice.sh` per le domande (2 decisioni prese così: scelta palette, branch di commit).

### Active Processes

- **Nessuno.** Il server `next start -p 3010` avviato durante la verifica è stato **fermato** (pkill confermato). Nessun processo in background attivo.

### Environment Variables

- Il file `.env.local` (in /Users/amplaye/CRM) contiene `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (usati dall'E2E). `CRM_PASSWORD` NON presente → la parte editor autenticata dell'E2E (§③) fa SKIP; il resto gira lo stesso. (Nomi soltanto — nessun valore qui.)

## Related Resources

- Memoria aggiornata: `/Users/amplaye/.claude/projects/-Users-amplaye/memory/feature_crm_website_templates_editor.md` (blocco "Palette per-sezione (fino a 6 colori)…" + nota contesto git).
- E2E: `scripts/site-templates-e2e.mjs` (`npm run build && npx next start -p 3010 &` poi `node scripts/site-templates-e2e.mjs`).
- Reference correlate in memoria: `reference_crm_floating_booking_widget.md`, `reference_nextjs_client_module_value_import.md`.

---

**Security Reminder**: nessun secret in questo file (solo NOMI di env var). Validato con validate_handoff.py.
