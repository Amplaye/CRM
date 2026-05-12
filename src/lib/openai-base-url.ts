// Resolves the chat-completions base URL. When AI_GATEWAY_API_KEY is set,
// the Vercel AI Gateway is used (model routing, retries, cost insights);
// otherwise the official OpenAI API is contacted directly. Callers pass
// `model: 'gpt-5.1'` and the helper expands it to `openai/gpt-5.1` for
// gateway compatibility (the gateway expects vendor/model strings).
//
// CLAUDE.md (Vercel best practices) recommends running through the
// gateway because: free cost tracking, automatic retry, multi-model
// fallback, no SDK lock-in.

export type ChatCompletionRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_completion_tokens?: number;
  max_tokens?: number;
};

export function chatCompletionsConfig(): { url: string; bearer: string; modelPrefix: string } {
  const gateway = process.env.AI_GATEWAY_API_KEY;
  if (gateway) {
    return {
      url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
      bearer: gateway,
      modelPrefix: 'openai/',
    };
  }
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    bearer: process.env.OPENAI_API_KEY || '',
    modelPrefix: '',
  };
}

/**
 * Drop-in replacement for the verbose fetch(...) blocks already in the
 * codebase. Returns the raw Response so callers can inspect ok/status
 * before parsing.
 */
export async function chatCompletion(req: ChatCompletionRequest): Promise<Response> {
  const cfg = chatCompletionsConfig();
  const payload = { ...req, model: cfg.modelPrefix + req.model };
  return fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.bearer}`,
    },
    body: JSON.stringify(payload),
  });
}
