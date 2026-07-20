import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { hasAnyText, sanitizeL10n } from "@/lib/announcements/select";

/**
 * GET /api/admin/announcements
 * Every announcement, newest first, each with its reach: how many users saw it
 * and how many took the CTA.
 */
export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const service = createServiceRoleClient();
  const { data: rows, error } = await service
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Small volumes (a handful of announcements × a few hundred users), so
  // aggregate in JS rather than adding an RPC for a count.
  const { data: dismissals } = await service
    .from("announcement_dismissals")
    .select("announcement_id, clicked");

  const stats = new Map<string, { seen: number; clicked: number }>();
  for (const d of dismissals || []) {
    const id = d.announcement_id as string;
    const cur = stats.get(id) || { seen: 0, clicked: 0 };
    cur.seen += 1;
    if (d.clicked) cur.clicked += 1;
    stats.set(id, cur);
  }

  return NextResponse.json({
    announcements: ((rows || []) as { id: string }[]).map((a) => ({
      ...a,
      seen: stats.get(a.id)?.seen || 0,
      clicked: stats.get(a.id)?.clicked || 0,
    })),
  });
}

/**
 * POST /api/admin/announcements — create one.
 * Publishing is a separate PATCH, so a draft can be written and reviewed
 * before it interrupts every owner on the platform.
 */
export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => ({}));
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) {
    return NextResponse.json({ error: "slug_format" }, { status: 400 });
  }

  const title = sanitizeL10n(body?.title);
  const bodyText = sanitizeL10n(body?.body);
  if (!hasAnyText(title) || !hasAnyText(bodyText)) {
    return NextResponse.json({ error: "text_required" }, { status: 400 });
  }

  const ctaHref = typeof body?.cta_href === "string" ? body.cta_href.trim() : "";
  // In-app paths only. An announcement modal that can navigate off-site is a
  // phishing surface we have no reason to open.
  if (ctaHref && !ctaHref.startsWith("/")) {
    return NextResponse.json({ error: "cta_href_must_be_internal" }, { status: 400 });
  }

  const audience = body?.audience === "all" ? "all" : "owner_manager";

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("announcements")
    .insert({
      slug,
      title,
      body: bodyText,
      cta_label: sanitizeL10n(body?.cta_label),
      cta_href: ctaHref || null,
      audience,
      published: false,
      starts_at: body?.starts_at || new Date().toISOString(),
      ends_at: body?.ends_at || null,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    if (`${error.message}`.includes("duplicate key")) {
      return NextResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, announcement: data });
}
