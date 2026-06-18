import crypto from "node:crypto";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Platform-admin tenant impersonation ("Enter as restaurant").
 *
 * Writes already work cross-tenant for a platform admin: the dashboard passes
 * the chosen tenant id into every server action / API call, and
 * `verifyTenantMembership` returns `owner` for an admin on ANY tenant (and RLS
 * grants admins cross-tenant access). So this module does NOT gate writes.
 *
 * Its only job is a TAMPER-PROOF, SERVER-READABLE signal of "this admin is
 * currently operating as tenant X", used to:
 *   1. suppress guest-facing side-effects (real WhatsApp to real guests) while
 *      an admin manages a tenant from the command center, and
 *   2. mark the audit trail.
 *
 * Security model: the cookie is httpOnly + HMAC-signed AND bound to the admin's
 * user id; on every read we re-derive the live session and require it to be the
 * same `platform_admin`. A normal user pasting a cookie by hand gets it ignored.
 */

export const IMPERSONATION_COOKIE = "imp_tenant";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h — re-enter after that

function secret(): string {
  // Dedicated secret if provided, else fall back to the service-role key (a
  // high-entropy server-only secret already present on Vercel). Avoids forcing a
  // new env var that, if forgotten, would break the deploy.
  return process.env.IMPERSONATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

/** token = `${tenantId}.${adminUserId}.${expiryEpochSeconds}.${hmac}` */
export function signImpersonationToken(tenantId: string, adminUserId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${tenantId}.${adminUserId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyImpersonationToken(
  token: string
): { tenantId: string; adminUserId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [tenantId, adminUserId, expStr, sig] = parts;
  const expected = sign(`${tenantId}.${adminUserId}.${expStr}`);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  if (!tenantId || !adminUserId) return null;
  return { tenantId, adminUserId };
}

export function impersonationCookieOptions(maxAge: number = MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * Returns the tenant id the current platform-admin session is impersonating, or
 * null. Performs the full security check (signature + binding + live role).
 * Uses getSession() (local JWT verify, no ~190ms Auth round-trip) per the
 * project's presence-check convention.
 */
export async function getImpersonatedTenantId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;

  const parsed = verifyImpersonationToken(raw);
  if (!parsed) return null;

  const supabase = await createServerSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId || userId !== parsed.adminUserId) return null;

  const { data } = await supabase
    .from("users")
    .select("global_role")
    .eq("id", userId)
    .single();
  if (data?.global_role !== "platform_admin") return null;

  return parsed.tenantId;
}

/** Convenience: is the current admin session impersonating exactly `tenantId`? */
export async function isImpersonatingTenant(tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  return (await getImpersonatedTenantId()) === tenantId;
}
