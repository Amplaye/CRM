# Flusso dei dati

*Versione 1.0 — luglio 2026. Owner: Steward. Aggiornare se cambia
l'architettura (nuovo canale, nuovo provider).*

## Canale WhatsApp (principale)

```mermaid
flowchart LR
    D[Cliente finale<br/>WhatsApp] -->|messaggio| M[Meta Cloud API]
    M -->|webhook firmato<br/>X-Hub-Signature-256| N[n8n router + motore unico<br/>VPS Hostinger]
    N -->|"Fetch diretto (service role):<br/>storia, KB, disponibilità"| S[(Supabase<br/>Postgres + RLS)]
    N -->|"POST /api/ai/*<br/>AI_WEBHOOK_SECRET"| C[CRM Vercel<br/>crm.baliflowagency.com]
    C --> S
    N -->|risposta| M -->|messaggio| D
    C -->|dashboard TLS| U[Staff ristorante<br/>login Supabase Auth]
```

## Canale voce

```mermaid
flowchart LR
    T[Chiamante] --> V[Vapi / Retell]
    V -->|assistant-request| C[CRM /api/voice/*]
    C --> S[(Supabase)]
    V -->|end-of-call report| C
    C -->|"follow-up WhatsApp<br/>(template)"| M[Meta Cloud API]
```

## Pagine pubbliche e pagamenti

```mermaid
flowchart LR
    W[Visitatore web] -->|/s /b /g /m| C[CRM Vercel]
    C -->|service-role<br/>query tenant-scoped| S[(Supabase)]
    W -->|checkout| P[Stripe / PayPal]
    P -->|webhook firmato| C
    C -->|email conferma| R[Resend<br/>chiave del tenant]
```

## Dove vivono i dati personali

| Dato | Dove | Protezione |
|---|---|---|
| Numeri di telefono, nomi, conversazioni | Supabase (`guests`, `conversations`) | RLS per-tenant, TLS, retention/DSAR |
| Credenziali POS/email/pagamento dei tenant | Supabase, cifrate | AES-256-GCM (`POS_CRED_ENC_KEY`) |
| Segreti di piattaforma per-tenant | `tenants.secrets` (JSONB) | Solo service-role — rischio accettato n.1 |
| Dati pagamento carte | Solo presso Stripe/PayPal | mai sul nostro DB |
| Registri fiscali | `fiscal_records` append-only | catena huella SHA-256 |
| Audit e login | `audit_events`, `login_events` | service-role only |
