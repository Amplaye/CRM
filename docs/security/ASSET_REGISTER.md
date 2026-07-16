# Registro asset

*Versione 1.0 — luglio 2026. Owner: Steward. Aggiornare quando si aggiunge un
servizio, un collaboratore o un device.*

## Dispositivi fisici (da completare a cura di Steward)

| Device | Proprietario | Accessi | Cifratura disco | Note |
|---|---|---|---|---|
| MacBook (principale) | Steward | Codice, console tutte, CRM admin | ☐ FileVault ON? | verificare |
| iPhone/Android | Steward | WhatsApp Business, email | ☐ | |
| Laptop | Sofía | Meta Business, CRM, WhatsApp | ☐ | |
| _aggiungere device di partner/venditori con accesso CRM_ | | | | |

## Piattaforme SaaS / sub-processor

| Servizio | Uso | Dati trattati | Criticità | DPA/Certificazioni |
|---|---|---|---|---|
| **Supabase** (EU) | DB, Auth, Storage, Realtime | Tutti i dati tenant + PII clienti finali | 🔴 Massima | DPA standard, SOC 2 |
| **Vercel** | Hosting app + cron | Transita tutto il traffico | 🔴 Massima | DPA standard, SOC 2 |
| **Meta (WhatsApp Cloud API)** | Canale messaggi | Numeri di telefono, contenuto conversazioni | 🔴 Alta | Termini Business |
| **Hostinger (VPS n8n)** | Motore conversazionale | Conversazioni in transito, token in workflow | 🔴 Alta | Contratto hosting |
| **OpenAI** | LLM (risposte bot, import menu, OCR) | Estratti conversazioni/menu (no training, API) | 🟠 Media | DPA API |
| **Stripe / PayPal** (LIVE) | Pagamenti | Dati pagamento (tokenizzati dai provider) | 🟠 Alta | PCI-DSS dei provider |
| **Resend** | Email transazionali + marketing (BYO-key per tenant) | Email destinatari | 🟠 Media | DPA |
| **Vapi / Retell** | Voice AI | Audio chiamate, numeri | 🟠 Media | DPA |
| **Twilio** | Legacy voce/SMS | Numeri | 🟡 Bassa (in dismissione) | DPA |
| **GitHub** | Codice + CI | Codice (privato) | 🟠 Alta | — |
| **Trello** | Sink alert sicurezza/bug | Titoli errori (no PII) | 🟡 Bassa | — |
| **Cloudflare** | DNS/Pages (siti) | Traffico siti pubblici | 🟠 Media | DPA |
| **Porkbun** | DNS baliflowagency.com | — | 🟠 Media | — |

**Nota DPA**: questa tabella è l'allegato sub-processor del DPA verso i tenant.
Verificare di aver accettato/scaricato il DPA di: Supabase, Vercel, OpenAI,
Resend, Vapi/Retell (azione Steward).

## Sistemi esterni da cui dipende il servizio

WhatsApp Cloud API (unico canale messaggi), Supabase (unico DB — i backup sono
la vera resilienza), Vercel (deploy), n8n su Hostinger (il bot muore se il VPS
è giù — vedi RISK_REGISTER), AEAT (invio VeriFactu, con coda di ritrasmissione).
