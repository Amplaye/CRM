import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess } from "@/lib/cassa/server";
import { normalizeNif } from "@/lib/fiscal/huella";
import { REGIMES, type FiscalRegimen } from "@/lib/fiscal/regions";
import { logAuditEvent } from "@/lib/audit";

// The fiscal identity of a tenant — Settings → Fiscale. Owner/manager only.
//
// GET  /api/fiscal/obligado?tenant_id=…
// PUT  /api/fiscal/obligado   { tenant_id, nif, razon_social, domicilio, regimen, sif_mode, serie }
//
// WHY THIS IS AN API AND NOT A FIELD IN tenants.settings
// The Features tab writes settings straight from the browser. That is fine for
// "we have a terrace". It is not fine for the NIF we file tax records under, nor
// for `sif_mode` — the flag that decides whether this till is legally allowed to
// take money. A client who could PATCH their own settings could declare themselves
// compliant. So the fiscal identity lives in its own table, with no member RLS
// policy, reachable only through this route.
//
// THE CHAIN IS PER NIF. Two venues of the same company share one obligado and one
// hash chain (art. 2 Orden HAC/1177/2024 — the software must behave as N logically
// independent SIF, one per obligado, not one per venue). So a NIF that already
// exists is JOINED, never duplicated; and when venues share it, each needs its own
// `serie` prefix or their invoice numbers would collide inside the shared chain.

const MODES = ["native", "external", "none"] as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id") || undefined;

  const access = await requireCassaAccess(tenantId, ["owner", "manager"]);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const { data: tenant } = await svc
    .from("tenants")
    .select("fiscal_serie, fiscal_obligado_id, fiscal_obligados(id, nif, razon_social, domicilio, regimen, sif_mode, mandate_signed_at, verifacti_nif_id)")
    .eq("id", tenantId!)
    .maybeSingle();

  const obligado = (tenant as any)?.fiscal_obligados ?? null;

  // How many records this chain holds, and how many still owe AEAT — the two
  // numbers an owner actually wants to see on this screen.
  let chain: { records: number; pending: number } = { records: 0, pending: 0 };
  if (obligado?.id) {
    const [{ data: head }, { count: pending }] = await Promise.all([
      svc.from("fiscal_chain_heads").select("record_count").eq("obligado_id", obligado.id).maybeSingle(),
      svc
        .from("fiscal_submissions")
        .select("id", { count: "exact", head: true })
        .eq("obligado_id", obligado.id)
        .in("status", ["pending", "sent"]),
    ]);
    chain = { records: Number(head?.record_count) || 0, pending: pending || 0 };
  }

  return NextResponse.json({
    obligado: obligado
      ? {
          id: obligado.id,
          nif: obligado.nif,
          razon_social: obligado.razon_social,
          domicilio: obligado.domicilio,
          regimen: obligado.regimen,
          sif_mode: obligado.sif_mode,
          mandate_signed: Boolean(obligado.mandate_signed_at),
          transport_linked: Boolean(obligado.verifacti_nif_id),
        }
      : null,
    serie: (tenant as any)?.fiscal_serie || "",
    chain,
    regimes: Object.values(REGIMES)
      .filter((r) => r.verifactu)
      .map((r) => ({ key: r.regimen, label: r.label, impuesto: r.impuesto, rates: r.rates })),
  });
}

export async function PUT(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const access = await requireCassaAccess(tenantId, ["owner", "manager"]);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  const nif = normalizeNif(body?.nif);
  if (!nif) return NextResponse.json({ error: "nif_required" }, { status: 400 });

  const regimen: FiscalRegimen = REGIMES[body?.regimen as FiscalRegimen]?.verifactu
    ? (body.regimen as FiscalRegimen)
    : "iva_peninsular";
  const sifMode = MODES.includes(body?.sif_mode) ? body.sif_mode : "none";
  const serie = typeof body?.serie === "string" ? body.serie.trim().slice(0, 12) : "";

  // Join the existing chain for this NIF if there is one — never open a second.
  const { data: existing } = await svc
    .from("fiscal_obligados")
    .select("id")
    .eq("nif", nif)
    .maybeSingle();

  let obligadoId: string;
  if (existing) {
    const { error } = await svc
      .from("fiscal_obligados")
      .update({
        razon_social: String(body?.razon_social || "").slice(0, 200),
        domicilio: body?.domicilio || {},
        regimen,
        sif_mode: sifMode,
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    obligadoId = existing.id;
  } else {
    const { data: created, error } = await svc
      .from("fiscal_obligados")
      .insert({
        nif,
        razon_social: String(body?.razon_social || "").slice(0, 200),
        domicilio: body?.domicilio || {},
        regimen,
        sif_mode: sifMode,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    obligadoId = created.id;
  }

  // A tenant sits on exactly ONE chain. Moving it is refused once it has issued:
  // its past records are chained under the old NIF and cannot be re-parented — the
  // hashes would stop verifying, which is precisely what they exist to prevent.
  const { data: current } = await svc
    .from("tenants")
    .select("fiscal_obligado_id")
    .eq("id", tenantId!)
    .maybeSingle();

  if (current?.fiscal_obligado_id && current.fiscal_obligado_id !== obligadoId) {
    const { count } = await svc
      .from("fiscal_records")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId!);
    if ((count || 0) > 0) {
      return NextResponse.json(
        {
          error: "chain_already_started",
          detail: "Questo locale ha già emesso registri sotto un altro NIF: la catena non si può ri-assegnare.",
        },
        { status: 409 },
      );
    }
  }

  const { error: linkErr } = await svc
    .from("tenants")
    .update({ fiscal_obligado_id: obligadoId, fiscal_serie: serie })
    .eq("id", tenantId!);
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  await logAuditEvent({
    tenant_id: tenantId!,
    action: "fiscal.obligado.update",
    entity_id: obligadoId,
    source: "staff",
    details: { nif, regimen, sif_mode: sifMode, serie, by: userId },
  });

  return NextResponse.json({ ok: true, obligado_id: obligadoId });
}
