import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-error";

// Register / remove this browser's Web-Push subscription for the signed-in
// user. Rows are tenant-scoped so server events fan out per tenant
// (src/lib/push/send.ts). The endpoint is unique per browser subscription:
// re-subscribing (or switching tenant) upserts the same row.

async function requireUser() {
  const userClient = await createServerSupabaseClient();
  const { data: { user } } = await userClient.auth.getUser();
  return { userClient, user };
}

export async function POST(req: NextRequest) {
  try {
    const { user, userClient } = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      tenantId?: string;
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    };
    const tenantId = (body.tenantId || "").trim();
    const endpoint = body.subscription?.endpoint;
    const keys = body.subscription?.keys;
    if (!tenantId || !endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Missing tenantId or subscription" }, { status: 400 });
    }

    // Membership check with the caller's own client (RLS-scoped).
    const { data: membership } = await userClient
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          tenant_id: tenantId,
          user_id: user.id,
          endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          user_agent: req.headers.get("user-agent")?.slice(0, 255) || null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, { route: "push/subscribe", publicMessage: "operation_failed", status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    if (!body.endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.endpoint)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, { route: "push/subscribe", publicMessage: "operation_failed", status: 500 });
  }
}
