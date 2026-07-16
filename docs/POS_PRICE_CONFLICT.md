# Prezzi CRM ↔ Cassa: chi vince?

> Regola in una riga: **il CRM è la fonte di verità per i prezzi del menù.**

## Il problema

Il prezzo di un piatto vive in due posti: nel CRM (`menu_items.price`) e sulla
cassa (es. il prodotto Loyverse). Se entrambi possono cambiare, serve una regola
chiara su quale dei due "vince" quando divergono — altrimenti una sincronizzazione
notturna potrebbe sovrascrivere in silenzio una modifica fatta a mano dal cliente.

## La regola

1. **Il prezzo si modifica dal CRM.** Il cliente cambia il prezzo nella schermata
   Food cost; il CRM lo salva in `menu_items.price` **e** lo invia alla cassa
   (`POST /api/pos/push-price` → `adapter.pushProductPrice`). I due restano
   allineati perché la scrittura parte sempre dal CRM.

2. **La sincronizzazione NON riporta mai il prezzo della cassa nel CRM.**
   Il sync (`src/lib/pos/sync.ts`) importa le **vendite** (fatti storici) e collega
   ogni piatto al suo prodotto cassa, ma **non tocca** `menu_items.price`. Così un
   prezzo vecchio sulla cassa non può cancellare una modifica recente del cliente.
   Il prezzo realmente incassato su ogni scontrino resta comunque registrato in
   `pos_sale_items.unit_price` (serve a food cost / conto economico), ma è un dato
   storico, non il prezzo "di listino".

3. **Se qualcuno cambia il prezzo direttamente sulla cassa** (sconsigliato), quel
   prezzo vale per gli scontrini futuri (e quindi per i report), ma il prezzo di
   listino mostrato nel CRM resta quello del CRM finché il cliente non lo rieduca
   da qui. Messaggio per il cliente: «i prezzi si cambiano dal CRM, non dalla
   cassa».

## Perché così (e non "ultimo che scrive vince")

"Ultimo che scrive vince" sembra comodo ma è ambiguo: una sincronizzazione
automatica scrive di continuo, quindi vincerebbe quasi sempre la cassa, annullando
le modifiche del cliente senza che se ne accorga. Avere **un'unica direzione di
scrittura per i prezzi** (CRM → cassa) è prevedibile e spiegabile in una frase.

## Dove guardare nel codice

- Scrittura prezzo: `src/app/api/pos/push-price/route.ts` (CRM → cassa).
- Sync che NON tocca il prezzo: `buildProductMap` in `src/lib/pos/sync.ts`.
- Le altre scritture seguono la stessa logica per il loro dominio:
  - prodotti (crea/rinomina): `src/app/api/pos/push-product/route.ts`
  - giacenze: `src/app/api/pos/push-stock/route.ts`
