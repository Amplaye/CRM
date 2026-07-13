import { NextResponse } from "next/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { assertRateLimit } from "@/lib/rate-limit";
import { consumeCredits, getCreditBalance } from "@/lib/billing/credits";
import { ACTION_MC, type CreditAction } from "@/lib/billing/credits-catalog";

// POST /api/credits/consume — the meter for work that happens OUTSIDE the CRM.
//
// The WhatsApp bot is an n8n workflow (motore unico 166), not a Next route, so
// it can't import consumeCredits. It calls this instead, from its Fetch node,
// before answering: one round-trip that CHECKS and DEBITS together.
//
// Check-and-debit in a single call is the point. A separate /check then /consume
// would let two parallel conversations both pass the check on the last 40 mc and
// both debit. Here the RPC's row lock decides, and the loser gets ok:false.
//
// The engine reads `ok`: false → it sends the courtesy message and never calls
// OpenAI. So a 403 here is a normal, expected answer, not an error — which is
// why the body is always JSON with the balance attached, whichever way it goes.
//
// Auth: the same x-ai-secret shared header as /api/ai/*.
//
// Body: { tenant_id, action, qty?, cost_eur?, metadata? }

const VALID_ACTIONS = new Set<string>(Object.keys(ACTION_MC));

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  const rl = await assertRateLimit(request, "credits:consume", { max: 600, windowSecs: 60 });
  if (rl) return rl;

  const body = (await request.json().catch(() => ({}))) as {
    tenant_id?: string;
    action?: string;
    qty?: number;
    cost_eur?: number;
    metadata?: Record<string, unknown>;
  };

  const tenantId = (body.tenant_id || "").trim();
  const action = (body.action || "").trim();
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "invalid_action", action }, { status: 400 });
  }

  const qty = Number.isFinite(body.qty) ? Number(body.qty) : 1;

  const result = await consumeCredits(tenantId, action as CreditAction, {
    qty,
    costEur: Number.isFinite(body.cost_eur) ? Number(body.cost_eur) : undefined,
    metadata: body.metadata,
  });

  if (!result.ok) {
    // Two different reasons land here: the wallet is genuinely empty, or the
    // debit itself failed (DB blip). Tell them apart — an empty wallet must
    // silence the bot, but OUR outage must not. Read the balance: if there's
    // credit there, the failure was ours, so let the bot answer (fail-open,
    // consistent with credits.ts) and eat the cost.
    const balance = await getCreditBalance(tenantId).catch(() => null);
    const needed = ACTION_MC[action as CreditAction] * Math.max(1, Math.ceil(qty));
    const genuinelyExhausted = balance !== null && balance.totalRemainingMc < needed;

    if (!genuinelyExhausted) {
      console.error("[credits/consume] debit failed but wallet looks funded — allowing", tenantId, action);
      return NextResponse.json({
        ok: true,
        metered: false, // we let it through without charging
        remaining_mc: balance?.totalRemainingMc ?? 0,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "credits_exhausted",
        needed_mc: needed,
        remaining_mc: balance?.totalRemainingMc ?? 0,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    metered: true,
    remaining_mc: result.remainingMc,
  });
}
