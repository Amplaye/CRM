import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";

// Email-confirmation / magic-link callback.
//
// Two flows can land here:
//  • token_hash + type — the PKCE-free verify-OTP flow. It needs NOTHING from
//    the original browser, so the link works even when opened in Gmail, a
//    different browser, or another device. This is the path we want.
//  • code — the legacy PKCE flow. It requires the `code-verifier` cookie that
//    was set in the browser at sign-up; opening the link anywhere else fails
//    and the user gets bounced to /login. Kept only for links already in the
//    wild.
//
// In both cases we build the redirect response UP FRONT and write the session
// cookies onto it: under Next 16 a hand-built NextResponse.redirect does not
// inherit Set-Cookie from next/headers' cookieStore, so writing to both is
// what actually persists the session past the redirect.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") as EmailOtpType | null) ?? "email";
  const next = searchParams.get("next") ?? "/";

  if (tokenHash || code) {
    const response = NextResponse.redirect(new URL(next, request.url));
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : await supabase.auth.exchangeCodeForSession(code!);

    if (!error) {
      return response;
    }
    // Surface the reason instead of silently bouncing.
    console.error(`auth/callback ${tokenHash ? "verifyOtp" : "exchangeCodeForSession"} failed:`, error.message);
  }

  // No token/code or verification failed → send to login.
  return NextResponse.redirect(new URL("/login", request.url));
}
