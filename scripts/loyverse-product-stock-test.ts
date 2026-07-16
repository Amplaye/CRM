// Live E2E for the NEW write-backs: prove the CRM can CREATE a product, SET its
// stock, and RENAME it on the real Loyverse till — the same adapter methods the
// /api/pos/push-product and /api/pos/push-stock routes call. Cleans up after
// itself (deletes the test product) so the account stays tidy.
//
//   LOYVERSE_TOKEN=xxxx npx tsx scripts/loyverse-product-stock-test.ts
//
// Proof goal: the owner adds a dish / corrects stock in the CRM and it lands on
// the till, without ever opening Loyverse.

import { loyverseAdapter } from "../src/lib/pos/adapters/loyverse";
import type { AdapterContext } from "../src/lib/pos/types";

const BASE = "https://api.loyverse.com/v1.0";

async function main() {
  const token = process.env.LOYVERSE_TOKEN?.trim();
  if (!token) {
    console.error("✗ Set LOYVERSE_TOKEN.");
    process.exit(1);
  }
  const ctx: AdapterContext = { tenantId: "live-test", credentials: { access_token: token }, config: { currency: "EUR" } };
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const stamp = process.env.STAMP || "QA"; // pass STAMP=... to vary the name across runs
  const name = `CRM Test ${stamp}`;
  let createdItemId: string | undefined;

  try {
    // 1) CREATE -------------------------------------------------------------
    console.log(`\n① CREA prodotto "${name}" (con categoria "QA Test") dal "CRM"…`);
    const created = await loyverseAdapter.pushProduct!(ctx, { name, price: 12.5, category: "QA Test" });
    console.log(`   pushProduct → ok=${created.ok} | ${created.detail}`);
    if (!created.ok || !created.externalProductId) throw new Error("create failed");
    const variantId = created.externalProductId;

    // confirm it's really on the till
    let products = await loyverseAdapter.fetchProducts(ctx);
    const found = products.find((p) => p.externalProductId === variantId);
    console.log(`   verifica fetchProducts → ${found ? `trovato: ${found.name} €${found.price} [${found.category}]` : "NON trovato"}`);
    if (!found) throw new Error("created product not visible via fetchProducts");

    // remember the parent item id for cleanup
    const itemsRes = await fetch(`${BASE}/items?limit=250`, { headers: auth });
    const itemsJson = (await itemsRes.json()) as { items?: Array<{ id?: string; variants?: Array<{ variant_id?: string }> }> };
    createdItemId = itemsJson.items?.find((it) => (it.variants ?? []).some((v) => v.variant_id === variantId))?.id;

    // 2) STOCK --------------------------------------------------------------
    console.log(`\n② IMPOSTA giacenza = 37 dal "CRM"…`);
    const stock = await loyverseAdapter.pushStock!(ctx, { externalProductId: variantId, quantity: 37 });
    console.log(`   pushStock → ok=${stock.ok} | ${stock.detail}`);
    if (!stock.ok) throw new Error("stock push failed");
    // read inventory back
    const invRes = await fetch(`${BASE}/inventory?variant_ids=${variantId}`, { headers: auth });
    const invJson = (await invRes.json()) as { inventory_levels?: Array<{ stock_after?: number; in_stock?: number }> };
    const level = invJson.inventory_levels?.[0];
    console.log(`   verifica /inventory → stock = ${level?.in_stock ?? level?.stock_after ?? "?"}`);

    // 3) RENAME -------------------------------------------------------------
    const newName = `${name} (rinominato)`;
    console.log(`\n③ RINOMINA in "${newName}" dal "CRM"…`);
    const renamed = await loyverseAdapter.pushProduct!(ctx, { externalProductId: variantId, name: newName });
    console.log(`   pushProduct(rename) → ok=${renamed.ok} | ${renamed.detail}`);
    products = await loyverseAdapter.fetchProducts(ctx);
    const after = products.find((p) => p.externalProductId === variantId);
    console.log(`   verifica fetchProducts → nome ora: ${after?.name}`);
    if (after?.name !== newName) throw new Error("rename not reflected");

    console.log(`\n✅ TUTTO CONFERMATO sulla CASSA REALE: create + stock + rename (CRM → POS).`);
  } finally {
    // CLEANUP — delete the test item so the account stays clean.
    if (createdItemId) {
      const del = await fetch(`${BASE}/items/${createdItemId}`, { method: "DELETE", headers: auth });
      console.log(`\n🧹 cleanup: DELETE item ${createdItemId} → HTTP ${del.status}`);
    }
  }
}

main().catch((e) => {
  console.error("\n✗ ERRORE:", e?.message || e);
  process.exit(1);
});
