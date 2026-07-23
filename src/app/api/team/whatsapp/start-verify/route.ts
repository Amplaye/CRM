import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Start linking the signed-in manager's WhatsApp number to the manager agent.
// We DON'T text them a code (Meta blocks outbound to a number that hasn't opted
// in): instead we mint a one-time code here and the person sends it FROM their
// phone to the restaurant's WhatsApp. The bot matches it (via /api/ai/manager
// verify_phone) and stamps the number verified. This endpoint just creates the
// pending row and returns the code to display.
//
// Auth: signed-in owner/manager of the tenant.

export const runtime = "nodejs";

// Unambiguous alphabet (no 0/O/1/I) — the code is read off a screen and typed.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_body" }, { status: 400 }); }
  const tenantId: string | undefined = body?.tenant_id;
  const manager = tenantId ? await verifyTenantMembership(tenantId, ["owner", "manager"]) : null;
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data: member } = await svc
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId!)
    .eq("user_id", manager.userId)
    .maybeSingle();

  // One pending code per member: clear any earlier unverified attempt.
  await svc.from("staff_whatsapp").delete().eq("tenant_id", tenantId!).eq("member_id", member?.id ?? null).is("verified_at", null);

  const code = makeCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await svc.from("staff_whatsapp").insert({
    tenant_id: tenantId,
    member_id: member?.id ?? null,
    verify_code: code,
    code_expires_at: expiresAt,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The number the person should message. Best-effort: tenant setting, else null
  // (UI falls back to "the restaurant's WhatsApp number").
  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId!).maybeSingle();
  const botNumber = (tenant?.settings as any)?.whatsapp?.display_number ?? (tenant?.settings as any)?.whatsapp?.number ?? null;

  return NextResponse.json({ ok: true, code, expires_at: expiresAt, bot_number: botNumber });
}
