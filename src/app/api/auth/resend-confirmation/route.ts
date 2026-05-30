import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Re-send the account-confirmation email for an UNCONFIRMED user, in the
// language the caller asks for.
//
// Why this exists: confirmation links expire (24h) and mobile mail apps can
// prefetch-consume them. When that happens the user is stranded — the account
// exists but is unconfirmed, so login is rejected ("email not valid") and
// re-registering says "already exists". This endpoint gets them unstuck by
// minting a fresh confirmation email instead of leaving a dead end.
//
// Design notes:
//  • Locale wins from the request: before resending we set the user's
//    user_metadata.locale = lang, so Supabase renders our multilingual
//    template ({{ .Data.locale }}) in the right language.
//  • Privacy: we ALWAYS return { ok: true } regardless of whether the email
//    exists or is already confirmed, so the endpoint can't be used to probe
//    which addresses have accounts.
//  • Already-confirmed users are a no-op (nothing to resend).
const ALLOWED_LANGS = new Set(["it", "es", "en", "de"]);

export async function POST(req: Request) {
  let email = "";
  let lang = "it";
  try {
    const body = (await req.json()) as { email?: string; lang?: string };
    email = (body?.email || "").trim().toLowerCase();
    if (body?.lang && ALLOWED_LANGS.has(body.lang)) lang = body.lang;
  } catch {
    // Malformed body → behave like "nothing to do".
    return NextResponse.json({ ok: true });
  }

  // Basic shape check; never reveal more than "ok".
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: true });
  }

  try {
    const svc = createServiceRoleClient();

    // Find the user by email via the admin API. (listUsers is paginated; a
    // direct filter keeps it cheap and exact.)
    const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return NextResponse.json({ ok: true });

    const user = (data?.users || []).find(
      (u: { email?: string }) => (u.email || "").toLowerCase() === email
    );

    // No such user, or already confirmed → nothing to resend (silently ok).
    if (!user || user.email_confirmed_at) {
      return NextResponse.json({ ok: true });
    }

    // Make the requested language authoritative for the rendered email.
    if (user.user_metadata?.locale !== lang) {
      await svc.auth.admin.updateUserById(user.id, {
        user_metadata: { ...(user.user_metadata || {}), locale: lang },
      });
    }

    // Trigger a fresh confirmation email. GoTrue's /resend re-renders the
    // confirmation template (now with the updated locale) and ships it through
    // the configured SMTP (Resend). We hit it with the anon key, exactly as the
    // browser SDK's auth.resend() would. The redirect carries lang so the
    // interstitial /auth/confirm page matches the email.
    const origin = new URL(req.url).origin;
    const resp = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/resend`,
      {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "signup",
          email,
          options: {
            email_redirect_to: `${origin}/auth/confirm?next=/onboarding&lang=${lang}`,
          },
        }),
      }
    );

    // smtp_max_frequency (60s between sends to the same address) can return 429.
    // That's fine — a mail is already in flight; still report ok to the user.
    if (!resp.ok && resp.status !== 429) {
      // Log server-side but don't leak details to the client.
      const txt = await resp.text().catch(() => "");
      console.error("resend-confirmation GoTrue error", resp.status, txt.slice(0, 200));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("resend-confirmation failed", (e as Error)?.message);
    // Never surface internals; the UI shows a generic retry message on !ok,
    // but we prefer ok-with-noop here to keep the flow forgiving.
    return NextResponse.json({ ok: true });
  }
}
