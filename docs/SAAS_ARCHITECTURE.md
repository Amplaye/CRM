# Bali Flow — Architettura SaaS (la bussola)

> Documento non tecnico. Serve a rispondere a UNA domanda: **Bali Flow è un vero SaaS o un'agenzia mascherata?**
> Scritto il 2026-05-21. Stato: siamo in sviluppo, **zero clienti reali** (Picnic è il nostro demo/pilota interno).

---

## 1. Perché questo documento esiste

La paura numero uno di un investitore è:

> "Se ogni ristorante richiede logica WhatsApp custom, menù custom, modifiche CRM custom, integrazioni custom, supporto custom e siti custom — allora questa è un'agenzia travestita da software. E le agenzie non scalano e non valgono molto."

Diventiamo *investibili* solo se possiamo dimostrare 5 cose:

1. **Setup standard** — ogni cliente parte dallo stesso prodotto
2. **Onboarding ripetibile** — attivare un cliente è una procedura, non un progetto
3. **Personalizzazione limitata** — il custom è l'eccezione costosa, non la regola
4. **Supporto ad alto margine** — pochi interventi manuali per cliente
5. **Vendite ripetibili** — vendi sempre lo stesso pacchetto

Questo documento misura dove siamo su ciascuna, e dove dobbiamo arrivare.

---

## 2. La metafora da tenere a mente

> **SaaS vero = un motore, mille configurazioni.**
> **Agenzia mascherata = mille copie dello stesso motore.**

Una catena di pizzerie SaaS ha **una ricetta** e ogni locale cambia solo gli ingredienti dal menù.
Un'agenzia ha **un cuoco per locale** che reinventa la ricetta ogni volta.

La domanda-test per qualsiasi nuova feature:

> *Quando arriva un nuovo cliente, sto **configurando** (dati nel database) o sto **costruendo** (codice/workflow nuovi per lui)?*
> Configuro = SaaS. Costruisco = agenzia.

---

## 2-bis. Focus: UN solo verticale — i ristoranti (decisione utente, 2026-05-21)

> **Questo CRM è e resta il CRM *per ristoranti*. Punto.**

Oggi la pagina di registrazione offre 3 tipi di attività (ristorante / ecommerce / servizi), ma dietro ecommerce e servizi **non c'è nulla** — è una "porta dipinta sul muro". Per un investitore tre verticali vuoti pre-clienti sono il segnale opposto a quello che vogliamo: dicono *"agenzia che spruzza e prega"*, non *"prodotto focalizzato"*. Quindi: si tolgono ecommerce e servizi dalla registrazione (resta solo ristorante).

**Visione futura (preferenza utente):** se un domani ci si espande ad altri settori, saranno **prodotti separati e dedicati**, NON questo CRM gonfiato per fare tutto. Conseguenza positiva sul presente: niente complessità multi-business qui dentro. La colonna `business_type` resta nel database come gancio dormiente (fissa a `restaurant`), ma non costruiamo varianti che non esistono. Quel futuro lontano riuserà questo come *scheletro* (account, fatturazione, infrastruttura AI sono comuni), non ripartirà da zero — ma è una decisione da prendere col mercato, non ora.

---

## 3. Dove siamo oggi (verdetto: ~60% SaaS, ~40% agenzia)

Basato sull'analisi del codice in `/Users/amplaye/CRM` e dell'infrastruttura n8n/Retell.

### ✅ Quello che è già SaaS vero (la fondazione è solida)

| Cosa | Stato | Dove |
|---|---|---|
| **Isolamento dati per cliente** | ✅ Solido | Ogni tabella ha `tenant_id` + RLS Supabase. Nessun cliente vede i dati di un altro. |
| **Differenze cliente = dati, non codice** | ✅ Solido | Orari, menù, messaggi, regole, config Retell stanno in `tenants.settings` (JSONB) e tabelle per-tenant. Cambiare orari ≠ toccare codice. |
| **Onboarding automatizzato** | ✅ ~70% | Wizard `/admin/onboard` provisiona un tenant in ~1 min: tenant, tavoli, KB, agente Retell, workflow, account owner. |
| **Self-serve config** | ✅ Buono | Il cliente modifica orari/menù/messaggi dal pannello `/settings` e `/knowledge`. |

**Questa fondazione è migliore di quella di molte startup pre-clienti.** Non va buttata: va completata.

### ❌ I 4 problemi che ci fanno sembrare un'agenzia

**Problema 1 — "Picnic è lo stampo di tutti" (segnale d'allarme #1 per investitori)**
Il codice usa Picnic come modello da cui clonare. Peggio: in 3 punti, se manca una configurazione, il sistema *ripiega su Picnic* invece di dare errore.
- `src/lib/onboarding/substitute.ts` — Picnic come "golden source", tenant_id hardcoded
- `src/app/api/sync-kb-retell/route.ts` — fallback config Picnic
- `src/app/api/sync-vapi-voicemail/route.ts` — fallback assistant Picnic
- `src/app/api/conversations/resume-bot/route.ts` — webhook Picnic hardcoded
- `src/components/settings/GeneralTab.tsx` — messaggio default "restaurante Picnic"

> Per un investitore tecnico: "quindi tutto il sistema dipende da un cliente speciale?". Da togliere.

**Problema 2 — Per ogni cliente moltiplichiamo l'infrastruttura (segnale d'allarme #2, il più grave per la scala)**
Ogni nuovo ristorante crea: **1 agente vocale Retell dedicato + 13 workflow n8n clonati**. Non è codice condiviso, sono 13 copie separate.
- A 100 clienti = ~1.300 workflow da gestire
- Correggere un bug nel "motore" = propagarlo a mano a ogni cliente
- Riferimento: `src/lib/onboarding/orchestrator.ts` (clona `PICNIC_WORKFLOW_IDS`)

**Problema 3 — Twilio/WhatsApp manuale**
Il collegamento del numero WhatsApp non è automatizzato. Oggi un solo numero attivo alla volta (sandbox). → "non puoi avere 2 clienti attivi insieme?". Da automatizzare.

**Problema 4 — Manutenzione a mano per cliente**
Cartelle di backup (`/Users/amplaye/N8N/picnic/`) mostrano ritocchi manuali iterativi. Comportamento da agenzia. Va eliminato: ogni modifica deve passare dal template, mai dal singolo cliente.

### 🔎 Tre scoperte dall'analisi del codice (fatti, non opinioni)

Tre cose emerse leggendo il codice, che spiegano *perché* i prossimi interventi sono quelli giusti:

1. **`business_type` è un filo scollegato.** La colonna esiste e viene scritta quando si crea un cliente, ma **non viene mai letta per cambiare comportamento** (nessun "se è ristorante fai X"). Cioè: il gancio per i template-per-tipo c'è, ma non è collegato a niente. (Coerente col focus ristorante: per ora resta dormiente, fisso a `restaurant`.)
2. **Tre modi diversi di creare un cliente, non centralizzati.** Self-registration pubblica, demo guest, e wizard admin: tre strade separate, ognuna scrive a modo suo. Vanno unificate (quando arriveremo allo "stato del cliente").
3. **Nessuno "stato" del cliente.** Appena creato, un cliente è subito "vivo": non esiste *in attesa / in prova / attivo / sospeso*. Manca quindi il filtro tra "si è registrato" e "può ricevere traffico". È il pezzo che servirà per avere più clienti attivi insieme in sicurezza.

---

## 4. La decisione chiave: come risolvere il Problema #2

Il Problema #2 (13 copie per cliente) è quello da cui dipende il giudizio "scala / non scala". Due strade:

### Opzione A — Motore unico (shared engine)
Una sola serie di workflow per **tutti** i clienti. All'arrivo di un messaggio, il sistema legge *da quale ristorante viene* e carica la sua config dal DB al volo.
- 🟢 Cliente n°100 gratis. Bug corretto una volta = corretto per tutti. SaaS al 100%.
- 🔴 Riprogettazione impegnativa. Se il motore unico si rompe, si rompono tutti i clienti insieme. Va costruito con cura e monitoraggio.

### Opzione B — Clone versionato (template robusto)
Si tengono le copie, ma gestite bene. I workflow si clonano da un **template ufficiale versionato** (es. "Motore Ristorante v3"), non da Picnic. Un meccanismo propaga gli aggiornamenti del template a tutti i clienti.
- 🟢 Veloce da realizzare da dove siamo. Rischio basso (un cliente rotto non rompe gli altri). Storia investitori comunque valida: "template standard + aggiornamenti automatici".
- 🔴 Restano N copie da gestire. La propagazione automatica è codice da costruire/mantenere. Meno "puro".

### Raccomandazione — il "clone-trampolino" (decisione presa con l'utente, 2026-05-21)
> **Destinazione: motore unico (Opzione A).** L'utente vuole centinaia/migliaia di ristoranti, e a quei numeri il clone non regge.
> **Strada: NON costruirlo ora.** Con zero clienti, costruire il motore unico significa indovinare al buio e bruciare mesi. Si parte da un **"clone-trampolino"**: un clone versionato (Opzione B) ma scritto *già orientato* al motore unico, così la migrazione futura è un'evoluzione, non una riscrittura.

Perché "trampolino" e non solo "clone": ogni gradino (template ufficiale, feature flag, logica condizionale che legge i flag dal DB) avvicina al motore unico invece di allontanarsene. Quando migreremo, sposteremo logica **già testata sui clienti veri**, non codice scritto al buio.

**Quando migrare al motore unico (il criterio, non una data):** quando il "registro varianti" (vedi sotto) smette di crescere — cioè quando **3-4 clienti di fila non chiedono niente di strutturalmente nuovo** (tipicamente tra i 5 e i 15 clienti). È un segnale dai dati, non una scadenza sul calendario.

**Storia per gli investitori scelta dall'utente:** *"funziona ed è affidabile"* prima di *"scala all'infinito"*. Quindi: rischio basso e robustezza prima di tutto. Un cliente che si rompe non deve romperne altri — ed è esattamente ciò che il clone-trampolino garantisce nella fase iniziale.

#### Il registro varianti (la bussola per il "giorno della fusione")
Terremo un elenco (`docs/REGISTRO_VARIANTI.md`) dove ogni volta che un cliente chiede qualcosa che il motore non fa, lo annotiamo: *cosa ha chiesto · quale cliente · come l'abbiamo risolto (interruttore / template / custom a pagamento)*. Serve a due cose: (1) dimostrare agli investitori che le esigenze **non sono infinite** (la curva si appiattisce), e (2) sapere quando le varianti si sono stabilizzate → è quello il momento di unificare il motore.

---

## 5. Architettura target (dove vogliamo arrivare)

```
                    ┌─────────────────────────────┐
                    │   UN SOLO CODEBASE (CRM)     │
                    │   UN SOLO set di workflow*   │
                    │   (*o template versionato)   │
                    └──────────────┬──────────────┘
                                   │ legge per ogni richiesta
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │              DATABASE (per-tenant)                 │
        │  tenant_A: orari, menù, messaggi, regole, config   │
        │  tenant_B: orari, menù, messaggi, regole, config   │
        │  tenant_C: ...                                     │
        └──────────────────────────────────────────────────┘

Il "custom" vero (raro) vive QUI ↓, come eccezione a pagamento:
        ┌──────────────────────────────────────────────────┐
        │  Sezioni CRM custom = template predefiniti +       │
        │  quote dedicate. Mai codice nuovo nascosto.        │
        └──────────────────────────────────────────────────┘
```

**Principio guida:** tutto ciò che differisce tra clienti vive nel database come dati. Il codice/workflow è uno (o un template versionato). Il custom è raro, esplicito e a pagamento.

---

## 6. Roadmap a fasi (dal più facile/sicuro al più ambizioso)

### Fase 0 — Quick wins (giorni) — togliere il segnale d'allarme #1
- Rimuovere i fallback hardcoded a Picnic (errore esplicito se manca config)
- Sostituire i default "restaurante Picnic" con placeholder neutri parametrizzati
- Rendere dinamico il webhook in `resume-bot`
- **Impatto investitore: ALTO. Sforzo: BASSO.** Da fare per primo.

### Fase 1 — Template versionato (settimane) — Opzione B
- Estrarre i 13 workflow Picnic in un "template ufficiale" versionato (non più Picnic come sorgente)
- Template per tipo-business (`restaurant`, `dentist`, …)
- Onboarding clona dal template versionato
- **Impatto: ALTO. Sforzo: MEDIO.**

### Fase 2 — Automazione completa onboarding (settimane)
- Automatizzare il collegamento Twilio/WhatsApp (Problema #3)
- Test end-to-end dell'onboarding (verifica che un nuovo cliente si attivi senza errori)
- Onboarding 100% senza mani sul codice
- **Impatto: ALTO (dimostra "ripetibile"). Sforzo: MEDIO.**

### Fase 3 — Propagazione aggiornamenti (settimane)
- Quando il template cambia, propagare a tutti i clienti automaticamente
- Elimina la manutenzione a mano per cliente (Problema #4)
- **Impatto: MEDIO-ALTO. Sforzo: MEDIO.**

### Fase 4 (futuro, dopo i primi clienti) — Motore unico (Opzione A)
- Migrare dal clone versionato al motore condiviso, se i numeri lo giustificano
- **Da decidere con dati reali, non ora.**

---

## 7. Come questo si traduce nella storia per gli investitori

Quando le fasi 0-2 sono fatte, puoi dire con onestà:

- **Setup standard:** "ogni cliente parte dallo stesso template versionato"
- **Onboarding ripetibile:** "un cliente si attiva in X minuti, da un pannello, senza che tocchi codice — guarda" (demo dal vivo)
- **Personalizzazione limitata:** "il 95% è configurazione nel pannello; il custom è un servizio a parte, a quota dedicata" (vedi listino: 'Sezione Custom nel CRM — su richiesta')
- **Supporto ad alto margine:** "il cliente fa da solo orari/menù/messaggi; il supporto è eccezione"
- **Vendite ripetibili:** "4 pacchetti chiari, prezzi standard" (il listino esiste già)

> Nota: il listino attuale (Starter/Pro/Enterprise/Catene + Add-on) è già coerente con un modello SaaS standardizzato. È un punto a favore: il packaging dice "prodotto", non "consulenza".

---

## 8. Cosa NON fare (anti-pattern da evitare d'ora in poi)

- ❌ Mai più "ritoccare a mano" il workflow di un singolo cliente. Ogni modifica passa dal template.
- ❌ Mai più fallback a un cliente specifico nel codice. Se manca config → errore chiaro.
- ❌ Mai promettere personalizzazioni come parte del pacchetto base. Il custom è un add-on a quota.
- ❌ Mai aggiungere feature "builder" per utenti finali non-tecnici (i ristoratori non vogliono costruire automazioni — vedi feedback progetto).

---

*Prossimo passo proposto: Fase 0 (quick wins sui fallback Picnic). Piccola, sicura, alto impatto sulla percezione "SaaS". Da confermare.*
