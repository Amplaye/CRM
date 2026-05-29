import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export type TenantRole = "owner" | "manager" | "host";

/**
 * Verify that the currently logged-in user is a member of `tenantId`, and
 * optionally that they hold one of `requiredRoles`. Returns the resolved
 * { userId, role } on success, or null when there is no session, no
 * membership, or the role is insufficient.
 *
 * This is the server-side authorization that dashboard-driven server actions
 * and session-authed API routes need *in addition* to having a session:
 * `getUser()` only proves who you are, not which tenant's data you may touch.
 * The CRM uses the service-role client for these writes (RLS bypassed), so the
 * membership check cannot be left to RLS.
 */
export async function verifyTenantMembership(
  tenantId: string,
  requiredRoles?: TenantRole[]
): Promise<{ userId: string; role: TenantRole } | null> {
  if (!tenantId) return null;

  const auth = await createServerSupabaseClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return null;

  // Platform admins may act on any tenant.
  const service = createServiceRoleClient();
  const { data: profile } = await service
    .from("users")
    .select("global_role")
    .eq("id", user.id)
    .single();
  if (profile?.global_role === "platform_admin") {
    return { userId: user.id, role: "owner" };
  }

  const { data: membership } = await service
    .from("tenant_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!membership) return null;
  const role = membership.role as TenantRole;
  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(role)) {
    return null;
  }
  return { userId: user.id, role };
}
