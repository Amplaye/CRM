import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Consumes a QR-login token and lands the visitor directly inside the CRM,
// already authenticated — no detour through /login.
//
// Two modes:
//  1. pending invite (user_id null + pending_name/pending_role set): we
//     create the Supabase user, the public.users row and the tenant_members
//     row on the fly, then sign them in.
//  2. existing-user QR (user_id set, e.g. re-issued from the staff list):
//     we just sign that user in.
//
// To skip /login completely we generate an admin magic-link, pull the
// email_otp out of it, and verify it server-side with the SSR Supabase
// client. The session cookies get set on the current request and the user
// is redirected to /floor.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") || "";
  const failUrl = new URL("/login?qr=invalid", req.url);
  if (!token) return NextResponse.redirect(failUrl);

  const admin = createServiceRoleClient();

  const { data: row } = await admin
    .from("qr_login_tokens")
    .select("id, user_id, tenant_id, expires_at, consumed_at, pending_name, pending_role")
    .eq("token", token)
    .maybeSingle();

  if (!row) return NextResponse.redirect(failUrl);
  if (row.consumed_at) return NextResponse.redirect(new URL("/login?qr=used", req.url));
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/login?qr=expired", req.url));
  }

  let userId: string;
  let email: string;

  if (row.user_id) {
    const { data: u } = await admin
      .from("users")
      .select("email")
      .eq("id", row.user_id)
      .maybeSingle();
    if (!u?.email) return NextResponse.redirect(failUrl);
    userId = row.user_id;
    email = u.email;
  } else if (row.pending_name && row.pending_role) {
    const tenantShort = row.tenant_id.replace(/-/g, "").slice(0, 8);
    const syntheticEmail = `staff-${randomBytes(6).toString("hex")}.t${tenantShort}@baliflow.local`;
    const syntheticPassword = randomBytes(24).toString("base64url");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: syntheticPassword,
      email_confirm: true,
      user_metadata: { name: row.pending_name, tenant_id: row.tenant_id, qr_staff: true },
    });
    if (createErr || !created?.user?.id) return NextResponse.redirect(failUrl);

    userId = created.user.id;
    email = syntheticEmail;

    await admin
      .from("users")
      .upsert({ id: userId, email, name: row.pending_name }, { onConflict: "id" });

    const { error: memberErr } = await admin
      .from("tenant_members")
      .insert({ tenant_id: row.tenant_id, user_id: userId, role: row.pending_role });
    if (memberErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.redirect(failUrl);
    }
  } else {
    return NextResponse.redirect(failUrl);
  }

  const { error: consumeErr } = await admin
    .from("qr_login_tokens")
    .update({ consumed_at: new Date().toISOString(), user_id: userId })
    .eq("id", (row as any).id)
    .is("consumed_at", null);
  if (consumeErr) return NextResponse.redirect(failUrl);

  // Mint a one-shot OTP for this email, then immediately exchange it for a
  // session on the current request — that writes the sb-* cookies on the app
  // domain. The OTP is consumed in the same request, so it can't be reused.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.email_otp) return NextResponse.redirect(failUrl);

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { error: otpErr } = await supabase.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (otpErr) return NextResponse.redirect(failUrl);

  return NextResponse.redirect(new URL("/floor", req.url));
}
