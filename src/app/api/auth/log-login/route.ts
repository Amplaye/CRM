import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

function getClientIp(req: NextRequest): string | null {
  // Vercel + most proxies put the client IP first in x-forwarded-for
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || null;
}

export async function POST(req: NextRequest) {
  try {
    // Verify the caller actually has a session (don't trust the body alone).
    const userClient = await createServerSupabaseClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent");
    const provider = (user.app_metadata as any)?.provider || "email";

    const service = createServiceRoleClient();
    await service.from("login_events").insert({
      user_id: user.id,
      email: user.email || null,
      ip_address: ip,
      user_agent: ua,
      provider,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // Never block the login UX if logging fails.
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
