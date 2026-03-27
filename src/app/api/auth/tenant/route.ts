import { NextResponse } from "next/server";

/**
 * This endpoint is no longer needed with Supabase auth.
 * Firebase custom claims (active_tenant_id) are replaced by
 * Supabase RLS policies and tenant membership queries.
 * Kept as a stub for backwards compatibility.
 */
export async function POST(req: Request) {
  return NextResponse.json({ success: true, message: "No-op: Supabase handles tenant context via RLS." });
}
