import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { encryptEmailSecret } from "@/lib/email/credentials";
import { getEmailUsageThisMonth } from "@/lib/email/usage";

// Settings → Email: the tenant's OWN Resend account (BYO key), mirroring
// /api/pos/connect. Optional by design — a tenant with no row here keeps sending
// on the platform's shared Resend account exactly as before.
//
//   GET    ?tenant_id=…                    → { connected, usage } — never the key
//   POST   { tenant_id, api_key, action? } → action 'test' validates only;
//                                            'save' (default) validates + stores
//   DELETE { tenant_id }                   → back to the shared pool
//
// The key is validated against Resend before it's stored: saving an unusable key
// would silently break every email for that tenant, and they'd find out from a
// guest who never got their confirmation.

const ROLES = ["owner", "manager", "marketing"] as const;

/** Cheapest authenticated Resend call: 200 lists the account's domains.
 *
 * A REJECTED key comes back 400 `{"name":"validation_error","message":"API key is
 * invalid"}` — NOT 401, which Resend reserves for a missing Authorization header
 * (verified against the live API). So a bad key must be recognised by the error
 * name, not the status: keying off 401 alone would tell someone who fat-fingered
 * their key to "try again later", and they'd keep retrying a key that will never
 * work. Anything else (5xx, rate limit) really is transient. */
async function validateResendKey(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: unknown[];
      name?: string;
      message?: string;
    };

    if (res.ok) {
      const domains = Array.isArray(json?.data) ? json.data.length : 0;
      return {
        ok: true,
        detail: domains
          ? `Chiave valida — ${domains} dominio${domains === 1 ? "" : "i"} configurato${domains === 1 ? "" : "i"}.`
          : "Chiave valida. Ricorda di verificare un dominio su Resend per inviare dal tuo indirizzo.",
      };
    }

    const rejected =
      res.status === 401 ||
      res.status === 403 ||
      json?.name === "validation_error" ||
      json?.name === "restricted_api_key" ||
      /api key/i.test(json?.message || "");
    if (rejected) {
      return { ok: false, detail: "Chiave rifiutata da Resend. Controlla di averla copiata per intero." };
    }
    return { ok: false, detail: `Resend ha risposto ${res.status}. Riprova tra poco.` };
  } catch {
    return { ok: false, detail: "Impossibile contattare Resend. Controlla la connessione e riprova." };
  }
}

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  if (!(await verifyTenantMembership(tenantId, [...ROLES]))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const svc = createServiceRoleClient();
  const usage = await getEmailUsageThisMonth(tenantId, svc);
  // `usage.ownKey` already decrypted the row to tell whose quota applies, so it
  // doubles as the connected flag — no second query, and no way for the two to
  // disagree (a stored-but-undecryptable key reads as NOT connected, which is
  // exactly how sends behave: they fall back to the shared pool).
  return NextResponse.json({ success: true, connected: usage.ownKey, usage });
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
  if (!apiKey) return NextResponse.json({ ok: false, error: "api_key required" }, { status: 400 });

  const test = await validateResendKey(apiKey);
  const action = body.action === "test" ? "test" : "save";
  if (!test.ok || action === "test") {
    return NextResponse.json({ ok: test.ok, test }, { status: 200 });
  }

  const svc = createServiceRoleClient();
  const { error } = await svc.from("email_secrets").upsert(
    {
      tenant_id: tenantId,
      provider: "resend",
      secret_enc: encryptEmailSecret({ api_key: apiKey }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, connected: true, test });
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
  const { error } = await svc.from("email_secrets").delete().eq("tenant_id", tenantId).eq("provider", "resend");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Sends fall straight back to the platform's shared key — nothing else to undo.
  return NextResponse.json({ ok: true, connected: false });
}
