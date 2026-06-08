# Prompt per la prossima sessione — CRM gestionale / integrazione POS

Copia-incolla questo all'inizio della prossima sessione.

---

## Contesto (cosa è già fatto)

Stiamo costruendo il **modulo gestionale** del CRM BaliFlow (`/Users/amplaye/CRM`), con la
visione: **il cliente gestisce TUTTO dal CRM, anche scrivendo sui sistemi POS connessi, senza
mai aprire la cassa**. La "presa universale": ogni cassa = un adapter; a valle tutto legge tabelle
canoniche (`pos_sales`/`menu_items`/`ingredients`). Flag `management_enabled` per tenant.

**Loyverse** è la PRIMA cassa reale integrata (le altre 5 — Cassa in Cloud, Tilby, iPratico,
NemPOS, Deliverect — sono stub). API base `https://api.loyverse.com/v1.0` (NB: `v1.0`, non `v1`),
auth `Bearer <token>` (token nel Back Office → Settings → Access tokens, immediato).

### Già funzionante e verificato dal vivo
- **Lettura POS→CRM**: `fetchSales` + `fetchProducts` (`src/lib/pos/adapters/loyverse.ts`), sync
  reale (`src/lib/pos/sync.ts`) che collega i piatti ai prodotti POS via
  `menu_items.pos_external_product_id` (match per nome).
- **Scrittura CRM→POS**: `pushProductPrice` (write-back prezzo), route `/api/pos/push-price`
  (auth utente + ownership). E2E verificato: modifica prezzo dalla UI Food cost → cambia sulla
  cassa Loyverse reale (€7→€8.5).
- **Food cost operativo** (`src/app/(dashboard)/food-cost/page.tsx`): prezzo editabile inline,
  ricetta espandibile per riga (RecipePanel), **paginazione 25 righe/pagina**.
- **Wizard onboarding**: step "Cassa" con 6 POS (i18n it/es/en/de).
- 448/448 test verdi, tsc pulito. Deployato in prod (auto-deploy GitHub→Vercel).

### Account/dati di test (Loyverse "Trattoria Demo")
- Tenant collegato per i test: **Oraz** (`93eebe9c-8af5-4ca5-a315-3376ef4976e5`), owner =
  steward_russo94@hotmail.it. Ha 3 piatti collegati a Loyverse (Margherita/Diavola/Vino) +
  ingredienti + ricette + connessione `loyverse` attiva.
- Store Loyverse id: `45728289-ec10-46fd-8377-dac0de22ccd0`.
- ⚠️ Il token Loyverse è stato condiviso in chat in sessioni precedenti: **valuta di rigenerarlo**.
- ⚠️ `POS_CRED_ENC_KEY` in `.env.local` è LOCALE (diversa da prod): le credenziali cifrate in
  locale NON sono leggibili in prod e viceversa. Per testare in prod serve collegare il tenant
  con la chiave di prod.

### Script utili (in `scripts/`)
- `loyverse-live-test.ts` — smoke test lettura (LOYVERSE_TOKEN=... npx tsx ...)
- `loyverse-writeback-test.ts` — test write-back prezzo (toggle 7↔8.5)

---

## Cosa manca / prossimi passi (in ordine di valore)

Per completare la visione "tutto dal CRM, niente POS", restano da fare:

1. **Write-back oltre il prezzo**: oggi si scrive solo il prezzo. Aggiungere al contratto adapter
   e a Loyverse: **creare/rinominare un prodotto**, **gestire lo stock** (Loyverse `/inventory`),
   ed eventualmente categorie. Così Magazzino e Menu diventano davvero bidirezionali.
2. **Sezione Magazzino operativa**: come Food cost, renderla editabile (creare/modificare
   ingredienti, scorte) e — se il prodotto è collegato — riflettere lo stock sul POS.
3. **UI di connessione cassa nelle Impostazioni**: oggi il provider si imposta nel wizard, ma
   manca una pagina in Settings dove il cliente **incolla il token Loyverse**, testa la
   connessione (`testConnection`) e fa "Sincronizza ora". Senza questa, il collegamento è solo
   via script. È il pezzo che rende l'integrazione self-service per il cliente.
4. **Gestione conflitto prezzi POS↔CRM**: definire la "fonte di verità". Oggi il sync legge i
   prezzi dal POS (potrebbe sovrascrivere modifiche CRM al prossimo sync). Decidere la regola
   (es. CRM vince, o ultimo-scritto-vince) e documentarla.
5. **Estendere il write-back agli altri POS** quando arrivano le loro API/credenziali.

## Note operative / preferenze
- L'utente (Steward) è figura tech ma non programmatore: serve sempre un **modo concreto per
  testare** ciò che si costruisce, e spiegazioni semplici (deve poterlo spiegare al cliente).
- Domande SEMPRE a voce: `/Users/amplaye/.claude/voice/ask_voice.sh "<domanda in italiano>"`.
- Test SEMPRE end-to-end con Playwright prima di dire "pronto". Auto commit+push a fine task.
- DB live via Supabase Management API (token in credentials.md, ref `azhlnybiqlkbhbboyvud`).
