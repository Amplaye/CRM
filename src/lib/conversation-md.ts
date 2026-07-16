// Pure renderer: take a conversation row + its transcript and produce a
// human-readable Markdown document. Used by:
//   - GET /api/conversations/[id]/markdown (on-demand download)
//   - future cron that persists each conversation_end snapshot to
//     Supabase Storage (target architecture Stage 3)

export type ConversationMessage = {
  role?: string;
  content?: string;
  text?: string;
  ts?: string;
  created_at?: string;
};

export type ConversationForMarkdown = {
  id: string;
  tenant_id?: string;
  channel?: string | null;
  intent?: string | null;
  status?: string | null;
  sentiment?: string | null;
  language?: string | null;
  summary?: string | null;
  transcript?: ConversationMessage[] | null;
  created_at?: string;
  updated_at?: string;
  guest?: { name?: string | null; phone?: string | null } | null;
};

function roleLabel(role: string | undefined): string {
  switch ((role || '').toLowerCase()) {
    case 'user':
    case 'client':
    case 'customer':
      return 'Cliente';
    case 'assistant':
    case 'ai':
    case 'bot':
      return 'Bot';
    case 'staff':
    case 'agent':
      return 'Staff';
    case 'system':
      return 'System';
    default:
      return role ? role.slice(0, 30) : 'Unknown';
  }
}

function isoOrEmpty(s: string | undefined): string {
  if (!s) return '';
  try {
    return new Date(s).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  } catch {
    return s;
  }
}

export function renderConversationMarkdown(conv: ConversationForMarkdown): string {
  const lines: string[] = [];
  lines.push(`# Conversation ${conv.id}`);
  lines.push('');

  const meta: Array<[string, string]> = [
    ['Tenant', conv.tenant_id || ''],
    ['Channel', conv.channel || ''],
    ['Status', conv.status || ''],
    ['Intent', conv.intent || ''],
    ['Sentiment', conv.sentiment || ''],
    ['Language', conv.language || ''],
    ['Started', isoOrEmpty(conv.created_at)],
    ['Updated', isoOrEmpty(conv.updated_at)],
    ['Guest', [conv.guest?.name, conv.guest?.phone].filter(Boolean).join(' · ')],
  ];
  for (const [k, v] of meta) {
    if (v) lines.push(`- **${k}**: ${v}`);
  }
  lines.push('');

  if (conv.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(conv.summary);
    lines.push('');
  }

  lines.push('## Transcript');
  lines.push('');
  const transcript = Array.isArray(conv.transcript) ? conv.transcript : [];
  if (transcript.length === 0) {
    lines.push('_(empty)_');
  } else {
    for (const m of transcript) {
      const role = roleLabel(m.role);
      const ts = isoOrEmpty(m.ts || m.created_at);
      const text = String(m.content || m.text || '').trim();
      if (!text) continue;
      const header = ts ? `**${role}** · ${ts}` : `**${role}**`;
      lines.push(header);
      for (const para of text.split(/\n+/)) {
        lines.push('> ' + para);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
