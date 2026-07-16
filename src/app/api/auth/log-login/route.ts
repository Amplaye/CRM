import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/rate-limit";
import { logSystemEvent } from "@/lib/system-log";

function getClientIp(req: NextRequest): string | null {
  // Vercel + most proxies put the client IP first in x-forwarded-for
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || null;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// How many failures for the same email inside the window trip the alarm.
const BRUTEFORCE_WINDOW_MIN = 15;
const BRUTEFORCE_THRESHOLD = 10;

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent");

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      // Successful-login calls historically send no body.
    }

    // FAILED attempt: no session exists, so this path is unauthenticated by
    // nature. Rate-limited and email-validated; it can only append a failure
    // row, never anything privileged.
    if (body?.failed === true) {
      const rl = await assertRateLimit(req, "auth:log-login", { max: 20, windowSecs: 60 });
      if (rl) return rl;

      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "invalid_email" }, { status: 400 });
      }

      const service = createServiceRoleClient();
      await service.from("login_events").insert({
        user_id: null,
        email,
        ip_address: ip,
        user_agent: ua,
        provider: "email",
        success: false,
        failure_reason: "invalid_credentials",
      });

      // Brute-force tripwire: many failures on one email in a short window.
      const since = new Date(Date.now() - BRUTEFORCE_WINDOW_MIN * 60_000).toISOString();
      const { count } = await service
        .from("login_events")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .eq("success", false)
        .gte("created_at", since);
      if ((count || 0) > BRUTEFORCE_THRESHOLD) {
        await logSystemEvent({
          category: "system",
          severity: "high",
          title: "Possibile brute-force sul login",
          description: `${count} tentativi falliti per ${email} negli ultimi ${BRUTEFORCE_WINDOW_MIN} minuti (ultimo IP: ${ip || "?"}).`,
          error_key: `login-bruteforce:${email}`,
        });
      }

      return NextResponse.json({ ok: true });
    }

    // SUCCESSFUL login: verify the caller actually has a session
    // (don't trust the body alone).
    const userClient = await createServerSupabaseClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const provider = (user.app_metadata as any)?.provider || "email";

    const service = createServiceRoleClient();
    await service.from("login_events").insert({
      user_id: user.id,
      email: user.email || null,
      ip_address: ip,
      user_agent: ua,
      provider,
      success: true,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never block the login UX if logging fails.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
