// Responsive audit: visits every CRM page at several viewports and reports
// REAL layout breaks, naming the exact offending elements so fixes are
// targeted rather than guesswork.
//
// What counts as a finding (noise is deliberately filtered out):
//   • overflow  — the document itself is wider than the viewport. Currently
//                 always 0 because globals.css sets html,body{overflow-x:hidden},
//                 which HIDES leaks rather than fixing them. So we also probe
//                 with that clamp temporarily lifted, to see the truth.
//   • blowout   — a block-level container whose content is meaningfully wider
//                 than its box AND that has no overflow-x:auto to scroll it.
//                 Text nodes and inline elements are excluded: a <p> reporting
//                 scrollWidth 74 vs clientWidth 67 is sub-pixel glyph rounding,
//                 not a layout bug.
//   • tapTarget — interactive elements under 32px, unusable on a phone.
//
//   node scripts/responsive-audit.mjs
//   PAGES=/floor,/settings node scripts/responsive-audit.mjs

import { chromium } from "playwright";
import { writeFileSync } from "fs";

const CRM = process.env.BASE || "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-pro", width: 393, height: 852 },
  { name: "ipad", width: 768, height: 1024 },
  { name: "ipad-land", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
];

const PAGES = (process.env.PAGES || [
  "/", "/reservations", "/pending", "/waitlist", "/guests", "/conversations",
  "/menu", "/floor", "/cassa", "/analytics", "/inventory", "/food-cost",
  "/pl", "/knowledge", "/staff", "/incidents", "/settings", "/marketing",
  "/social", "/website", "/reviews", "/gift-cards",
].join(",")).split(",");

// Runs IN the page. Temporarily lifts the global overflow-x clamp so we can
// see real document overflow, measures, then restores it.
const PROBE = () => {
  const de = document.documentElement;
  const prevHtml = de.style.overflowX;
  const prevBody = document.body.style.overflowX;
  de.style.overflowX = "visible";
  document.body.style.overflowX = "visible";

  const vw = de.clientWidth;
  const out = { vw, trueOverflowPx: 0, escapees: [], blowouts: [], tapTargets: [] };

  const describe = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim();
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls.split(/\s+/).slice(0, 7).join(".") : ""}`;
  };

  out.trueOverflowPx = Math.round(Math.max(de.scrollWidth, document.body.scrollWidth) - vw);

  // Only these box types can genuinely "blow out" a layout. Inline/text
  // elements report sub-pixel scrollWidth deltas that are pure noise.
  const BLOCKISH = new Set(["block", "flex", "grid", "flow-root", "list-item", "table"]);

  for (const el of document.querySelectorAll("body *")) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // 1) Element's own box escapes the viewport and nothing clips it.
    if (r.right > vw + 1 || r.left < -1) {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") { clipped = true; break; }
      }
      if (!clipped && st.position !== "fixed") {
        out.escapees.push({
          sel: describe(el), pos: st.position,
          left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        });
      }
    }

    // 2) Container's content is wider than its box, with no way to scroll it.
    //    >12px so we ignore rounding; blockish only so we ignore text nodes.
    const delta = el.scrollWidth - el.clientWidth;
    if (delta > 12 && BLOCKISH.has(st.display) && st.overflowX === "visible") {
      out.blowouts.push({ sel: describe(el), scrollW: el.scrollWidth, clientW: el.clientWidth, delta });
    }

    // 3) Tap targets too small for a finger.
    if ((el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button")
        && (r.width < 32 || r.height < 32) && r.width > 0) {
      out.tapTargets.push({ sel: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  de.style.overflowX = prevHtml;
  document.body.style.overflowX = prevBody;

  // Deepest-first, dedupe by selector: a blown-out child usually explains its
  // ancestors, so reporting every ancestor is noise.
  const seen = new Set();
  out.blowouts = out.blowouts.sort((a, b) => b.delta - a.delta)
    .filter((b) => !seen.has(b.sel) && seen.add(b.sel)).slice(0, 12);
  out.escapees = out.escapees.slice(0, 12);
  const seenT = new Set();
  out.tapTargets = out.tapTargets.filter((t) => !seenT.has(t.sel) && seenT.add(t.sel)).slice(0, 8);
  return out;
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));

  console.log("① Login…");
  await page.goto(`${CRM}/login`, { waitUntil: "domcontentloaded" });
  // Wait for hydration — clicking too early submits the form natively as a
  // GET and bounces back to /login with the credentials in the query string.
  await page.waitForTimeout(3500);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /sign in|accedi|entrar/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 60000 });
  await page.waitForTimeout(2500);
  console.log("   ✓ logged in");

  console.log(`② Tenant "${TENANT}"…`);
  await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByText(TENANT, { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log("   ✓ tenant selected");

  const report = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    console.log(`\n=== ${vp.name} (${vp.width}px) ===`);
    for (const path of PAGES) {
      try {
        await page.goto(`${CRM}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2600);
        const r = await page.evaluate(PROBE);
        const bad = r.trueOverflowPx > 1 || r.escapees.length || r.blowouts.length || r.tapTargets.length;
        if (bad) {
          console.log(`  ✗ ${path}  trueOverflow=${r.trueOverflowPx}px  escapees=${r.escapees.length} blowouts=${r.blowouts.length} tinyTaps=${r.tapTargets.length}`);
          for (const o of r.escapees.slice(0, 5)) console.log(`      → ESCAPE [${o.pos}] right=${o.right}/vw=${r.vw}  ${o.sel}`);
          for (const s of r.blowouts.slice(0, 5)) console.log(`      → BLOWOUT +${s.delta}px (${s.scrollW}>${s.clientW})  ${s.sel}`);
          for (const t of r.tapTargets.slice(0, 4)) console.log(`      → TAP ${t.w}x${t.h}  ${t.sel}`);
        } else {
          console.log(`  ✓ ${path}`);
        }
        report.push({ viewport: vp.name, width: vp.width, path, ...r });
      } catch (e) {
        console.log(`  ! ${path} — ${e.message.slice(0, 90)}`);
        report.push({ viewport: vp.name, width: vp.width, path, error: e.message });
      }
    }
  }
  writeFileSync("/tmp/responsive-audit.json", JSON.stringify(report, null, 2));
  console.log("\nReport → /tmp/responsive-audit.json");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
