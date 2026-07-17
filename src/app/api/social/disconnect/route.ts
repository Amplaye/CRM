import { NextResponse } from "next/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { disconnectSocial } from "@/lib/social/meta-connect";
import { apiError } from "@/lib/api-error";

// Disconnect the tenant's social accounts: mark social_accounts revoked and drop
// the Page token from tenants.secrets. The composer keeps working (drafts), but
// nothing can publish until the owner reconnects.

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenant_id || "");
    if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const res = await disconnectSocial(tenantId);
    if (!res.ok) return NextResponse.json({ error: res.error || "disconnect_failed" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e, { route: "social/disconnect", publicMessage: "internal" });
  }
}
