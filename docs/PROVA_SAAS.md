# PROVA SAAS — cosa è garantito dal sistema stesso (non dalla buona volontà)

> Documento collegato a `docs/PIANO_SAAS.md`. Serve a rispondere all'investitore quando chiede *"come so che è davvero un software (SaaS) e non un'agenzia che fa tutto a mano?"*.

## L'idea in una frase

Nel piano c'è una **"Verifica Globale"**: una lista di controlli da fare a mano per dimostrare che è un SaaS. Il problema delle liste a mano è che ci si dimentica di farle. Così abbiamo trasformato i controlli **che si possono fare senza chiamare servizi esterni** in **test automatici**: girano da soli a ogni modifica del codice. Se qualcuno, anche per sbaglio, rompe uno di questi pilastri, **il test diventa rosso e blocca il lavoro**. Non è "speriamo che funzioni": è il sistema che si controlla da solo.

Comando per farli girare (anche davanti a un investitore): `npm test`.

## I pilastri bloccati automaticamente

| Pilastro (la promessa SaaS) | Cosa garantisce | Dove è bloccato |
|---|---|---|
| **Un solo mestiere: ristoranti** | Ogni nuovo cliente nasce come ristorante, sempre — niente "piattaforma multi-settore" finta. Il tipo di attività non si può falsificare da un modulo web. | `src/lib/tenants/create-tenant.test.ts` |
| **Stato del cliente esplicito** | Ogni cliente nasce con uno stato chiaro (prova / attivo) deciso dal punto giusto, non a caso. Solo i clienti vivi consumano risorse. | `src/lib/tenants/create-tenant.test.ts` + `src/lib/tenants/status.test.ts` |
| **Si configura, non si costruisce** | Accendere/spegnere una funzione (es. lista d'attesa) cambia il comportamento **solo di quel ristorante**, senza toccare il codice e senza toccare gli altri clienti. È la differenza tra SaaS (una macchina, mille regolazioni) e agenzia (mille copie della macchina). | `src/lib/saas-invariants.test.ts` + `src/lib/tenants/features.test.ts` + `src/lib/types/tenant-settings.test.ts` |
| **Mai più "ripieghi su Picnic"** | Il segnale d'allarme #1 per l'investitore era: se manca la configurazione di un cliente, il sistema usava di nascosto quella del primo ristorante (Picnic). Ora un controllo automatico vieta che il numero/telefono del template ricompaia dentro le route attive: se la config manca, il sistema lo dice chiaramente, non "fa finta" usando un altro. | `src/lib/saas-invariants.test.ts` |

## Cosa NON è (ancora) automatico — e perché è onesto dirlo

Alcuni controlli della "Verifica Globale" toccano servizi esterni veri (Retell per la voce, n8n per i flussi, Twilio per WhatsApp). Quelli **non** si possono provare senza un cliente reale e un numero di telefono vero, quindi restano verifiche manuali e sono **in attesa del primo cliente** (vedi Mossa 5 nel piano). Non li abbiamo finti: dire "questo lo proviamo quando arriva un cliente" è più credibile che simulare una prova che non prova nulla.

## In breve, per chi non programma

- I **4 pilastri qui sopra** sono garantiti dalla macchina, a ogni modifica.
- Gli altri (servizi esterni) si verificano col **primo cliente reale**.
- Il senso: meno cose dipendono dalla memoria di una persona, più il prodotto è un vero software.
