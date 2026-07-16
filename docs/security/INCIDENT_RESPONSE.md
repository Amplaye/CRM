# Piano di risposta agli incidenti

*Versione 1.0 — luglio 2026. Il runbook operativo dettagliato (comandi, query,
rollback) è [docs/INCIDENT_RUNBOOK.md](../INCIDENT_RUNBOOK.md): questo documento
definisce il processo, quello il "come".*

## Classificazione

| Severità | Esempi | Reazione |
|---|---|---|
| **Critica** | Data breach (PII esposta), takeover account, chiavi compromesse | Subito, drop everything |
| **Alta** | Bot down per tutti i tenant, webhook spoofing riuscito, brute-force riuscito | < 4 ore |
| **Media** | Un tenant degradato, alert `webhook_failure` ripetuti | < 1 giorno |
| **Bassa** | Errore singolo, falso positivo | Triage settimanale board Trello |

## Fasi

1. **Rileva** — Fonti: Monitoring (system_logs), card Trello automatiche,
   `login_events` (brute-force tripwire), Dependabot/secret-scanning alert,
   segnalazione tenant o `security@baliflowagency.com`.
2. **Contieni** — Leve pronte:
   - Kill-switch bot per tenant (Settings → pausa bot).
   - Env di emergenza: `FACEBOOK_VERIFY_SIGNATURE=0` / `TWILIO_VERIFY_SIGNATURE=0`
     / `RATE_LIMIT_ENABLED=0` (+ redeploy) SOLO per ripristinare servizio.
   - Rotazione chiavi: Supabase service role, token Meta, chiavi Stripe/PayPal,
     `AI_WEBHOOK_SECRET` (env Vercel + n8n).
   - Revoca sessioni: Supabase Auth → sign out utente.
   - Rollback codice: `git revert` + push (deploy automatico) o "Redeploy"
     di un deployment precedente in Vercel.
3. **Analizza** — `audit_events`, `login_events`, `system_logs` (persistenti su
   DB), log runtime Vercel (⚠️ retention breve su piano Hobby: estrarre subito),
   execution log n8n.
4. **Notifica** — Se ci sono dati personali coinvolti segui
   [BREACH_NOTIFICATION.md](BREACH_NOTIFICATION.md) (AEPD 72h). Sofía gestisce
   la comunicazione ai tenant.
5. **Recupera** — Ripristino da backup Supabase (PITR/daily secondo piano);
   verifica integrità catena fiscale (`fiscal_records` è append-only, la huella
   rileva manomissioni).
6. **Impara** — Post-mortem breve (cosa, perché, fix, prevenzione) in
   `docs/security/archive/`; aggiorna RISK_REGISTER e, se serve, questo piano.

## Contatti

- Steward (titolare tecnico) — triage e contenimento
- Sofía — comunicazioni tenant/esterne (+34 684 109 244)
- Supabase support, Vercel support, Meta Business support — via console
