// Prompt-file loader for the dialog engine.
//
// The system prompts live in `/prompts/*.md` so they can be diffed in code
// review without spelunking through a 750 KB n8n JSON. At runtime we render
// the Mustache-style `{{PLACEHOLDER}}` variables with the per-turn context.
//
// Why a tiny custom renderer instead of mustache.js:
//  - We control the placeholder set (15 names) → no risk of injection.
//  - One dependency-free function < adding a parser for 15 strings.
//  - Conditional sections (`{{#if INTENT_IS_INFO}}`) are minimal — only the
//    formatter-instruction template uses one.

import fs from 'node:fs';
import path from 'node:path';

const PROMPTS_DIR = path.join(process.cwd(), 'prompts');

let _cache: Map<string, string> = new Map();

function loadFile(name: string): string {
  const cached = _cache.get(name);
  if (cached) return cached;
  const full = path.join(PROMPTS_DIR, name);
  const body = fs.readFileSync(full, 'utf8');
  // Strip the leading HTML comment header (between <!-- and -->)
  const stripped = body.replace(/^<!--[\s\S]*?-->\s*\n/, '');
  _cache.set(name, stripped);
  return stripped;
}

/** Cache reset hook for tests */
export function _resetPromptCache(): void {
  _cache = new Map();
}

/** Variables understood by every prompt — see `prompts/README.md`. */
export interface PromptVars {
  TODAY?: string;
  DAY_NAME?: string;
  TIME?: string;
  TOMORROW?: string;
  DAY_AFTER_TOMORROW?: string;
  CALENDAR_BLOCK?: string;
  SCHEDULE_INFO?: string;
  SLOTS_INFO?: string;
  EXISTING_RESERVATIONS?: string;
  KB_CONTENT?: string;
  SENDER_PHONE?: string;
  LANG?: string;
  NEXT_INSTRUCTION?: string;
  CUSTOMER_FIELDS_JSON?: string;
  USER_MESSAGE?: string;
  /** Used only by formatter-instruction conditional section */
  INTENT_IS_INFO?: boolean;
}

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;
const IF_BLOCK_RE = /\{\{#if ([A-Z_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

/**
 * Render a `prompts/*.md` file with the provided variables. Unknown
 * placeholders are left intact (visible in the output) so the LLM can flag
 * the omission rather than the bot lying about missing data.
 */
export function render(promptName: string, vars: PromptVars): string {
  let body = loadFile(promptName);

  // Conditional blocks first (so placeholder substitution doesn't trip over
  // them).
  body = body.replace(IF_BLOCK_RE, (_match, key: string, content: string) => {
    const v = (vars as Record<string, unknown>)[key];
    return v ? content : '';
  });

  body = body.replace(PLACEHOLDER_RE, (full, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    if (v === undefined || v === null) return full;
    return String(v);
  });

  return body;
}

export const PARSER_TEMPLATE = 'parser.es.md';
export const FORMATTER_INSTRUCTION_TEMPLATE = 'formatter-instruction.es.md';
export const FORMATTER_TOOLS_TEMPLATE = 'formatter-tools.es.md';

/** Lazy-load the tools.json schema; cached. */
let _toolsCache: unknown[] | null = null;
export function loadTools(): unknown[] {
  if (_toolsCache) return _toolsCache;
  const full = path.join(PROMPTS_DIR, 'tools.json');
  _toolsCache = JSON.parse(fs.readFileSync(full, 'utf8'));
  return _toolsCache!;
}
