// AI caption + hashtag generator for the Social section. Pure over I/O except
// the one OpenAI call — the route wraps it with credit metering (social_caption)
// exactly like marketing/generate wraps its ai_text call. Never throws on a bad
// OpenAI response: it returns { ok:false } so the route leaves credits untouched.
//
// Uses the same /v1/responses gpt-4o path the rest of the CRM uses (marketing
// copy, review replies) so there's one OpenAI contract, not a new one.

export type SocialPostType = "image" | "carousel" | "reels";

export interface ComposeContext {
  restaurantName: string;
  /** ISO language code for the caption: "it" | "en" | "es" | "de" | ... */
  locale: string;
  postType: SocialPostType;
  /** Dish/collection names the post is about, for the AI to write around. */
  dishes: string[];
  /** Optional cuisine/style hint (e.g. "Balinese", "seafood"). */
  cuisine?: string;
}

export interface ComposeResult {
  ok: boolean;
  caption?: string;
  hashtags?: string[];
  error?: string;
}

const TYPE_HINT: Record<SocialPostType, string> = {
  image: "a single feed photo of one dish",
  carousel: "a multi-photo carousel showcasing several dishes",
  reels: "a short vertical reel (10–15s) with a few dishes in sequence",
};

/**
 * Generate a caption + hashtags for a social post. `fetchImpl` is injectable so
 * unit tests run without network. Never throws.
 */
export async function composeCaption(
  ctx: ComposeContext,
  opts?: { apiKey?: string; fetchImpl?: typeof fetch },
): Promise<ComposeResult> {
  const key = opts?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "ai_not_configured" };
  const doFetch = opts?.fetchImpl ?? fetch;

  const dishList = ctx.dishes.filter(Boolean).slice(0, 8).join(", ") || "the day's dishes";
  const shape =
    `Output STRICT JSON: {"caption": string, "hashtags": string[]}. ` +
    `caption: 1–3 short sentences in the language "${ctx.locale}", warm and appetising, ` +
    `max 2 emojis, one soft call to action (e.g. book a table / come by), no placeholders like [name]. ` +
    `hashtags: 5–10 relevant hashtags WITHOUT the # symbol, lowercase, no spaces.`;

  try {
    const res = await doFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_output_tokens: 400,
        temperature: 0.85,
        instructions:
          `You write Instagram/Facebook captions for the restaurant "${ctx.restaurantName}"` +
          `${ctx.cuisine ? ` (${ctx.cuisine} cuisine)` : ""}. The post is ${TYPE_HINT[ctx.postType]}. ` +
          `${shape} No markdown fences — raw JSON only.`,
        input: [{ role: "user", content: [{ type: "input_text", text: `Dishes/collection: ${dishList}` }] }],
      }),
    });
    if (!res.ok) return { ok: false, error: `openai ${res.status}` };
    const json = (await res.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text =
      json.output_text ||
      (json.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("");
    const parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, "")) as {
      caption?: string;
      hashtags?: string[];
    };
    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 10)
      : [];
    return { ok: true, caption: String(parsed.caption || "").trim(), hashtags };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Join caption + hashtags into the single string the Graph API `caption` field wants. */
export function toGraphCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}
