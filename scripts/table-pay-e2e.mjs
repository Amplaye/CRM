// E2E pay-at-table (QR) — runs against a LOCAL `next start` (default :3111)
// pointed at the prod DB, on the Gabelstapler TEST tenant. Exercises the whole
// guest chain short of an actual card charge:
//
//   1. no tenant Stripe key  → bill sheet renders the lines, pay unavailable
//      (reason no_stripe);
//   2. key connected (row in payment_secrets, encrypted like the app does)
//      → sheet payable, "pay" click lands on checkout.stripe.com;
//   3. confirm with the pending session → { status: "unpaid" } (nobody paid);
//   4. security spot-checks: foreign table id → 404, disabled tenant → 403.
//
// Usage: node scripts/table-pay-e2e.mjs [--base http://localhost:3111]
// Cleanup of the seeded rows is the caller's job (see the SQL in the session
// notes) — the script only removes the payment_secrets row it created.

import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3111";

const TENANT_ID = "a861cb0a-e908-41af-a376-7637e05d16ba"; // Gabelstapler (test)
const SLUG = "gabelstapler-xq1fpc";
const TABLE_ID = "7acc0f84-e9bf-4e4c-918f-efc9961e65aa"; // T1

// --- env ---------------------------------------------------------------
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const STRIPE_KEY = process.env.E2E_STRIPE_KEY || "";
if (!STRIPE_KEY) {
  console.error("Set E2E_STRIPE_KEY (a real sk_ key to stand in as the tenant's own key)");
  process.exit(1);
}

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Same AES-256-GCM blob format as src/lib/billing/secrets.ts.
function encrypt(plain, rawKey) {
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey)
    ? Buffer.from(rawKey, "hex")
    : crypto.createHash("sha256").update(rawKey, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plain), "utf8")), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

// --- phase 0: API-level guards ------------------------------------------
{
  const r = await fetch(`${BASE}/api/public/table-bill?slug=${SLUG}&table_id=00000000-0000-0000-0000-000000000000`);
  check("foreign/unknown table → 404", r.status === 404);
}
{
  // A tenant without the flag (picnic) must 403.
  const r = await fetch(`${BASE}/api/public/table-bill?slug=picnic&table_id=${TABLE_ID}`);
  check("flag OFF tenant → 403", r.status === 403);
}

// --- phase 1: bill visible, not payable (no key) --------------------------
await svc.from("payment_secrets").delete().eq("tenant_id", TENANT_ID).eq("provider", "stripe");
{
  const r = await fetch(`${BASE}/api/public/table-bill?slug=${SLUG}&table_id=${TABLE_ID}`);
  const j = await r.json();
  check("bill returns order lines", r.ok && j.order?.items?.length === 2, JSON.stringify(j.order?.items?.map((i) => i.name)));
  check("total = 22.50", j.order?.total === 22.5, String(j.order?.total));
  check("not payable without key (no_stripe)", j.payable === false && j.reason === "no_stripe");
}
{
  const r = await fetch(`${BASE}/api/public/table-pay/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: SLUG, table_id: TABLE_ID }),
  });
  const j = await r.json();
  check("checkout without key → 409 no_stripe", r.status === 409 && j.error === "no_stripe");
}

// --- phase 2: connect the key, drive the UI -------------------------------
{
  const { error } = await svc.from("payment_secrets").insert({
    tenant_id: TENANT_ID,
    provider: "stripe",
    secret_enc: encrypt({ secret_key: STRIPE_KEY }, env.PAYMENT_CRED_ENC_KEY || env.POS_CRED_ENC_KEY),
  });
  check("tenant Stripe key stored", !error, error?.message);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let checkoutUrl = null;
try {
  await page.goto(`${BASE}/m/${SLUG}?table=${TABLE_ID}`, { waitUntil: "networkidle" });
  const pill = page.getByRole("button", { name: /Rechnung/ }); // tenant locale = de
  await pill.waitFor({ timeout: 10000 });
  check("bill pill renders on the public menu", true);
  await pill.click();
  await page.getByText("Pizza E2E").waitFor({ timeout: 10000 });
  check("bill sheet lists the lines", await page.getByText("Birra E2E").isVisible());
  check("bill sheet shows the total", await page.getByText("€ 22.50").first().isVisible());
  const payBtn = page.getByRole("button", { name: /Mit Karte zahlen/ });
  check("pay button enabled", await payBtn.isEnabled());
  await Promise.all([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }),
    payBtn.click(),
  ]);
  checkoutUrl = page.url();
  check("redirected to Stripe Checkout", /checkout\.stripe\.com/.test(checkoutUrl));
  await page.screenshot({ path: "/tmp/table-pay-e2e-stripe.png" });
} catch (e) {
  check("UI flow", false, e.message);
  await page.screenshot({ path: "/tmp/table-pay-e2e-fail.png" }).catch(() => {});
} finally {
  await browser.close();
}

// --- phase 3: confirm on an unpaid session --------------------------------
{
  const { data: qr } = await svc
    .from("cassa_qr_payments")
    .select("stripe_session_id, amount_cents, status")
    .eq("tenant_id", TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  check("cassa_qr_payments row pending 2250c", qr?.status === "pending" && qr?.amount_cents === 2250, JSON.stringify(qr));
  if (qr) {
    const r = await fetch(`${BASE}/api/public/table-pay/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: SLUG, session_id: qr.stripe_session_id }),
    });
    const j = await r.json();
    check("confirm on unpaid session → unpaid", j.status === "unpaid", JSON.stringify(j));
  }
}

// --- cleanup of what THIS script created ----------------------------------
await svc.from("payment_secrets").delete().eq("tenant_id", TENANT_ID).eq("provider", "stripe");
console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
