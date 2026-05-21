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

### Raccomandazione
> **Opzione B adesso, architettura pronta per l'Opzione A dopo.**

Motivo: l'Opzione A pura, senza un cliente reale, significa indovinare cosa serve e rischiare di bruciare mesi senza acquisire nessuno. L'Opzione B dà *subito* una storia SaaS credibile e lascia migrare al motore unico **quando i primi clienti veri** diranno cosa serve davvero. Si decide di nuovo dopo i primi 3-5 clienti.

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
