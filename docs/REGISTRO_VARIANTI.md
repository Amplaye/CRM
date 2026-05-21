# REGISTRO VARIANTI — la bussola del "giorno della fusione"

> **A cosa serve.** Ogni volta che un cliente (ristorante) chiede qualcosa che il
> nostro motore non fa ancora, lo segniamo qui. Serve a due cose:
> 1. **Dimostrare agli investitori che le esigenze NON sono infinite.** Se la lista
>    smette di crescere, vuol dire che abbiamo coperto i casi reali → è un SaaS, non
>    un'agenzia che ricostruisce tutto per ogni cliente.
> 2. **Decidere QUANDO passare al "motore unico"** (Mossa 6 del piano SaaS).
>
> **Posizione:** `/Users/amplaye/CRM/docs/REGISTRO_VARIANTI.md`. Compagno del
> `PIANO_SAAS.md` e della bussola `SAAS_ARCHITECTURE.md`.

## 🟢 IL CRITERIO DEL "GIORNO DELLA FUSIONE"

Passiamo al motore unico **quando 3-4 clienti di fila chiedono ZERO varianti nuove.**
Non è una data sul calendario: è un segnale che leggiamo da questa tabella. Finché
ogni nuovo cliente aggiunge righe, è presto. Quando la curva si appiattisce
(tipicamente fra i 5 e i 15 clienti), siamo pronti.

## 🔑 LE TRE MODALITÀ DI RISPOSTA (la colonna "risolta come")

Quando arriva una richiesta, la risolviamo in UNO di questi tre modi — in ordine di
preferenza (dall'alto = più SaaS, in basso = più agenzia):

| Modo | Cosa vuol dire | Costo per noi |
|------|----------------|---------------|
| **🟩 flag** | Esiste già un interruttore (o ne aggiungiamo UNO al template). Si accende dal pannello. | Quasi zero — è solo configurazione. |
| **🟦 template** | Si risolve riempiendo dati nel profilo del cliente (orari, menù, telefono, voce…). Nessun codice nuovo. | Basso — è data entry. |
| **🟥 custom a pagamento** | Richiede codice/workflow nuovo solo per quel cliente. Da evitare; se serve, si fa pagare. | Alto — è lavoro da agenzia. |

> **Regola d'oro:** ogni richiesta 🟥 è un campanello. Se due clienti chiedono la
> stessa cosa "custom", quella variante va promossa a **flag** sul template (una
> volta sola) così tutti i futuri clienti ce l'hanno senza lavoro extra.

---

## 📋 REGISTRO

> Riga più recente in cima. Le righe pre-popolate qui sotto sono le varianti **già
> note** dal prototipo Picnic: servono a mostrare che l'elenco è finito e in gran
> parte già coperto.

| Variante richiesta | Cliente | Risolta come |
|--------------------|---------|--------------|
| Orari di apertura diversi (giorni/fasce) | Picnic | 🟦 template — campo `opening_hours` nel profilo |
| Doppio turno (pranzo + cena) | Picnic | 🟩 flag `double_shift` |
| Lista d'attesa quando è pieno | Picnic | 🟩 flag `waitlist_enabled` |
| Bot risponde in più lingue (es/it/en/de) | Picnic | 🟩 flag `multi_language` |
| Più sale / ambienti separati | — (previsto) | 🟩 flag `multi_room` |
| Eventi, serate speciali, gruppi grandi | — (previsto) | 🟩 flag `events_enabled` |
| Terrazza / posti all'aperto | — (previsto) | 🟩 flag `terrace` |
| Animali ammessi | — (previsto) | 🟩 flag `pet_friendly` |
| Messaggio di segreteria personalizzato | Picnic | 🟦 template — `vapi_voicemail` nel profilo |
| Menù / FAQ proprie del locale | Picnic | 🟦 template — articoli `knowledge_base` per cliente |
| Voce del bot diversa | Picnic | 🟦 template — config Retell per cliente |
| Valuta / fuso orario | Picnic | 🟦 template — `timezone` / `currency` nel profilo |
| Numero WhatsApp dedicato per cliente | — (futuro) | 🟥 → da automatizzare in Mossa 5 (oggi manuale) |

---

## COME SI USA (operativo)

1. Cliente chiede qualcosa che non c'è → **aggiungi una riga in cima.**
2. Decidi la modalità (🟩 flag / 🟦 template / 🟥 custom) usando la regola d'oro.
3. Se è 🟩 flag nuovo → aggiungilo **al template una volta** (vedi `tenant-settings.ts`,
   blocco `features`) e accendilo solo per chi lo chiede.
4. Periodicamente guarda la tabella: **se le ultime 3-4 righe sono vecchie e nessun
   cliente nuovo ne aggiunge** → è ora di valutare la Mossa 6 (motore unico).
