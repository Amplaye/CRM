# Collegare Instagram e Facebook alla sezione Social

Questa è la lista del processo di connessione con le API ufficiali Meta (Instagram
Graph API + Facebook Login). Il ristoratore la segue una volta; la parte "lato
piattaforma" è a cura dell'agenzia una tantum.

## Prerequisiti (lato ristoratore)

1. **Una Pagina Facebook** del ristorante (non un profilo personale).
2. **Un profilo Instagram Business o Creator** collegato a quella Pagina.
   - Instagram → Impostazioni → Account → **Passa a un account professionale**.
   - Poi collega la Pagina Facebook dalle impostazioni del profilo IG.
   - La pubblicazione via API funziona **solo** con IG Business/Creator + Pagina.

## Connessione (nel CRM)

3. CRM → sezione **Social** → **"Collega account"**.
4. Si apre il login Facebook: accedi e **autorizza i permessi**:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`
5. **Scegli la Pagina** (se ne amministri più d'una): il CRM rileva l'account
   Instagram collegato a quella Pagina.
6. Fatto: l'account appare **"Collegato"**. Il token della Pagina resta sul
   server (mai nel browser).

## Note (lato piattaforma / agenzia — una tantum)

- L'**App Meta** deve avere i prodotti **Instagram Graph API** + **Facebook Login**.
- Per pubblicare in **produzione**, `instagram_content_publish` richiede
  **App Review** di Meta. In fase demo si usano **utenti di test** dell'app.
- **Rate limit**: 100 post pubblicati / 24h per account IG (ampiamente sufficiente).
- **Reel**: la codifica video avviene nel browser (WebCodecs) → solo **Chromium**
  (Chrome/Edge/Brave). Immagini e caroselli funzionano ovunque.

## Vincoli tecnici noti

- Per pubblicare, Meta **scarica** i media da URL pubblici: i render finiscono nel
  bucket **pubblico** `social-media` prima della pubblicazione.
- La **licenza Remotion** è gratis per team fino a 3 persone (anche uso
  commerciale); da 4+ persone serve una company license (~$100/mese).
