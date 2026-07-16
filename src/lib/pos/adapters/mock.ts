// MockAdapter — the only adapter that produces data today. It generates
// DETERMINISTIC fake sales: the same (tenantId, businessDate) always yields the
// exact same sales, so re-running the sync upserts identical rows and never
// duplicates (the (tenant,provider,external_id) unique key holds). That
// determinism is also what makes the seed verifiable ("yesterday vs last
// Saturday" has a known answer).
//
// Shape: ~40–90 bills/day with lunch + dinner peaks, weekends ×1.6; channel mix
// ~70% sala / 20% asporto / 10% delivery (delivery carries a 25–30% aggregator
// fee and a channelSource); a fixed Italian dish catalogue; IVA 10%/22%;
// realistic payment mix. fetchProducts() returns that same catalogue.

import type {
  AdapterContext,
  CanonicalProduct,
  CanonicalSale,
  CanonicalSaleItem,
  FetchSalesParams,
  PosAdapter,
  PosChannel,
  PosPaymentMethod,
} from "@/lib/pos/types";

// ---- deterministic PRNG -----------------------------------------------------
// FNV-1a string hash → 32-bit seed, fed to mulberry32. Pure, no Math.random,
// so a given seed string is fully reproducible across machines and re-syncs.
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- fixed catalogue --------------------------------------------------------
interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  taxRate: number; // 10 (food on-site) / 22 (alcohol/some drinks)
}

export const MOCK_CATALOG: CatalogProduct[] = [
  { id: "mock-margherita", name: "Pizza Margherita", category: "Pizze", price: 7.0, taxRate: 10 },
  { id: "mock-diavola", name: "Pizza Diavola", category: "Pizze", price: 9.0, taxRate: 10 },
  { id: "mock-carbonara", name: "Spaghetti Carbonara", category: "Primi", price: 12.0, taxRate: 10 },
  { id: "mock-amatriciana", name: "Bucatini all'Amatriciana", category: "Primi", price: 11.0, taxRate: 10 },
  { id: "mock-lasagna", name: "Lasagna al Forno", category: "Primi", price: 13.0, taxRate: 10 },
  { id: "mock-tagliata", name: "Tagliata di Manzo", category: "Secondi", price: 18.0, taxRate: 10 },
  { id: "mock-cotoletta", name: "Cotoletta alla Milanese", category: "Secondi", price: 16.0, taxRate: 10 },
  { id: "mock-caprese", name: "Insalata Caprese", category: "Antipasti", price: 8.0, taxRate: 10 },
  { id: "mock-bruschette", name: "Bruschette Miste", category: "Antipasti", price: 6.0, taxRate: 10 },
  { id: "mock-tiramisu", name: "Tiramisù", category: "Dolci", price: 6.0, taxRate: 10 },
  { id: "mock-pannacotta", name: "Panna Cotta", category: "Dolci", price: 5.0, taxRate: 10 },
  { id: "mock-acqua", name: "Acqua Minerale", category: "Bevande", price: 2.5, taxRate: 22 },
  { id: "mock-vino-rosso", name: "Calice Vino Rosso", category: "Bevande", price: 5.0, taxRate: 22 },
  { id: "mock-birra", name: "Birra Media", category: "Bevande", price: 5.0, taxRate: 22 },
  { id: "mock-caffe", name: "Caffè", category: "Bevande", price: 1.5, taxRate: 22 },
];

const PAYMENTS: PosPaymentMethod[] = ["card", "card", "cash", "card", "online", "meal_voucher"];
const DELIVERY_SOURCES = ["glovo", "justeat", "deliveroo", "ubereats"];

// ---- date helpers (UTC-stable to keep determinism off the host TZ) -----------
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function* eachDate(sinceISO: string, untilISO: string): Generator<string> {
  const start = new Date(sinceISO.slice(0, 10) + "T00:00:00Z");
  const end = new Date(untilISO.slice(0, 10) + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield isoDate(d);
  }
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function intBetween(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Generate the deterministic set of sales for one business date. */
function salesForDate(tenantId: string, date: string): CanonicalSale[] {
  const rng = mulberry32(hashSeed(`${tenantId}|${date}`));
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0 Sun … 6 Sat
  const weekend = dow === 5 || dow === 6 || dow === 0;
  const base = intBetween(rng, 40, 90);
  const count = Math.round(base * (weekend ? 1.6 : 1.0));

  const sales: CanonicalSale[] = [];
  for (let i = 0; i < count; i++) {
    // lunch (12–15) vs dinner (19–23) peak; ~45% lunch.
    const lunch = rng() < 0.45;
    const hour = lunch ? intBetween(rng, 12, 14) : intBetween(rng, 19, 22);
    const minute = intBetween(rng, 0, 59);
    const closedAt = `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;

    // channel mix 70/20/10
    const r = rng();
    const channel: PosChannel = r < 0.7 ? "sala" : r < 0.9 ? "asporto" : "delivery";
    const channelSource = channel === "delivery" ? pick(rng, DELIVERY_SOURCES) : null;
    const covers = channel === "sala" ? intBetween(rng, 1, 5) : null;

    // 1–4 distinct dishes per bill, qty 1–3 each
    const lineCount = intBetween(rng, 1, 4);
    const items: CanonicalSaleItem[] = [];
    const used = new Set<string>();
    for (let j = 0; j < lineCount; j++) {
      const p = pick(rng, MOCK_CATALOG);
      if (used.has(p.id)) continue;
      used.add(p.id);
      const qty = intBetween(rng, 1, 3);
      const lineGross = round2(p.price * qty);
      items.push({
        externalProductId: p.id,
        name: p.name,
        category: p.category,
        quantity: qty,
        unitPrice: p.price,
        grossTotal: lineGross,
        taxRate: p.taxRate,
        raw: { mock: true },
      });
    }
    if (items.length === 0) continue;

    const grossTotal = round2(items.reduce((s, it) => s + it.grossTotal, 0));
    // tax_total computed per-line from inclusive prices: tax = gross - gross/(1+rate)
    const taxTotal = round2(
      items.reduce((s, it) => s + (it.grossTotal - it.grossTotal / (1 + (it.taxRate ?? 0) / 100)), 0),
    );
    const netTotal = round2(grossTotal - taxTotal);
    const feesTotal = channel === "delivery" ? round2(grossTotal * (0.25 + rng() * 0.05)) : 0;
    const tipTotal = channel === "sala" && rng() < 0.2 ? round2(rng() * 5) : 0;

    sales.push({
      externalId: `mock-${date}-${i}`,
      channel,
      channelSource,
      businessDate: date,
      closedAt,
      currency: "EUR",
      grossTotal,
      netTotal,
      taxTotal,
      discountTotal: 0,
      feesTotal,
      tipTotal,
      covers,
      paymentMethod: channel === "delivery" ? "online" : pick(rng, PAYMENTS),
      orderRef: `M${date.replace(/-/g, "")}-${i}`,
      items,
      raw: { mock: true, dow, weekend },
    });
  }
  return sales;
}

export const mockAdapter: PosAdapter = {
  provider: "mock",

  async testConnection() {
    return { ok: true, detail: "MockAdapter — generatore di vendite finte deterministico" };
  },

  async fetchSales(ctx: AdapterContext, p: FetchSalesParams): Promise<CanonicalSale[]> {
    const out: CanonicalSale[] = [];
    for (const date of eachDate(p.since, p.until)) {
      for (const sale of salesForDate(ctx.tenantId, date)) {
        // keep only bills whose closedAt is within the window (so an incremental
        // sync re-runs the same date but the upsert stays idempotent).
        if (sale.closedAt >= p.since && sale.closedAt <= p.until) out.push(sale);
      }
    }
    return out;
  },

  async fetchProducts(): Promise<CanonicalProduct[]> {
    return MOCK_CATALOG.map((p) => ({
      externalProductId: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
    }));
  },
};
