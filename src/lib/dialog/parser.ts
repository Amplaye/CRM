// Parser LLM call — extracts intent + entities from a single user message.
//
// This is the *first* stage of the per-turn pipeline. The controller will
// merge the output into the session state and decide what happens next.
// See `prompts/parser.es.md` for the system prompt.

import { chatCompletion } from '@/lib/openai-base-url';
import { render, PARSER_TEMPLATE } from './prompts';
import type { ParserOutput } from './types';

export interface ParseArgs {
  message: string;
  todayYmd: string; // e.g. 2026-05-20
  dayName: string; // localized today (esp. for the LLM): "martes"
  calendarBlock: string; // multi-line: "lunes 2026-05-20 | almuerzo … cena …"
}

/**
 * Call the parser LLM and return a strictly-typed result. Never throws —
 * on failure the `_parseError` property is set and the controller falls back
 * to the B2.2 ambiguous-input path.
 */
export async function parseMessage(args: ParseArgs): Promise<ParserOutput> {
  const system = render(PARSER_TEMPLATE, {
    TODAY: args.todayYmd,
    DAY_NAME: args.dayName,
    CALENDAR_BLOCK: args.calendarBlock,
    USER_MESSAGE: args.message,
  });

  try {
    const res = await chatCompletion({
      model: 'gpt-5.1',
      messages: [{ role: 'system', content: system }],
      max_completion_tokens: 3000,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
    });

    if (!res.ok) {
      return parseError(`http_${res.status}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw) as Partial<ParserOutput>;
    return normalize(parsed);
  } catch (err) {
    return parseError(err instanceof Error ? err.message : String(err));
  }
}

function parseError(reason: string): ParserOutput {
  return {
    intent: null,
    personas: null,
    delta_personas: null,
    fecha: null,
    hora: null,
    zona: null,
    nombre: null,
    notas: null,
    confirmacion: null,
    _parseError: reason,
  };
}

/**
 * The LLM occasionally returns extra keys or wrong types — coerce to the
 * declared shape so downstream code can rely on it.
 */
function normalize(p: Partial<ParserOutput>): ParserOutput {
  const intent = pickEnum(p.intent, [
    'book',
    'modify',
    'cancel',
    'waitlist',
    'info',
    'offtopic',
    'confirm_yes',
    'confirm_no',
  ]);
  const zona = pickEnum(p.zona, ['interior', 'exterior']);
  const confirmacion = pickEnum(p.confirmacion, ['yes', 'no']);

  return {
    intent,
    personas: numberOrNull(p.personas),
    delta_personas: numberOrNull(p.delta_personas),
    fecha: stringOrNull(p.fecha),
    hora: stringOrNull(p.hora),
    zona,
    nombre: stringOrNull(p.nombre),
    notas: stringOrNull(p.notas),
    confirmacion,
  };
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v;
  return null;
}
