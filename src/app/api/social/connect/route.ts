import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { getFeatures } from "@/lib/types/tenant-settings";
import { listPagesFromCode, listPagesFromToken, storeSocialConnection } from "@/lib/social/meta-connect";
import { apiError } from "@/lib/api-error";

// Meta connection for the Social section. Two-step so we can let the owner pick
// which Facebook Page (and its linked IG account) to connect when they admin more
// than one:
//   1. POST { tenant_id, code }        → exchange + list Pages. One Page → store
//      it and return connected; multiple → return { pages } for the UI to choose.
//   2. POST { tenant_id, code, page_id } → store the chosen Page.
//
// The short-lived FB.login code is single-use, so the client passes it again on
// the second call along with the chosen page_id. The secret Page token never
// leaves the server (storeSocialConnection writes it to tenants.secrets).

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const code = String(body.code || "");
    const chosenPageId = body.page_id ? String(body.page_id) : "";
    const userToken = body.user_token ? String(body.user_token) : "";
    if (!tenantId || (!code && !userToken)) {
      return NextResponse.json({ error: "tenant_id and code required" }, { status: 400 });
    }

    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!getFeatures(tenant.settings).social_enabled) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403 });
    }

    // Exchange the code (or reuse a passed user token) and list Pages.
    const listed = userToken ? await listPagesFromToken(userToken) : await listPagesFromCode(code);
    if (!listed.ok) return NextResponse.json({ error: listed.error || "connect_failed" }, { status: 502 });
    const pages = listed.pages || [];
    if (!pages.length) {
      return NextResponse.json({ error: "no_pages" }, { status: 422 });
    }

    // Which Page to connect: the chosen one, or the only one, or ask the UI.
    const page = chosenPageId ? pages.find((p) => p.pageId === chosenPageId) : pages.length === 1 ? pages[0] : undefined;
    if (!page) {
      // Multiple Pages and none chosen → return the list (no tokens) for selection.
      return NextResponse.json({
        needsChoice: true,
        pages: pages.map((p) => ({ pageId: p.pageId, pageName: p.pageName, hasInstagram: Boolean(p.igUserId) })),
      });
    }

    // Targets: Instagram only if the Page has a linked IG business account.
    const targets: Array<"instagram" | "facebook"> = ["facebook"];
    if (page.igUserId) targets.unshift("instagram");

    const stored = await storeSocialConnection({ tenantId, page, targets });
    if (!stored.ok) return NextResponse.json({ error: stored.error || "store_failed" }, { status: 500 });

    return NextResponse.json({
      success: true,
      account: { name: page.pageName, hasInstagram: Boolean(page.igUserId), targets },
    });
  } catch (e) {
    return apiError(e, { route: "social/connect", publicMessage: "internal" });
  }
}
