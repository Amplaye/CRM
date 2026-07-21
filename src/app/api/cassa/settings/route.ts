import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess } from "@/lib/cassa/server";

// Cassa preferences — coperto + collegamento Registratore Telematico (RT).
//
// PATCH /api/cassa/settings { tenant_id, cover_charge? }              (owner/manager)
// PATCH /api/cassa/settings { tenant_id, fiscal_device: {...} }        (owner only)
//
// Writes settings.cassa on the tenant. New orders snapshot cover_charge as
// cover_unit at creation; bills already open keep the value they were born with.
// `fiscal_device` holds the RT LAN address + reparto map — non-secret config
// only (the RT is reached from the browser over the local network).

type FiscalDevicePatch = {
  enabled?: boolean;
  brand?: "epson" | "axon" | "generic";
  transport?: "lan_http" | "lan_ws";
  host?: string;
  tls?: boolean;
  vat_reparto_map?: Record<string, number>;
  lottery_enabled?: boolean;
};

function sanitizeFiscalDevice(raw: any): FiscalDevicePatch | NextResponse {
  const out: FiscalDevicePatch = {};
  out.enabled = !!raw?.enabled;
  const brand = raw?.brand;
  out.brand = ["epson", "axon", "generic"].includes(brand) ? brand : "epson";
  const transport = raw?.transport;
  out.transport = ["lan_http", "lan_ws"].includes(transport) ? transport : "lan_http";
  out.tls = !!raw?.tls;
  out.lottery_enabled = !!raw?.lottery_enabled;
  const host = typeof raw?.host === "string" ? raw.host.trim().slice(0, 120) : "";
  if (out.enabled && !host) {
    return NextResponse.json({ error: "fiscal_host_required" }, { status: 400 });
  }
  out.host = host;
  const map: Record<string, number> = {};
  if (raw?.vat_reparto_map && typeof raw.vat_reparto_map === "object") {
    for (const [k, v] of Object.entries(raw.vat_reparto_map)) {
      const rate = String(k).replace(/[^0-9]/g, "");
      const dept = Math.round(Number(v));
      if (rate && Number.isFinite(dept) && dept >= 1 && dept <= 99) map[rate] = dept;
    }
  }
  out.vat_reparto_map = map;
  return out;
}

export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const hasFiscal = body?.fiscal_device !== undefined;
  const hasCover = body?.cover_charge !== undefined;
  if (!hasFiscal && !hasCover) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  // Fiscal-device config is an owner-only setting; coperto is owner/manager.
  const roles: ("owner" | "manager")[] = hasFiscal ? ["owner"] : ["owner", "manager"];
  const access = await requireCassaAccess(body?.tenant_id, roles);
  if (!isAccess(access)) return access;
  const { svc } = access;

  let coverCharge: number | undefined;
  if (hasCover) {
    const raw = Number(body.cover_charge);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return NextResponse.json({ error: "invalid_cover_charge" }, { status: 400 });
    }
    coverCharge = Math.round(raw * 100) / 100;
  }

  let fiscalDevice: FiscalDevicePatch | undefined;
  if (hasFiscal) {
    const sanitized = sanitizeFiscalDevice(body.fiscal_device);
    if (sanitized instanceof NextResponse) return sanitized;
    fiscalDevice = sanitized;
  }

  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", body.tenant_id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  const settings = { ...(tenant.settings as Record<string, any> || {}) };
  const cassa = { ...(settings.cassa || {}) };
  if (coverCharge !== undefined) cassa.cover_charge = coverCharge;
  if (fiscalDevice !== undefined) cassa.fiscal_device = fiscalDevice;
  settings.cassa = cassa;

  const { error } = await svc.from("tenants").update({ settings }).eq("id", body.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cover_charge: coverCharge, fiscal_device: fiscalDevice });
}
