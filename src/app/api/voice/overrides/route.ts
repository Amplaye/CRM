import { NextRequest, NextResponse } from "next/server";
import { buildTenantCallConfig, spelledDateVars } from "@/lib/voice/engine";

// Web voice engine endpoint. The public booking widget calls this with a
// tenant_id and gets back { assistantId, assistantOverrides } for the SHARED
// engine assistant, then does vapi.start(assistantId, assistantOverrides).
//
// The overrides carry the tenant's freshly-composed system prompt (built from
// the CODE template + live DB KB/hours), so every call uses the latest source
// of truth — change the template or any DB value and the next call reflects it,
// for every tenant, with no per-tenant clone and no re-sync. metadata.tenant_id
// lets the n8n voice webhooks resolve the tenant (one engine serves all).
//
// The composed prompt is behavioural instructions, not a secret, so it is safe
// to hand to the browser; the real secrets (Supabase/OpenAI/Twilio keys) stay
// server-side in n8n. No auth: this only RETURNS config; the call itself is
// created client-side with the public key, exactly as before.

const ALLOW_ORIGINS = [
  "https://picnic-web-tau.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

async function handle(req: NextRequest, tenantId: string | null, tz?: string, locale?: string) {
  const cors = corsHeaders(req.headers.get("origin"));
  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant_id" }, { status: 400, headers: cors });
  }
  try {
    const dateVars = spelledDateVars(new Date(), tz, locale);
    const cfg = await buildTenantCallConfig(tenantId, dateVars);
    return NextResponse.json(cfg, { headers: cors });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    const status = /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status, headers: cors });
  }
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams;
  return handle(req, u.get("tenant_id"), u.get("tz") || undefined, u.get("locale") || undefined);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(req, body?.tenant_id ?? null, body?.tz, body?.locale);
}
