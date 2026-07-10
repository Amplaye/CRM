import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { createDepositForReservation } from "@/lib/deposits/checkout";
import { logAuditEvent } from "@/lib/audit";

// Staff-triggered deposit request: generate (or regenerate) the Stripe
// Checkout link for a reservation so the owner can send it to the guest.
// `force` bypasses the party-size threshold — staff may demand a deposit on
// ANY booking (e.g. a repeat no-shower booking a table for two).

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const reservationId = String(body.reservation_id || "");
    if (!tenantId || !reservationId) {
      return NextResponse.json({ error: "tenant_id and reservation_id required" }, { status: 400 });
    }
    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const [{ data: tenant }, { data: reservation }] = await Promise.all([
      svc.from("tenants").select("id, name, slug, settings").eq("id", tenantId).maybeSingle(),
      svc
        .from("reservations")
        .select("id, date, time, party_size, deposit_status, language, guest_id")
        .eq("id", reservationId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    if (!tenant || !reservation) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (["authorized", "paid", "forfeited"].includes(reservation.deposit_status)) {
      return NextResponse.json({ error: "already_settled", deposit_status: reservation.deposit_status }, { status: 409 });
    }

    const { data: guest } = await svc
      .from("guests")
      .select("email")
      .eq("id", reservation.guest_id)
      .maybeSingle();

    const link = await createDepositForReservation(svc, {
      tenantId,
      tenantName: tenant.name || "",
      tenantSlug: tenant.slug || "",
      settings: tenant.settings,
      reservationId,
      partySize: Number(reservation.party_size) || 2,
      date: reservation.date,
      time: reservation.time,
      lang: reservation.language || undefined,
      guestEmail: guest?.email || null,
      force: body.force !== false, // staff route: default to forcing
    });
    if (!link) {
      return NextResponse.json(
        { error: "deposit_unavailable", hint: "Stripe non configurato o importo caparra mancante in Impostazioni → Prenotazioni" },
        { status: 422 },
      );
    }

    await logAuditEvent({
      tenant_id: tenantId,
      action: "deposit_requested",
      entity_id: reservationId,
      idempotency_key: `deposit_req_${reservationId}_${link.url.slice(-12)}`,
      source: "staff",
      details: { amount_cents: link.amountCents, currency: link.currency, by: member.userId },
    });

    return NextResponse.json({ success: true, url: link.url, amount: link.formatted });
  } catch (e) {
    console.error("[deposits/request]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
