import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { renderConversationMarkdown, type ConversationForMarkdown } from '@/lib/conversation-md';
import { assertAiSecret } from '@/lib/ai-auth';

// GET /api/conversations/[id]/markdown
// Accepts either an authenticated dashboard session (via the existing
// supabase ssr cookie middleware) OR an `x-ai-secret` header for
// server-side callers (cron exporters / Storage backfill).
// Returns the conversation as text/markdown with content-disposition set
// so curl downloads "conversation-<id>.md" cleanly.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const ai = assertAiSecret(req);
  // assertAiSecret returns NextResponse for failure OR null for ok. When
  // AI_WEBHOOK_SECRET isn't set in env it returns null (open). That's the
  // expected fallback for dashboard same-origin requests.

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

  // When the secret IS set but didn't match, reject (don't reveal
  // conversation content).
  if (ai && ai.status === 401) return ai;

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
