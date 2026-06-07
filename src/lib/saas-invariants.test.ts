import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getFeatures } from "./types/tenant-settings";
import { N8N_TEMPLATE_COUNT } from "./tenants/activation";

/**
 * SAAS PROOF SUITE — the investor pillars, locked by the build.
 *
 * docs/PIANO_SAAS.md ships a manual "VERIFICA GLOBALE" checklist. The pillars
 * that can be proven in-process (no external Vapi/n8n/Twilio call) are asserted
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

// The template restaurant's own owner phone. Since 2026-06-03 the cloned n8n
// workflows read the owner phone LIVE from the DB, so this literal no longer
// lives anywhere in src/ (it remains only as an inert fallback inside the live
// n8n template content). It must never reappear in a runtime API route as a
// fallback — that hardcoded "borrow the template's config" was the #1 agency
// smell removed in Mossa 1.
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

  // The shared platform sender lives ONLY as config (env
  // META_WHATSAPP_PHONE_NUMBER_ID, resolved by resolveWhatsAppFrom in
  // src/lib/whatsapp/from.ts). A route that re-hardcodes ANY of these numbers is
  // the "one number for everyone" agency smell — the sending number is
  // per-tenant config (settings.whatsapp.from), never a literal in a route.
  //   - 1095078260361095 : the shared Meta phone_number_id (post-migration)
  //   - 14155238886       : the old Twilio sandbox (must not resurface)
  //   - 34641459479       : the LIVE BALI number once hardcoded in admin/bali/send
  const BANNED_SENDERS = ["1095078260361095", "14155238886", "34641459479"];

  it("no API route hardcodes a WhatsApp sender number — use resolveWhatsAppFrom()", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const txt = readFileSync(f, "utf8");
      for (const n of BANNED_SENDERS) if (txt.includes(n)) offenders.push(`${f} → ${n}`);
    }
    expect(offenders, `sender number hardcoded in routes:\n${offenders.join("\n")}`).toEqual([]);
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

describe("SaaS pillar — the wizard owner phone is persisted, never dropped [owner-alert routing]", () => {
  // The number the owner types in the wizard MUST be saved on the tenant, in BOTH
  // places that decide who gets booking alerts:
  //   - settings.owner_phone        → read by the CRM (pending/reservations/waitlist)
  //   - bot_config.responsible_phone → read by the cloned n8n bot
  // When it was dropped, every tenant's "NUEVA RESERVA"/"GRUPO GRANDE" alerts fell
  // back to the bot's hardcoded Picnic number, so owners got each other's bookings.
  // We read the orchestrator SOURCE (its module pulls server-only supabase deps).
  const src = readFileSync(join(process.cwd(), "src", "lib", "onboarding", "orchestrator.ts"), "utf8");
  const provBlock = src.match(/const provisioningSettings\s*=\s*\{([\s\S]*?)\n {6}\};/);
  const botBlock = src.match(/const mergeBotConfig\s*=[\s\S]*?const merged\s*=\s*\{([\s\S]*?)\};/);

  it("provisioningSettings persists owner_phone (read by the CRM as settings.owner_phone)", () => {
    expect(provBlock, "provisioningSettings block not found").not.toBeNull();
    expect(provBlock![1]).toMatch(/owner_phone:\s*input\.owner_phone/);
  });

  it("mergeBotConfig persists responsible_phone (read by the n8n bot)", () => {
    expect(botBlock, "mergeBotConfig block not found").not.toBeNull();
    expect(botBlock![1]).toMatch(/responsible_phone:\s*input\.owner_phone/);
  });
});

describe("SaaS pillar — POS credentials are never readable by the browser [gestionale]", () => {
  // Till API keys must live ONLY in the dedicated, service-role-only
  // pos_credentials table (AES-256-GCM). They must never be written into
  // tenants.settings (the browser reads settings everywhere → an API key there is
  // a leak), and the encrypt/decrypt path must never surface in a client bundle.
  // Skip test files (this very file references the patterns in comments).
  const allSrc = sourceFiles(join(process.cwd(), "src")).filter((f) => !/\.test\.tsx?$/.test(f));

  it("no code writes POS secrets into tenants.settings.pos (provider flag only)", () => {
    // settings.pos may only carry the non-secret provider flag. Catch an obvious
    // mistake: a credential/secret/apiKey field assigned under a `pos:` settings object.
    const offenders: string[] = [];
    for (const f of allSrc) {
      const txt = readFileSync(f, "utf8");
      // a `pos: { ... secret/apiKey/credential ... }` settings literal
      const m = txt.match(/pos:\s*\{[^}]*\b(secret|api_?key|credential|token|password)\b/i);
      if (m) offenders.push(`${f} → ${m[0].slice(0, 60)}`);
    }
    expect(offenders, `POS secret in settings.pos:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the credential cipher key (POS_CRED_ENC_KEY) is only used server-side, never in a client component", () => {
    const offenders: string[] = [];
    for (const f of allSrc) {
      const txt = readFileSync(f, "utf8");
      if (txt.includes("POS_CRED_ENC_KEY") && /^["']use client["']/m.test(txt)) {
        offenders.push(f);
      }
    }
    expect(offenders, `POS_CRED_ENC_KEY referenced in a client component:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("management_enabled defaults OFF (opt-in module, never auto-on)", () => {
    expect(getFeatures(null).management_enabled).toBe(false);
  });
});

describe("SaaS pillar — every new tenant clones PICNIC's full workflow set [gold standard]", () => {
  // PICNIC is the maintenance-free legacy tenant. The onboarding template must
  // clone exactly its per-tenant workflows so a new client is born complete.
  // Two numbers express the same count and must never drift: the clone list in
  // the orchestrator, and the health card's "fully provisioned" threshold. We
  // read the orchestrator's SOURCE (not its module — that pulls server-only
  // supabase deps) and count the id literals in the exported array.
  const src = readFileSync(join(process.cwd(), "src", "lib", "onboarding", "orchestrator.ts"), "utf8");
  const block = src.match(/TEMPLATE_RESTAURANT_WORKFLOW_IDS\s*=\s*\[([\s\S]*?)\]/);

  it("finds the workflow-id array in the orchestrator", () => {
    expect(block).not.toBeNull();
  });

  it("the clone count equals N8N_TEMPLATE_COUNT (no drift between template and health check)", () => {
    const ids = (block![1].match(/"[A-Za-z0-9]+"/g) || []).map((s) => s.replace(/"/g, ""));
    expect(ids.length).toBe(N8N_TEMPLATE_COUNT);
    // no accidental duplicate ids (would clone the same workflow twice)
    expect(new Set(ids).size).toBe(ids.length);
  });
});
