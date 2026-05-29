import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { renderConversationMarkdown, type ConversationForMarkdown } from '@/lib/conversation-md';
import { assertAiSecret } from '@/lib/ai-auth';
import { verifyTenantMembership } from '@/lib/tenant-membership';

// GET /api/conversations/[id]/markdown
// Accepts either an `x-ai-secret` header for server-side callers (cron
// exporters / Storage backfill) OR an authenticated dashboard session that is
// a member of the conversation's tenant. Returns the conversation as
// text/markdown with content-disposition set so curl downloads cleanly.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const viaSecret = !assertAiSecret(req);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, tenant_id, channel, intent, status, sentiment, language, summary, transcript, created_at, updated_at, guest:guests(name, phone)'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // M3: a session caller must be a member of this conversation's tenant.
  // Secret callers (cron) are trusted. Without either, reject — don't leak
  // the transcript/PII to anyone who knows a conversation id.
  if (!viaSecret) {
    const member = await verifyTenantMembership(data.tenant_id as string);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const guest = Array.isArray(data.guest) ? data.guest[0] : data.guest;
  const conv: ConversationForMarkdown = { ...data, guest };
  const md = renderConversationMarkdown(conv);

  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="conversation-${id}.md"`,
    },
  });
}
