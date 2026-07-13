import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { encryptEmailSecret, readEmailSecret } from "@/lib/email/credentials";
import { getEmailUsageThisMonth } from "@/lib/email/usage";
import { defaultSenderAddress, senderOnVerifiedDomain, isEmailAddress, addressOf, domainOf } from "@/lib/email/from";

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
  /** false → a "Sending access" key: valid, but Resend won't let it read the
   *  account's domains, so we can't discover the sender for the owner. */
  canListDomains: boolean;
  /** Domains the key's account has DNS-verified — the only ones it can send from.
   *  Always empty for a sending-only key (we're not allowed to look). */
  verified: string[];
  /** Domains added but not through DNS yet (pending/failed): worth naming, since
   *  "I added it on Resend" is the state an owner most often mistakes for done. */
  pending: string[];
}

/** Cheapest authenticated Resend call: 200 lists the account's domains — which is
 * also exactly what we need to pick a sender, so one round-trip answers both "is
 * this key real?" and "what can it send from?".
 *
 * Three distinct answers hide in the error bodies, and conflating any two of them
 * hands the owner a lie (all reproduced against the live API):
 *
 *   400 validation_error  "API key is invalid"                    → really rejected
 *   401 restricted_api_key "restricted to only send emails"       → PERFECTLY VALID,
 *        it's a Resend key created with "Sending access" instead of "Full access".
 *        It cannot read domains, but it can send — which is the only thing we
 *        actually need it for. Treating this 401 as a bad key is what made a
 *        correct key come back "Chiave rifiutata, controlla di averla copiata".
 *   anything else (5xx, rate limit)                               → transient
 *
 * Note the rejected case is a 400, NOT a 401: Resend reserves 401 for a missing
 * or restricted Authorization. So a bad key must be recognised by its error name,
 * never by the status alone. */
async function checkResendKey(apiKey: string): Promise<KeyCheck> {
  const fail = (detail: string): KeyCheck => ({
    ok: false,
    detail,
    canListDomains: false,
    verified: [],
    pending: [],
  });
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
        canListDomains: true,
        verified,
        pending,
        detail: verified.length
          ? `Chiave valida — dominio verificato: ${verified.join(", ")}.`
          : "Chiave valida, ma nessun dominio verificato su Resend: senza dominio verificato Resend rifiuta gli invii.",
      };
    }

    if (json?.name === "restricted_api_key") {
      return {
        ok: true,
        canListDomains: false,
        verified: [],
        pending: [],
        detail: "Chiave valida (tipo “Sending access”): può inviare, ma non ci lascia leggere i tuoi domini.",
      };
    }

    const rejected = json?.name === "validation_error" || /api key/i.test(json?.message || "");
    if (rejected) return fail("Chiave rifiutata da Resend. Controlla di averla copiata per intero.");
    return fail(`Resend ha risposto ${res.status}. Riprova tra poco.`);
  } catch {
    return fail("Impossibile contattare Resend. Controlla la connessione e riprova.");
  }
}

/** For a sending-only key the domain list is off-limits, so the only way to know
 * whether an address is sendable is to ask Resend to send from it. We do exactly
 * that: one real email to the owner's own inbox. It doubles as proof the whole
 * chain works, which is strictly better than saving an address and finding out
 * from a guest who never got their confirmation.
 *
 * The 403 we're looking for is the same one the platform's own domain earns in a
 * tenant's account: `The <domain> domain is not verified`. */
async function probeSender(
  apiKey: string,
  fromAddress: string,
  tenantName: string,
  to: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${tenantName || "CRM"} <${fromAddress}>`,
        to: [to],
        subject: "Email collegata correttamente",
        html: `<p>Il tuo account Resend è collegato al CRM. Le email partiranno da <strong>${fromAddress}</strong>.</p>`,
      }),
    });
    if (res.ok) return { ok: true, detail: `Collegato: ti abbiamo mandato un'email di prova a ${to}.` };

    const json = (await res.json().catch(() => ({}))) as { message?: string };
    const msg = json?.message || `Resend ha risposto ${res.status}.`;
    if (/not verified/i.test(msg)) {
      return {
        ok: false,
        detail: `Il dominio di ${fromAddress} non è verificato nel tuo account Resend. Aggiungilo su resend.com/domains, metti i record DNS e riprova.`,
      };
    }
    return { ok: false, detail: msg };
  } catch {
    return { ok: false, detail: "Impossibile contattare Resend. Riprova tra poco." };
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
  const member = await verifyTenantMembership(tenantId, [...ROLES]);
  if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
      can_list_domains: check.canListDomains,
      needs_domain: check.canListDomains && check.verified.length === 0,
      needs_sender: !check.canListDomains && !requested,
      verified: check.verified,
      pending: check.pending,
      suggested_from: check.verified[0] ? defaultSenderAddress(check.verified[0]) : null,
    });
  }

  // ── Full-access key: the domain list IS the answer. ────────────────────────
  if (check.canListDomains) {
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

  // ── "Sending access" key: the domain list is off-limits. ───────────────────
  // We can't discover the sender, so the owner types it and Resend itself settles
  // the argument — one real email to the owner's own inbox. Saving an unproven
  // address would mean finding out it's wrong from a guest who never got their
  // confirmation, which is exactly the failure this whole feature exists to avoid.
  if (!requested || !isEmailAddress(requested)) {
    return NextResponse.json({
      ok: false,
      needs_sender: true,
      test: {
        ...check,
        ok: false,
        detail:
          "Con una chiave “Sending access” non possiamo leggere i tuoi domini: scrivi qui sotto l'indirizzo mittente (es. noreply@iltuodominio.com).",
      },
    });
  }

  // resend.dev is Resend's sandbox: it sends ONLY to the account owner's own
  // address. The probe below would pass (we mail the owner!) and we'd save a
  // "connected" tenant that can't reach a single guest — the exact green-tick lie
  // this route exists to prevent.
  if (domainOf(requested) === "resend.dev") {
    return NextResponse.json({
      ok: false,
      invalid_sender: true,
      test: {
        ...check,
        ok: false,
        detail:
          "resend.dev è l'indirizzo di prova di Resend: raggiunge solo te, non i tuoi clienti. Verifica il tuo dominio su resend.com/domains e usa un indirizzo su quel dominio.",
      },
    });
  }

  const [{ data: tenant }, { data: authUser }] = await Promise.all([
    svc.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    svc.auth.admin.getUserById(member.userId),
  ]);
  const ownerEmail = authUser?.user?.email || "";
  if (!ownerEmail) {
    return NextResponse.json({
      ok: false,
      test: { ...check, ok: false, detail: "Non riusciamo a leggere la tua email per l'invio di prova." },
    });
  }

  const probe = await probeSender(apiKey, requested, tenant?.name || "", ownerEmail);
  if (!probe.ok) {
    return NextResponse.json({
      ok: false,
      invalid_sender: true,
      test: { ...check, ok: false, detail: probe.detail },
    });
  }

  const err = await store(svc, tenantId, apiKey, requested);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 });

  return NextResponse.json({
    ok: true,
    connected: true,
    from_address: requested,
    test: { ...check, detail: probe.detail },
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
