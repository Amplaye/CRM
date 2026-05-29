import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { logSystemEvent, resolveSystemEvents } from '@/lib/system-log';
import { tenantWhatsAppFrom } from '@/lib/whatsapp/from';
import { sendWhatsAppMeta } from '@/lib/whatsapp/meta';

// Called by the n8n cron every few minutes. For each active waitlist entry
// older than 30 minutes that hasn't been reassured yet, sends an honest
// "still waiting" WhatsApp message and stamps reassurance_sent_at so we
// don't notify twice.
//
// No "table might free up soon" guessing — just a polite status ping.
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Meta credentials not configured' }, { status: 500 });
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

    // Resolve a guest's preferred language from the most recent conversation
    // in the last 30 days. Falls back to 'es' if no conversation found.
    const resolveLang = async (tenantId: string, guestId: string): Promise<'es' | 'it' | 'en' | 'de'> => {
      const sinceISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('conversations')
        .select('language')
        .eq('tenant_id', tenantId)
        .eq('guest_id', guestId)
        .in('language', ['es', 'it', 'en', 'de'])
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const lang = (data?.language as 'es' | 'it' | 'en' | 'de') || 'es';
      return lang;
    };

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!entries || entries.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const failures: string[] = [];

    // Each tenant sends from its OWN WhatsApp number (config, not code). One
    // settings fetch for all tenants in this sweep; unset → platform default.
    const tenantIds = [...new Set((entries as any[]).map((e) => e.tenant_id).filter(Boolean))];
    const fromByTenant = new Map<string, string | undefined>();
    if (tenantIds.length > 0) {
      const { data: tenantRows } = await supabase
        .from('tenants')
        .select('id, settings')
        .in('id', tenantIds);
      for (const t of (tenantRows || []) as any[]) {
        fromByTenant.set(t.id, tenantWhatsAppFrom(t.settings));
      }
    }

    for (const e of entries as any[]) {
      const phone = e.guests?.phone;
      if (!phone) {
        await supabase
          .from('waitlist_entries')
          .update({ reassurance_sent_at: new Date().toISOString() })
          .eq('id', e.id);
        continue;
      }
      const lang = await resolveLang(e.tenant_id, e.guest_id);
      const M = {
        es:
          `⏳ De momento todas las mesas del turno siguen ocupadas — te escribo apenas se libere una. ` +
          `Recuerda: estar en lista de espera no garantiza un sitio. Gracias por la paciencia.`,
        it:
          `⏳ Al momento tutti i tavoli del turno sono ancora occupati — ti scriverò appena se ne libera uno. ` +
          `Ricorda: essere in lista d'attesa non garantisce un posto. Grazie per la pazienza.`,
        en:
          `⏳ All tables for this shift are still taken — I'll message you as soon as one frees up. ` +
          `Remember: being on the waitlist doesn't guarantee a table. Thanks for your patience.`,
        de:
          `⏳ Im Moment sind alle Tische dieser Schicht noch belegt — ich schreibe dir, sobald einer frei wird. ` +
          `Beachte: Auf der Warteliste zu stehen garantiert keinen Tisch. Danke für deine Geduld.`,
      };
      const body = M[lang];

      const result = await sendWhatsAppMeta(phone, body, fromByTenant.get(e.tenant_id));
      if (!result.ok) {
        failures.push(`${e.id}: meta ${result.status} ${result.errorMessage || ''}`.trim());
        continue;
      }
      await supabase
        .from('waitlist_entries')
        .update({ reassurance_sent_at: new Date().toISOString() })
        .eq('id', e.id);
      sent++;
    }

    if (failures.length > 0) {
      await logSystemEvent({
        category: 'message_failure',
        severity: 'medium',
        title: 'waitlist-reassurance partial failure',
        description: failures.join(' | '),
        metadata: { failures, sent, considered: entries.length },
        error_key: 'waitlist-reassurance:batch',
      });
    } else if (entries.length > 0) {
      // Tutto inviato senza failures → chiudi eventuali open precedenti
      void resolveSystemEvents({ error_key: 'waitlist-reassurance:batch' });
    }

    return NextResponse.json({ ok: true, sent, considered: entries.length, failures: failures.length });
  } catch (e: any) {
    console.error('waitlist-reassurance error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
