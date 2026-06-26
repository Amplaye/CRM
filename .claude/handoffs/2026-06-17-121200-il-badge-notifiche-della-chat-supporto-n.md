# Handoff: il badge notifiche della chat supporto nella tab non sembra funzionare bene, ri…

> AUTO-GENERATED at ~40% context — fired headless at the threshold; no agent edited this. Treat as a faithful snapshot of the transcript.

## Session Metadata
- Created: 2026-06-17 12:11:59
- Trigger: auto-40pct-context
- Project: /Users/amplaye/CRM
- Branch: main
- Transcript: /Users/amplaye/.claude/projects/-Users-amplaye-CRM/560ddb74-fbff-403d-bd1d-8d8ca8a94b5c.jsonl

### Recent Commits
- 3f2fca4 fix(menu): read JS-driven & PDF-behind-splash menu URLs, crisper dish photos (#22)
- 764ad1d feat(billing): enforce B2B at pilot checkout (business name + tax id required) (#21)
- f3a2e3b i18n(reservations): simpler seat button label (IT 'Far sedere' -> 'Siedi')
- 2fcd271 feat(floor): scrollable floor plan on tablet/mobile (< lg)
- 9f76c07 style(notifications): mirror SourceIcon markup exactly (flex + flex-shrink-0)

## Current Objective

il badge notifiche della chat supporto nella tab non sembra funzionare bene, riesci a sistemarlo senza nuova build?

## Recent User Requests (oldest → newest)

- dove cambio la lingua da inglese a italiano?
- [Image: original 1170x2532, displayed at 924x2000. Multiply coordinates by 1.27 to map to original image.]
- lasciamo stare la lingua, la faremo nella prossima build quando avremo qualche bug da fixare. adesso voglio che trovi tutti gli screen che abbiamo usato in app e che me li trasformi in screen professionali  con titoli in sovrappressione perchè al momento non sono professionali come ogni altra app s…
- cancella tutto quello che hai di comacchio, questi screen li trovi in download
- mi piace di più questo style per i testi, segui come esempio questi screen e fai tutte e 4 le img che ti avevo passato, per comacchio, confermo la rimozione completa
- [Image: original 1170x2532, displayed at 924x2000. Multiply coordinates by 1.27 to map to original image.] [Image: original 1170x2532, displayed at 924x2000. Multiply coordinates by 1.27 to map to original image.]
- ho notato che c'è un utente che quando mi scrive nel supporto, invia sempre doppi messaggi, riesci a controllare se è solo un suo problema o se un problema di chat?
- il badge notifiche della chat supporto nella tab non sembra funzionare bene, riesci a sistemarlo senza nuova build?

## What Was Happening (last assistant actions)

- Dati puliti: **0 messaggi support non letti** (nessun duplicato lato support). Quindi non è inflazione dati. La causa è o nella config **Realtime** (server, fixabile senza build) o nella logica client (che richiederebbe build). Controllo due cose decisive: se `chat_messages` è a…
- Lato server/dati è tutto sano: **Realtime attivo** su `chat_messages`, l'admin inserisce le risposte con `read:false`, **0 messaggi support non letti**, nessun duplicato support. Quindi il problema **non** è fixabile dai dati: è nella logica client del badge → richiederebbe una…
- **Trovato il bug** — ed è client-side. La tab legge `unreadSupportCount` (TabNavigator:83), ma **nessuno chiama mai `initSupportUnreadWatcher`/`refreshSupportUnread`**: il grep dei chiamanti non trova nulla. Quindi quel contatore resta sempre 0 → il badge non si aggiorna/non com…
- Correzione: App.tsx **sì** chiama `initSupportUnreadWatcher` (il mio grep era solo su `src/`, App.tsx è nella root). Quindi il watcher è cablato. Rileggo la logica esatta (App.tsx + il watcher) per trovare il difetto concreto, e dove la chat marca "letto".
- Il cablaggio client è completo e corretto (watcher su auth, refresh su foreground e su push; chat marca letto all'apertura). Resta un'ultima cosa fixabile lato server: il Realtime per l'app. L'app si autentica con **WordPress, non Supabase Auth** → usa la chiave anon. Se RLS blo…
- Ho la risposta definitiva, ed è importante essere sincero: **no, questo non si può sistemare senza una nuova build.**  ## Perché Il badge è **stato 100% client** (`unreadSupportCount` in `useChatStore`, mostrato da `TabNavigator`). L'ho verificato a fondo e **tutto il lato serve…

## Files Touched This Session

| File | Last action |
|------|-------------|
| /Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/rafflemania-support-chat-dual-write.md | Write |
| /Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/MEMORY.md | Edit |
| /Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/rafflemania-secrets-exposed-in-git-history.md | Write |
| /Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/keep-repos-tidy-golden-rule.md | Write |
| /Users/amplaye/RaffleMania/social-content/appstore/out/01-home.png | Read |
| /Users/amplaye/RaffleMania/social-content/appstore/out/02-vinto.png | Read |
| /Users/amplaye/Downloads/400x800bb (3).png | Read |
| /Users/amplaye/Downloads/400x800bb (2).png | Read |
| /Users/amplaye/RaffleMania/social-content/appstore/out/sample-win.png | Read |
| /Users/amplaye/RaffleMania/social-content/appstore/render.js | Write |
| /Users/amplaye/RaffleMania/social-content/appstore/template.html | Write |
| /Users/amplaye/RaffleMania/social-content/template.html | Read |
| /Users/amplaye/Downloads/400x800bb (1).png | Read |
| /Users/amplaye/Downloads/400x800bb.png | Read |
| /Users/amplaye/Downloads/screen ios/IMG_9557.PNG | Read |
| /Users/amplaye/Downloads/screen ios/IMG_9555.PNG | Read |
| /Users/amplaye/RaffleMania/src/components/common/PreviewThemeBanner.tsx | Edit |
| /Users/amplaye/RaffleMania/src/store/useEffectsStore.ts | Edit |
| /Users/amplaye/RaffleMania/src/screens/shop/ShopScreen.tsx | Edit |
| /Users/amplaye/RaffleMania/App.tsx | Read |
| /Users/amplaye/RaffleMania/src/store/useTutorialStore.ts | Edit |
| /Users/amplaye/RaffleMania/src/types/index.ts | Edit |
| /Users/amplaye/RaffleMania/src/components/modals/TutorialModal.tsx | Edit |
| /Users/amplaye/RaffleMania/src/store/useAuthStore.ts | Edit |
| /Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/rafflemania-ios-push-permission-regression.md | Edit |

### Uncommitted Changes (git status)
```
?? .claude/
?? scripts/storage-audit.sql
```

## Todo State (last snapshot)

- [ ] POST-RELEASE: set game_config min_version=1.0.5 once live on both stores
- [ ] SECURITY: rotate creds exposed in git history (FTP/WP/Plesk/DB/OneSignal)
- [x] Support double-message bug fixed (server dedup, deployed, dups cleaned)

## Recent Shell Commands

```bash
cd /Users/amplaye/RaffleMania
curl -s -X POST "https://api.supabase.com/v1/projects/kjkxvrxzwzvimgfycohf/database/query" \
cd /Users/amplaye/RaffleMania
curl -s -X POST "https://api.supabase.com/v1/projects/kjkxvrxzwzvimgfycohf/database/query" \
curl -s -X POST "https://api.supabase.com/v1/projects/kjkxvrxzwzvimgfycohf/database/query" \
cd /Users/amplaye/RaffleMania
cd /Users/amplaye/RaffleMania
cd /Users/amplaye/RaffleMania
cd /Users/amplaye/RaffleMania
cd /Users/amplaye/RaffleMania
cd /Users/amplaye/RaffleMania
curl -s -X POST "https://api.supabase.com/v1/projects/kjkxvrxzwzvimgfycohf/database/query" \
```

## Immediate Next Steps

1. Read this handoff fully, then re-read the **Current Objective**.
2. Re-open the most-recently-touched file: `/Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/rafflemania-support-chat-dual-write.md` and confirm state.
3. Continue the Current Objective from where the last action left off.

## Gotchas

- This was generated automatically; verify any half-finished edit against the actual file before assuming it is complete.
- Check `git status` for uncommitted work before making new changes.
