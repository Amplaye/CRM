// PII redaction / tokenization layer — sits between our system and the LLM so we
// don't ship raw direct identifiers (and, optionally, sensitive spans) into a
// third-party model's prompt. The model can still reason about "the guest at
// [PHONE_1] has [HEALTH_1]" without ingesting the raw phone or health detail; we
// resolve the tokens back in our own layer when composing the final message to the
// kitchen/CRM. This is the architectural half of "data minimization": even with a
// one-tap consent UX, what actually leaves our controlled environment is small.
//
// Deterministic by construction: tokens are numbered by first-appearance order
// (PHONE_1, PHONE_2, …) with a per-run map, so the same input always yields the
// same output — no randomness (which the workflow/runtime forbids anyway) and the
// round-trip resolve() is exact. Redaction is text-only and reversible via the map;
// it never touches storage.
//
// Scope: emails and phone numbers are always redacted (unambiguous direct
// identifiers). Sensitive (Tier 1) spans are redacted only when `redactSensitive`
// is on — full Tier-1 redaction is safest but can reduce the model's allergy/
// dietary reasoning quality, so it's a per-use-case switch (see brief §6.4, open
// decision #2). Names are intentionally NOT auto-redacted here: reliable name
// detection needs NER we don't run inline, and over-redacting names breaks the
// conversational UX. Pass known names in via `extraTerms` when you have them.

import { classifyText } from "./classifier";

export type RedactionKind = "EMAIL" | "PHONE" | "HEALTH" | "ACCESSIBILITY" | "TERM";

export interface RedactionToken {
  token: string;
  kind: RedactionKind;
  value: string;
}

export interface RedactionResult {
  /** The text with identifiers replaced by [KIND_n] placeholders. */
  redacted: string;
  /** token → original value, for resolve(). Insertion-ordered by first appearance. */
  map: Record<string, string>;
  /** Structured view of every substitution (same info as `map`, typed). */
  tokens: RedactionToken[];
}

export interface RedactOptions {
  /** Also redact sensitive (Tier 1) spans detected by the classifier. Default false. */
  redactSensitive?: boolean;
  /** Extra literal strings to redact (e.g. a known guest name). Case-insensitive. */
  extraTerms?: string[];
}

// Email: pragmatic RFC-ish matcher, good enough to catch real addresses.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Phone: an optional leading +, then 7–15 digits possibly separated by spaces,
// dots, or hyphens. Anchored to avoid swallowing plain party-size numbers ("4
// people") by requiring at least 7 digits total.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

/** Count the digits in a candidate phone span (whitespace/punctuation ignored). */
function digitCount(s: string): number {
  return (s.match(/\d/g) || []).length;
}

/**
 * Redact PII from `text`, returning the placeholdered text plus a reversible map.
 *
 * Order matters: emails first (they contain characters the phone regex would
 * otherwise fragment), then phones, then optional sensitive spans and extra terms.
 * Each distinct original value gets one stable token; a repeated value reuses it.
 */
export function redactPII(text: string | null | undefined, opts: RedactOptions = {}): RedactionResult {
  const map: Record<string, string> = {};
  const tokens: RedactionToken[] = [];
  if (!text) return { redacted: "", map, tokens };

  // Per-kind counters so tokens read [EMAIL_1], [PHONE_1], [PHONE_2]…
  const counters: Record<RedactionKind, number> = {
    EMAIL: 0, PHONE: 0, HEALTH: 0, ACCESSIBILITY: 0, TERM: 0,
  };
  // Reuse a token when the SAME original value recurs (value → token).
  const valueToToken = new Map<string, string>();

  const mint = (kind: RedactionKind, value: string): string => {
    const existing = valueToToken.get(`${kind}:${value}`);
    if (existing) return existing;
    counters[kind] += 1;
    const token = `[${kind}_${counters[kind]}]`;
    valueToToken.set(`${kind}:${value}`, token);
    map[token] = value;
    tokens.push({ token, kind, value });
    return token;
  };

  let out = text;

  // 1. Emails.
  out = out.replace(EMAIL_RE, (m) => mint("EMAIL", m));

  // 2. Phone numbers — only spans with ≥7 digits (skip small counts like party size).
  out = out.replace(PHONE_RE, (m) => (digitCount(m) >= 7 ? mint("PHONE", m.trim()) : m));

  // 3. Extra literal terms (e.g. a known guest name), longest-first so a full name
  //    is replaced before its parts. Case-insensitive, whole-substring.
  const terms = (opts.extraTerms || [])
    .filter((t) => t && t.trim().length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const re = new RegExp(escapeRegExp(term), "gi");
    out = out.replace(re, (m) => mint("TERM", m));
  }

  // 4. Optional sensitive spans. We tokenize the classifier's matched stems by
  //    category. This is coarse (stem-level, not full clinical phrase) but keeps
  //    the raw health noun out of the prompt when the caller wants maximum safety.
  if (opts.redactSensitive) {
    const cls = classifyText(text);
    // Re-detect exact stems on the CURRENT (already email/phone-redacted) text so we
    // don't touch anything already tokenized. Longest stems first.
    const stems = Array.from(new Set(cls.matches)).sort((a, b) => b.length - a.length);
    for (const stem of stems) {
      const kind: RedactionKind = cls.categories.includes("accessibility") && !cls.categories.includes("health")
        ? "ACCESSIBILITY"
        : "HEALTH";
      // Replace the whole word containing the stem (so "allergico" tokenizes fully,
      // not just the "allerg" fragment). Accent-tolerant via the Unicode letter class.
      const wordRe = new RegExp(`[\\p{L}\\p{M}-]*${escapeRegExp(stem)}[\\p{L}\\p{M}-]*`, "giu");
      out = out.replace(wordRe, (m) => mint(kind, m));
    }
  }

  return { redacted: out, map, tokens };
}

/** Inverse of redactPII: substitute every [KIND_n] placeholder back to its original
 * value using the map. Used in our own layer when composing the final downstream
 * message. Unknown tokens are left as-is. */
export function resolveTokens(text: string, map: Record<string, string>): string {
  if (!text) return text;
  return text.replace(/\[[A-Z]+_\d+\]/g, (tok) => (tok in map ? map[tok] : tok));
}

/** Escape a literal string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
