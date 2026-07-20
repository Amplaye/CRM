// Chat-completions client. Calls go straight to the official OpenAI API.
//
// We used to route through the Vercel AI Gateway, but the stack now runs
// entirely on Cloudflare Workers and we no longer depend on Vercel. The
// gateway path was also a single point of failure: a revoked
// AI_GATEWAY_API_KEY silently took down every AI feature (the in-app
// assistant, conversation summaries, onboarding, note translation) because
// the gateway was preferred whenever the key was merely *present*.
//
// Only OPENAI_API_KEY is needed — set it as a secret on the `crm` worker
// (`wrangler secret put OPENAI_API_KEY`).

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export type ChatCompletionRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_completion_tokens?: number;
  max_tokens?: number;
  response_format?: { type: string };
};

export function chatCompletionsConfig(): { url: string; bearer: string; modelPrefix: string } {
  // modelPrefix is kept (always '') so callers that compose model strings
  // keep working; OpenAI takes bare model ids like 'gpt-4.1-mini'.
  return { url: OPENAI_URL, bearer: process.env.OPENAI_API_KEY || '', modelPrefix: '' };
}

/**
 * Drop-in replacement for the verbose fetch(...) blocks already in the
 * codebase. Returns the raw Response so callers can inspect ok/status
 * before parsing.
 */
export async function chatCompletion(req: ChatCompletionRequest): Promise<Response> {
  const cfg = chatCompletionsConfig();
  return fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.bearer}`,
    },
    body: JSON.stringify({ ...req, model: cfg.modelPrefix + req.model }),
  });
}
