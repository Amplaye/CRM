// Live write-back test: prove the CRM → POS direction. Uses the SAME adapter the
// /api/pos/push-price route calls. Reads the current price of a product from
// Loyverse, pushes a new one via the adapter, then re-reads to confirm the till
// actually changed. This is the proof that the owner can change a price in the
// CRM without ever opening the POS.
//
// Usage:
//   LOYVERSE_TOKEN=xxxx npx tsx scripts/loyverse-writeback-test.ts            # toggles Margherita 7↔8.5
//   LOYVERSE_TOKEN=xxxx npx tsx scripts/loyverse-writeback-test.ts <variantId> <newPrice>

import { loyverseAdapter } from "../src/lib/pos/adapters/loyverse";
import type { AdapterContext } from "../src/lib/pos/types";

async function main() {
  const token = process.env.LOYVERSE_TOKEN?.trim();
  if (!token) { console.error("✗ Set LOYVERSE_TOKEN."); process.exit(1); }
  const ctx: AdapterContext = { tenantId: "live-test", credentials: { access_token: token }, config: { currency: "EUR" } };

  // Resolve which product to retarget.
  let variantId = process.argv[2];
  let newPrice = process.argv[3] ? Number(process.argv[3]) : undefined;

  const products = await loyverseAdapter.fetchProducts(ctx);
  if (products.length === 0) { console.error("✗ No products on the account — run loyverse-live-test seeding first."); process.exit(1); }

  if (!variantId) {
    const marg = products.find((p) => /margherita/i.test(p.name)) || products[0];
    variantId = marg.externalProductId;
    // toggle 7 ↔ 8.5 based on current price so re-runs visibly change something
    newPrice = (marg.price ?? 7) === 7 ? 8.5 : 7;
  }
  if (newPrice == null || !Number.isFinite(newPrice)) { console.error("✗ Invalid price."); process.exit(1); }

  const before = products.find((p) => p.externalProductId === variantId);
  console.log(`\n🎯 Target: ${before?.name || variantId}`);
  console.log(`   Prezzo PRIMA su Loyverse: €${before?.price ?? "?"}`);
  console.log(`   → invio nuovo prezzo dal "CRM": €${newPrice}\n`);

  if (typeof loyverseAdapter.pushProductPrice !== "function") {
    console.error("✗ Adapter has no pushProductPrice."); process.exit(1);
  }
  const res = await loyverseAdapter.pushProductPrice(ctx, { externalProductId: variantId, price: newPrice });
  console.log(`   pushProductPrice → ok=${res.ok} | ${res.detail}`);
  if (!res.ok) process.exit(1);

  // Re-read straight from the API to confirm the till actually changed.
  const after = (await loyverseAdapter.fetchProducts(ctx)).find((p) => p.externalProductId === variantId);
  console.log(`\n   Prezzo DOPO su Loyverse: €${after?.price ?? "?"}`);
  if (after?.price === Math.round(newPrice * 100) / 100) {
    console.log(`\n✅ Confermato: il prezzo è cambiato sulla CASSA REALE (CRM → POS funziona).\n`);
  } else {
    console.log(`\n⚠ Il prezzo riletto (${after?.price}) non combacia con ${newPrice}. Controlla.\n`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("Unexpected error:", e); process.exit(1); });
