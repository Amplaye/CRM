import { NextResponse } from 'next/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { logSystemEvent, type SystemLogCategory, type SystemLogSeverity } from '@/lib/system-log';

// Lightweight trace endpoint for n8n wrappers (chat + voice + reminders).
// Stores a structured event in system_logs so failures and decisions are
// visible in /admin/debug without tailing n8n logs.
//
// Body shape (all fields optional except step):
//   {
//     wrapper: 'chat' | 'voice' | 'reminder' | 'web',
//     step: string,           // short label — e.g. 'book.api_call', 'modify.noop_guard'
//     tenant_id?: string,
//     success?: boolean,      // false → logged as ai_error/high severity
//     level?: 'info' | 'warning' | 'error',
//     context?: Record<string, any>,  // tool args, API response, phone, etc.
//     error?: string,
//   }
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const body = await request.json().catch(() => ({} as any));
    const { wrapper, step, tenant_id, success, level, context, error } = body || {};

    if (!step || typeof step !== 'string') {
      return NextResponse.json({ ok: false, error: 'step required' }, { status: 400 });
    }

    const resolvedLevel: 'info' | 'warning' | 'error' =
      level || (success === false ? 'error' : 'info');

    const category: SystemLogCategory =
      resolvedLevel === 'error' ? 'ai_error' : 'system';

    // User-flow rejections (e.g. "modify but no reservation", "already cancelled",
    // "date in the past") aren't system failures — they're the bot working
    // correctly. Log them for observability but at low severity so the
    // System Logs Alert workflow doesn't page the agency owner about them.
    // The error string can come either at the top of the body OR nested under
    // context.error (the n8n workflows wrap most failures in context).
    const ctxErr = (context && typeof context === 'object') ? (context as any).error : '';
    // Some n8n wrappers pass the rejection reason as `context.reason` instead of
    // `context.error` (e.g. closing-time / before-opening / outside-hours rejections).
    // Match against both so business-rule rejections don't page the owner.
    const ctxReason = (context && typeof context === 'object') ? (context as any).reason : '';
    const errMsg = String(error || ctxErr || ctxReason || '').toLowerCase();
    // Step-level marker also indicates a deterministic rejection path (e.g.
    // `book.rejected_closing_time`, `modify.rejected_closing_time`).
    const stepLower = String(step || '').toLowerCase();
    const isUserCase = [
      'no active reservation found',
      'no se ha encontrado',
      'no encontrada',
      'already cancelled',
      'ya cancelad',
      'ya cancelada',
      'in the past',
      'fecha pasada',
      'past_date',
      'past_time',
      'no_tables',
      'outside_hours',
      'closed_day',
      'closing_time',
      'before_opening',
    ].some((m) => errMsg.includes(m) || stepLower.includes(m));

    const severity: SystemLogSeverity = isUserCase
      ? 'low'
      : resolvedLevel === 'error' ? 'high' : resolvedLevel === 'warning' ? 'medium' : 'low';

    await logSystemEvent({
      tenant_id: tenant_id || undefined,
      category,
      severity,
      title: `[${wrapper || 'bot'}] ${step}`,
      description: error || undefined,
      metadata: {
        wrapper: wrapper || null,
        step,
        success: success ?? null,
        ...(context && typeof context === 'object' ? context : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('log-event failed:', e?.message);
    return NextResponse.json({ ok: false, error: 'log_failed' }, { status: 500 });
  }
}
