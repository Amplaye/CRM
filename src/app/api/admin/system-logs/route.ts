import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { apiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const supabase = createServiceRoleClient();
    const status = req.nextUrl.searchParams.get("status") || "open";
    const tenantId = req.nextUrl.searchParams.get("tenant_id");

    let query = supabase
      .from("system_logs")
      .select("*, tenants(name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (status !== "all") {
      query = query.eq("status", status);
    }
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ logs: data || [] });
  } catch (err: any) {
    return apiError(err, { route: "admin/system-logs", publicMessage: "operation_failed", status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { id, status } = await req.json();
    if (!id || !status) {
      return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const update: any = { status };
    if (status === "resolved") update.resolved_at = new Date().toISOString();

    const { error } = await supabase.from("system_logs").update(update).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, { route: "admin/system-logs", publicMessage: "operation_failed", status: 500 });
  }
}
