import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/announcements/dismiss
 * body: { announcement_id, tenant_id?, clicked? }
 *
 * Records "this user has seen it" — the row's existence is the seen flag, and
 * `clicked` tells us whether they took the CTA (the only reach metric we keep).
 *
 * Idempotent: a second dismiss for the same (announcement, user) upgrades
 * clicked false→true but never downgrades it, so a "Got it" tap after the CTA
 * can't erase the fact that they clicked through.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const announcementId = typeof body?.announcement_id === "string" ? body.announcement_id : "";
    if (!announcementId) return NextResponse.json({ error: "announcement_id required" }, { status: 400 });

    const tenantId = typeof body?.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;
    const clicked = body?.clicked === true;

    const service = createServiceRoleClient();
    const { data: existing } = await service
      .from("announcement_dismissals")
      .select("id, clicked")
      .eq("announcement_id", announcementId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      if (clicked && !existing.clicked) {
        await service.from("announcement_dismissals").update({ clicked: true }).eq("id", existing.id);
      }
      return NextResponse.json({ ok: true });
    }

    const { error } = await service.from("announcement_dismissals").insert({
      announcement_id: announcementId,
      user_id: userId,
      tenant_id: tenantId,
      clicked,
    });
    // A concurrent double-tap races on the unique index; that's the desired
    // end state anyway, so don't surface it as a failure.
    if (error && !`${error.message}`.includes("duplicate key")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "dismiss_failed" }, { status: 500 });
  }
}
