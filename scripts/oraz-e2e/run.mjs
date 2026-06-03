// Driver: N rounds per CRM function against the live Oraz bot, with a
// per-function pass-rate matrix. Goal = 100% on every function.
//
//   node scripts/oraz-e2e/run.mjs                 # all, 5 rounds
//   node scripts/oraz-e2e/run.mjs --rounds 3
//   node scripts/oraz-e2e/run.mjs --only booking,menu,cancel
//   node scripts/oraz-e2e/run.mjs --cleanup       # purge test data only
//   node scripts/oraz-e2e/run.mjs --rounds 5 --json out.json

import { runScenario, ENV, SK, SUPA_URL, TENANT_ID, TEST_PREFIX, sleep } from './harness.mjs';
import { SCENARIOS } from './scenarios.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROUNDS = parseInt(getArg('--rounds', '5'), 10);
const ONLY = (getArg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const JSON_OUT = getArg('--json', '');
const CONCURRENCY = parseInt(getArg('--concurrency', '3'), 10); // rounds run in small parallel batches

const palette = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// ---------- test-data cleanup ----------
async function supa(method, pathq, body) {
  const res = await fetch(`${SUPA_URL}/${pathq}`, {
    method,
    headers: {
      apikey: SK,
      Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function cleanup() {
  const like = `phone=like.*${TEST_PREFIX}*`;
  console.log(palette.dim(`\nCleaning test data for phones like *${TEST_PREFIX}* …`));
  // 1) find test guests
  const guests = await supa('GET', `guests?tenant_id=eq.${TENANT_ID}&${like}&select=id,phone`);
  const ids = (guests.json || []).map((g) => g.id);
  let removed = { reservations: 0, conversations: 0, bot_messages: 0, bot_sessions: 0, guests: 0 };
  if (ids.length) {
    const inList = `(${ids.join(',')})`;
    const r1 = await supa('DELETE', `reservations?guest_id=in.${inList}`);
    removed.reservations = (r1.json || []).length;
    const c1 = await supa('DELETE', `conversations?guest_id=in.${inList}`);
    removed.conversations = (c1.json || []).length;
    const g1 = await supa('DELETE', `guests?id=in.${inList}`);
    removed.guests = (g1.json || []).length;
  }
  // bot_messages / bot_sessions keyed by phone (various shapes)
  for (const ph of ['', '+']) {
    const bm = await supa('DELETE', `bot_messages?phone=like.*${TEST_PREFIX}*`);
    removed.bot_messages += (bm.json || []).length;
    const bs = await supa('DELETE', `bot_sessions?phone=like.*${TEST_PREFIX}*`);
    removed.bot_sessions += (bs.json || []).length;
    break; // single pass; LIKE already covers both shapes
  }
  console.log(palette.dim(`Removed: ${JSON.stringify(removed)}`));
  return removed;
}

// ---------- main ----------
async function main() {
  if (args.includes('--cleanup')) { await cleanup(); return; }

  let scns = SCENARIOS;
  if (ONLY.length) scns = scns.filter((s) => ONLY.includes(s.id));
  if (!scns.length) { console.error('No scenarios match --only', ONLY); process.exit(1); }

  console.log(palette.bold(`\n🤖 Oraz bot E2E — ${scns.length} functions × ${ROUNDS} rounds (live n8n, gpt-5.1)\n`));
  const t0 = Date.now();
  const results = {}; // id -> { name, rounds: [{ok, checks}], pass, rate }

  for (const scn of scns) {
    process.stdout.write(`${palette.bold(scn.name.padEnd(38))} `);
    const rounds = [];
    // run rounds in small parallel batches to keep wall-time sane
    for (let i = 0; i < ROUNDS; i += CONCURRENCY) {
      const batch = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, ROUNDS); j++) batch.push(runScenario(scn));
      const out = await Promise.all(batch);
      rounds.push(...out);
      for (const rr of out) process.stdout.write(rr.ok ? palette.green('●') : palette.red('●'));
    }
    const pass = rounds.filter((r) => r.ok).length;
    const rate = Math.round((pass / ROUNDS) * 100);
    results[scn.id] = { name: scn.name, rounds, pass, rate };
    const tag = rate === 100 ? palette.green(` ${pass}/${ROUNDS} 100%`) : palette.red(` ${pass}/${ROUNDS} ${rate}%`);
    console.log(tag);
    // print failing checks for this function
    const fails = rounds.filter((r) => !r.ok);
    const shownLabels = new Set();
    for (const f of fails) {
      for (const c of f.checks.filter((c) => !c.ok)) {
        const key = c.label;
        if (shownLabels.has(key)) continue;
        shownLabels.add(key);
        console.log(palette.red(`    ✗ ${c.label}`) + palette.dim(` — ${String(c.detail).replace(/\s+/g, ' ').slice(0, 140)}`));
      }
    }
  }

  // ---------- summary matrix ----------
  const allGreen = Object.values(results).every((r) => r.rate === 100);
  console.log('\n' + palette.bold('═══ SUMMARY ═══'));
  for (const [id, r] of Object.entries(results)) {
    const bar = r.rounds.map((x) => (x.ok ? '✓' : '✗')).join('');
    const line = `${r.name.padEnd(38)} ${bar.padEnd(ROUNDS + 1)} ${String(r.rate).padStart(3)}%`;
    console.log(r.rate === 100 ? palette.green(line) : palette.red(line));
  }
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n${allGreen ? palette.green('✅ ALL FUNCTIONS 100%') : palette.yellow('⚠️  NOT ALL 100% — see ✗ above')}  ${palette.dim(`(${mins} min)`)}`);

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
    console.log(palette.dim(`wrote ${JSON_OUT}`));
  }
  process.exitCode = allGreen ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(2); });
