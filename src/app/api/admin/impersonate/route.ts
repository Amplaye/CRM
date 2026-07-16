import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { logAuditEvent } from "@/lib/audit";
import {
  IMPERSONATION_COOKIE,
  signImpersonationToken,
  verifyImpersonationToken,
  impersonationCookieOptions,
} from "@/lib/impersonation";

/**
 * Enter/exit "operate as tenant" for a platform admin.
 *
 * POST { tenant_id }       → set the signed httpOnly impersonation cookie + audit enter.
 * POST { tenant_id: null } → clear it + audit exit (used by the client tenant switcher).
 * DELETE                   → clear it + audit exit.
 *
 * The cookie is the server-readable signal consumed by getImpersonatedTenantId()
 * to suppress guest-facing side-effects and mark the audit trail. It does NOT
 * grant access — cross-tenant authority already comes from the admin's role.
 */
export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  let body: { tenant_id?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jar = await cookies();
  const tenantId = body.tenant_id;

  if (tenantId) {
    jar.set(
      IMPERSONATION_COOKIE,
      signImpersonationToken(tenantId, auth.userId),
      impersonationCookieOptions()
    );
    await logAuditEvent({
      tenant_id: tenantId,
      action: "admin_impersonate_enter",
      entity_id: auth.userId,
      source: "staff",
      details: { admin_user_id: auth.userId },
    });
    return NextResponse.json({ ok: true });
  }

  // tenant_id null/absent → exit
  await clearImpersonation(jar, auth.userId);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const jar = await cookies();
  await clearImpersonation(jar, auth.userId);
  return NextResponse.json({ ok: true });
}

async function clearImpersonation(
  jar: Awaited<ReturnType<typeof cookies>>,
  adminUserId: string
) {
  const prev = jar.get(IMPERSONATION_COOKIE)?.value;
  const parsed = prev ? verifyImpersonationToken(prev) : null;
  jar.delete(IMPERSONATION_COOKIE);
  if (parsed) {
    await logAuditEvent({
      tenant_id: parsed.tenantId,
      action: "admin_impersonate_exit",
      entity_id: adminUserId,
      source: "staff",
      details: { admin_user_id: adminUserId },
    });
  }
}
