// Live smoke-test for the Loyverse adapter against the REAL Loyverse API.
// Proves the first real till end-to-end: token auth → catalogue → sales, with
// the same adapter the sync orchestrator uses in production. No DB writes — it
// only READS from Loyverse and prints a human-readable summary, so it's safe to
// run against a live merchant account.
//
// Get a token: Loyverse Back Office → Settings → Access tokens → + Add → copy.
// (Instant, no approval. A free Loyverse account is enough to test.)
//
// Usage:
//   LOYVERSE_TOKEN=xxxxxxxx npx tsx scripts/loyverse-live-test.ts
//   LOYVERSE_TOKEN=xxxxxxxx LOYVERSE_DAYS=7 npx tsx scripts/loyverse-live-test.ts
//
// Exit code 0 on success, 1 on any failure (so it can gate CI later).

import { loyverseAdapter } from "../src/lib/pos/adapters/loyverse";
import type { AdapterContext } from "../src/lib/pos/types";

async function main() {
  const token = process.env.LOYVERSE_TOKEN?.trim();
  if (!token) {
    console.error("✗ Set LOYVERSE_TOKEN (Back Office → Settings → Access tokens).");
    process.exit(1);
  }
  const days = Number(process.env.LOYVERSE_DAYS || 30);
  const storeId = process.env.LOYVERSE_STORE_ID?.trim() || undefined;

  const ctx: AdapterContext = {
    tenantId: "live-test",
    credentials: { access_token: token },
    config: { currency: "EUR", ...(storeId ? { store_id: storeId } : {}) },
  };

  // Window: last N days up to now. ISO 8601, which is what Loyverse expects for
  // created_at_min/max. We compute the boundary from a passed-in "now" so the
  // script has no hidden clock dependency in its core logic.
  const now = new Date();
  const until = now.toISOString();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  console.log(`\n🔌 Loyverse live test — window ${since.slice(0, 10)} → ${until.slice(0, 10)} (${days}d)\n`);

  // 1) testConnection -------------------------------------------------------
  try {
    const conn = await loyverseAdapter.testConnection(ctx);
    console.log(`✓ testConnection: ${conn.detail || "ok"}`);
  } catch (e: any) {
    console.error(`✗ testConnection failed: ${e?.message || e}`);
    process.exit(1);
  }

  // 2) fetchProducts --------------------------------------------------------
  let productCount = 0;
  try {
    const products = await loyverseAdapter.fetchProducts(ctx);
    productCount = products.length;
    console.log(`✓ fetchProducts: ${products.length} products`);
    for (const p of products.slice(0, 5)) {
      console.log(`    • ${p.name}${p.category ? ` [${p.category}]` : ""} — ${p.price != null ? `€${p.price}` : "no price"}  (id ${p.externalProductId})`);
    }
    if (products.length > 5) console.log(`    … +${products.length - 5} more`);
  } catch (e: any) {
    console.error(`✗ fetchProducts failed: ${e?.message || e}`);
    process.exit(1);
  }

  // 3) fetchSales -----------------------------------------------------------
  try {
    const sales = await loyverseAdapter.fetchSales(ctx, { since, until });
    const gross = sales.reduce((s, x) => s + x.grossTotal, 0);
    const byChannel = sales.reduce<Record<string, number>>((acc, s) => {
      acc[s.channel] = (acc[s.channel] || 0) + 1;
      return acc;
    }, {});
    console.log(`✓ fetchSales: ${sales.length} receipts, gross €${Math.round(gross * 100) / 100}`);
    console.log(`    channels: ${Object.entries(byChannel).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
    for (const s of sales.slice(0, 3)) {
      console.log(`    • ${s.businessDate} ${s.externalId} — €${s.grossTotal} (${s.channel}, ${s.paymentMethod || "?"}, ${s.items.length} lines)`);
    }
    if (sales.length === 0) {
      console.log("    ⚠ No receipts in this window. If the account is new/empty, ring up a test sale in the Loyverse app and re-run, or widen LOYVERSE_DAYS.");
    }

    // Sanity assertions on the canonical contract (cheap, catches mapping drift).
    for (const s of sales) {
      const lineSum = Math.round(s.items.reduce((a, it) => a + it.grossTotal, 0) * 100) / 100;
      if (s.items.length > 0 && Math.abs(lineSum - s.grossTotal) > Math.max(0.05, s.grossTotal * 0.02)) {
        console.warn(`    ⚠ receipt ${s.externalId}: line sum €${lineSum} ≠ gross €${s.grossTotal} (discount/rounding?)`);
      }
      if (!["sala", "asporto", "delivery"].includes(s.channel)) {
        throw new Error(`receipt ${s.externalId}: invalid channel ${s.channel}`);
      }
    }
  } catch (e: any) {
    console.error(`✗ fetchSales failed: ${e?.message || e}`);
    process.exit(1);
  }

  console.log(`\n✅ Loyverse adapter works against the live API (products: ${productCount}).\n`);
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
