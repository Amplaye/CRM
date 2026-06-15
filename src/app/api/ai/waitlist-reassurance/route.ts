import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { logSystemEvent, resolveSystemEvents } from '@/lib/system-log';
import { tenantWhatsAppFrom } from '@/lib/whatsapp/from';
import { sendWhatsAppMeta } from '@/lib/whatsapp/meta';

// Called by the single shared `[ALL] Waitlist Reassurance — Multi-Tenant` n8n
// cron every 10 min (the per-tenant clones were retired 2026-06-16 — this
// endpoint already sweeps EVERY tenant in one call, so cloning it per tenant
// just re-did the whole-fleet sweep N times). For each active waitlist entry
// older than 30 minutes that hasn't been reassured yet, it sends an honest
// "still waiting" WhatsApp message and stamps reassurance_sent_at so we don't
// notify twice.
//
// No "table might free up soon" guessing — just a polite status ping.

type Lang = 'es' | 'it' | 'en' | 'de';

const REASSURE: Record<Lang, string> = {
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

// One fleet-wide sweep can face far more than one tenant's worth of entries, so
// we page through them (oldest-first) instead of capping at a flat 50. Each
// page sends in bounded-parallel so the run never serialises into a multi-minute
// job; maxDuration is a safety net so the socket is never cut mid-flight.
const PAGE = 100;
const MAX_PAGES = 20; // hard ceiling: ≤2000 entries/run; the rest catch the next tick
const CONCURRENCY = 8;
export const maxDuration = 60;

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Meta credentials not configured' }, { status: 500 });
  }

  try {
    const supabase = createServiceRoleClient();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const stamp = (id: string) =>
      supabase
        .from('waitlist_entries')
        .update({ reassurance_sent_at: new Date().toISOString() })
        .eq('id', id);

    let sent = 0;
    let considered = 0;
    let capped = false;
    const failures: string[] = [];
    // Entries whose send FAILED don't get stamped, so they'd reappear at the top
    // of the next page (oldest-first) and spin the loop forever. Exclude them
    // explicitly — they retry on the next 10-min tick instead.
    const failedIds: string[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      let q = supabase
        .from('waitlist_entries')
        .select('id, tenant_id, guest_id, date, target_time, party_size, notes, guests(phone, name)')
        .eq('status', 'waiting')
        .lte('created_at', thirtyMinAgo)
        .is('reassurance_sent_at', null)
        .order('created_at', { ascending: true })
        .limit(PAGE);
      if (failedIds.length > 0) q = q.not('id', 'in', `(${failedIds.join(',')})`);

      const { data: entries, error } = await q;
      if (error) {
        if (page === 0) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
        failures.push(`page ${page}: ${error.message}`);
        break;
      }
      if (!entries || entries.length === 0) break;

      const list = entries as any[];

      // Each tenant sends from its OWN WhatsApp number (config, not code). One
      // settings fetch per page covers its tenants; unset → platform default.
      const tenantIds = [...new Set(list.map((e) => e.tenant_id).filter(Boolean))];
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

      // Resolve each guest's preferred language from their most recent
      // conversation in the last 30 days — ONE query per page. Rows come back
      // newest-first, so the first hit per guest wins. Falls back to 'es'.
      const langByGuest = new Map<string, Lang>();
      const guestIds = [...new Set(list.map((e) => e.guest_id).filter(Boolean))];
      if (guestIds.length > 0) {
        const sinceISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: convs } = await supabase
          .from('conversations')
          .select('tenant_id, guest_id, language')
          .in('tenant_id', tenantIds)
          .in('guest_id', guestIds)
          .in('language', ['es', 'it', 'en', 'de'])
          .gte('created_at', sinceISO)
          .order('created_at', { ascending: false });
        for (const c of (convs || []) as any[]) {
          const key = `${c.tenant_id}:${c.guest_id}`;
          if (!langByGuest.has(key)) langByGuest.set(key, c.language as Lang);
        }
      }
      const resolveLang = (tenantId: string, guestId: string): Lang =>
        langByGuest.get(`${tenantId}:${guestId}`) || 'es';

      const sendOne = async (e: any) => {
        const phone = e.guests?.phone;
        if (!phone) {
          await stamp(e.id);
          return;
        }
        const body = REASSURE[resolveLang(e.tenant_id, e.guest_id)];
        const result = await sendWhatsAppMeta(phone, body, fromByTenant.get(e.tenant_id));
        if (!result.ok) {
          failures.push(`${e.id}: meta ${result.status} ${result.errorMessage || ''}`.trim());
          failedIds.push(e.id);
          return;
        }
        await stamp(e.id);
        sent++;
      };

      for (let i = 0; i < list.length; i += CONCURRENCY) {
        await Promise.all(list.slice(i, i + CONCURRENCY).map(sendOne));
      }

      considered += list.length;
      if (list.length < PAGE) break;
      if (page === MAX_PAGES - 1) capped = true;
    }

    if (failures.length > 0) {
      await logSystemEvent({
        category: 'message_failure',
        severity: 'medium',
        title: 'waitlist-reassurance partial failure',
        description: failures.join(' | '),
        metadata: { failures, sent, considered, capped },
        error_key: 'waitlist-reassurance:batch',
      });
    } else if (considered > 0) {
      // Tutto inviato senza failures → chiudi eventuali open precedenti
      void resolveSystemEvents({ error_key: 'waitlist-reassurance:batch' });
    }

    return NextResponse.json({ ok: true, sent, considered, failures: failures.length, capped });
  } catch (e: any) {
    console.error('waitlist-reassurance error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
