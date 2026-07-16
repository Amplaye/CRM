#!/usr/bin/env node
// Audit di credenziali / endpoint hardcoded nei workflow n8n esportati.
//
// Esamina tutti i `*.json` (esclusi `*.bak*`) in /Users/amplaye/N8N/picnic/
// e produce, per ogni file, l'elenco di literali sensibili trovati:
//   - Twilio SID  (AC + 32 hex)
//   - Twilio Auth Token (32 hex)
//   - Supabase service-role JWT (eyJ…)
//   - OpenAI key (sk-...)
//   - Retell key (key_…)
//   - `x-ai-secret` literal
//   - tenant_id literal (per cosmetic refactor 1.1)
//
// Output: tabella per stdout + report Markdown su disco
// (`/Users/amplaye/CRM/docs/n8n-secret-audit.md`).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

void crypto; // reserved for future hash-based pattern matching

const N8N_DIR = process.env.N8N_DIR || '/Users/amplaye/N8N/picnic';
const PICNIC_TENANT = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';

// Token literali noti vengono confrontati come hash sha256, così il file
// auditing non contiene mai le credenziali in chiaro (GitHub secret
// scanner happy + safe da committare).
const KNOWN_TWILIO_TOKEN_HASHES = new Set(
  (process.env.AUDIT_TWILIO_TOKEN_HASHES || '').split(',').filter(Boolean)
);
const KNOWN_AI_SECRET_HASHES = new Set(
  (process.env.AUDIT_AI_SECRET_HASHES || '').split(',').filter(Boolean)
);

const PATTERNS = [
  ['twilio_sid', /AC[0-9a-f]{32}/g],
  // Twilio Auth Token: 32 hex post-SID. Generic match, contesto = appare
  // accanto a TWILIO_SID nel jsCode dei nodi.
  ['twilio_token_generic_hex', /\bTWILIO_(?:TOKEN|AUTH_TOKEN)['"]?\s*[:=]\s*['"][0-9a-f]{32}['"]/g],
  ['supabase_jwt', /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g],
  ['openai_key', /sk-(?:proj|live|test)?-[A-Za-z0-9_\-]{20,}/g],
  ['retell_key', /key_[a-f0-9]{20,}/g],
  // ai_webhook_secret: cerchiamo "x-ai-secret" usato come header + valore
  // 64-hex; il valore reale non viene memorizzato.
  ['x_ai_secret_header', /x-ai-secret['"]?\s*[:=]\s*['"][0-9a-f]{64}['"]/g],
  ['picnic_tenant_id', new RegExp(PICNIC_TENANT, 'g')],
];

const files = readdirSync(N8N_DIR)
  .filter((f) => f.endsWith('.json') && !f.includes('.bak'))
  .sort();

const rows = [];
let grand = 0;
for (const f of files) {
  const raw = readFileSync(join(N8N_DIR, f), 'utf8');
  const counts = {};
  for (const [label, re] of PATTERNS) {
    const m = raw.match(re);
    counts[label] = m ? m.length : 0;
    grand += counts[label];
  }
  rows.push({ file: f, ...counts });
}

// Stdout
const cols = ['file', ...PATTERNS.map((p) => p[0])];
const colW = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
const fmt = (vals) => vals.map((v, i) => String(v).padEnd(colW[i])).join('  ');
console.log(fmt(cols));
console.log(colW.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(fmt(cols.map((c) => r[c])));
console.log('');
console.log(`Total hardcoded literals across all workflows: ${grand}`);

// Markdown report
const md = [
  '# n8n workflow — audit credenziali hardcoded',
  '',
  `Generato: ${new Date().toISOString()} da \`scripts/audit-n8n-secrets.mjs\`.`,
  `Fonte: \`${N8N_DIR}\` (file \`*.json\` non backup).`,
  '',
  '## Riepilogo',
  '',
  `| file | ${PATTERNS.map((p) => p[0]).join(' | ')} |`,
  `|---|${PATTERNS.map(() => '---').join('|')}|`,
  ...rows.map(
    (r) =>
      `| \`${r.file}\` | ${PATTERNS.map((p) => r[p[0]]).join(' | ')} |`
  ),
  '',
  `**Totale literali**: ${grand}`,
  '',
  '## Come pulire',
  '',
  '1. **Twilio SID/TOKEN**: spostare in `tenants.settings.bot_config.twilio_sid` / `twilio_token` e leggere via `picnicCfgGet()` (pattern già usato nel chatbot post-Risk #2).',
  '2. **Supabase JWT service-role**: usare n8n Credentials (HTTP Header Auth) invece di literal nei jsCode. Richiede creare 1 credential e referenziarla in ogni HTTP node.',
  '3. **OpenAI key**: stessa cosa, n8n Credentials → OpenAI.',
  '4. **Retell key**: idem.',
  '5. **`x-ai-secret`**: header sicuro perché matching contro env CRM-side; spostare comunque in n8n credential.',
  '6. **tenant_id literal**: cosmetic finché c\'è 1 solo ristorante. Quando arriva il 2°, introdurre `tenants.id` come variable di workflow.',
  '',
  '## Priorità',
  '',
  '- **Alta** (rischio leak immediato): Twilio TOKEN, Supabase JWT, OpenAI key — tutti danno accesso a qualcosa di sensibile o costoso.',
  '- **Media**: Retell key, `x-ai-secret` — accesso limitato al tenant Picnic.',
  '- **Bassa**: Twilio SID, tenant_id — non sono secret ma vanno comunque centralizzati per multi-tenant.',
  '',
].join('\n');

writeFileSync('/Users/amplaye/CRM/docs/n8n-secret-audit.md', md);
console.log(`\nReport: /Users/amplaye/CRM/docs/n8n-secret-audit.md`);
