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
  // Don't add response_format here: the Vercel AI Gateway rejects it
  // ("Invalid input", validated even before auth) — prompt for JSON instead.
};

const GATEWAY_CONFIG = {
  url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
  modelPrefix: 'openai/',
} as const;

const OPENAI_CONFIG = {
  url: 'https://api.openai.com/v1/chat/completions',
  modelPrefix: '',
} as const;

export function chatCompletionsConfig(): { url: string; bearer: string; modelPrefix: string } {
  const gateway = process.env.AI_GATEWAY_API_KEY;
  if (gateway) return { ...GATEWAY_CONFIG, bearer: gateway };
  return { ...OPENAI_CONFIG, bearer: process.env.OPENAI_API_KEY || '' };
}

/**
 * Drop-in replacement for the verbose fetch(...) blocks already in the
 * codebase. Returns the raw Response so callers can inspect ok/status
 * before parsing.
 */
function send(
  cfg: { url: string; bearer: string; modelPrefix: string },
  req: ChatCompletionRequest,
): Promise<Response> {
  return fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.bearer}`,
    },
    body: JSON.stringify({ ...req, model: cfg.modelPrefix + req.model }),
  });
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<Response> {
  const cfg = chatCompletionsConfig();
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const usingGateway = cfg.url === GATEWAY_CONFIG.url;

  let res: Response;
  try {
    res = await send(cfg, req);
  } catch (e) {
    // Gateway unreachable (DNS/network). Fall back rather than surfacing a
    // throw to callers that would otherwise have a working OpenAI key.
    if (usingGateway && openaiKey) {
      console.error('[chatCompletion] gateway unreachable, falling back to OpenAI', e);
      return send({ ...OPENAI_CONFIG, bearer: openaiKey }, req);
    }
    throw e;
  }

  // An expired/revoked gateway credential (401/403) must not take every AI
  // feature down while a valid OPENAI_API_KEY is configured. 5xx means the
  // gateway itself is degraded — also worth retrying direct.
  const gatewayBroken = res.status === 401 || res.status === 403 || res.status >= 500;
  if (usingGateway && gatewayBroken && openaiKey) {
    console.error(
      `[chatCompletion] AI Gateway returned ${res.status} — falling back to the OpenAI API directly. ` +
        'Rotate AI_GATEWAY_API_KEY on the `crm` worker to restore gateway routing.',
    );
    return send({ ...OPENAI_CONFIG, bearer: openaiKey }, req);
  }

  return res;
}
