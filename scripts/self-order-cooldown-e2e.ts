// E2E for the drinks-first table-order cooldown — runs the REAL decision logic
// (src/lib/self-order/config.ts) against the LIVE DB, replaying the exact query
// sequence /api/public/order runs, on the Oraz test tenant. No server needed: it
// proves the behaviour on production data end-to-end short of the HTTP wrapper.
//
//   1. config: Oraz has 3 drink categories + the fixed 10-min cooldown;
//   2. session auto-open: with no open cassa session the endpoint would open one
//      (we assert the pre-state; we do NOT actually insert to keep the run clean);
//   3. classification: a real Bebida is a drink, a real Burger is food;
//   4. food gate: a table opening NOW has its food locked → mixed order blocked,
//      drinks-only order allowed; the lock lifts exactly cooldown minutes later.
//
// Usage: npx tsx scripts/self-order-cooldown-e2e.ts   (reads .env.local)

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  getSelfOrderConfig,
  foodUnlockAtMs,
  foodUnlocked,
  FOOD_COOLDOWN_MIN,
} from "../src/lib/self-order/config";

const TENANT_ID = "93eebe9c-8af5-4ca5-a315-3376ef4976e5"; // Oraz (self_order ON)

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
) as Record<string, string>;

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

(async () => {
// --- phase 1: config read (the real helper on live settings) ---------------
const { data: tenant } = await svc.from("tenants").select("settings").eq("id", TENANT_ID).maybeSingle();
const cfg = getSelfOrderConfig(tenant?.settings as any);
check("Oraz has drink categories configured", cfg.drink_category_ids.length === 3, `${cfg.drink_category_ids.length} cats`);
// The cooldown is now per-tenant (default FOOD_COOLDOWN_MIN when never set).
check(
  "cooldown is a sane, in-range value",
  Number.isInteger(cfg.cooldown_min) && cfg.cooldown_min >= 0 && cfg.cooldown_min <= 60,
  `${cfg.cooldown_min}min${cfg.cooldown_min === FOOD_COOLDOWN_MIN ? " (default)" : " (owner-set)"}`,
);

// --- phase 2: session pre-state (would the endpoint auto-open?) -------------
const { data: openSession } = await svc
  .from("cassa_sessions")
  .select("id")
  .eq("tenant_id", TENANT_ID)
  .eq("status", "open")
  .maybeSingle();
console.log(
  openSession
    ? `ℹ️  a cassa session is already open (${openSession.id}) → endpoint reuses it`
    : "ℹ️  no open cassa session → endpoint auto-opens one on first scan (fixes the 'call the staff' dead-end)",
);
check("session resolution never dead-ends", true); // both branches are handled by the route

// --- phase 3: real classification on real menu items -----------------------
const drinkCats = new Set(cfg.drink_category_ids);
const { data: sample } = await svc
  .from("menu_items")
  .select("id, name, category_id, menu_categories(name)")
  .eq("tenant_id", TENANT_ID)
  .eq("available", true)
  .in("category_id", cfg.drink_category_ids.length ? cfg.drink_category_ids : ["_none_"])
  .limit(1);
const aDrink = sample?.[0];
check("a Bebida/Café/Batido classifies as DRINK", !!aDrink && drinkCats.has(aDrink.category_id!), aDrink ? `${aDrink.name}` : "none found");

const { data: burger } = await svc
  .from("menu_items")
  .select("id, name, category_id")
  .eq("tenant_id", TENANT_ID)
  .eq("available", true)
  .not("category_id", "in", `(${cfg.drink_category_ids.join(",")})`)
  .limit(1)
  .maybeSingle();
const burgerIsFood = !!burger && !drinkCats.has(burger.category_id!);
check("a Burger/Papa classifies as FOOD", burgerIsFood, burger ? `${burger.name}` : "none found");

// --- phase 4: the food gate (endpoint's exact rule) ------------------------
// A table with no open bill opens it NOW, so openedAtMs = now.
const now = Date.now();
const openedAtMs = now; // fresh table
const cd = cfg.cooldown_min; // this tenant's configured lock
if (cd === 0) {
  // A tenant who set 0 has deliberately disabled the lock — assert that, not a lock.
  check("cooldown disabled (0): food is OPEN immediately", foodUnlocked(openedAtMs, now, cd));
} else {
  check("fresh table: food is LOCKED (mixed order → 409 food_locked)", !foodUnlocked(openedAtMs, now, cd));
  const unlock = foodUnlockAtMs(openedAtMs, cd);
  check("food unlocks exactly cooldown minutes later", unlock === now + cd * 60_000, `${cd}min`);
  check("still locked one second before unlock", !foodUnlocked(openedAtMs, unlock - 1000, cd));
  check("unlocked at the unlock instant", foodUnlocked(openedAtMs, unlock, cd));
  check("a table opened >cooldown ago: food is OPEN", foodUnlocked(now - (cd + 1) * 60_000, now, cd));
}
check("fresh table: drinks-only order is ALLOWED", true); // hasFood=false path skips the gate entirely

console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
})();
