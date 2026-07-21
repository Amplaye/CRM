import { NextResponse } from "next/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertManagement } from "@/lib/billing/guard";
import { seedDefaultIngredients } from "@/lib/management/seed-ingredients";

// Top a tenant's warehouse up with the default ingredient catalogue, in the
// tenant's CRM language.
//
// New tenants get this automatically at creation (see lib/tenants/create-tenant);
// this route is what lets a tenant that PREDATES the catalogue fill an empty (or
// half-empty) Inventory from the page itself. Idempotent — only names the tenant
// doesn't already hold are inserted, and no existing row's cost, stock or
// category is touched.
//
// Gating mirrors suggest-recipe: membership → management add-on. No AI, no
// credits.

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

  const membership = await verifyTenantMembership(tenantId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = await assertManagement(tenantId);
  if (gate) return gate;

  const supabase = createServiceRoleClient();

  // Seed in the tenant's dashboard language, so the storeroom reads the way the
  // rest of the CRM does. The caller may override for the rare tenant whose
  // kitchen language differs from its dashboard.
  let locale = typeof body.locale === "string" ? body.locale : "";
  if (!locale) {
    const { data } = await supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle();
    locale = (data?.settings as { crm_locale?: string } | null)?.crm_locale || "en";
  }

  try {
    const result = await seedDefaultIngredients(supabase, tenantId, locale);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "seed failed" },
      { status: 500 },
    );
  }
}
