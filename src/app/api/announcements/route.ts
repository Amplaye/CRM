import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { pickAnnouncement, type Announcement } from "@/lib/announcements/select";

/**
 * GET /api/announcements?tenant_id=…
 *
 * The one announcement this user should be interrupted with, or null. Called
 * once per dashboard mount, so it is written to be cheap and to fail quiet:
 * any error returns `{ announcement: null }` rather than a status the modal
 * would have to reason about. Never showing a product announcement is a
 * non-event; showing one to the wrong person, or crashing the shell, is not.
 *
 * Auth: getSession() reads the cookie locally (no ~190ms Auth-server hop —
 * same trade-off as admin-auth.ts), and the tenant_members read below goes
 * through the ANON-key client, so PostgREST verifies the JWT and RLS proves
 * the membership. A forged cookie yields no row → no announcement.
 */
export async function GET(req: NextRequest) {
  const none = NextResponse.json({ announcement: null });

  try {
    const tenantId = req.nextUrl.searchParams.get("tenant_id");
    const supabase = await createServerSupabaseClient();

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return none;

    // Resolve the role the same way the rest of the app does: tenant membership
    // first, platform admins normalised to `owner` (they see everything).
    let role: string | null = null;
    if (tenantId) {
      const { data: membership } = await supabase
        .from("tenant_members")
        .select("role")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle();
      role = (membership?.role as string) || null;
    }
    if (!role) {
      const { data: profile } = await supabase
        .from("users")
        .select("global_role")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.global_role === "platform_admin") role = "owner";
    }
    if (!role) return none;

    // Announcements are platform-wide, so the service-role client is only
    // reading global rows plus this user's own dismissals — nothing crosses a
    // tenant boundary here.
    const service = createServiceRoleClient();
    const [{ data: rows }, { data: dismissals }] = await Promise.all([
      service
        .from("announcements")
        .select("id, slug, title, body, cta_label, cta_href, audience, published, starts_at, ends_at")
        .eq("published", true)
        .order("starts_at", { ascending: false })
        .limit(20),
      service.from("announcement_dismissals").select("announcement_id").eq("user_id", userId),
    ]);

    const picked = pickAnnouncement((rows || []) as Announcement[], {
      role,
      now: new Date(),
      dismissedIds: ((dismissals || []) as { announcement_id: string }[]).map(
        (d) => d.announcement_id
      ),
    });

    return NextResponse.json({ announcement: picked });
  } catch {
    return none;
  }
}
