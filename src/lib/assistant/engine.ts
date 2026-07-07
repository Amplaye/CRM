// The assistant's brain: pure, local, free. No LLM, no network — a scoring
// matcher over the curated knowledge base in kb.ts. Deterministic and testable.

import {
  KB,
  SMALLTALK,
  FALLBACK,
  SUGGESTED_TOPIC_IDS,
  topicById,
  type AssistantLang,
  type KbTopic,
} from "./kb";

export interface AssistantReply {
  kind: "topic" | "smalltalk" | "fallback";
  /** Set when kind === "topic". */
  topic?: KbTopic;
  /** Related topics to offer as chips (topic replies). */
  related: KbTopic[];
  /** Set when kind !== "topic". */
  text?: string;
  /** Topics to offer as chips (fallback replies). */
  suggestions: KbTopic[];
  /** Match strength of the winning topic — lets callers treat weak wins as
   * "maybe" and try a smarter interpreter first. */
  score?: number;
}

/** Lowercase, strip accents and punctuation — so "com'è" matches "come". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STEM_MIN = 4;

/** Token match with a light stem: "prenotazioni" hits keyword "prenotazione". */
function tokenMatches(token: string, keyword: string): boolean {
  if (token === keyword) return true;
  if (token.length >= STEM_MIN && keyword.length >= STEM_MIN) {
    return token.startsWith(keyword) || keyword.startsWith(token);
  }
  return false;
}

export function scoreTopic(topic: KbTopic, query: string): number {
  const q = ` ${query} `;
  const tokens = query.split(" ").filter(Boolean);
  let score = 0;
  for (const raw of topic.keywords) {
    const kw = normalize(raw);
    if (!kw) continue;
    if (kw.includes(" ")) {
      if (q.includes(` ${kw} `) || query.includes(kw)) {
        // Whole phrase present: strongest signal.
        score += 5;
      } else {
        // All meaningful words present but scattered ("chiusura DI cassa",
        // "close THE till"): still a strong signal.
        const words = kw.split(" ").filter((w) => w.length >= 3);
        if (words.length > 0 && words.every((w) => tokens.some((t) => tokenMatches(t, w)))) {
          score += 4;
        }
      }
    } else if (tokens.some((t) => tokenMatches(t, kw))) {
      score += kw.length >= 6 ? 3 : 2;
    }
  }
  return score;
}

function pickSmalltalk(query: string): (typeof SMALLTALK)[keyof typeof SMALLTALK] | null {
  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return null;
  for (const entry of Object.values(SMALLTALK)) {
    for (const trig of entry.triggers) {
      const nt = normalize(trig);
      if (nt.includes(" ") ? query.includes(nt) : tokens.includes(nt)) return entry;
    }
  }
  return null;
}

const MIN_SCORE = 3;

export function answerQuery(raw: string, lang: AssistantLang): AssistantReply {
  const query = normalize(raw);
  const suggestions = SUGGESTED_TOPIC_IDS.map(topicById).filter(Boolean) as KbTopic[];

  if (!query) {
    return { kind: "fallback", text: FALLBACK[lang], related: [], suggestions };
  }

  // Rank the whole KB; smalltalk only wins when nothing substantial matches,
  // so "ciao, come aggiungo un piatto?" still answers the real question.
  const ranked = KB.map((topic) => ({ topic, score: scoreTopic(topic, query) })).sort(
    (a, b) => b.score - a.score,
  );
  const best = ranked[0];

  if (!best || best.score < MIN_SCORE) {
    const st = pickSmalltalk(query);
    if (st) return { kind: "smalltalk", text: st.reply[lang], related: [], suggestions: [] };
    return { kind: "fallback", text: FALLBACK[lang], related: [], suggestions };
  }

  // Related chips: curated links first, then the runner-up match.
  const relatedIds = new Set<string>(best.topic.related || []);
  for (const r of ranked.slice(1)) {
    if (relatedIds.size >= 4) break;
    if (r.score >= MIN_SCORE && r.topic.id !== best.topic.id) relatedIds.add(r.topic.id);
  }
  relatedIds.delete(best.topic.id);
  const related = [...relatedIds]
    .map(topicById)
    .filter(Boolean)
    .slice(0, 4) as KbTopic[];

  return { kind: "topic", topic: best.topic, related, suggestions: [], score: best.score };
}
