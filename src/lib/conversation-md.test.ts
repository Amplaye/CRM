import { describe, it, expect } from 'vitest';
import { renderConversationMarkdown } from './conversation-md';

describe('renderConversationMarkdown', () => {
  it('emits header + meta block', () => {
    const md = renderConversationMarkdown({
      id: 'abc-123',
      tenant_id: 'tenant-1',
      channel: 'whatsapp',
      status: 'active',
      summary: 'cliente prenota tavolo per 4 sabato sera',
      transcript: [],
    });
    expect(md).toContain('# Conversation abc-123');
    expect(md).toContain('**Channel**: whatsapp');
    expect(md).toContain('**Status**: active');
    expect(md).toContain('## Summary');
    expect(md).toContain('cliente prenota tavolo');
  });

  it('renders transcript turns with role labels + blockquoted text', () => {
    const md = renderConversationMarkdown({
      id: 'conv-1',
      transcript: [
        { role: 'user', content: 'Hola, quiero una mesa', ts: '2026-05-12T19:00:00Z' },
        { role: 'assistant', content: 'Claro!\nPara cuántos?' },
        { role: 'staff', content: 'Gracias' },
      ],
    });
    expect(md).toContain('**Cliente** · 2026-05-12 19:00:00Z');
    expect(md).toContain('> Hola, quiero una mesa');
    expect(md).toContain('**Bot**');
    expect(md).toContain('> Claro!');
    expect(md).toContain('> Para cuántos?');
    expect(md).toContain('**Staff**');
  });

  it('handles empty transcripts gracefully', () => {
    const md = renderConversationMarkdown({ id: 'e', transcript: [] });
    expect(md).toContain('## Transcript');
    expect(md).toContain('_(empty)_');
  });

  it('skips messages with no content', () => {
    const md = renderConversationMarkdown({
      id: 'x',
      transcript: [
        { role: 'user', content: '   ' },
        { role: 'assistant', content: 'real reply' },
      ],
    });
    expect(md).toContain('real reply');
    // empty content message should not produce a header
    const userCount = (md.match(/\*\*Cliente\*\*/g) || []).length;
    expect(userCount).toBe(0);
  });

  it('falls back to text field when content missing', () => {
    const md = renderConversationMarkdown({
      id: 'y',
      transcript: [{ role: 'user', text: 'via text field' }],
    });
    expect(md).toContain('via text field');
  });

  it('renders guest name + phone when present', () => {
    const md = renderConversationMarkdown({
      id: 'g',
      transcript: [],
      guest: { name: 'Ana', phone: '+34611111111' },
    });
    expect(md).toContain('**Guest**: Ana · +34611111111');
  });
});
