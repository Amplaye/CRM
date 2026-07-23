import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAiSecret } from "@/lib/ai-auth";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizePhone, phoneTail } from "@/lib/booking-validation";

// Shared authorization for the manager agent. Two callers hit the same invoice
// routes now: a signed-in dashboard user (RLS client) and the WhatsApp bot on
// behalf of a VERIFIED staff member (service-role client + x-ai-secret). This
// keeps the two entry points on one code path so the invoice pipeline can't
// drift between them.

/** A WhatsApp number is trusted only after the code round-trip (staff_whatsapp
 *  verified_at). Match on normalized number, with a phone-tail fallback for
 *  formatting differences. Service-role client (bypasses RLS by design). */
export async function verifiedStaffPhone(
  svc: SupabaseClient,
  tenantId: string,
  phone: string,
): Promise<{ id: string; member_id: string | null } | null> {
  const norm = normalizePhone(phone);
  const tail = phoneTail(phone);
  const { data } = await svc
    .from("staff_whatsapp")
    .select("id, member_id, phone")
    .eq("tenant_id", tenantId)
    .not("verified_at", "is", null);
  const rows = (data || []) as Array<{ id: string; member_id: string | null; phone: string | null }>;
  const hit = rows.find((r) => r.phone && (normalizePhone(r.phone) === norm || phoneTail(r.phone) === tail));
  return hit ? { id: hit.id, member_id: hit.member_id } : null;
}

export type InvoiceAuth =
  | { error: NextResponse }
  | { supabase: SupabaseClient; viaBot: true; createdBy: null }
  | { supabase: SupabaseClient; viaBot: false; createdBy: string };

/**
 * Authorize an invoice upload/confirm request as EITHER:
 *   • the WhatsApp bot — when an `x-ai-secret` header is present: validate the
 *     shared secret, require `phone` to be a verified staff number of the tenant,
 *     and return a service-role client (RLS-bypassing, already staff-gated);
 *   • a dashboard user — otherwise: the normal signed-in RLS client.
 * Callers parse their own body first (tenant_id + optional phone) and pass them in.
 */
export async function authorizeInvoiceRequest(
  req: Request,
  tenantId: string,
  phone?: string,
): Promise<InvoiceAuth> {
  if (req.headers.has("x-ai-secret")) {
    const unauth = assertAiSecret(req);
    if (unauth) return { error: unauth };
    if (!phone) return { error: NextResponse.json({ error: "missing_phone" }, { status: 400 }) };
    const svc = createServiceRoleClient() as unknown as SupabaseClient;
    const staff = await verifiedStaffPhone(svc, tenantId, phone);
    if (!staff) return { error: NextResponse.json({ error: "not_staff" }, { status: 403 }) };
    return { supabase: svc, viaBot: true, createdBy: null };
  }

  const rls = (await createServerSupabaseClient()) as unknown as SupabaseClient;
  const { data: { user } } = await rls.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { supabase: rls, viaBot: false, createdBy: user.id };
}
