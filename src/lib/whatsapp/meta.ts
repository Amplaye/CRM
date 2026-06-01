// Single send primitive for WhatsApp via the Meta WhatsApp Cloud API.
//
// Migration (2026-05-29): WhatsApp moved off Twilio onto Meta Cloud API. Every
// send-site in the app routes through sendWhatsAppMeta() so the Graph call,
// auth, payload shape and error handling live in ONE place — not duplicated
// across each API route the way the old Twilio fetch() blocks were.
//
// Twilio still exists in this codebase, but ONLY as the future voice trunk
// (phone number → forward → Vapi). It must never touch WhatsApp again.
//
// Endpoint:  POST https://graph.facebook.com/{version}/{phone_number_id}/messages
// Auth:      Authorization: Bearer <META_ACCESS_TOKEN>   (system-user token)
// Body:      JSON { messaging_product:"whatsapp", to, type:"text", text:{ body } }
//            `to` is E.164 DIGITS ONLY — no leading "+", no "whatsapp:" prefix.

import { resolveWhatsAppFrom } from "./from";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";

export interface MetaSendResult {
  ok: boolean;
  /** Meta message id (wamid....) on success — the Twilio `sid` equivalent. */
  messageId?: string;
  /** HTTP status from Graph (or 0 on a thrown/network error). */
  status: number;
  /** Parsed Graph error payload on failure, for logging. */
  error?: unknown;
  /** Human-readable error message on failure. */
  errorMessage?: string;
}

/**
 * Normalise any phone shape to the E.164 digits Meta requires.
 * Accepts "whatsapp:+34600111222", "+34600111222", "34600111222" → "34600111222".
 */
export function toMetaRecipient(raw: string): string {
  return (raw || "")
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d]/g, "");
}

/**
 * Send a plain-text WhatsApp message through Meta Cloud API.
 *
 * @param to        Recipient phone in any shape (normalised internally).
 * @param body      Message text.
 * @param fromId    Optional sender phone_number_id. Defaults via resolveWhatsAppFrom()
 *                  to the platform's shared Meta number — pass a tenant's own id
 *                  here once per-tenant numbers exist (config, not code).
 * @param token     Optional access token (defaults to META_ACCESS_TOKEN).
 *
 * Never throws — returns a MetaSendResult so callers handle failure explicitly,
 * matching how the old Twilio blocks inspected `res.ok`.
 */
export async function sendWhatsAppMeta(
  to: string,
  body: string,
  fromId?: string | null,
  token: string | undefined = process.env.META_ACCESS_TOKEN
): Promise<MetaSendResult> {
  if (!token) {
    return { ok: false, status: 0, errorMessage: "META_ACCESS_TOKEN not configured" };
  }

  const phoneNumberId = resolveWhatsAppFrom(fromId);
  const recipient = toMetaRecipient(to);
  if (!recipient) {
    return { ok: false, status: 0, errorMessage: `Invalid recipient: "${to}"` };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body },
        }),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg =
        (data as { error?: { message?: string } })?.error?.message ||
        `Meta error ${res.status}`;
      return { ok: false, status: res.status, error: data, errorMessage: msg };
    }

    const messageId = (data as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
    return { ok: true, status: res.status, messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, errorMessage: msg };
  }
}

/**
 * Send an APPROVED WhatsApp template (HSM) through Meta Cloud API.
 *
 * WHY a separate primitive: Meta forbids free-text business-initiated messages
 * outside the 24h customer-service window. Reminders, follow-ups and waitlist
 * offers usually fall outside it, so they MUST go out as a pre-approved
 * template (see scripts/meta-templates.mjs for the registered templates).
 * sendWhatsAppMeta() (type:"text") still covers replies WITHIN the 24h window.
 *
 * @param to        Recipient phone in any shape (normalised internally).
 * @param template  Approved template name (e.g. "booking_reminder").
 * @param language  Meta language code matching the approved template ("es","it","en","de").
 * @param bodyParams Ordered values for the body's {{1}},{{2}}… placeholders.
 *                   Order MUST match the template's variable map.
 * @param fromId    Optional sender phone_number_id (defaults via resolveWhatsAppFrom).
 * @param token     Optional access token (defaults to META_ACCESS_TOKEN).
 *
 * Never throws — returns a MetaSendResult, same contract as sendWhatsAppMeta().
 */
export async function sendWhatsAppTemplate(
  to: string,
  template: string,
  language: string,
  bodyParams: string[] = [],
  fromId?: string | null,
  token: string | undefined = process.env.META_ACCESS_TOKEN
): Promise<MetaSendResult> {
  if (!token) {
    return { ok: false, status: 0, errorMessage: "META_ACCESS_TOKEN not configured" };
  }

  const phoneNumberId = resolveWhatsAppFrom(fromId);
  const recipient = toMetaRecipient(to);
  if (!recipient) {
    return { ok: false, status: 0, errorMessage: `Invalid recipient: "${to}"` };
  }

  // Only attach a BODY component when the template actually has variables —
  // a parameter-less template rejects an empty parameters array.
  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text: String(text) })),
          },
        ]
      : undefined;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: template,
            language: { code: language },
            ...(components ? { components } : {}),
          },
        }),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg =
        (data as { error?: { message?: string } })?.error?.message ||
        `Meta error ${res.status}`;
      return { ok: false, status: res.status, error: data, errorMessage: msg };
    }

    const messageId = (data as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
    return { ok: true, status: res.status, messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, errorMessage: msg };
  }
}
