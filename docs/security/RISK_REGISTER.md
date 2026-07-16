# Registro dei rischi

*Versione 1.0 — luglio 2026. Owner: Steward. Rivedere a ogni release rilevante
o incidente. Tolleranza: nessun rischio ALTO senza mitigazione o accettazione
scritta.*

| # | Rischio | Prob. | Impatto | Stato / Mitigazione |
|---|---|---|---|---|
| 1 | `tenants.secrets` (openai_key, ai_secret, meta_access_token) in chiaro nel DB (JSONB, solo RLS) | Bassa | Alto | **ACCETTATO**: il motore n8n legge queste colonne direttamente da Supabase; cifrarle romperebbe il motore. Compensazioni: accesso solo service-role, RLS, secret scanning sul codice. Rivalutare se si rifattorizza il motore. |
| 2 | VPS n8n (Hostinger) compromesso o giù → bot muto per tutti | Media | Alto | Parziale: healthcheck + alert; scaling plan documentato. Pending: hardening VPS, uptime monitor esterno. |
| 3 | Account console senza MFA (GitHub, Supabase, Vercel, Meta, Stripe…) | Media | Critico | **Pending Steward**: attivare MFA ovunque (checklist finale). Password già ruotate 2026-05-20. |
| 4 | Backup DB mai testati in restore | Bassa | Critico | **Pending Steward**: verificare piano backup Supabase e fare un test di restore su progetto scratch. |
| 5 | Log runtime Vercel con retention breve (piano Hobby) → forensics limitata | Media | Medio | ACCETTATO in parte: audit_events/login_events/system_logs persistono su DB. Estrarre i log Vercel subito in caso d'incidente. |
| 6 | Dipendenza npm compromessa (supply chain) | Bassa | Alto | Dependabot + npm audit in CI + lockfile. Patch high/critical ≤ 7 giorni. |
| 7 | Webhook spoofing | Bassa | Alto | MITIGATO (lug 2026): firme fail-closed Meta/Twilio/Trello/Stripe/PayPal + alert `webhook_failure` high. |
| 8 | Brute-force sul login | Media | Medio | MITIGATO (lug 2026): password ≥10, rate limit default-ON, tripwire >10 fallimenti/15min → alert. HIBP pending (richiede Supabase Pro). |
| 9 | XSS / injection client | Bassa | Alto | CSP senza `unsafe-eval`, sanitizzazione input, React escaping. `unsafe-inline` resta (necessario a Next): rischio residuo basso. |
| 10 | Leak di dettagli interni negli errori API | Bassa | Medio | MITIGATO (lug 2026): apiError con messaggi generici + requestId su path pubblici. |
| 11 | Service-role nelle pagine pubbliche (/s /b /g…) bypassa RLS: un bug di scoping = dati cross-tenant | Bassa | Alto | Query tenant-scoped esplicite (audit fatto su export ospiti); test saas-invariants. Mantenere il pattern `.eq('tenant_id', …)` in ogni nuova query. |
| 12 | Persona unica (Steward) per tutto il triage | Alta | Medio | ACCETTATO (dimensione azienda). Sofía ha accesso Meta/comunicazioni; documentazione operativa in docs/. |
| 13 | Credenziali in chiaro su disco locale (`.env.local`, `~/.crm-secrets/`, cartella `N8N/`) | Media | Alto | Gitignorate e fuori dal repo (stripe.env spostato lug 2026). Pending: FileVault su tutti i device (vedi ASSET_REGISTER). |
| 14 | Dati fiscali VeriFactu manomessi | Molto bassa | Critico | Catena huella SHA-256 append-only sotto lock SQL; QR AEAT verificabile dal cliente. |
| 15 | Email marketing da dominio piattaforma (reputazione) | Bassa | Basso | Eliminato il pool condiviso: solo BYO-key Resend del tenant, mittente sul SUO dominio verificato. |
