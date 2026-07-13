import { NextResponse } from "next/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { assertRateLimit } from "@/lib/rate-limit";
import { consumeCredits, getCreditBalance, walletEverFunded } from "@/lib/billing/credits";
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
    // THREE different reasons land here, and only one of them may silence a bot:
    //
    //   a) the debit itself failed (DB blip) — OUR outage. Let the bot answer.
    //   b) the tenant was never put on the credits system at all — nobody granted
    //      them anything. They are not out of credits, they are outside the
    //      system. Blocking them would take a restaurant's bot down over billing
    //      WE never provisioned. Let the bot answer, unmetered.
    //   c) the tenant HAD credits and has spent them. Out. Block — that is the
    //      whole point of the meter.
    //
    // (b) is not hypothetical: on 2026-07-13 this branch, which then only knew
    // about (a) and (c), read every un-provisioned tenant as "exhausted" and the
    // gate went out ready to silence all five live restaurants. A zero balance
    // does not mean spent — walletEverFunded is what tells (b) from (c).
    const balance = await getCreditBalance(tenantId).catch(() => null);
    const needed = ACTION_MC[action as CreditAction] * Math.max(1, Math.ceil(qty));
    const emptyWallet = balance !== null && balance.totalRemainingMc < needed;
    const genuinelyExhausted = emptyWallet && (await walletEverFunded(tenantId));

    if (!genuinelyExhausted) {
      console.error(
        emptyWallet
          ? "[credits/consume] wallet never funded — tenant is not on the credits system, allowing"
          : "[credits/consume] debit failed but wallet looks funded — allowing",
        tenantId,
        action,
      );
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
