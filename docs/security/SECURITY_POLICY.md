# Politica di sicurezza — BALI Flow CRM

*Versione 1.0 — luglio 2026. Owner: Steward. Revisione: annuale o dopo ogni incidente.*

## Scopo e ambito

Questa politica copre il CRM multi-tenant (`crm.baliflowagency.com`), il motore
conversazionale n8n, i dati dei tenant (ristoranti/cliniche) e dei loro clienti
finali, il codice (`github.com/Amplaye/CRM`) e le console SaaS collegate.

## Ruoli e responsabilità

| Ruolo | Chi | Responsabilità |
|---|---|---|
| Titolare sicurezza | Steward | Triage alert (Trello/Monitoring), gestione accessi, patch, incident response |
| Vice / comunicazioni | Sofía | Contatto tenant, comunicazioni in caso di incidente, accesso Meta Business |
| Fornitori critici | Supabase, Vercel, Meta, Stripe/PayPal, Resend, Hostinger (n8n), Vapi/Retell, OpenAI | Sicurezza dell'infrastruttura sottostante (vedi ASSET_REGISTER.md) |

Terze parti (collaboratori, partner commerciali) ricevono **solo** accessi
minimi e revocabili (invito staff con ruolo, mai credenziali condivise).

## Principi operativi

1. **Least privilege**: ruoli owner/admin/staff nel CRM; RLS per-tenant sul DB;
   route admin protette da `assertPlatformAdmin`; add-on gating.
2. **Fail-closed**: webhook firmati (Meta/Twilio/Trello/Stripe/PayPal) rifiutano
   richieste non verificabili; cron protetti da `CRON_SECRET`; AI routes da
   `AI_WEBHOOK_SECRET`.
3. **Niente segreti in git**: token solo in env Vercel / `.env.local`
   (gitignorato). Secret scanning + push protection attivi sul repo.
4. **Dati minimi**: PII mascherata nei log; messaggi d'errore generici verso
   l'esterno; retention e cancellazione secondo GDPR (vedi moduli DSAR/retention).
5. **Password**: minimo 10 caratteri (enforced da Supabase Auth). MFA
   obbligatoria su tutte le console amministrative (GitHub, Supabase, Vercel,
   Cloudflare, Meta, Stripe, PayPal, Trello, Hostinger).
6. **Aggiornamenti**: Dependabot settimanale + `npm audit` in CI; le patch di
   sicurezza high/critical si applicano entro 7 giorni.
7. **Offboarding**: alla rimozione di un collaboratore si revocano subito membri
   CRM, accessi GitHub e si ruotano le credenziali condivise toccate (fatto ad
   es. il 2026-05-20).

## Gestione del rischio

I rischi sono censiti in [RISK_REGISTER.md](RISK_REGISTER.md) (rivisto a ogni
release rilevante). Tolleranza: nessun rischio "alto" senza mitigazione o
accettazione scritta con motivazione.

## Incidenti

Procedure in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md); obblighi di notifica
in [BREACH_NOTIFICATION.md](BREACH_NOTIFICATION.md). Segnalazioni esterne:
`security@baliflowagency.com` (vedi SECURITY.md nel root del repo).
