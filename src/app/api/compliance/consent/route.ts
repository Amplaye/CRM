import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveTenantFromApiKey } from "@/lib/tenant-auth";
import { recordConsent, hasValidConsent } from "@/lib/compliance/consent";

// Bot-facing (n8n / Retell): the invisible half of the just-in-time micro-consent.
// When the guest gives the one-tap "sì, salva" affirmative for a Tier 1 field, the
// agent POSTs it here and we append the accountability record. Authenticated with
// the tenant's Bearer API key; the tenant is taken from the key, never the body.
//
// POST { subject_ref, purpose, data_category?, channel?, granted?, evidence?, guest_id?, policy_version? }
//   → { ok, record }
// GET  ?subject_ref=&purpose=  → { hasConsent }
export async function POST(req: NextRequest) {
  try {
    const tenantId = await tenantFromReq(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const supabase = createServiceRoleClient();
    const result = await recordConsent(supabase, {
      tenant_id: tenantId,
      subject_ref: body.subject_ref,
      purpose: body.purpose,
      data_category: body.data_category,
      channel: body.channel,
      granted: body.granted,
      evidence: body.evidence,
      guest_id: body.guest_id ?? null,
      policy_version: body.policy_version,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, record: result.record });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = await tenantFromReq(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const subject_ref = req.nextUrl.searchParams.get("subject_ref") || "";
    const purpose = req.nextUrl.searchParams.get("purpose") || "";
    if (!subject_ref || !purpose) {
      return NextResponse.json({ error: "subject_ref and purpose required" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const ok = await hasValidConsent(supabase, { tenant_id: tenantId, subject_ref, purpose });
    return NextResponse.json({ hasConsent: ok });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function tenantFromReq(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token ? await resolveTenantFromApiKey(token) : null;
}
