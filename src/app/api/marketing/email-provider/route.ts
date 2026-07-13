import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { encryptEmailSecret, readEmailSecret } from "@/lib/email/credentials";
import { getEmailUsageThisMonth } from "@/lib/email/usage";
import { defaultSenderAddress, senderOnVerifiedDomain, isEmailAddress, addressOf } from "@/lib/email/from";

// Settings → Email: the tenant's OWN Resend account, mirroring /api/pos/connect.
//
// NOT optional, and that is the whole design: without a key here the CRM sends
// this tenant NO email at all — no campaigns, no coupons, no gift cards, no
// confirmations. There is no shared platform plan to fall back on (owner
// decision). The only emails that still come from the platform are the ones that
// let an owner GET here in the first place: signup confirmation and password
// recovery, which are Supabase Auth's own project-wide SMTP.
//
//   GET    ?tenant_id=…  → { connected, from_address, usage } — never the key
//   POST   { tenant_id, api_key, from_address?, action? }
//            action 'test'   → validate the key, report its verified domains
//                   'save'   → validate + store key AND sender address
//                   'sender' → change ONLY the address, reusing the stored key
//   DELETE { tenant_id }  → disconnect: this tenant stops sending email entirely
//
// A key alone is useless, so a key alone is never stored. Resend refuses a From
// on a domain that account hasn't verified (403 "The <domain> domain is not
// verified"), so "connected" has to mean key + verified sender or it means
// nothing — the owner would see a green tick and every guest email would bounce.

const ROLES = ["owner", "manager", "marketing"] as const;

interface ResendDomain {
  name: string;
  status: string;
}

interface KeyCheck {
  ok: boolean;
  detail: string;
  /** Domains the key's account has DNS-verified — the only ones it can send from. */
  verified: string[];
  /** Domains added but not through DNS yet (pending/failed): worth naming, since
   *  "I added it on Resend" is the state an owner most often mistakes for done. */
  pending: string[];
}

/** Cheapest authenticated Resend call: 200 lists the account's domains — which
 * is also exactly what we need to pick a sender, so one round-trip answers both
 * "is this key real?" and "what can it send from?".
 *
 * A REJECTED key comes back 400 `{"name":"validation_error","message":"API key is
 * invalid"}` — NOT 401, which Resend reserves for a missing Authorization header
 * (verified against the live API). So a bad key must be recognised by the error
 * name, not the status: keying off 401 alone would tell someone who fat-fingered
 * their key to "try again later", and they'd keep retrying a key that will never
 * work. Anything else (5xx, rate limit) really is transient. */
async function checkResendKey(apiKey: string): Promise<KeyCheck> {
  const fail = (detail: string): KeyCheck => ({ ok: false, detail, verified: [], pending: [] });
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: ResendDomain[];
      name?: string;
      message?: string;
    };

    if (res.ok) {
      const domains = Array.isArray(json?.data) ? json.data : [];
      const verified = domains.filter((d) => d.status === "verified").map((d) => d.name);
      const pending = domains.filter((d) => d.status !== "verified").map((d) => d.name);
      return {
        ok: true,
        verified,
        pending,
        detail: verified.length
          ? `Chiave valida — dominio verificato: ${verified.join(", ")}.`
          : "Chiave valida, ma nessun dominio verificato su Resend: senza dominio verificato Resend rifiuta gli invii.",
      };
    }

    const rejected =
      res.status === 401 ||
      res.status === 403 ||
      json?.name === "validation_error" ||
      json?.name === "restricted_api_key" ||
      /api key/i.test(json?.message || "");
    if (rejected) return fail("Chiave rifiutata da Resend. Controlla di averla copiata per intero.");
    return fail(`Resend ha risposto ${res.status}. Riprova tra poco.`);
  } catch {
    return fail("Impossibile contattare Resend. Controlla la connessione e riprova.");
  }
}

/** Persist key + sender together — the only state in which this tenant can send. */
async function store(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
  apiKey: string,
  fromAddress: string,
): Promise<string | null> {
  const { error } = await svc.from("email_secrets").upsert(
    {
      tenant_id: tenantId,
      provider: "resend",
      secret_enc: encryptEmailSecret({ api_key: apiKey, from_address: fromAddress }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );
  return error ? error.message : null;
}

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  if (!(await verifyTenantMembership(tenantId, [...ROLES]))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const svc = createServiceRoleClient();
  const [usage, secret] = await Promise.all([
    getEmailUsageThisMonth(tenantId, svc),
    readEmailSecret(svc, tenantId),
  ]);
  // `usage.connected` already decrypted the row to decide whether this tenant can
  // send, so it IS the connected flag — no second source of truth to disagree with
  // it. A stored-but-undecryptable key reads as NOT connected, which is exactly how
  // sends behave: they don't happen.
  return NextResponse.json({
    success: true,
    connected: usage.connected,
    from_address: secret?.fromAddress || null,
    usage,
  });
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

  const action = body.action === "test" ? "test" : body.action === "sender" ? "sender" : "save";
  const svc = createServiceRoleClient();
  const requested = addressOf(String(body.from_address || "").trim()).toLowerCase();

  // 'sender' changes only the address, so the key comes from what's already stored
  // (we never send it back to the browser, so the browser can't return it to us).
  const apiKey =
    action === "sender"
      ? (await readEmailSecret(svc, tenantId))?.apiKey || ""
      : String(body.api_key || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: action === "sender" ? "not_connected" : "api_key required" },
      { status: 400 },
    );
  }

  // Always re-check against Resend: a saved address is only as good as the domain
  // still being verified in that account, and a key can be revoked at any time.
  const check = await checkResendKey(apiKey);
  if (!check.ok) return NextResponse.json({ ok: false, test: check }, { status: 200 });

  if (action === "test") {
    return NextResponse.json({
      ok: true,
      test: check,
      needs_domain: check.verified.length === 0,
      verified: check.verified,
      pending: check.pending,
      suggested_from: check.verified[0] ? defaultSenderAddress(check.verified[0]) : null,
    });
  }

  // A key with nothing verified behind it cannot send one single email, so it is
  // not saved: storing it would light up "collegato" while every guest email 403s.
  if (!check.verified.length) {
    return NextResponse.json({
      ok: false,
      needs_domain: true,
      test: check,
      verified: [],
      pending: check.pending,
    });
  }

  const fromAddress = requested || defaultSenderAddress(check.verified[0]);
  if (!isEmailAddress(fromAddress) || !senderOnVerifiedDomain(fromAddress, check.verified)) {
    return NextResponse.json({
      ok: false,
      invalid_sender: true,
      verified: check.verified,
      test: {
        ...check,
        ok: false,
        detail: `L'indirizzo mittente deve stare su un dominio verificato nel tuo account Resend (${check.verified.join(", ")}).`,
      },
    });
  }

  const err = await store(svc, tenantId, apiKey, fromAddress);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 });

  return NextResponse.json({
    ok: true,
    connected: true,
    from_address: fromAddress,
    verified: check.verified,
    test: { ...check, detail: `Collegato. Le email partiranno da ${fromAddress}.` },
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
  const { error } = await svc.from("email_secrets").delete().eq("tenant_id", tenantId).eq("provider", "resend");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Not a downgrade to some cheaper plan — this tenant now sends no email at all.
  return NextResponse.json({ ok: true, connected: false });
}
