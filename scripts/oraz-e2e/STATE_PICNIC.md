# Test Picnic — parametri
- Workflow id: 166QnQsGHqXDpBxa (INATTIVO di default — riattivare per testare, poi rivalutare)
- Tenant id: 626547ff-bc44-4f35-8f42-0e97f1dcf0d5
- Webhook path: picnic-whatsapp
- Per testare con l'harness oraz-e2e: serve un override del path/tenant (vedi harness.mjs WEBHOOK_PATH / TENANT_ID).
- Riattivazione temporanea: POST /api/v1/workflows/166QnQsGHqXDpBxa/activate ; a fine test valutare con l'utente se lasciare attivo.
- Cleanup dati test: phone 34699* sul tenant Picnic.

## Backup pre-merge (2026-06-02)
- live_picnic.PRE_MERGE_20260602_201913.json (308KB, active=false) — Picnic LIVE da n8n API
- live_oraz.REFERENCE.json (582KB, active=true) — sorgente fix del merge
- Drift confermato: Picnic live 308KB << Oraz 582KB (Picnic è il template legacy indietro).
