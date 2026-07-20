import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { hasAnyText, sanitizeL10n } from "@/lib/announcements/select";

/**
 * PATCH /api/admin/announcements/:id — edit copy, or publish/unpublish.
 *
 * Unpublishing hides the modal from anyone who hasn't seen it yet, but does
 * NOT delete dismissals: re-publishing must not re-interrupt the people who
 * already dismissed it.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body?.title !== undefined) {
    const title = sanitizeL10n(body.title);
    if (!hasAnyText(title)) return NextResponse.json({ error: "text_required" }, { status: 400 });
    patch.title = title;
  }
  if (body?.body !== undefined) {
    const text = sanitizeL10n(body.body);
    if (!hasAnyText(text)) return NextResponse.json({ error: "text_required" }, { status: 400 });
    patch.body = text;
  }
  if (body?.cta_label !== undefined) patch.cta_label = sanitizeL10n(body.cta_label);
  if (body?.cta_href !== undefined) {
    const href = typeof body.cta_href === "string" ? body.cta_href.trim() : "";
    if (href && !href.startsWith("/")) {
      return NextResponse.json({ error: "cta_href_must_be_internal" }, { status: 400 });
    }
    patch.cta_href = href || null;
  }
  if (body?.audience !== undefined) patch.audience = body.audience === "all" ? "all" : "owner_manager";
  if (body?.published !== undefined) patch.published = body.published === true;
  if (body?.starts_at !== undefined) patch.starts_at = body.starts_at || new Date().toISOString();
  if (body?.ends_at !== undefined) patch.ends_at = body.ends_at || null;

  const service = createServiceRoleClient();

  // Publishing is the irreversible-ish moment (it reaches every tenant), so
  // refuse to publish something that says nothing.
  if (patch.published === true) {
    const { data: current } = await service
      .from("announcements")
      .select("title, body")
      .eq("id", id)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const finalTitle = (patch.title as never) ?? current.title;
    const finalBody = (patch.body as never) ?? current.body;
    if (!hasAnyText(finalTitle) || !hasAnyText(finalBody)) {
      return NextResponse.json({ error: "text_required" }, { status: 400 });
    }
  }

  const { data, error } = await service
    .from("announcements")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, announcement: data });
}

/** DELETE /api/admin/announcements/:id — removes the announcement and its dismissals. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;

  const service = createServiceRoleClient();
  const { error } = await service.from("announcements").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
