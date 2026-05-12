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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
