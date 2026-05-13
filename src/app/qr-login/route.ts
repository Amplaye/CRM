import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@supabase/ssr";
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
  const fail = (reason: string) => {
    const u = new URL("/login", req.url);
    u.searchParams.set("qr", reason);
    console.error("[qr-login] fail:", reason);
    return NextResponse.redirect(u);
  };
  if (!token) return fail("missing");

  const admin = createServiceRoleClient();

  const { data: row, error: rowErr } = await admin
    .from("qr_login_tokens")
    .select("id, user_id, tenant_id, expires_at, consumed_at, pending_name, pending_role")
    .eq("token", token)
    .maybeSingle();

  if (rowErr) return fail("lookup_error");
  if (!row) return fail("not_found");
  if (row.consumed_at) return fail("used");
  if (new Date(row.expires_at).getTime() < Date.now()) return fail("expired");

  let userId: string;
  let email: string;

  if (row.user_id) {
    const { data: u } = await admin
      .from("users")
      .select("email")
      .eq("id", row.user_id)
      .maybeSingle();
    if (!u?.email) return fail("user_email_missing");
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
    if (createErr || !created?.user?.id) {
      console.error("[qr-login] createUser error:", createErr);
      return fail("create_user_failed");
    }

    userId = created.user.id;
    email = syntheticEmail;

    await admin
      .from("users")
      .upsert({ id: userId, email, name: row.pending_name }, { onConflict: "id" });

    const { error: memberErr } = await admin
      .from("tenant_members")
      .insert({ tenant_id: row.tenant_id, user_id: userId, role: row.pending_role });
    if (memberErr) {
      console.error("[qr-login] tenant_members insert error:", memberErr);
      await admin.auth.admin.deleteUser(userId);
      return fail("member_insert_failed");
    }
  } else {
    return fail("bad_token_shape");
  }

  const { error: consumeErr } = await admin
    .from("qr_login_tokens")
    .update({ consumed_at: new Date().toISOString(), user_id: userId })
    .eq("id", (row as any).id)
    .is("consumed_at", null);
  if (consumeErr) {
    console.error("[qr-login] consume error:", consumeErr);
    return fail("consume_failed");
  }

  // Mint a one-shot OTP for this email, then immediately exchange it for a
  // session on the current request. We set the resulting sb-* cookies on the
  // redirect response explicitly so the browser receives them on the very
  // navigation to /floor (relying on `cookies().set()` to bleed onto the
  // redirect response is fragile across Next.js versions).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.email_otp) {
    console.error("[qr-login] generateLink error:", linkErr);
    return fail("link_failed");
  }

  const res = NextResponse.redirect(new URL("/floor", req.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error: otpErr } = await supabase.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (otpErr) {
    console.error("[qr-login] verifyOtp error:", otpErr);
    return fail("otp_failed");
  }

  return res;
}
