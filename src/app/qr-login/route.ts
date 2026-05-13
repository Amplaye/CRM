import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Consumes a one-time QR login token: marks it used and redirects the browser
// through Supabase's magic-link verify URL, which sets the auth cookies and
// drops the user inside /floor (the default landing for staff).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") || "";
  const failUrl = new URL("/login?qr=invalid", req.url);

  if (!token) return NextResponse.redirect(failUrl);

  const admin = createServiceRoleClient();

  const { data: row } = await admin
    .from("qr_login_tokens")
    .select("id, user_id, tenant_id, expires_at, consumed_at, users(email)")
    .eq("token", token)
    .maybeSingle();

  if (!row) return NextResponse.redirect(failUrl);
  if (row.consumed_at) return NextResponse.redirect(new URL("/login?qr=used", req.url));
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/login?qr=expired", req.url));
  }

  const email = (row as any).users?.email as string | undefined;
  if (!email) return NextResponse.redirect(failUrl);

  // Mark consumed atomically before generating the link.
  const { error: consumeErr } = await admin
    .from("qr_login_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", (row as any).id)
    .is("consumed_at", null);

  if (consumeErr) return NextResponse.redirect(failUrl);

  // Supabase will set the active_tenant_id client-side via TenantContext on
  // its own, since the user has a membership row. We just need a session.
  const origin = req.nextUrl.origin;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/auth/callback?next=/floor` },
  });

  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.redirect(failUrl);
  }

  return NextResponse.redirect(link.properties.action_link);
}
