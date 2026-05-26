import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    // Build the redirect response UP FRONT so the session cookies set by
    // exchangeCodeForSession are written onto the response that the browser
    // actually receives. Writing only to next/headers' cookieStore does NOT
    // attach Set-Cookie to a hand-built NextResponse.redirect, so the freshly
    // confirmed session would be lost and middleware would bounce the user to
    // /login on the next request.
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return response;
    }
    // Surface the reason instead of silently bouncing — a PKCE/verifier
    // mismatch (e.g. confirmed on a different device) lands here too.
    console.error("auth/callback exchangeCodeForSession failed:", error.message);
  }

  // If no code or error, redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}
