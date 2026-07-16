import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/rate-limit";
import { isEmail, isRealPhone, normalizeEmail } from "@/lib/booking-validation";
import { emailDomainReachable } from "@/lib/email-domain";
import { POST as aiBook } from "@/app/api/ai/book/route";

// PUBLIC booking for the widget (/b/<slug>) — Fase 7. Reuses the FULL
// /api/ai/book pipeline (validation, guest dedup by phone tail, availability
// + atomic table assignment, large-party escalation, WhatsApp confirmation,
// deposit link when deposits_enabled) by invoking the handler in-process with
// the shared secret. This route adds what a public form needs instead:
// strict IP rate limit, its own field validation, slug→tenant resolution and
// a response trimmed to widget-safe fields. source='web' throughout.

export const dynamic = "force-dynamic";
// Node runtime (not edge) — the email domain check uses node:dns.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await assertRateLimit(req, "public:book", { max: 5, windowSecs: 60 });
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  const time = typeof body?.time === "string" ? body.time.trim() : "";
  const partySize = Number(body?.party_size);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const phone = typeof body?.phone === "string" ? body.phone.replace(/[\s().-]/g, "") : "";
  const email = typeof body?.email === "string" ? body.email.trim().slice(0, 254) : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 300) : "";
  // Exact room name chosen in the widget's room step (blank = single-room venue).
  const room = typeof body?.room === "string" ? body.room.trim().slice(0, 60) : "";

  if (
    !slug ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time) ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 50 ||
    !name
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  // Phone must be a real, dial-able number for its country — not just
  // E.164-shaped. Rejects "+11111111111" & co. that the bare regex waves through.
  if (!isRealPhone(phone)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  // Email is mandatory on the public site (all fields required) and must be a
  // plausible address — captured for the tenant's marketing list. It never
  // triggers a confirmation email (the AI book route only stores it). Two gates:
  // (1) pragmatic syntax, (2) the domain actually accepts mail (MX/A lookup),
  // so "x@dominioinventato.xyz" / "x@hotmail.con" are refused. We can't verify
  // the individual mailbox without sending — which the product forbids.
  if (!isEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!(await emailDomainReachable(email))) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: tenant } = await svc
    .from("tenants")
    .select("id, status, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const locale = ["it", "es", "en", "de"].includes(tenant.settings?.crm_locale)
    ? tenant.settings.crm_locale
    : undefined;

  const inner = new Request("http://internal/api/ai/book", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ai-secret": process.env.AI_WEBHOOK_SECRET || "",
    },
    body: JSON.stringify({
      tenant_id: tenant.id,
      guest_name: name,
      guest_phone: phone.startsWith("+") ? phone : `+${phone}`,
      guest_email: normalizeEmail(email),
      date,
      time,
      party_size: partySize,
      notes,
      ...(room ? { zone_exact: room } : {}),
      source: "web",
      idempotency_key: randomUUID(),
      ...(locale ? { language: locale } : {}),
    }),
  });
  const res = await aiBook(inner);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => ({}));

  // Trim to widget-safe fields — the AI route's `message` strings are
  // bot-facing prose; the widget renders its own localized copy by `reason`.
  return NextResponse.json(
    {
      success: !!json?.success,
      reservation_id: json?.reservation_id ?? null,
      status: json?.status ?? null,
      on_waitlist: !!json?.on_waitlist,
      reason: json?.reason ?? (json?.success ? null : json?.error || "unavailable"),
      deposit_payment_url: json?.deposit_payment_url || null,
    },
    { status: res.ok ? 200 : res.status },
  );
}
