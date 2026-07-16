# Notifica violazioni dati (GDPR / AEPD)

*Versione 1.0 — luglio 2026. Owner: Steward (tecnica) + Sofía (comunicazioni).
Autorità competente: AEPD (Spagna) — sede espansione principale; per tenant
italiani coordinarsi anche col Garante.*

## Albero decisionale (entro 72 ore dalla scoperta)

```mermaid
flowchart TD
    A[Sospetta violazione<br/>di dati personali] --> B{Sono coinvolti<br/>dati personali?}
    B -- No --> Z1[Incidente normale:<br/>INCIDENT_RESPONSE.md<br/>+ post-mortem]
    B -- Sì --> C[REGISTRA tutto:<br/>cosa, quando scoperto, chi, quanti interessati]
    C --> D{Rischio per diritti e libertà<br/>degli interessati?}
    D -- "Improbabile<br/>(es. dati cifrati, chiave non compromessa)" --> Z2[Solo registro interno<br/>art. 33.5 - documenta la motivazione]
    D -- Probabile --> E[NOTIFICA AEPD entro 72h<br/>sede electronica aepd.es]
    E --> F{Rischio ELEVATO?<br/>es. conversazioni sanitarie,<br/>credenziali, dati finanziari}
    F -- No --> Z3[Registro + notifica AEPD basta]
    F -- Sì --> G[Comunica anche agli INTERESSATI<br/>senza ritardo - art. 34]
    G --> H[Informa i TENANT coinvolti:<br/>sono i titolari, noi responsabili<br/>del trattamento - art. 33.2]
```

## Ruoli GDPR — chi notifica chi

- **BALI Flow è responsabile del trattamento** (processor) per i dati dei clienti
  finali dei ristoranti: se la violazione tocca quei dati, il nostro obbligo
  primario è avvisare **senza ritardo il tenant** (titolare), che notifica AEPD.
- **BALI Flow è titolare** per i propri dati (account staff dei tenant, dati di
  fatturazione dei tenant): lì notifichiamo noi direttamente AEPD entro 72h.

## Contenuto minimo della notifica (art. 33.3)

1. Natura della violazione, categorie e numero approssimativo di interessati e
   record.
2. Contatto: `security@baliflowagency.com`.
3. Probabili conseguenze.
4. Misure adottate o proposte (contenimento, rotazione chiavi, ripristino).

## Registro violazioni

Ogni evento (anche quelli NON notificati) va registrato in
`docs/security/archive/breach-YYYY-MM-DD.md` con la valutazione del rischio e
la decisione presa. È l'evidenza di accountability richiesta dall'art. 33.5.
