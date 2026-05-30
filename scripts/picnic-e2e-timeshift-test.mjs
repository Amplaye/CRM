#!/usr/bin/env node
// End-to-end test of the deployed time-shift path, mirroring exactly what the
// bot now sends. Creates a throwaway guest+reservation at 21:30, calls
// /api/ai/modify with retraso_minutos:30 (the bot's payload), asserts the time
// moved to 22:00, then deletes the test rows. Non-interactive, self-cleaning.
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const SB_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const SB_KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const SECRET = get('AI_WEBHOOK_SECRET');
const CRM = 'https://crm.baliflowagency.com';
const TENANT = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';
const PHONE = '+390000000099'; // throwaway test phone
const DATE = process.env.TEST_DATE; // YYYY-MM-DD passed from caller (no Date.now in script)

const sb = (path, opts = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });

let guestId, resId;
const cleanup = async () => {
  if (resId) await sb(`reservations?id=eq.${resId}`, { method: 'DELETE' });
  if (guestId) await sb(`guests?id=eq.${guestId}`, { method: 'DELETE' });
};

try {
  // 1) test guest
  let r = await sb('guests', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT, phone: PHONE, name: 'E2E TimeShift Test' }) });
  if (!r.ok) throw new Error('create guest: ' + r.status + ' ' + (await r.text()));
  guestId = (await r.json())[0].id;

  // 2) test reservation at 21:30
  r = await sb('reservations', { method: 'POST', body: JSON.stringify({
    tenant_id: TENANT, guest_id: guestId, date: DATE, time: '21:30:00',
    party_size: 2, status: 'confirmed',
  }) });
  if (!r.ok) throw new Error('create reservation: ' + r.status + ' ' + (await r.text()));
  resId = (await r.json())[0].id;
  console.log('created reservation', resId, 'at 21:30 on', DATE);

  // 3) call modify EXACTLY as the bot does
  const mr = await fetch(`${CRM}/api/ai/modify`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-ai-secret': SECRET },
    body: JSON.stringify({ tenant_id: TENANT, guest_phone: PHONE, retraso_minutos: 30 }),
  });
  const mtxt = await mr.text();
  console.log('modify HTTP', mr.status, '::', mtxt.slice(0, 200));
  if (!mr.ok) throw new Error('modify failed');

  // 4) re-read the reservation
  const vr = await sb(`reservations?id=eq.${resId}&select=time`);
  const newTime = (await vr.json())[0].time;
  console.log('reservation time after shift:', newTime);
  const pass = newTime.startsWith('22:00');
  console.log(pass ? 'PASS: 21:30 + 30min -> 22:00' : 'FAIL: expected 22:00, got ' + newTime);
  await cleanup();
  console.log('cleanup done');
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error('ERROR:', e.message);
  await cleanup();
  console.log('cleanup done (after error)');
  process.exit(1);
}
