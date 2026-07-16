import { NextRequest, NextResponse } from "next/server";
import { resolveSystemEvents, type SystemLogCategory } from "@/lib/system-log";
import { resolveTenantFromApiKey } from "@/lib/tenant-auth";
import { apiError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const tenantFromKey = token ? await resolveTenantFromApiKey(token) : null;

    const body = await req.json().catch(() => ({}));
    const error_key: string | undefined = body.error_key;
    const category: SystemLogCategory | undefined = body.category;
    const tenant_id: string | undefined = body.tenant_id || tenantFromKey || undefined;

    if (!error_key && !category) {
      return NextResponse.json(
        { error: "Provide error_key and/or category" },
        { status: 400 }
      );
    }

    if (!tenantFromKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const effectiveTenant = tenantFromKey;

    const result = await resolveSystemEvents({
      error_key,
      category,
      tenant_id: effectiveTenant,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return apiError(err, { route: "admin/system-logs/resolve", publicMessage: "operation_failed", status: 500 });
  }
}
