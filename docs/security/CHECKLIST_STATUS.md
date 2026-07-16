# Stato checklist — 108 misure (IKT-Minimalstandard 2023 / NIST CSF)

*Generato 2026-07-16 dal progetto di hardening. Fonte: BALI_Flow_Security_Baseline_Checklist.xlsx.*

*Security review finale (2026-07-16) sul diff completo dell'hardening: **0 vulnerabilità confermate, 0 falsi positivi da registrare** (verificati: branch non autenticato di log-login, logica firme fail-closed, refactor apiError su ~50 route, tenant-scoping export, CSP).*


**Riepilogo: 74 fatte · 17 da fare (owner assegnato) · 17 non applicabili — su 108 misure.**


## Identify

| Codice | Misura | Stato | Evidenza / Azione |
|---|---|---|---|
| ID.AM-1 | Inventory all physical devices and systems used by the organization | ⏳ Da fare | Steward: compilare tabella device in ASSET_REGISTER.md (template pronto) |
| ID.AM-2 | Inventory all software platforms and applications in use | ✅ Fatto | ASSET_REGISTER.md § SaaS/sub-processor |
| ID.AM-3 | Map organizational communication and data flows | ✅ Fatto | DATA_FLOW.md (3 diagrammi mermaid) |
| ID.AM-4 | Catalogue external information systems the business depends on | ✅ Fatto | ASSET_REGISTER.md § sistemi esterni |
| ID.AM-5 | Prioritize assets by classification, criticality and business value | ✅ Fatto | Colonna criticità in ASSET_REGISTER.md |
| ID.AM-6 | Establish cybersecurity roles and responsibilities for staff and third parties | ✅ Fatto | SECURITY_POLICY.md § ruoli |
| ID.BE-1 | Identify and communicate the organization's role in the supply chain | — N/A | Micro-azienda, non parte di supply chain critica |
| ID.BE-2 | Identify the organization's place in critical infrastructure / sector | — N/A | Non infrastruttura critica |
| ID.BE-3 | Establish and communicate priorities for mission, objectives and activities | ✅ Fatto | SECURITY_POLICY.md § principi |
| ID.BE-4 | Establish dependencies and critical functions for delivery of critical services | ✅ Fatto | ASSET_REGISTER.md § dipendenze critiche |
| ID.BE-5 | Establish resilience requirements to support delivery of critical services | ✅ Fatto | Resilienza: Vercel/Supabase gestiti + coda fiscale + RISK_REGISTER n.2/4 |
| ID.GV-1 | Establish and communicate an organizational cybersecurity policy | ✅ Fatto | SECURITY_POLICY.md |
| ID.GV-2 | Coordinate cybersecurity roles with internal roles and external partners | ✅ Fatto | SECURITY_POLICY.md § ruoli (interni + fornitori) |
| ID.GV-3 | Understand and manage legal and regulatory requirements | ✅ Fatto | GDPR: moduli DSAR/retention/purge nel codice; VeriFactu; BREACH_NOTIFICATION.md |
| ID.GV-4 | Ensure governance and risk processes address cybersecurity risks | ✅ Fatto | RISK_REGISTER.md con processo di revisione |
| ID.RA-1 | Identify and document asset vulnerabilities | ✅ Fatto | Dependabot alerts + npm audit in CI (0 vulnerabilità al 2026-07-16) |
| ID.RA-2 | Receive cyber threat intelligence from information-sharing sources | ✅ Fatto | GitHub Security Advisories via Dependabot |
| ID.RA-3 | Identify and document internal and external threats | ✅ Fatto | RISK_REGISTER.md (minacce interne ed esterne) |
| ID.RA-4 | Identify potential business impacts and likelihoods | ✅ Fatto | RISK_REGISTER.md colonne probabilità/impatto |
| ID.RA-5 | Use threats, vulnerabilities, likelihoods and impacts to determine risk | ✅ Fatto | RISK_REGISTER.md |
| ID.RA-6 | Identify and prioritize risk responses | ✅ Fatto | RISK_REGISTER.md colonna stato/mitigazione |
| ID.RM-1 | Establish and agree on risk management processes | ✅ Fatto | SECURITY_POLICY.md § gestione del rischio |
| ID.RM-2 | Determine and express organizational risk tolerance | ✅ Fatto | Tolleranza dichiarata in RISK_REGISTER.md |
| ID.RM-3 | Inform risk tolerance by role in critical infrastructure | — N/A | Non infrastruttura critica |
| ID.SC-1 | Establish supply chain (cyber) risk management processes | ✅ Fatto | ASSET_REGISTER.md = registro sub-processor |
| ID.SC-2 | Identify, prioritize and assess suppliers and partners | ✅ Fatto | Colonna criticità fornitori in ASSET_REGISTER.md |
| ID.SC-3 | Ensure supplier contracts implement supply-chain security measures | ⏳ Da fare | Steward: verificare/accettare DPA di Supabase, Vercel, OpenAI, Resend, Vapi/Retell |
| ID.SC-4 | Routinely assess suppliers via audits, test results or evaluations | — N/A | Micro-azienda: ci si affida a SOC2/ISO dei provider |
| ID.SC-5 | Conduct response and recovery planning/testing with suppliers | — N/A | Micro-azienda |

## Protect

| Codice | Misura | Stato | Evidenza / Azione |
|---|---|---|---|
| PR.AC-1 | Issue, manage, verify and revoke identities and credentials | ✅ Fatto | Supabase Auth, inviti staff con ruolo, revoca membri, rotazione credenziali 2026-05-20, login_events |
| PR.AC-2 | Manage and protect physical access to assets | ⏳ Da fare | Steward: accesso fisico = device personali; FileVault (vedi ASSET_REGISTER) |
| PR.AC-3 | Manage remote access | ✅ Fatto | Tutto è SaaS via TLS; nessuna VPN/rete interna da gestire |
| PR.AC-4 | Manage access permissions with least privilege and separation of duties | ✅ Fatto | Ruoli owner/admin/staff + RLS per-tenant + assertPlatformAdmin + add-on gating |
| PR.AC-5 | Protect network integrity (segregation/segmentation) | ✅ Fatto | Segmentazione logica per-tenant via RLS; CORS ristretto su /api |
| PR.AC-6 | Proof identities and bind them to credentials | ✅ Fatto | Verifica email Supabase Auth all'iscrizione |
| PR.AC-7 | Authenticate users, devices and assets commensurate with risk (e.g. MFA) | ⏳ Da fare | Steward: MFA sulle console (GitHub, Supabase, Vercel, Cloudflare, Meta, Stripe, PayPal, Trello, Hostinger). Password ≥10 char enforced lato app |
| PR.AT-1 | Inform and train all users on cybersecurity | ⏳ Da fare | Steward: 30 min di formazione base a Sofía + partner (phishing, password manager) |
| PR.AT-2 | Ensure privileged users understand their roles and responsibilities | ✅ Fatto | SECURITY_POLICY.md § ruoli definisce le responsabilità dei privilegiati |
| PR.AT-3 | Ensure third parties understand their security roles | ⏳ Da fare | Steward: condividere SECURITY_POLICY.md con i collaboratori esterni |
| PR.AT-4 | Ensure senior executives understand their security roles | — N/A | Nessun livello executive separato (2 persone) |
| PR.AT-5 | Ensure physical/cybersecurity personnel understand their roles | — N/A | Nessun personale sicurezza dedicato |
| PR.DS-1 | Protect data at rest | ✅ Fatto | Supabase cifratura at-rest + AES-256-GCM per credenziali POS/email/pagamento (rischio accettato n.1 per tenants.secrets) |
| PR.DS-2 | Protect data in transit | ✅ Fatto | TLS ovunque, HSTS preload, webhook firmati |
| PR.DS-3 | Formally manage assets through removal, transfer and disposition | ⏳ Da fare | Steward: wipe dei device dismessi (procedura in policy) |
| PR.DS-4 | Maintain adequate capacity to ensure availability | ✅ Fatto | Vercel serverless autoscale + rate limiting default-ON |
| PR.DS-5 | Implement protections against data leaks | ✅ Fatto | Errori API generici (lug 2026), secret scanning + push protection, CSP, PII mascherata nei log |
| PR.DS-6 | Verify software, firmware and information integrity | ✅ Fatto | CI: tsc + vitest + build; package-lock committato |
| PR.DS-7 | Separate development/testing environments from production | ⏳ Da fare | Preview deployment Vercel esistono ma puntano allo stesso DB: valutare progetto Supabase di staging |
| PR.DS-8 | Verify hardware integrity | — N/A | Nessun hardware proprio |
| PR.IP-1 | Create and maintain baseline configurations of systems | ✅ Fatto | Config versionata: next.config (headers), vercel.json (cron), migrazioni SQL, .env.local.example |
| PR.IP-2 | Implement a System Development Life Cycle | ✅ Fatto | Flusso: branch → tsc+test+build → merge main → deploy automatico + CI |
| PR.IP-3 | Establish configuration change control | ✅ Fatto | Change control via git; migrazioni SQL numerate |
| PR.IP-4 | Conduct, maintain and TEST backups | ⏳ Da fare | Steward: verificare piano backup Supabase + UN test di restore documentato (rischio n.4) |
| PR.IP-5 | Meet policy/regulations for the physical operating environment | — N/A | Nessun locale fisico |
| PR.IP-6 | Destroy data according to policy | ✅ Fatto | Purge tenant 90gg + DSAR erase + retention transcript opt-in |
| PR.IP-7 | Continuously improve protection processes | ✅ Fatto | Hardening iterativo (questo progetto) + revisione RISK_REGISTER |
| PR.IP-8 | Share effectiveness of protection technologies | — N/A | Micro-azienda |
| PR.IP-9 | Establish and manage response and recovery plans | ✅ Fatto | INCIDENT_RESPONSE.md + INCIDENT_RUNBOOK.md |
| PR.IP-10 | Test response and recovery plans | ⏳ Da fare | Steward+Sofía: tabletop 1×/anno (simulare un breach sul flusso BREACH_NOTIFICATION) |
| PR.IP-11 | Include cybersecurity in HR practices (screening, offboarding) | ✅ Fatto | SECURITY_POLICY.md § offboarding (applicato realmente il 2026-05-20) |
| PR.IP-12 | Develop and implement a vulnerability management plan | ✅ Fatto | Dependabot weekly + npm audit CI + SECURITY.md (disclosure) + SLA patch 7gg in policy |
| PR.MA-1 | Perform and log maintenance with approved tools | — N/A | Nessuna infrastruttura propria da manutenere (SaaS) |
| PR.MA-2 | Approve, log and secure remote maintenance | ⏳ Da fare | Steward: hardening VPS n8n Hostinger (ssh key-only, aggiornamenti automatici) — rischio n.2 |
| PR.PT-1 | Determine, document, implement and review audit/log records | ✅ Fatto | audit_events + login_events (successi E fallimenti) + system_logs; review via Monitoring/Trello |
| PR.PT-2 | Protect and restrict removable media | — N/A | Nessun uso di media rimovibili nel flusso di lavoro |
| PR.PT-3 | Apply least functionality (only essential capabilities enabled) | ✅ Fatto | CSP senza unsafe-eval, Permissions-Policy, least privilege API, add-on gating |
| PR.PT-4 | Protect communications and control networks | ✅ Fatto | TLS + HSTS + CORS ristretto + firme webhook |
| PR.PT-5 | Implement resilience mechanisms (failover, load balancing) | ✅ Fatto | Vercel/Supabase gestiti (multi-AZ); coda ritrasmissione fiscale |

## Detect

| Codice | Misura | Stato | Evidenza / Azione |
|---|---|---|---|
| DE.AE-1 | Establish a baseline of network operations and expected data flows | ✅ Fatto | system_logs come baseline eventi + vista Monitoring |
| DE.AE-2 | Analyze detected events to understand targets and methods | ✅ Fatto | Triage con categorie/severità + card Trello |
| DE.AE-3 | Collect and correlate event data from multiple sources | ✅ Fatto | system_logs correla webhook/API/AI/cron; error_key deduplica |
| DE.AE-4 | Determine the impact of events | ✅ Fatto | Campo severity valorizzato a ogni log |
| DE.AE-5 | Establish incident alert thresholds | ✅ Fatto | Soglie: severity ≥ medium → card Trello; brute-force >10/15min → high |
| DE.CM-1 | Monitor the network for potential cybersecurity events | ⏳ Da fare | Steward: uptime monitor esterno (UptimeRobot free) su crm.baliflowagency.com + webhook n8n |
| DE.CM-2 | Monitor the physical environment | — N/A | Nessun ambiente fisico |
| DE.CM-3 | Monitor personnel activity for cybersecurity events | — N/A | 2 persone; audit_events copre le azioni admin |
| DE.CM-4 | Detect malicious code | ✅ Fatto | Nessun upload eseguibile (MIME allowlist); push protection; dipendenze scansionate |
| DE.CM-5 | Detect unauthorized mobile code | — N/A | Nessun mobile code di terzi (CSP script-src 'self') |
| DE.CM-6 | Monitor external service provider activity | ✅ Fatto | Alert webhook_failure sui provider + login_events + status page provider |
| DE.CM-7 | Monitor for unauthorized personnel, connections, devices and software | — N/A | Nessuna rete propria |
| DE.CM-8 | Perform vulnerability scans | ✅ Fatto | npm audit in CI + Dependabot + secret scanning su ogni push |
| DE.DP-1 | Define roles and responsibilities for detection | ✅ Fatto | SECURITY_POLICY.md: Steward = triage detection |
| DE.DP-2 | Ensure detection activities comply with requirements | ✅ Fatto | Log senza PII (telefoni mascherati lug 2026); retention conforme |
| DE.DP-3 | Test detection processes | ⏳ Da fare | Steward: 1×/anno test pipeline alert (evento fittizio → card Trello) |
| DE.DP-4 | Communicate event detection information | ✅ Fatto | Card Trello automatiche + campanella in-app |
| DE.DP-5 | Continuously improve detection processes | ✅ Fatto | Dedup error_key + revisione periodica board |

## Respond

| Codice | Misura | Stato | Evidenza / Azione |
|---|---|---|---|
| RS.RP-1 | Execute the response plan during or after an incident | ✅ Fatto | INCIDENT_RESPONSE.md eseguibile (leve di contenimento pronte) |
| RS.CO-1 | Ensure personnel know their roles when a response is needed | ✅ Fatto | Ruoli in SECURITY_POLICY/INCIDENT_RESPONSE (Steward tecnica, Sofía comms) |
| RS.CO-2 | Report incidents consistent with established criteria | ✅ Fatto | Criteri di notifica in BREACH_NOTIFICATION.md |
| RS.CO-3 | Share information consistent with response plans | ✅ Fatto | BREACH_NOTIFICATION.md: AEPD/tenant/interessati |
| RS.CO-4 | Coordinate with stakeholders consistent with response plans | ✅ Fatto | Flusso tenant (titolari) ↔ noi (responsabili) documentato |
| RS.CO-5 | Engage in voluntary information sharing with external stakeholders | — N/A | Micro-azienda |
| RS.AN-1 | Investigate notifications from detection systems | ✅ Fatto | Triage Monitoring/Trello settimanale + alert high immediati |
| RS.AN-2 | Understand the impact of the incident | ✅ Fatto | INCIDENT_RESPONSE.md § analizza (fonti dati per stimare impatto) |
| RS.AN-3 | Perform forensics | ⏳ Da fare | Log Vercel a retention breve (Hobby): estrarli subito a incidente. audit/login/system_logs persistono su DB (rischio n.5) |
| RS.AN-4 | Categorize incidents consistent with response plans | ✅ Fatto | Classificazione severità in INCIDENT_RESPONSE.md |
| RS.AN-5 | Establish processes to receive and respond to vulnerability disclosures | ✅ Fatto | SECURITY.md: security@baliflowagency.com, risposta ≤72h |
| RS.MI-1 | Contain incidents | ✅ Fatto | Leve: kill-switch bot, env opt-out firmati, revoca sessioni, rotazione chiavi |
| RS.MI-2 | Mitigate incidents | ✅ Fatto | INCIDENT_RUNBOOK.md operativo |
| RS.MI-3 | Mitigate or document newly identified vulnerabilities as accepted risks | ✅ Fatto | RISK_REGISTER.md § rischi accettati con motivazione |
| RS.IM-1 | Incorporate lessons learned into response plans | ✅ Fatto | Post-mortem obbligatorio in INCIDENT_RESPONSE.md § impara |
| RS.IM-2 | Update response strategies | ✅ Fatto | Stesso processo (aggiornare piano + registro) |

## Recover

| Codice | Misura | Stato | Evidenza / Azione |
|---|---|---|---|
| RC.RP-1 | Execute the recovery plan during or after an incident | ⏳ Da fare | Dipende dal test di restore backup (PR.IP-4): finché non testato, il recovery plan è teorico |
| RC.IM-1 | Incorporate lessons learned into recovery plans | ✅ Fatto | Post-mortem alimenta anche il recovery (INCIDENT_RESPONSE § impara) |
| RC.IM-2 | Update recovery strategies | ✅ Fatto | Idem |
| RC.CO-1 | Manage public relations after an incident | ⏳ Da fare | Sofía: bozza di comunicazione pubblica post-incidente (2 paragrafi standard) |
| RC.CO-2 | Repair reputation after an incident | ⏳ Da fare | Sofía: idem, gestione reputazione = comunicazione trasparente ai tenant |
| RC.CO-3 | Communicate recovery activities to stakeholders | ✅ Fatto | BREACH_NOTIFICATION.md copre la comunicazione del ripristino ai tenant |
