// Seed deterministic gestionale mock data for ONE tenant, so the whole module
// (food cost, P&L, inventory, assistant) is demonstrable on realistic numbers
// before any real till exists. Pairs with the MockAdapter: the seeded menu_items
// are named EXACTLY like the mock catalogue, so a /api/pos/sync run maps the fake
// sale lines onto these dishes → food cost computes and stock depletes.
//
// Seeds: a 'mock' pos_connection (active), ~10 ingredients (some below par, one
// expiring) with their cost applied via ingredient_cost_history (so the trigger
// is exercised, not a direct write), recipes on 6 dishes, and ~2 weeks of
// labor_cost. It does NOT hand-write pos_sales — the MockAdapter generates those
// deterministically on sync (incl. a weekend bump, so "yesterday vs last
// Saturday" has a verifiable answer).
//
// Usage:  SEED_ALLOW=1 npx tsx scripts/seed-management-mock.ts <tenantId|auto>
//   "auto" creates a disposable tenant and prints its id (for E2E + teardown).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// --- tiny .env.local loader (no dependency) ---------------------------------
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env file optional if vars already set */
}

if (process.env.SEED_ALLOW !== "1") {
  console.error("Refusing to seed: set SEED_ALLOW=1 (disposable local/dev DB only).");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const supabase = createClient(url, key);

const arg = process.argv[2];

// Ingredients: name → [unitCost, unit, stock, par, expiryOffsetDays|null]
const INGREDIENTS: Array<{ name: string; unit: string; cost: number; stock: number; par: number; expiry: number | null }> = [
  { name: "Farina 00", unit: "g", cost: 0.0008, stock: 500, par: 1000, expiry: null }, // BELOW par
  { name: "Pomodoro", unit: "g", cost: 0.0025, stock: 8000, par: 2000, expiry: 30 },
  { name: "Mozzarella", unit: "g", cost: 0.0075, stock: 3000, par: 1500, expiry: 3 }, // EXPIRING soon
  { name: "Uova", unit: "pz", cost: 0.3, stock: 120, par: 60, expiry: 14 },
  { name: "Guanciale", unit: "g", cost: 0.018, stock: 1200, par: 800, expiry: 20 },
  { name: "Pecorino", unit: "g", cost: 0.022, stock: 900, par: 1000, expiry: 60 }, // BELOW par
  { name: "Manzo", unit: "g", cost: 0.025, stock: 5000, par: 2000, expiry: 5 },
  { name: "Pangrattato", unit: "g", cost: 0.003, stock: 2000, par: 500, expiry: null },
  { name: "Zucchero", unit: "g", cost: 0.0012, stock: 4000, par: 1000, expiry: null },
  { name: "Caffè", unit: "g", cost: 0.02, stock: 2500, par: 1000, expiry: 90 },
];

// Recipes by dish name (names MUST match the MockAdapter catalogue).
const RECIPES: Record<string, Array<{ ing: string; qty: number }>> = {
  "Pizza Margherita": [{ ing: "Farina 00", qty: 250 }, { ing: "Pomodoro", qty: 100 }, { ing: "Mozzarella", qty: 200 }],
  "Spaghetti Carbonara": [{ ing: "Uova", qty: 2 }, { ing: "Pecorino", qty: 50 }, { ing: "Guanciale", qty: 80 }, { ing: "Farina 00", qty: 120 }],
  "Tagliata di Manzo": [{ ing: "Manzo", qty: 250 }],
  "Cotoletta alla Milanese": [{ ing: "Manzo", qty: 220 }, { ing: "Uova", qty: 1 }, { ing: "Pangrattato", qty: 80 }],
  "Tiramisù": [{ ing: "Uova", qty: 2 }, { ing: "Zucchero", qty: 60 }, { ing: "Caffè", qty: 15 }, { ing: "Mozzarella", qty: 100 }],
  "Caffè": [{ ing: "Caffè", qty: 8 }],
};

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ensureTenant(): Promise<string> {
  if (arg && arg !== "auto") return arg;
  const slug = `mock-gestionale-${Math.abs(hash(String(process.pid))).toString(36)}`;
  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: "Mock Gestionale (disposable)",
      slug,
      status: "active",
      settings: { timezone: "Europe/Rome", currency: "EUR", features: { management_enabled: true }, pos: { provider: "mock" } },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`create tenant failed: ${error?.message}`);
  return data.id as string;
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

async function main() {
  const tenantId = await ensureTenant();
  console.log(`Seeding gestionale mock for tenant ${tenantId}`);

  // Enable the module (idempotent) on an existing tenant too.
  const { data: trow } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const settings = { ...(trow?.settings || {}) };
  settings.features = { ...(settings.features || {}), management_enabled: true };
  settings.pos = { ...(settings.pos || {}), provider: "mock" };
  await supabase.from("tenants").update({ settings }).eq("id", tenantId);

  // 1. POS connection (mock, active) — upsert on (tenant, provider).
  await supabase.from("pos_connections").upsert(
    { tenant_id: tenantId, provider: "mock", active: true, config: {} },
    { onConflict: "tenant_id,provider" },
  );

  // 2. Ingredients — insert at cost 0, then apply real cost via cost-history
  //    (exercises the trigger). Upsert on (tenant, name).
  const ingIdByName = new Map<string, string>();
  for (const ing of INGREDIENTS) {
    const { data } = await supabase
      .from("ingredients")
      .upsert(
        {
          tenant_id: tenantId,
          name: ing.name,
          unit: ing.unit,
          current_unit_cost: 0,
          stock_qty: ing.stock,
          par_level: ing.par,
          expiry_date: ing.expiry != null ? isoOffset(ing.expiry) : null,
          supplier_name: "Fornitore Mock",
        },
        { onConflict: "tenant_id,name" },
      )
      .select("id")
      .single();
    if (data) ingIdByName.set(ing.name, data.id);
  }
  // cost history → trigger updates current_unit_cost
  const hist = INGREDIENTS.map((ing) => ({
    tenant_id: tenantId,
    ingredient_id: ingIdByName.get(ing.name),
    unit_cost: ing.cost,
    source: "manual",
    observed_on: isoOffset(-1),
  })).filter((h) => h.ingredient_id);
  await supabase.from("ingredient_cost_history").insert(hist);

  // 3. Menu items (names match the mock catalogue) — upsert by name.
  const menuIdByName = new Map<string, string>();
  const prices: Record<string, number> = {
    "Pizza Margherita": 7, "Spaghetti Carbonara": 12, "Tagliata di Manzo": 18,
    "Cotoletta alla Milanese": 16, "Tiramisù": 6, "Caffè": 1.5,
  };
  for (const name of Object.keys(RECIPES)) {
    // find existing by name, else insert
    const { data: existing } = await supabase
      .from("menu_items").select("id").eq("tenant_id", tenantId).eq("name", name).maybeSingle();
    let id = existing?.id;
    if (!id) {
      const { data } = await supabase
        .from("menu_items")
        .insert({ tenant_id: tenantId, name, price: prices[name], available: true })
        .select("id").single();
      id = data?.id;
    }
    if (id) menuIdByName.set(name, id);
  }

  // 4. Recipes — upsert on (menu_item, ingredient).
  for (const [dish, lines] of Object.entries(RECIPES)) {
    const menuItemId = menuIdByName.get(dish);
    if (!menuItemId) continue;
    const rows = lines
      .map((l) => ({ tenant_id: tenantId, menu_item_id: menuItemId, ingredient_id: ingIdByName.get(l.ing), qty: l.qty }))
      .filter((r) => r.ingredient_id);
    if (rows.length) await supabase.from("recipe_items").upsert(rows, { onConflict: "menu_item_id,ingredient_id" });
  }

  // 5. Labor cost — last 14 days, lunch + dinner. Upsert on (tenant,date,shift).
  const labor = [];
  for (let d = 0; d < 14; d++) {
    const date = isoOffset(-d);
    labor.push({ tenant_id: tenantId, work_date: date, shift: "lunch", cost: 180, hours: 12, staff_count: 3 });
    labor.push({ tenant_id: tenantId, work_date: date, shift: "dinner", cost: 260, hours: 16, staff_count: 4 });
  }
  await supabase.from("labor_cost").upsert(labor, { onConflict: "tenant_id,work_date,shift" });

  console.log("Seed complete:");
  console.log(`  ingredients: ${ingIdByName.size}  dishes: ${menuIdByName.size}  labor rows: ${labor.length}`);
  console.log(`TENANT_ID=${tenantId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
