import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolveSystemLogByTrelloCard, TRELLO_DONE_LIST_ID } from "@/lib/trello-sync";

// Inbound Trello webhook — the REVERSE of trello-sync's outbound mirror.
//
// When someone drags a bug card into "✅ Hecho" ON TRELLO, Trello POSTs an
// `updateCard` action here. We find the system_logs row that owns that card and
// mark it resolved, so the CRM Monitoring view closes the same problem. The
// outbound half (open log → card, resolved log → card moves to Hecho) already
// lives in trello-sync.ts; this completes the bidirectional sync.
//
// Registration: Trello probes the callback URL with a HEAD request and expects
// 200 before it will create the webhook (see scripts/register-trello-webhook).
//
// Auth: Trello signs every callback with HMAC-SHA1 over (body + callbackURL)
// using the API SECRET as the key. We verify it when TRELLO_API_SECRET and
// TRELLO_WEBHOOK_CALLBACK_URL are set; if not, we fall back to accepting (the
// action only ever *resolves* an existing log — it cannot create or escalate).

export const runtime = "nodejs";

// Trello's registration handshake.
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

// Trello also issues a GET against the callback during some validation flows.
export async function GET() {
  return NextResponse.json({ ok: true });
}

function verifyTrelloSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.TRELLO_API_SECRET;
  const callbackUrl = process.env.TRELLO_WEBHOOK_CALLBACK_URL;
  // Not configured → can't verify; accept (resolve-only endpoint, low blast radius).
  if (!secret || !callbackUrl) {
    console.warn("[trello-webhook] TRELLO_API_SECRET/CALLBACK_URL not set — skipping signature check");
    return true;
  }
  if (!header) return false;
  const expected = crypto
    .createHmac("sha1", secret)
    .update(rawBody + callbackUrl)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Read the raw body once — needed both for signature verification and parsing.
  const raw = await req.text();

  if (!verifyTrelloSignature(raw, req.headers.get("x-trello-webhook"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, skipped: "non-JSON body" });
  }

  try {
    const action = body?.action;
    const type: string | undefined = action?.type;
    const data = action?.data || {};

    // We only care about a card landing in the "✅ Hecho" list. Trello fires
    // `updateCard` with listAfter when a card is moved between lists.
    const movedToDone =
      type === "updateCard" && data?.listAfter?.id === TRELLO_DONE_LIST_ID;

    if (!movedToDone) {
      return NextResponse.json({ ok: true, skipped: `no-op (${type || "unknown"})` });
    }

    const cardId: string | undefined = data?.card?.id;
    if (!cardId) {
      return NextResponse.json({ ok: true, skipped: "no card id" });
    }

    const result = await resolveSystemLogByTrelloCard(cardId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[trello-webhook] error:", err?.message);
    // Return 200 so Trello doesn't disable the webhook after repeated 500s;
    // the failure is logged for us to inspect.
    return NextResponse.json({ ok: false, error: err?.message || "error" });
  }
}
