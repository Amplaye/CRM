import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  mcFor,
  PLAN_CREDITS_MC,
  type CreditAction,
} from "./credits-catalog";

// Credit metering — the runtime half of the catalog. Two verbs, mirroring the
// assertX → NextResponse|null shape of guard.ts so a route reads the same way
// whether it's gated on an add-on or on a balance:
//
//   const gate = await assertCredits(tenantId, "invoice_ocr");
//   if (gate) return gate;                    // fail BEFORE burning the API call
//   const extracted = await extractInvoice(...);
//   await consumeCredits(tenantId, "invoice_ocr", { costEur: 0.03 });
//
// The split is deliberate. assertCredits is a cheap pre-check that debits
// NOTHING: it exists so we refuse a 300-recipient campaign before Meta bills us
// for the first 40. consumeCredits is the debit, and it runs AFTER the action
// succeeded — we never charge a tenant for a call that 502'd.
//
// FAIL-OPEN, unlike guard.ts. That inversion is the important decision here:
// assertManagement fails CLOSED because a paid feature must not leak. Metering
// is not a feature gate — it's a meter — and if the meter itself breaks
// (Supabase blips, the RPC is missing) the right outcome is that the restaurant
// keeps answering its customers and we eat a few cents, not that the bot goes
// silent during service. A billing bug must never cost a client a booking.

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export interface CreditBalance {
  includedRemainingMc: number;
  purchasedRemainingMc: number;
  includedGrantedMc: number;
  totalRemainingMc: number;
  periodStart: string | null;
}

const EMPTY: CreditBalance = {
  includedRemainingMc: 0,
  purchasedRemainingMc: 0,
  includedGrantedMc: 0,
  totalRemainingMc: 0,
  periodStart: null,
};

/** Read a tenant's wallet (service-role). Returns a zeroed balance — not null —
 * when the tenant has never had a row, so callers never branch on null. */
export async function getCreditBalance(
  tenantId: string,
  client?: ServiceClient,
): Promise<CreditBalance> {
  const svc = client ?? createServiceRoleClient();
  const { data } = await svc
    .from("credit_balances")
    .select("included_remaining_mc, purchased_remaining_mc, included_granted_mc, period_start")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return { ...EMPTY };
  const included = Number(data.included_remaining_mc) || 0;
  const purchased = Number(data.purchased_remaining_mc) || 0;
  return {
    includedRemainingMc: included,
    purchasedRemainingMc: purchased,
    includedGrantedMc: Number(data.included_granted_mc) || 0,
    totalRemainingMc: included + purchased,
    periodStart: (data.period_start as string) || null,
  };
}

/**
 * 403 `{ error: "credits_exhausted", needed_mc, remaining_mc }` when the wallet
 * can't cover the action; `null` when it can (caller proceeds).
 *
 * Debits nothing — this is the pre-flight. Put it immediately before the
 * expensive call, and pass `qty` when the cost scales (campaign recipients, menu
 * chunks) so we refuse the WHOLE job up front instead of running out halfway
 * through and leaving a campaign half-sent.
 *
 * Fails OPEN: an unreadable wallet lets the action through (see the file header).
 */
export async function assertCredits(
  tenantId: string,
  action: CreditAction,
  qty = 1,
  client?: ServiceClient,
): Promise<NextResponse | null> {
  const needed = mcFor(action, qty);
  if (needed <= 0) return null;

  let balance: CreditBalance;
  try {
    balance = await getCreditBalance(tenantId, client);
  } catch (e) {
    console.error("[credits] balance read failed, allowing action", tenantId, action, e);
    return null; // fail-open
  }

  if (balance.totalRemainingMc < needed) {
    return NextResponse.json(
      {
        error: "credits_exhausted",
        needed_mc: needed,
        remaining_mc: balance.totalRemainingMc,
      },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Debit the wallet for an action that HAS ALREADY SUCCEEDED. Atomic (the
 * consume_credits RPC takes a row lock, so the bot's parallel conversations and
 * the campaign loop can't overdraw between them).
 *
 * Never throws and never returns a NextResponse: the caller has already done the
 * work and is on its way to returning a success, and a metering failure must not
 * turn that into an error. A failed debit is logged and swallowed — we lose the
 * few cents, the restaurant keeps working.
 *
 * `costEur` is our REAL cost (Meta's country price, the Vapi minute), recorded
 * on the ledger row so the admin side can see the actual margin rather than the
 * assumed one.
 */
export async function consumeCredits(
  tenantId: string,
  action: CreditAction,
  opts?: {
    qty?: number;
    costEur?: number;
    metadata?: Record<string, unknown>;
    client?: ServiceClient;
  },
): Promise<{ ok: boolean; remainingMc: number }> {
  const mc = mcFor(action, opts?.qty ?? 1);
  if (mc <= 0) return { ok: true, remainingMc: 0 };

  try {
    const svc = opts?.client ?? createServiceRoleClient();
    const { data, error } = await svc.rpc("consume_credits", {
      p_tenant_id: tenantId,
      p_action: action,
      p_credits_mc: mc,
      p_cost_eur: opts?.costEur ?? null,
      p_metadata: opts?.metadata ?? {},
    });
    if (error) {
      console.error("[credits] consume failed", tenantId, action, mc, error.message);
      return { ok: false, remainingMc: 0 };
    }
    // The RPC returns a one-row table.
    const row = Array.isArray(data) ? data[0] : data;
    return {
      ok: Boolean(row?.ok),
      remainingMc: Number(row?.remaining_mc) || 0,
    };
  } catch (e) {
    console.error("[credits] consume threw", tenantId, action, e);
    return { ok: false, remainingMc: 0 };
  }
}

/**
 * Add bought credits to the wallet (a Stripe top-up pack). They never expire and
 * are spent only after the monthly allowance is gone.
 *
 * `action` is what the ledger row says. It defaults to "topup" (the customer
 * paid), and the admin panel passes "admin_grant" instead — a gift and a
 * purchase both add credits, but conflating them in the ledger would make the
 * revenue numbers lie.
 */
export async function grantPurchasedCredits(
  tenantId: string,
  creditsMc: number,
  metadata?: Record<string, unknown>,
  client?: ServiceClient,
  action: "topup" | "admin_grant" = "topup",
): Promise<boolean> {
  return grant(tenantId, "purchased", creditsMc, action, metadata, client);
}

/**
 * Reset the monthly allowance to the plan's quota. Called on every renewal
 * (Stripe/PayPal webhook) and by the daily cron backstop.
 *
 * A RESET, not an addition: unused allowance does not roll over, and a
 * re-delivered webhook therefore re-sets the same number instead of doubling it.
 * That idempotence is why this is safe to call from both the webhook and the
 * cron without coordinating them.
 */
export async function resetIncludedCredits(
  tenantId: string,
  plan: "premium" | "business",
  client?: ServiceClient,
): Promise<boolean> {
  const quota = PLAN_CREDITS_MC[plan];
  if (!quota) return false;
  return grant(tenantId, "included", quota, "plan_reset", { plan }, client);
}

async function grant(
  tenantId: string,
  kind: "purchased" | "included",
  creditsMc: number,
  action: string,
  metadata?: Record<string, unknown>,
  client?: ServiceClient,
): Promise<boolean> {
  try {
    const svc = client ?? createServiceRoleClient();
    const { error } = await svc.rpc("grant_credits", {
      p_tenant_id: tenantId,
      p_kind: kind,
      p_credits_mc: creditsMc,
      p_action: action,
      p_metadata: metadata ?? {},
    });
    if (error) {
      console.error("[credits] grant failed", tenantId, kind, creditsMc, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[credits] grant threw", tenantId, kind, e);
    return false;
  }
}
