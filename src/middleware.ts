import { updateSession } from '@/lib/supabase/middleware'
import { enforceApiCors } from '@/lib/cors'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const corsBlock = enforceApiCors(request)
  if (corsBlock) return corsBlock
  return await updateSession(request)
}

export const config = {
  matcher: [
    // `opengraph-image` is a code-generated metadata route served WITHOUT a file
    // extension (e.g. /opengraph-image?<hash>), so the `.png$` rule below doesn't
    // catch it — exclude it explicitly or the auth middleware 307s WhatsApp's
    // crawler to /welcome and the link preview breaks. The .png metadata routes
    // (twitter-image/icon/apple-icon) are already covered by the extension rule.
    // `manifest.webmanifest` (from app/manifest.ts) must stay public too, or
    // the install prompt fetches it and gets a 307 to the login page.
    '/((?!_next/static|_next/image|favicon.ico|opengraph-image|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
