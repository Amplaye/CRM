import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Presence check for the auth REDIRECT gate only. We use getSession() (reads +
  // refreshes the token from the cookie LOCALLY) instead of getUser(), which makes
  // a network round-trip to the Auth server (~190ms) on EVERY request — and this
  // middleware runs on every page, API call and navigation (see matcher below), so
  // getUser() here was a per-request latency tax that made the whole CRM feel slow.
  //
  // Safe because this only decides "send anonymous visitors to /login". It is NOT
  // the authorization boundary: every table read is gated by Postgres RLS (which
  // verifies the JWT signature server-side) and privileged /api/admin routes
  // re-check the role via assertPlatformAdmin. A forged cookie still can't read or
  // mutate data — it would just avoid the login bounce, then hit empty/403 responses.
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (
    !user &&
    // /welcome is the public entry choice (Create account vs Sign in) shown to
    // first-time visitors before the login form.
    !request.nextUrl.pathname.startsWith('/welcome') &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/register') &&
    !request.nextUrl.pathname.startsWith('/forgot-password') &&
    !request.nextUrl.pathname.startsWith('/reset-password') &&
    !request.nextUrl.pathname.startsWith('/auth/callback') &&
    !request.nextUrl.pathname.startsWith('/auth/confirm') &&
    !request.nextUrl.pathname.startsWith('/qr-login') &&
    // /m/<slug> is the public hosted menu (the QR target diners scan) — it must
    // be reachable without auth, same as /api.
    !request.nextUrl.pathname.startsWith('/m/') &&
    // /r/<slug> is the public review-link resolver tapped from the post-dinner
    // WhatsApp template button — a guest, never an authenticated user.
    !request.nextUrl.pathname.startsWith('/r/') &&
    // /d/<slug> is the public deposit-checkout landing (Stripe success/cancel
    // URL) — the paying guest has no CRM account.
    !request.nextUrl.pathname.startsWith('/d/') &&
    !request.nextUrl.pathname.startsWith('/api')
  ) {
    const url = request.nextUrl.clone()
    // First touch point: let the visitor choose between creating an account and
    // signing in, instead of dropping them straight onto the login form.
    url.pathname = '/welcome'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
