# n8n workflow — audit credenziali hardcoded

Generato: 2026-05-12T16:50:08.959Z da `scripts/audit-n8n-secrets.mjs`.
Fonte: `/Users/amplaye/N8N/picnic` (file `*.json` non backup).

## Riepilogo

| file | twilio_sid | twilio_token_generic_hex | supabase_jwt | openai_key | retell_key | x_ai_secret_header | picnic_tenant_id |
|---|---|---|---|---|---|---|---|
| `Picnic_CRM_Sync.json` | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| `Picnic_Chatbot_WhatsApp.json` | 0 | 0 | 94 | 2 | 0 | 0 | 72 |
| `Picnic_Daily_Summary_10AM.json` | 2 | 2 | 2 | 0 | 0 | 0 | 2 |
| `Picnic_Follow-up_Post-Cena.json` | 2 | 2 | 2 | 0 | 0 | 0 | 2 |
| `Picnic_Menu_del_Dia_-_30min_antes.json` | 2 | 2 | 2 | 0 | 0 | 0 | 2 |
| `Picnic_No-Show_Auto-Cancel.json` | 2 | 2 | 2 | 0 | 0 | 0 | 2 |
| `Picnic_Pre-Turno_Summary.json` | 4 | 4 | 4 | 0 | 0 | 0 | 4 |
| `Picnic_Reminders.json` | 2 | 2 | 2 | 0 | 0 | 2 | 4 |
| `Picnic_Update_Voice_Agent_Date.json` | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| `Picnic_Voice_Agent_Webhooks.json` | 12 | 12 | 4 | 0 | 0 | 22 | 22 |
| `Picnic_Web_Call_Token.json` | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| `Picnic_Weekly_AI_Report.json` | 2 | 0 | 0 | 0 | 0 | 0 | 2 |

**Totale literali**: 314

## Come pulire

1. **Twilio SID/TOKEN**: spostare in `tenants.settings.bot_config.twilio_sid` / `twilio_token` e leggere via `picnicCfgGet()` (pattern già usato nel chatbot post-Risk #2).
2. **Supabase JWT service-role**: usare n8n Credentials (HTTP Header Auth) invece di literal nei jsCode. Richiede creare 1 credential e referenziarla in ogni HTTP node.
3. **OpenAI key**: stessa cosa, n8n Credentials → OpenAI.
4. **Retell key**: idem.
5. **`x-ai-secret`**: header sicuro perché matching contro env CRM-side; spostare comunque in n8n credential.
6. **tenant_id literal**: cosmetic finché c'è 1 solo ristorante. Quando arriva il 2°, introdurre `tenants.id` come variable di workflow.

## Priorità

- **Alta** (rischio leak immediato): Twilio TOKEN, Supabase JWT, OpenAI key — tutti danno accesso a qualcosa di sensibile o costoso.
- **Media**: Retell key, `x-ai-secret` — accesso limitato al tenant Picnic.
- **Bassa**: Twilio SID, tenant_id — non sono secret ma vanno comunque centralizzati per multi-tenant.
