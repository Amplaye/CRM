# Prompt per la prossima sessione — CRM gestionale / integrazione POS

Copia-incolla questo all'inizio della prossima sessione.

---

## ✅ Stato: i 4 prossimi-passi sono FATTI (2026-06-08, commit b2eae37 + a7d3edf)

Il **modulo gestionale** del CRM BaliFlow (`/Users/amplaye/CRM`) ora realizza la visione
"il cliente gestisce TUTTO dal CRM, anche scrivendo sulla cassa, senza mai aprire il POS".
Loyverse è la prima cassa reale; le altre 5 restano stub. Flag `management_enabled`.

Completato e verificato dal vivo (Loyverse reale + Playwright su prod):

1. **Write-back oltre il prezzo** — `pushProduct` (crea/rinomina) + `pushStock` (giacenza)
   nel contratto adapter e in Loyverse. Create con `track_stock:true`; pushStock abilita
   track_stock prima di scrivere `/inventory` (Loyverse 400 altrimenti — bug trovato live).
2. **Magazzino editabile** (`/inventory`) — stock inline (write-back), editor riga completo,
   crea/elimina ingrediente, picker "collega a prodotto cassa" (`ingredients.pos_external_product_id`).
3. **Connessione cassa self-service** — Settings → **Cassa** (`PosTab`): scegli cassa, incolla
   token, prova, salva+collega, sincronizza ora + stato/ultima sync. Route `/api/pos/connect`.
4. **Conflitto prezzi** — regola "**CRM è fonte di verità**", il sync non sovrascrive mai
   `menu_items.price`. Documentato in `docs/POS_PRICE_CONFLICT.md`.

Bug auth trovato dall'E2E: i write-back POS davano 403 al platform admin che impersona →
`authorizeTenant` ora delega a `verifyTenantMembership` (consente platform_admin). 456/456 test.

Script di prova: `scripts/loyverse-product-stock-test.ts` (cassa reale, con cleanup),
`scripts/pos-ui-e2e.mjs` (UI prod). Token Loyverse salvato in memoria (`credentials_loyverse.md`).

---

## Cosa resta (in ordine di valore)

1. **Estendere write-back (prodotti/giacenze) alle altre 5 casse** quando arrivano le loro
   API/credenziali: implementare `pushProduct`/`pushStock` nei rispettivi adapter. La UI e il
   contratto sono già pronti — è solo il livello adapter.
2. **Categorie bidirezionali** (opzionale): oggi si crea/rinomina prodotto + categoria su create;
   valutare la sincronizzazione categorie nel sync di lettura.
3. **Far girare un sync in prod sul tenant Oraz**: ⚠️ `POS_CRED_ENC_KEY` di prod ≠ locale, quindi
   per testare in prod il collegamento va rifatto dalla UI Settings → Cassa (che ri-cifra il token
   con la chiave di prod). Da lì "Sincronizza ora" funziona.

## Note operative / preferenze
- L'utente (Steward) è figura tech ma non programmatore: serve sempre un **modo concreto per
  testare** e spiegazioni semplici (deve poterlo spiegare al cliente).
- Domande SEMPRE a voce: `/Users/amplaye/.claude/voice/ask_voice.sh "<domanda in italiano>"`.
- Test SEMPRE end-to-end con Playwright prima di dire "pronto". Auto commit+push a fine task.
- ⚠️ I write-back POS vanno testati ANCHE da admin che impersona (non solo da owner): è lì che
  è emerso il bug 403.
- DB live via Supabase Management API (token in credentials.md, ref `azhlnybiqlkbhbboyvud`).
