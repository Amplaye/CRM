import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { logSystemEvent } from '@/lib/system-log';

// Body:
//   { conversation_id: string, language?: 'es'|'it'|'en', force?: boolean }
//
// Reads transcript, asks GPT-5.1 for a short, factual summary in the client's
// language (1-2 sentences focused on the booking outcome), then writes it to
// conversations.summary + conversations.language.
//
// Called by:
//   - n8n chatbot after CONFIRMO / CANCELAR
//   - n8n voice Post-Call Logic after end-of-call
//   - admin UI "Regenerate summary" button (future)
//
// Since the OpenAI call takes ~3s and the (current) callers don't use the
// returned summary text, the LLM call + DB write are scheduled via
// next/server `after()` and the route returns immediately with 202. Admin
// UI use case can switch to a synchronous variant when wired up.
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => ({} as any));
    const { conversation_id, phone, tenant_id, language: requestedLang, force } = body || {};
    if (!conversation_id && !(phone && tenant_id)) {
      return NextResponse.json({ ok: false, error: 'conversation_id OR (phone + tenant_id) required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    let conv: { id: string; transcript: any; summary: string | null; language: string | null; channel: string; intent: string | null } | null = null;

    if (conversation_id) {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, transcript, summary, language, channel, intent')
        .eq('id', conversation_id)
        .maybeSingle();
      if (error) throw error;
      conv = data as any;
    } else {
      // Phone-based fallback: find guest by fuzzy phone match, then most recent
      // conversation in last 24h for that guest.
      const phoneDigits = String(phone).replace(/\D/g, '');
      const target = phoneDigits.slice(-9);
      const { data: guests } = await supabase
        .from('guests')
        .select('id, phone')
        .eq('tenant_id', tenant_id);
      const matchIds = (guests || [])
        .filter((g: any) => {
          const gd = (g.phone || '').replace(/\D/g, '');
          if (!gd || gd.length < 7) return false;
          return gd.slice(-9) === target;
        })
        .map((g: any) => g.id);
      if (matchIds.length === 0) {
        return NextResponse.json({ ok: false, error: 'no guest matches phone' }, { status: 404 });
      }
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, transcript, summary, language, channel, intent')
        .eq('tenant_id', tenant_id)
        .in('guest_id', matchIds)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      conv = convs && convs.length ? (convs[0] as any) : null;
    }

    if (!conv) {
      return NextResponse.json({ ok: false, error: 'conversation not found' }, { status: 404 });
    }

    const transcript = Array.isArray(conv.transcript) ? conv.transcript : [];
    if (transcript.length === 0) {
      return NextResponse.json({ ok: false, error: 'empty transcript' }, { status: 400 });
    }

    // Schedule the heavy work after the response is sent. The caller gets
    // 202 in ~50ms instead of waiting ~3s for OpenAI.
    const convSnapshot = conv;
    after(async () => {
      await runSummaryJob(convSnapshot, transcript, requestedLang, force, OPENAI_KEY);
    });

    return NextResponse.json(
      { ok: true, conversation_id: conv.id, queued: true },
      { status: 202 }
    );
  } catch (e: any) {
    console.error('conversation-summary error:', e?.message);
    return NextResponse.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}

async function runSummaryJob(
  conv: { id: string; transcript: any; summary: string | null; language: string | null; channel: string; intent: string | null },
  transcript: any[],
  requestedLang: string | undefined,
  force: boolean | undefined,
  OPENAI_KEY: string
) {
  try {
    const supabase = createServiceRoleClient();

    // Resolve language: explicit param > stored conv.language (unless force) >
    // auto-detect from USER messages only. Default to 'es'.
    let lang = (requestedLang || (force ? '' : conv.language) || '').toLowerCase();
    if (!['es', 'it', 'en', 'de'].includes(lang)) {
      const userText = transcript
        .filter((m: any) => m.role === 'user')
        .map((m: any) => String(m.content || ''))
        .join(' ')
        .toLowerCase();
      const itHits = (userText.match(/\b(ciao|grazie|prenotazione|tavolo|persone|domani|stasera|oggi|sono|vorrei|cambiare|annullare|allergi[ae])\b/g) || []).length;
      const enHits = (userText.match(/\b(hello|hi|thanks|thank you|please|booking|tonight|tomorrow|guests?|table|cancel|change|allergy)\b/g) || []).length;
      const esHits = (userText.match(/\b(hola|gracias|reserva|mesa|personas|mañana|hoy|cambiar|cancelar|noche|tarde|alergia)\b/g) || []).length;
      const deHits = (userText.match(/\b(hallo|danke|bitte|reservierung|tisch|personen|morgen|heute|abend|mittag|ändern|stornieren|absagen|allergie|möchte|wir sind|guten tag|guten abend)\b/g) || []).length;
      const max = Math.max(itHits, enHits, esHits, deHits);
      if (max === 0) lang = 'es';
      else if (deHits === max) lang = 'de';
      else if (itHits === max) lang = 'it';
      else if (enHits === max) lang = 'en';
      else lang = 'es';
    }

    const langInstr =
      lang === 'it'
        ? 'Rispondi SOLO in italiano.'
        : lang === 'en'
        ? 'Reply ONLY in English.'
        : lang === 'de'
        ? 'Antworte AUSSCHLIESSLICH auf Deutsch.'
        : 'Responde SOLO en español.';

    // Build a compact transcript representation for the model.
    const flat = transcript
      .filter((m: any) => m && m.role !== 'system')
      .slice(-30)
      .map((m: any) => {
        const who = m.role === 'user' ? 'Cliente' : m.role === 'staff' ? 'Staff' : 'Bot';
        return `${who}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 400)}`;
      })
      .join('\n');

    const sysPrompt =
      `Sei un assistente che riassume conversazioni di prenotazione di un ristorante. ` +
      `Scrivi 1-2 frasi (max 35 parole) che catturino: chi è il cliente, cosa ha richiesto (data/ora/persone/zona se presenti), e l'esito (prenotato, cancellato, in lista d'attesa, escalato, in attesa di conferma). ` +
      `Niente saluti, niente elenchi, niente meta-commenti tipo "il cliente ha detto". Scrivi come una nota interna sintetica per il responsabile del ristorante. ` +
      langInstr;

    const userPrompt = `Trascrizione:\n${flat}\n\nRiassunto:`;

    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.1',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_completion_tokens: 120,
      }),
    });
    if (!aiResp.ok) {
      const errText = await aiResp.text();
      await logSystemEvent({
        category: 'ai_error',
        severity: 'medium',
        title: 'conversation-summary OpenAI error',
        description: errText.slice(0, 500),
        metadata: { conversation_id: conv.id, lang },
      });
      return;
    }
    const aiData = await aiResp.json();
    const summary = String(aiData?.choices?.[0]?.message?.content || '').trim();
    if (!summary) return;

    // Skip overwrite if existing summary is identical (idempotent re-trigger).
    if (!force && conv.summary === summary && conv.language === lang) return;

    const { error: updErr } = await supabase
      .from('conversations')
      .update({ summary, language: lang, updated_at: new Date().toISOString() })
      .eq('id', conv.id);
    if (updErr) {
      console.error('conversation-summary update error:', updErr.message);
    }
  } catch (e: any) {
    console.error('conversation-summary background error:', e?.message);
  }
}
