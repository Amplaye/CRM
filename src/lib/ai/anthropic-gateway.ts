// Anthropic Messages API via Vercel AI Gateway.
// We use the Anthropic-native path (POST /v1/messages, base URL
// ai-gateway.vercel.sh) instead of the OpenAI-compat path because PDF
// support (type=document, source.type=base64, media_type=application/pdf)
// only exists on the Anthropic side. The gateway just proxies.
//
// Auth is the same AI_GATEWAY_API_KEY already used by openai-base-url.ts.

const GATEWAY_BASE = 'https://ai-gateway.vercel.sh';

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      };
    }
  | {
      type: 'document';
      source: {
        type: 'base64';
        media_type: 'application/pdf';
        data: string;
      };
    };

export type AnthropicRequest = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
};

export type AnthropicResponse = {
  content: Array<{ type: 'text'; text: string } | { type: string; [k: string]: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

/**
 * Call Anthropic Messages API through Vercel AI Gateway.
 * Throws on non-2xx with the gateway error body included.
 */
export async function anthropicMessages(req: AnthropicRequest): Promise<AnthropicResponse> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error('AI_GATEWAY_API_KEY not configured');

  const res = await fetch(`${GATEWAY_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic gateway ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as AnthropicResponse;
}

/**
 * Extract the first text block from an Anthropic response, defaulting to
 * empty string. Most of our prompts ask for a single JSON blob so this is
 * what callers want.
 */
export function firstText(res: AnthropicResponse): string {
  for (const block of res.content) {
    if (block.type === 'text' && typeof (block as { text: unknown }).text === 'string') {
      return (block as { text: string }).text;
    }
  }
  return '';
}
