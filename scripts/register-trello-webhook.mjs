// One-time setup: register the inbound Trello webhook so that dragging a bug
// card into "✅ Hecho" on Trello closes the matching system_logs row in the CRM
// (the reverse of trello-sync.ts). Run once after deploy; re-running is safe
// (Trello rejects a duplicate idModel+callbackURL with a clear error).
//
// Usage:
//   TRELLO_API_KEY=... TRELLO_TOKEN=... \
//   TRELLO_WEBHOOK_CALLBACK_URL=https://<prod-host>/api/admin/system-logs/trello-webhook \
//   node scripts/register-trello-webhook.mjs
//
// The webhook watches the whole board, so every list-move on it is delivered;
// the route filters to card-moves into the Hecho list.

const KEY = process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
const CALLBACK = process.env.TRELLO_WEBHOOK_CALLBACK_URL;

// Board "Picnic" (same board trello-sync.ts writes cards to). Webhooks attach to
// a model id; the board id is the broadest useful scope.
const BOARD_ID = process.env.TRELLO_BOARD_ID || "6a0b1ad6edb011313ee6f489"; // board "Picnic"

if (!KEY || !TOKEN || !CALLBACK) {
  console.error("Missing TRELLO_API_KEY / TRELLO_TOKEN / TRELLO_WEBHOOK_CALLBACK_URL");
  process.exit(1);
}

const base = "https://api.trello.com/1";
const auth = `key=${KEY}&token=${TOKEN}`;

async function listWebhooks() {
  const res = await fetch(`${base}/tokens/${TOKEN}/webhooks?${auth}`);
  if (!res.ok) throw new Error(`list webhooks → ${res.status} ${await res.text()}`);
  return res.json();
}

async function createWebhook() {
  const params = new URLSearchParams({
    callbackURL: CALLBACK,
    idModel: BOARD_ID,
    description: "CRM Monitoring ↔ Trello resolve-back (card → Hecho closes system_log)",
  });
  const res = await fetch(`${base}/webhooks?${auth}&${params}`, { method: "POST" });
  const text = await res.text();
  if (!res.ok) throw new Error(`create webhook → ${res.status} ${text}`);
  return JSON.parse(text);
}

const existing = await listWebhooks();
const dupe = existing.find((w) => w.callbackURL === CALLBACK && w.idModel === BOARD_ID);
if (dupe) {
  console.log("✓ Webhook already registered:", dupe.id, "(active:", dupe.active, ")");
  process.exit(0);
}

const wh = await createWebhook();
console.log("✓ Registered Trello webhook:", wh.id);
console.log("  callback:", wh.callbackURL);
console.log("  board:", wh.idModel, "active:", wh.active);
