import { NextResponse } from "next/server";

// Email-based invites are disabled: the only roles are Admin (DB owner — the
// account creator, set at signup) and Staff (DB host — added via QR from
// /api/team/add-staff). This endpoint stays in place to return a clear 410 for
// any cached client that still POSTs here.
export async function POST() {
  return NextResponse.json({ error: "Email invites are disabled. Add staff via QR." }, { status: 410 });
}
