# Handoff: Sito web — 7 template demo + editor visuale + widget prenotazione SHIPPED

## Session Metadata
- Created: 2026-07-10 17:45:28
- Project: /Users/amplaye/CRM (TableFlow/BaliFlow CRM)
- Branch: main
- Session duration: ~1h (16:50 → 17:45)
- Commit shippato: `2c3a83a` (pushato su origin/main — Vercel auto-deploy partito)
- Stato: ✅ FEATURE COMPLETA, TESTATA E2E, COMMITTATA E PUSHATA. Nessun lavoro a metà.

### Recent Commits (for context)
  - 2c3a83a feat(website): 7 demo-site templates + in-place visual editor + embedded booking widget
  - 5c046a7 docs(handoff): update session handoff for all-inclusive merge
  - f65fb52 docs(handoff): all-inclusive Fasi 4-7 shipped — plan code-complete, remaining: env/templates/webhook-event + merge
  - f70b1bb feat(booking-widget): public /b/[slug] widget — availability grid + booking via the full AI pipeline in-process
  - 66bc3ae feat(loyalty): points per visit + reward redemption

## Handoff Chain

- **Continues from**: [2026-07-10-162528-stop-hook-feedback-handoff-di-contesto-r.md](./2026-07-10-162528-stop-hook-feedback-handoff-di-contesto-r.md)
  - Previous title: chiusura sessione all-inclusive Fasi 4-7 (merge su main)
- **Supersedes**: None (feature nuova, indipendente dal piano all-inclusive)

## Current State Summary

Richiesta utente (2 punti, entrambi CONSEGNATI): (1) "le sezioni nuove devono essere full size" → tutte le sezioni dei nuovi template sono full-bleed (sfondi 100% larghezza, hero 100svh dove il demo lo prevede); (2) "un template uguale ad ognuno di questi 7 link, modificabili direttamente dentro al sito web (testi e immagini di ogni contenuto), ogni template col widget di prenotazione connesso al CRM" → fatto per tutti e 7: la-suerte-17, la-dolce-vita-a2g, la-champinoneria, picnic-web-tau, perez-and-beers, el-vasco-de-vegueta, casa-montesdeoca. Verifica completa passata: tsc 0 · vitest 868/868 · build ok · E2E Playwright locale (8/8 template rendono, widget presente in tutti, availability HTTP 200 dal widget embedded, editor login→edit→save→testo live su /s). Screenshot di tutti gli 8 template guardati uno a uno. Tenant QA ripristinato. Nulla resta da finire in questa feature.

## Important Context

Le 5 cose che il prossimo agente DEVE sapere prima di toccare qualsiasi cosa:
1. La feature è FINITA e pushata (2c3a83a su main): non c'è nulla da "completare" — solo verifica prod ed eventuali rifiniture su richiesta utente.
2. I dati dei template (default copy + font URL) vivono SOLO in `src/components/site-templates/defaults.ts` (modulo puro): mai spostarli/importarli dai file "use client" → Gotcha #1 (client-reference proxy vuoti, nessun errore di build).
3. Gli override del titolare stanno in `tenants.settings.site_content[template]` come DIFF vs defaults — se un valore coincide col default viene rimosso al salvataggio, è voluto.
4. Il design "classic" e i suoi campi form sono INTATTI: qualunque modifica ai 7 template demo non deve toccare il ramo classic di `src/app/s/[slug]/page.tsx`.
5. Verifica sempre con `scripts/site-templates-e2e.mjs` (build + next start -p 3010 + CRM_PASSWORD): copre render 8 template, widget→availability e il giro completo dell'editor.

## Codebase Understanding

### Architecture Overview

- **Scelta template**: `settings.site_branding.template` (`SiteTemplateKey` in tenant-settings.ts). Unset → `classic` (design originale INVARIATO, form-driven). Valori: classic, suerte, dolcevita, champinoneria, picnic, perezbeers, vasco, montesdeoca.
- **Template = client components** ("use client") in `src/components/site-templates/<Name>Template.tsx` (~420-465 righe l'uno). Ogni testo/immagine passa da `<EditableText id>/<EditableImage id>` (`src/lib/site/content.tsx`): pubblico = markup piatto (SSR), editor = contentEditable/click-to-upload. CSS per-template in `<style>` con prefisso (`.su- .dv- .pc- .pb- .va- .mo- .ch-`), animazioni CSS-only (NO GSAP/Lenis — sostituiti deliberatamente: hero scroll-film di Picnic → statico su frame_0400.webp; scene pinned Montesdeoca → 3 beat statici).
- **Default + font in modulo dati PURO**: `site-templates/defaults.ts` (X_DEFAULTS copy spagnolo verbatim dei demo + URL immagini assolute ai demo live; X_FONTS URL Google Fonts css2). SEPARATO dai file client per il Gotcha #1.
- **Registry**: `site-templates/registry.ts` — `SITE_TEMPLATE_DEFS` {component, defaults, fontsHref, label, vibe, swatches, fontLabel} + `isDemoTemplate()`.
- **Override titolare**: `settings.site_content[template]` = mappa blockId→valore, SOLO diff vs defaults (blocco riportato al default esce dalla mappa; il copy default aggiornato fluisce ai blocchi non toccati). Per-template → il contenuto sopravvive al cambio template. NIENTE migrazione DB (tutto in tenants.settings jsonb).
- **Pagina pubblica** `src/app/s/[slug]/page.tsx`: se `isDemoTemplate` → fetch menu+reviews, `buildSiteData`, content = defaults ⊕ overrides, `<link>` fonts, `<SiteContentProvider editMode=false>` + componente; altrimenti percorso classic identico a prima.
- **Editor** `src/app/(dashboard)/website/editor/page.tsx`: overlay `fixed inset-0 z-[70]` (copre la sidebar), toolbar (Esci con confirm se dirty / hint / non-salvato / Apri sito / Salva), STESSO componente con editMode=canEdit. Testo: contentEditable NON controllato, commit onBlur (caret non salta). Foto: file input nascosto → `uploadSitePhoto` (WebP 1600px, bucket `branding`, nome stabile `site-<template>-<blockid>.webp`). Widget VIVO di proposito (il titolare testa la disponibilità reale). Guard: redirect a /website se classic o modulo off. beforeunload se dirty.
- **Lib condivisa** `src/lib/site/`: `types.ts` (SiteData), `data.ts` (buildSiteData, pickMenuTeaser photo-first, buildHoursRows Monday-first, formatSitePrice, firstName + data.test.ts), `labels.ts` (SITE_STRINGS it/es/en/de guest-facing), `booking-strings.ts` (BOOKING_STRINGS + resolveSiteLocale — estratte da /b che ora le importa), `content.tsx`, `upload-site-photo.ts`.
- **Dashboard** `/website`: card picker 8 template; se ≠ classic → bottone "Apri l'editor visuale" e i campi classic (hero/about/stile/galleria/sezioni) NASCOSTI (`{template === "classic" ? … : null}`).
- **Dati live in ogni template**: menu teaser max 6 (sezione nascosta se vuoto), recensioni 4-5★ (empty → labels.reviewsEmpty), orari, indirizzo/tel, Maps iframe `?q=<addr>&output=embed` solo se address, review_url CTA solo se impostato, `/g/<slug>` se gift, carta → `/m/<slug>`.
- **i18n**: 15 chiavi `website_templates_*`/`website_editor_*` nei 4 dizionari dopo `website_section_contact`.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| src/components/site-templates/defaults.ts | Default copy+font per template (modulo PURO) | Unica fonte dati server-safe; vedi Gotcha #1 |
| src/components/site-templates/registry.ts | Mappa template→component/dati per pagina, editor e picker | Aggiungere qui un template nuovo |
| src/lib/site/content.tsx | SiteContentProvider + EditableText/EditableImage/useBlockValue | Cuore dell'inline editing |
| src/lib/site/data.ts | buildSiteData condiviso server/editor | Shaping unico dei dati live |
| src/app/s/[slug]/page.tsx | Pagina pubblica, branch classic vs template | Punto d'ingresso pubblico |
| src/app/(dashboard)/website/editor/page.tsx | Editor visuale full-screen | Flusso edit→save (diff-only) |
| src/app/(dashboard)/website/page.tsx | Picker template + form classic | UI di scelta |
| scripts/site-templates-e2e.mjs | E2E riusabile (8 render + widget + editor loop) | Regression per modifiche future |
| src/lib/types/tenant-settings.ts | SITE_TEMPLATES, site_branding.template, site_content | Contratto settings |

### Key Patterns Discovered

- Template nuovo = 1 file component + entry in src/components/site-templates/defaults.ts + entry in src/components/site-templates/registry.ts. Pagina pubblica, editor e picker sono generici: nient'altro da toccare.
- `SiteContentProvider {content, editMode, onEditText, onEditImage}` riusabile per qualunque superficie futura (es. anteprima nel dashboard).
- E2E parametrico: `BASE`, `TENANT_SLUG`, `SHOT_DIR`, `CRM_PASSWORD` (password admin = quella già usata in scripts/cassa-e2e.mjs).
- Convention brand: nav/hero/footer usano `data.tenantName` via `fallback` dinamico (nessun default nella mappa) → ogni tenant vede il SUO nome; i paragrafi default che citavano il ristorante demo sono neutralizzati ("la casa").

## Decisions Made (col PERCHÉ)

1. **Contenuti = mappa piatta blockId→string salvata come diff** — semplice, jsonb esistente, zero migrazioni; diff-only così i futuri miglioramenti al copy default arrivano ai blocchi non personalizzati.
2. **Classic intatto e form-driven; solo i 7 demo inline-editable** — zero regressioni per tenant esistenti.
3. **Stesso componente per pubblico ed editor** — niente doppia implementazione, l'editor è il sito vero.
4. **No GSAP/Lenis/canvas** — fragili e pesanti nel CRM; identità visiva ricreata in CSS puro.
5. **No wa.me/password-gate/lang-switcher/Instagram dei demo** — numeri hardcoded = rischio; il widget reale sostituisce i form-WhatsApp demo.
6. **Widget vivo nell'editor** — feature: il titolare prova il flusso vero.
7. **Commit diretto su main** — convenzione repo (memoria: no branch, demo phase).
8. **6 template scritti da agenti paralleli** su spec estratte dai siti reali + esemplare (SuerteTemplate scritto a mano) + contratto rigido — file indipendenti, zero conflitti; verificati con grep di conformità, tsc, E2E, screenshot.

## Potential Gotchas (TRAPPOLE — leggere prima di toccare)

1. **⚠️ MAI importare costanti (oggetti/stringhe) da un file "use client" in un server component**: arrivano come client-reference proxy → spread = `{}`, NESSUN errore tsc/build. È SUCCESSO: tutti i blocchi rendevano vuoti sul pubblico mentre l'editor (tutto client) funzionava — per questo esiste `defaults.ts` puro. Salvato in memoria globale (`reference_nextjs_client_module_value_import.md`). Debug rapido: curl della pagina SSR + grep del testo atteso.
2. **`next start` non ricarica una build nuova**: dopo `npm run build` va killato e rilanciato (`lsof -ti:3010 | xargs kill`).
3. **`.env.local` ha i valori TRA VIRGOLETTE** (Vercel CLI) — parser env a mano deve strippare le quote (già fatto in site-templates-e2e.mjs).
4. **HTML SSR su UNA riga** → `grep -c` conta max 1; usare `grep -o | wc -l`.
5. **Immagini default = URL ai demo live** (*.pages.dev / picnic-web-tau.vercel.app; tutte 200 al 2026-07-10). Demo spento → quel template perde le foto DEFAULT (gli upload del titolare no, stanno nel bucket branding).
6. **Maps iframe `output=embed` senza key**: in EU può mostrare il consenso cookie nell'iframe (box vuoto negli screenshot headless). Stesso approccio dei demo originali — parità voluta.
7. **Tenant QA E2E**: `bali-rest-ghl8po` (BALI Rest, locale es, 72 piatti, orari 6 giorni, 0 recensioni → empty label nelle sezioni recensioni). Lo script ripristina SEMPRE i settings a fine run (finally).
8. **contentEditable**: non controllato durante la digitazione (commit onBlur); nbsp normalizzati — nel sorgente di content.tsx c'è un VERO carattere U+00A0 dentro la regex, non toccarlo "per pulizia".
9. **Menu card senza foto**: nascondere il riquadro foto se `image_url` null (fix applicato a DolceVita; pattern da rispettare nei template futuri).

## Files Touched This Session (commit 2c3a83a — 26 file, +4366/−221)

Nuovi: `src/components/site-templates/{SuerteTemplate,DolceVitaTemplate,ChampinoneriaTemplate,PicnicTemplate,PerezBeersTemplate,VascoTemplate,MontesdeocaTemplate}.tsx`, `src/components/site-templates/defaults.ts`, `src/components/site-templates/registry.ts`, `src/lib/site/{types,data,labels,booking-strings,upload-site-photo}.ts`, `src/lib/site/content.tsx`, `src/lib/site/data.test.ts`, `src/app/(dashboard)/website/editor/page.tsx`, `scripts/site-templates-e2e.mjs`.
Modificati: `src/app/s/[slug]/page.tsx`, `src/app/b/[slug]/page.tsx` (usa BOOKING_STRINGS condivise), `src/app/(dashboard)/website/page.tsx`, `src/lib/types/tenant-settings.ts`, 4 dizionari i18n (it/es/en/de).
Memoria globale: `feature_crm_website_templates_editor.md` + `reference_nextjs_client_module_value_import.md` + 2 puntatori in MEMORY.md.

## Environment State

- Server locale 3010: FERMATO. Nessun processo attivo lasciato.
- `.next` = build di produzione dell'ultimo commit.
- DB: nessuna migrazione. Tenant QA ripristinato (site_branding/site_content come pre-sessione).
- Screenshot/spec di lavoro in scratchpad effimero (`/private/tmp/claude-501/-Users-amplaye/498b7444-.../scratchpad/{shots,specs}/`) — non nel repo; le spec si rigenerano ri-analizzando i siti con curl se servisse.

## Pending Work

- [x] Tutto il lavoro chiesto in sessione è completo e pushato.
- [ ] (Facoltativo, next session) Verifica del deploy Vercel in prod — vedi Next Steps 1.
- [ ] (Ereditati dal piano all-inclusive, NON di questa sessione) env Resend, template Meta, evento Stripe webhook — dettagli in `2026-07-10-162141-all-inclusive-fase4-7-shipped.md`.

## Immediate Next Steps

1. **Verifica deploy Vercel** (auto da push, commit 2c3a83a): da admin aprire `https://crm.baliflowagency.com/website`, scegliere un template su un tenant di prova e controllare `/s/<slug>` in prod. (E2E già verde in locale sullo stesso build — atteso ok.)
2. **Far provare l'editor a Steward**: /website → card template → "Apri l'editor visuale" → clic su testo/foto → Salva. Raccogliere feedback UX (possibile richiesta futura: "ripristina default" per blocco — NON costruirla senza richiesta esplicita).
3. Per rifiniture su un singolo template: toccare il suo file + `defaults.ts`, poi `npm run build` + `npx next start -p 3010` + `CRM_PASSWORD=<admin> node scripts/site-templates-e2e.mjs`.

## Blockers

Nessuno. Feature completa, testata e pushata.
