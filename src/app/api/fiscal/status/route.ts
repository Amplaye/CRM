import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess } from "@/lib/cassa/server";
import { getFiscalContext } from "@/lib/fiscal/server";
import { pendingCount } from "@/lib/fiscal/queue";

// GET /api/fiscal/status?tenant_id=… — everything the till and Settings → Fiscale
// need to know about this tenant's fiscal posture, in one call.
//
// The pending count is here because the law requires it to be VISIBLE to the user:
// a venue must be able to see, at a glance, that it owes the Agencia Tributaria N
// records. It drives the badge in the cassa.
//
// Note what is NOT returned: nothing from `fiscal_obligados` beyond the NIF and the
// mode. The mandate evidence stays server-side (that table has no member RLS policy
// on purpose — same reason as pos_credentials).

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id") || undefined;

  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const ctx = await getFiscalContext(svc, tenantId!);
  const pending = ctx.mode === "off" ? 0 : await pendingCount(svc, tenantId!);

  return NextResponse.json({
    // `off` → the till behaves exactly as it always has (Italy, or not yet onboarded).
    mode: ctx.mode,
    register: ctx.register,
    nif: ctx.nif,
    regime: {
      key: ctx.regime.regimen,
      label: ctx.regime.label,
      impuesto: ctx.regime.impuesto,
      rates: ctx.regime.rates,
      defaultRate: ctx.regime.defaultRate,
      coverRate: ctx.regime.coverRate,
    },
    serie: ctx.serie,
    pending,
  });
}
