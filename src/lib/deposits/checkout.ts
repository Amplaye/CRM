// Server-side deposit orchestration: create the Stripe Checkout link for a
// reservation and persist the pending state. Shared by the bot booking path
// (/api/ai/book) and the staff "request deposit" route (/api/deposits/request)
// so both produce identical sessions/metadata and the webhook has ONE shape
// to trust.

import { createDepositCheckoutSession, stripeConfigured } from "@/lib/billing/stripe";
import { depositDueFor, formatCents } from "./deposits";
import type { TenantSettings } from "@/lib/types/tenant-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any; // service-role Supabase client (same loose typing as the webhook)

export interface DepositLink {
  url: string;
  amountCents: number;
  currency: string;
  formatted: string;
}

/** Create (or refuse to create) a deposit Checkout for a reservation.
 * Returns null when no deposit is due, Stripe isn't configured, or Stripe
 * errors — a deposit failure must NEVER break the booking itself; callers
 * treat null as "proceed without deposit". `force` skips the party-size
 * threshold (staff explicitly requesting one for any booking). */
export async function createDepositForReservation(
  svc: Svc,
  params: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    settings: TenantSettings | null | undefined;
    reservationId: string;
    partySize: number;
    date: string;
    time: string;
    lang?: string;
    guestEmail?: string | null;
    force?: boolean;
  },
): Promise<DepositLink | null> {
  try {
    if (!stripeConfigured()) return null;
    let due = depositDueFor(params.settings, params.partySize);
    if (!due.due && params.force) {
      // Staff override: charge the configured amount regardless of party size.
      const withAll = depositDueFor(
        {
          ...(params.settings || {}),
          venue: { ...((params.settings?.venue as object) || {}), deposit_min_party: 1 },
        } as TenantSettings,
        params.partySize,
      );
      due = withAll;
    }
    if (!due.due) return null;

    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://crm.baliflowagency.com";
    const productName = `Deposit — ${params.tenantName}, ${params.date} ${params.time}`;
    const session = await createDepositCheckoutSession({
      amountCents: due.amountCents,
      currency: due.currency,
      productName,
      successUrl: `${origin}/d/${params.tenantSlug}?paid=1`,
      cancelUrl: `${origin}/d/${params.tenantSlug}?paid=0`,
      clientReferenceId: params.tenantId,
      metadata: {
        kind: "deposit",
        tenant_id: params.tenantId,
        reservation_id: params.reservationId,
      },
      customerEmail: params.guestEmail || undefined,
      locale: (params.lang || "").slice(0, 2) || undefined,
    });

    await svc
      .from("reservations")
      .update({
        deposit_status: "pending",
        deposit_amount_cents: due.amountCents,
        deposit_currency: due.currency,
        deposit_checkout_session_id: session.id,
      })
      .eq("id", params.reservationId)
      .eq("tenant_id", params.tenantId);

    return {
      url: session.url,
      amountCents: due.amountCents,
      currency: due.currency,
      formatted: formatCents(due.amountCents, due.currency),
    };
  } catch (e) {
    // Best-effort by contract: log and let the booking continue depositless.
    console.error("[deposits] checkout creation failed", {
      reservation: params.reservationId,
      error: e instanceof Error ? e.message : e,
    });
    return null;
  }
}
