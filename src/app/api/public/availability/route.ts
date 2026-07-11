import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/rate-limit";
import { GET as aiAvailability } from "@/app/api/ai/availability/route";

// PUBLIC availability for the booking widget (/b/<slug>) — a thin shim over
// the battle-tested /api/ai/availability engine. The guest knows only the
// slug; we resolve the tenant and invoke the AI handler IN-PROCESS with the
// shared secret (no network hop, full logic reuse: hours, cut-offs, per-slot
// table fit). Tightened rate limit because this endpoint has no secret.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = await assertRateLimit(req, "public:availability", { max: 30, windowSecs: 60 });
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
  const partySize = Number(body?.party_size);
  // Optional exact room name (widget room step) — availability is then scoped to
  // that room's tables. Length-capped; the AI route validates it exists.
  const room = typeof body?.room === "string" ? body.room.trim().slice(0, 60) : "";
  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: tenant } = await svc
    .from("tenants")
    .select("id, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const qs = new URLSearchParams({
    tenant_id: tenant.id,
    date,
    party_size: String(partySize),
    ...(room ? { zone_exact: room } : {}),
  });
  const inner = new Request(`http://internal/api/ai/availability?${qs}`, {
    headers: { "x-ai-secret": process.env.AI_WEBHOOK_SECRET || "" },
  });
  const res = await aiAvailability(inner);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  // Expose only what the widget needs — not the bot-facing prose fields.
  return NextResponse.json({
    date: json.date,
    status: json.status ?? "open",
    next_open: json.next_open ?? null,
    availability: Array.isArray(json.availability)
      ? json.availability.map((a: { time: string; available: boolean }) => ({
          time: a.time,
          available: !!a.available,
        }))
      : [],
  });
}
