import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildBookingConfirmationMessage } from "@/lib/booking-confirmation-message";
import { isSendableGuestPhone } from "@/lib/whatsapp/phone";

/**
 * Send the guest a WhatsApp confirmation when a reservation is confirmed from
 * the CRM (e.g. staff approving an `escalated` large-group request). The voice
 * agent only sends a WhatsApp on the normal 1-6 auto-confirm path, so a booking
 * that the owner confirms by hand otherwise reaches the guest silently.
 *
 * Best-effort and self-contained: never throws into the caller's transaction.
 * Skips silently when the stored phone is missing/implausible (e.g. the mangled
 * "+6341790137" from a bad STT) so we don't hand Twilio an undeliverable number.
 */
export async function sendReservationConfirmationWhatsApp(params: {
  tenantId: string;
  reservation: {
    guest_id: string;
    date: string;
    time: string;
    party_size: number;
    notes?: string | null;
    language?: string | null;
  };
  baseUrl: string;
  aiSecret?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const supabase = createServiceRoleClient();
    const { data: guest } = await supabase
      .from("guests")
      .select("name, phone")
      .eq("id", params.reservation.guest_id)
      .maybeSingle();

    const phone = (guest?.phone || "").trim();
    if (!isSendableGuestPhone(phone)) {
      return { sent: false, reason: "phone_not_sendable" };
    }

    // Resolve the message language. The reservation's own language wins; if it's
    // missing (older rows, or escalated bookings created before the language was
    // pinned) fall back to the tenant's primary language so an Italian (or other
    // non-Spanish) restaurant doesn't send a Spanish confirmation. Spanish is the
    // last-resort default inside buildBookingConfirmationMessage.
    let lang = params.reservation.language ?? null;
    if (!lang) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("settings")
        .eq("id", params.tenantId)
        .maybeSingle();
      lang = (tenant?.settings as any)?.bot_config?.primary_language ?? null;
    }

    const message = buildBookingConfirmationMessage({
      date: params.reservation.date,
      time: params.reservation.time,
      partySize: params.reservation.party_size,
      guestName: guest?.name ?? null,
      notes: params.reservation.notes ?? null,
      language: lang,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (params.aiSecret) headers["x-ai-secret"] = params.aiSecret;

    const res = await fetch(`${params.baseUrl}/api/send-whatsapp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ to: phone, message, tenant_id: params.tenantId }),
    });
    if (!res.ok) return { sent: false, reason: `send_failed_${res.status}` };
    return { sent: true };
  } catch (err: any) {
    // Never break the reservation update over a notification failure.
    return { sent: false, reason: err?.message || "exception" };
  }
}
