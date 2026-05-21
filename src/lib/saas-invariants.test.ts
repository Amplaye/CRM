import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getFeatures } from "./types/tenant-settings";

/**
 * SAAS PROOF SUITE — the investor pillars, locked by the build.
 *
 * docs/PIANO_SAAS.md ships a manual "VERIFICA GLOBALE" checklist. The pillars
 * that can be proven in-process (no external Retell/n8n/Twilio call) are asserted
 * here, so a future edit cannot silently undo them. Companion: docs/PROVA_SAAS.md.
 */

/** Every .ts/.tsx file under a directory (skips build/deps output). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const API_DIR = join(process.cwd(), "src", "app", "api");

// The template restaurant's own owner phone. It lives ONLY in the onboarding
// substitute map (src/lib/onboarding/substitute.ts) as a search-and-replace key.
// It must never reappear in a runtime API route as a fallback — that hardcoded
// "borrow the template's config" was the #1 agency smell removed in Mossa 1.
const TEMPLATE_OWNER_PHONE = "34641790137";

describe("SaaS pillar — no cross-tenant (Picnic) fallback in runtime routes [Mossa 1]", () => {
  const files = sourceFiles(API_DIR);

  it("has API routes to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("no runtime route hardcodes the template owner phone", () => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(TEMPLATE_OWNER_PHONE));
    expect(offenders, `template phone leaked into runtime routes:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the removed agency-smell fallback constants stay removed", () => {
    const banned = ["TENANT_CONFIG_FALLBACK", "TENANT_VAPI_FALLBACK", "PICNIC_WEBHOOK"];
    const offenders: string[] = [];
    for (const f of files) {
      const txt = readFileSync(f, "utf8");
      for (const b of banned) if (txt.includes(b)) offenders.push(`${f} → ${b}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("SaaS pillar — WhatsApp sender is config, resolved in one place [Mossa 5]", () => {
  const files = sourceFiles(API_DIR);

  // The Twilio sandbox sender. It must live ONLY in src/lib/whatsapp/from.ts; a
  // route that re-hardcodes it is the "one number for everyone" agency smell —
  // the sending number is per-tenant config (settings.whatsapp.from) resolved by
  // resolveWhatsAppFrom().
  const SANDBOX_FROM = "14155238886";

  it("no API route hardcodes the WhatsApp sandbox sender — use resolveWhatsAppFrom()", () => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(SANDBOX_FROM));
    expect(offenders, `sandbox sender hardcoded in routes:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("SaaS pillar — config-not-code: a flag changes one tenant only [Mossa 3]", () => {
  it("flipping a flag affects only that tenant's resolved behaviour", () => {
    const tenantOff = getFeatures({ features: { waitlist_enabled: false } });
    const otherTenant = getFeatures({}); // untouched neighbour
    expect(tenantOff.waitlist_enabled).toBe(false);
    expect(otherTenant.waitlist_enabled).toBe(true);
  });

  it("defaults preserve today's behaviour (waitlist / double_shift / multi_language ON)", () => {
    const f = getFeatures(null);
    expect(f.waitlist_enabled).toBe(true);
    expect(f.double_shift).toBe(true);
    expect(f.multi_language).toBe(true);
  });
});
