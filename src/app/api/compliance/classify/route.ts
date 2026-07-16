import { NextRequest, NextResponse } from "next/server";
import { resolveTenantFromApiKey } from "@/lib/tenant-auth";
import { classifyText } from "@/lib/compliance/classifier";
import { apiError } from "@/lib/api-error";

// Bot-facing (n8n / Retell): classify an inbound guest message as Tier 0 (ordinary)
// or Tier 1 (sensitive) so the agent knows whether to fold in the just-in-time
// micro-consent before storing it. Authenticated with the tenant's Bearer API key
// (same scheme as the other bot endpoints); the classification itself is pure, but
// we gate it so only our own agents can call it.
//
// POST { text } → { tier, categories, matches, needsConsent }
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const tenantId = token ? await resolveTenantFromApiKey(token) : null;
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const text: string = typeof body.text === "string" ? body.text : "";
    const result = classifyText(text);
    return NextResponse.json({ ...result, needsConsent: result.tier === 1 });
  } catch (err: any) {
    return apiError(err, { route: "compliance/classify", publicMessage: "operation_failed", status: 500 });
  }
}
