import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { logSystemEvent } from '@/lib/system-log';

// Called by the n8n cron every few minutes. For each active waitlist entry
// older than 30 minutes that hasn't been reassured yet, sends an honest
// "still waiting" WhatsApp message and stamps reassurance_sent_at so we
// don't notify twice.
//
// No "table might free up soon" guessing — just a polite status ping.
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Twilio credentials not configured' }, { status: 500 });
  }

  try {
    const supabase = createServiceRoleClient();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: entries, error } = await supabase
      .from('waitlist_entries')
      .select('id, tenant_id, guest_id, date, target_time, party_size, notes, guests(phone, name)')
      .eq('status', 'waiting')
      .lte('created_at', thirtyMinAgo)
      .is('reassurance_sent_at', null)
      .limit(50);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!entries || entries.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const failures: string[] = [];

    for (const e of entries as any[]) {
      const phone = e.guests?.phone;
      if (!phone) {
        await supabase
          .from('waitlist_entries')
          .update({ reassurance_sent_at: new Date().toISOString() })
          .eq('id', e.id);
        continue;
      }
      const to = phone.startsWith('whatsapp:')
        ? phone
        : phone.startsWith('+')
        ? 'whatsapp:' + phone
        : 'whatsapp:+' + phone;

      const body =
        `⏳ Sigues en lista de espera para el ${e.date} a las ${(e.target_time || '').slice(0, 5)} (${e.party_size} personas). ` +
        `De momento todas las mesas del turno siguen ocupadas — te escribo apenas se libere una. ` +
        `Recuerda: estar en lista de espera no garantiza un sitio. Gracias por la paciencia.`;

      const form = new URLSearchParams();
      form.set('From', TWILIO_FROM);
      form.set('To', to);
      form.set('Body', body);

      try {
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
            },
            body: form.toString(),
          }
        );
        if (!resp.ok) {
          failures.push(`${e.id}: twilio ${resp.status}`);
          continue;
        }
        await supabase
          .from('waitlist_entries')
          .update({ reassurance_sent_at: new Date().toISOString() })
          .eq('id', e.id);
        sent++;
      } catch (err: any) {
        failures.push(`${e.id}: ${err.message}`);
      }
    }

    if (failures.length > 0) {
      await logSystemEvent({
        category: 'message_failure',
        severity: 'medium',
        title: 'waitlist-reassurance partial failure',
        description: failures.join(' | '),
        metadata: { failures, sent, considered: entries.length },
      });
    }

    return NextResponse.json({ ok: true, sent, considered: entries.length, failures: failures.length });
  } catch (e: any) {
    console.error('waitlist-reassurance error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
