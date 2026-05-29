# Prompt per la prossima sessione — Migrazione Twilio→Meta WhatsApp

> Copia-incolla il blocco qui sotto come primo messaggio della prossima sessione.

---

Riprendiamo la migrazione di BaliFlow CRM da **Twilio WhatsApp → Meta WhatsApp Cloud API**. Il piano completo, già validato da un audit esaustivo, è in `/Users/amplaye/.claude/plans/temporal-bouncing-rainbow.md` — **leggilo per primo** (contiene mappa, fasi, rischi, e in appendice la lista dei 38 workflow con credenziali Twilio hardcoded da ruotare).

**Obiettivo:** far sparire OGNI traccia di Twilio da WhatsApp (n8n + repo + DB + credenziali). Twilio resta SOLO come futuro trunk voce (fuori scope). Numero Meta unico condiviso: `phone_number_id = 1095078260361095` (già attivo su PICNIC e oraz).

**Contesto chiave già accertato:** la migrazione è a metà (Meta Router già attivo, chatbot Picnic/oraz/BALI Rest con doppio path Meta/Twilio, PICNIC il più avanti). 61 workflow su 97 da modificare; 38 con SID+token Twilio in chiaro + 1 JWT Supabase hardcoded in oraz Chatbot. Due vincoli grossi: i **template Meta approvati** (per i messaggi proattivi, review lenta → da chiedere subito) e il **routing con numero condiviso**.

**Prima di toccare qualcosa, risolviamo le 3 decisioni aperte** (sono nel piano, sezione "Decisioni aperte"):
1. **Routing:** numero Meta unico con smistamento applicativo a valle, oppure un `phone_number_id` per ristorante? (è il nodo architetturale più grosso)
2. **Token Meta:** centralizzato in env/credenziali (consigliato, un numero solo) o per-tenant in `bot_config`?
3. **Env Twilio voce:** rimuovo subito `TWILIO_ACCOUNT_SID/AUTH_TOKEN` o le tengo per la voce futura?

Fammi queste domande **a voce** (come da mie istruzioni globali), una alla volta, in italiano semplice — non capisco i dettagli tecnici, quindi spiegami i pro/contro in parole povere e consigliami tu. Poi, quando ho deciso, presentami il piano d'esecuzione aggiornato ed eseguilo fase per fase (PICNIC-first), chiedendomi conferma sui passi delicati (rotazione credenziali, spegnimento workflow, numeri LIVE +34641459479).

Note: lavoriamo su `main` (no branch), commit+push automatico a fine task, le chiamate n8n/Supabase richiedono `dangerouslyDisableSandbox`. Verifica sempre con tsc+vitest+build e con uno scan finale `grep` anti-Twilio su repo e workflow.
