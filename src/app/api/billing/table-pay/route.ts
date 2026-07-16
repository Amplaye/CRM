import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import {
  looksLikeStripeSecretKey,
  checkTenantStripeKey,
  saveTenantStripeKey,
  deleteTenantStripeKey,
  resolveTenantStripeKey,
} from "@/lib/billing/tenant-stripe";

// Settings → Pagamenti → "Pagamento al tavolo (QR)": the venue's OWN Stripe key,
// mirroring the BYO Resend key route. Without a key here this tenant takes no
// QR payments at all — the platform's Stripe is never a fallback for a venue's
// takings.
//
//   GET    ?tenant_id=…            → { connected } — never the key
//   POST   { tenant_id, api_key }  → validate against Stripe (/v1/account) + store
//   DELETE { tenant_id }           → disconnect (QR pay switches off in practice)

const ROLES = ["owner", "manager"] as const;

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  if (!(await verifyTenantMembership(tenantId, [...ROLES]))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const svc = createServiceRoleClient();
  const key = await resolveTenantStripeKey(svc, tenantId);
  return NextResponse.json({ connected: !!key, livemode: key ? key.includes("_live_") : null });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId = String(body.tenant_id || "");
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  if (!(await verifyTenantMembership(tenantId, [...ROLES]))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const apiKey = String(body.api_key || "").trim();
  if (!looksLikeStripeSecretKey(apiKey)) {
    return NextResponse.json({ ok: false, error: "key_format" }, { status: 200 });
  }

  // One authenticated round-trip answers "is it real?" and "can it charge?".
  const check = await checkTenantStripeKey(apiKey);
  if (!check.ok) return NextResponse.json({ ok: false, error: "key_rejected", detail: check.error }, { status: 200 });

  const svc = createServiceRoleClient();
  const err = await saveTenantStripeKey(svc, tenantId, apiKey);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 });

  return NextResponse.json({
    ok: true,
    connected: true,
    livemode: check.livemode ?? false,
    charges_enabled: check.chargesEnabled ?? false,
    account_name: check.accountName || null,
  });
}

export async function DELETE(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // tenant_id may also arrive as a query param
  }
  const tenantId = String(body.tenant_id || new URL(req.url).searchParams.get("tenant_id") || "");
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  if (!(await verifyTenantMembership(tenantId, [...ROLES]))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const svc = createServiceRoleClient();
  const err = await deleteTenantStripeKey(svc, tenantId);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 });
  return NextResponse.json({ ok: true, connected: false });
}
