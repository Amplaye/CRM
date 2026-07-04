import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess } from "@/lib/cassa/server";

// Cassa preferences — today just the coperto.
//
// PATCH /api/cassa/settings { tenant_id, cover_charge }   (owner/manager)
//
// Writes settings.cassa.cover_charge on the tenant. New orders snapshot it as
// cover_unit at creation; bills already open keep the value they were born with.

export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const access = await requireCassaAccess(body?.tenant_id, ["owner", "manager"]);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const raw = Number(body?.cover_charge);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    return NextResponse.json({ error: "invalid_cover_charge" }, { status: 400 });
  }
  const coverCharge = Math.round(raw * 100) / 100;

  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", body.tenant_id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  const settings = { ...(tenant.settings as Record<string, any> || {}) };
  settings.cassa = { ...(settings.cassa || {}), cover_charge: coverCharge };

  const { error } = await svc.from("tenants").update({ settings }).eq("id", body.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cover_charge: coverCharge });
}
