import { NextRequest, NextResponse } from "next/server";
import { buildTenantCallConfig } from "@/lib/voice/engine";

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
  "https://picnic-8dn.pages.dev",
  "https://picnic-web-tau.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Cloudflare Pages mints a per-deployment preview subdomain
// (e.g. https://f1d7b3f3.picnic-8dn.pages.dev) that serves the same widget.
// Allow the production host in the list above plus any *.picnic-8dn.pages.dev
// preview, so a fresh deploy never breaks the call button via CORS.
function isAllowedOrigin(origin: string): boolean {
  if (ALLOW_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "picnic-8dn.pages.dev" || host.endsWith(".picnic-8dn.pages.dev");
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && isAllowedOrigin(origin) ? origin : ALLOW_ORIGINS[0];
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

async function handle(req: NextRequest, tenantId: string | null) {
  const cors = corsHeaders(req.headers.get("origin"));
  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant_id" }, { status: 400, headers: cors });
  }
  try {
    // Date vars are derived from the tenant's own tz/locale inside the engine.
    const cfg = await buildTenantCallConfig(tenantId);
    return NextResponse.json(cfg, { headers: cors });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    const status = /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status, headers: cors });
  }
}

export async function GET(req: NextRequest) {
  return handle(req, req.nextUrl.searchParams.get("tenant_id"));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(req, body?.tenant_id ?? null);
}
