import { NextResponse } from "next/server";
import { authorizeTenant, resolveTill } from "@/lib/pos/write-back";

// List the connected till's products, so the CRM can offer them as link targets
// (e.g. linking a warehouse ingredient like "Vino della casa" to its sellable
// till product to sync stock). User-authenticated + ownership-checked.
//
// GET /api/pos/products?tenant_id=...  → { provider, products: [{ externalProductId, name, category, price }] }
// Returns an empty list (not an error) when the tenant is on mock / not connected,
// so the UI can simply show "no products to link".
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id") || undefined;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  const till = await resolveTill(auth.svc, tenantId);
  if (!till.ctx) return NextResponse.json({ provider: till.provider, products: [] });
  try {
    const products = await till.adapter.fetchProducts(till.ctx);
    return NextResponse.json({ provider: till.provider, products });
  } catch (e: any) {
    return NextResponse.json({ provider: till.provider, products: [], error: e?.message || String(e) });
  }
}
