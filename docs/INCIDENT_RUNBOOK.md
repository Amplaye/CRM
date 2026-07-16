# Incident Runbook — Picnic

When the bot stops responding, or staff report wrong behavior, follow this
in order. Most incidents resolve at step 2 or 3.

## 0. Triage — what's broken?

Ask the reporter:
- **Channel?** WhatsApp / voice (Retell) / dashboard?
- **Single guest or all?** Single guest is usually a stuck `bot_sessions`
  row; all guests is an outage.
- **Started when?** Cross-reference with deploy log (Vercel) and last
  workflow PUT (`git log` of `picnic_backups/`).
- **What did the bot say?** Get a screenshot or the actual message.

## 1. Check the obvious

```bash
# CRM up?
curl -sI https://crm.baliflowagency.com/api/ai/availability | head -1

# Smoke test — covers most "did anything break" cases
N8N_API_KEY=… SUPABASE_MGMT_TOKEN=… AI_WEBHOOK_SECRET=… SMOKE_API_KEY=… \
  node scripts/smoke-test.mjs

# Live system_logs in the last hour
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer $SB_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT severity,title,description,created_at FROM system_logs WHERE created_at > now() - interval '\''1 hour'\'' ORDER BY created_at DESC LIMIT 20;"}'
```

## 2. n8n side

Workflows on `https://n8n.srv1468837.hstgr.cloud` (API key in
[credentials.md](../.claude/projects/-Users-amplaye/memory/credentials.md)).

```bash
# All [Picnic] workflows + active state
curl -s "$N8N_BASE/api/v1/workflows?limit=50" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" | jq '.data[] | select(.name | startswith("[Picnic]")) | {id,name,active}'
```

If a workflow is `active: false`, that's the culprit. Inspect the most
recent executions via the n8n UI.

To roll back to a backup:
```bash
# pick a known-good file from /Users/amplaye/picnic_backups/
node -e "
const fs = require('node:fs');
const wf = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings, staticData: wf.staticData };
fetch(\`https://n8n.srv1468837.hstgr.cloud/api/v1/workflows/\${process.argv[2]}\`, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}).then(r => r.text()).then(console.log);
" /Users/amplaye/picnic_backups/<file>.json <workflow-id>
```

## 3. Single guest stuck

Most common: `bot_sessions.session_data` has a sticky state
(`awaitingForceNew`, `awaitingZoneSwitch`, `awaitingDisambig`). Inspect:

```sql
SELECT session_data, lock_until, updated_at
FROM bot_sessions
WHERE phone LIKE '%<last-9-digits>%';
```

Clear if stale:
```sql
DELETE FROM bot_sessions WHERE phone = '<full-phone>';
```

Then check if they're stuck on a closed reservation by looking at
`reservations` for that guest_id.

## 4. Pause the bot for a specific guest (60s cooldown)

Staff takeover from the dashboard sets `guests.bot_paused_at = now()`.
The chatbot honors a 60-second cooldown (key
`bot_paused_cooldown_sec`).

Manual override:
```sql
UPDATE guests SET bot_paused_at = now()
WHERE id = '<guest-id>';
```

## 5. Vercel / CRM down

Vercel dashboard → CRM project → Deployments tab. The last green deploy
is one click away from a redeploy. If a recent commit broke things:

```bash
cd /Users/amplaye/CRM
git log --oneline -20
git revert <bad-sha>
git push
```

Deploys auto-trigger on push.

## 6. Twilio Sandbox issues

Sandbox-only number requires guests to send `join <keyword>` first. If
they complain "the bot doesn't reply", confirm they joined. The owner
phone `+34641790137` is pre-joined.

## 7. Escalation contacts

- **Picnic owner WhatsApp**: `+34641790137`
- **n8n hosting (Hostinger)**: account in [credentials.md](../.claude/projects/-Users-amplaye/memory/credentials.md)
- **Supabase project**: `azhlnybiqlkbhbboyvud` (BaliFlow CRM)

## 8. Post-incident

After resolving:
1. Add a row to the "Postmortems" section below.
2. Write a memory file in `/Users/amplaye/.claude/projects/-Users-amplaye/memory/`
   if it's a recurring pattern.
3. If the fix needs to land in code, follow the standard PR flow (smoke
   test → commit → push).

## Postmortems

- _(empty — the moment you handle your first one, document it here)_
