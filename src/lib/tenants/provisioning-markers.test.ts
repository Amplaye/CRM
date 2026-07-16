import { describe, it, expect } from "vitest";
import { resolveProvisioningMarkers, slugify } from "./provisioning-markers";

describe("slugify", () => {
  it("strips accents and lowercases", () => {
    expect(slugify("Lugares Mágicos ✨")).toBe("lugares-magicos");
  });
  it("collapses non-alphanumerics and trims hyphens", () => {
    expect(slugify("  Trattoria  Rossa!! ")).toBe("trattoria-rossa");
  });
});

describe("resolveProvisioningMarkers", () => {
  it("a brand-new tenant is sandbox-routable so it shows in the test menu", () => {
    const m = resolveProvisioningMarkers(undefined, "lugares-magicos");
    expect(m.sandbox_routable).toBe(true);
    expect(m.whatsapp_attached).toBe(false);
    expect(m.slug).toBe("lugares-magicos");
  });

  it("a re-run preserves an already-attached own number and drops sandbox routing", () => {
    const m = resolveProvisioningMarkers(
      { whatsapp_attached: true, sandbox_routable: false, slug: "real-client" },
      "ignored-fallback",
    );
    // Own number must WIN — never force a real customer back onto the shared sandbox.
    expect(m.whatsapp_attached).toBe(true);
    expect(m.sandbox_routable).toBe(false);
    expect(m.slug).toBe("real-client");
  });

  it("keeps the recorded slug over the fallback", () => {
    const m = resolveProvisioningMarkers({ slug: "kept" }, "fallback");
    expect(m.slug).toBe("kept");
  });

  it("preserves unrelated provisioning fields (e.g. self_serve)", () => {
    const m = resolveProvisioningMarkers({ self_serve: true }, "x");
    expect(m.self_serve).toBe(true);
    expect(m.sandbox_routable).toBe(true);
  });

  it("backfills a half-provisioned tenant (active, no markers) to routable", () => {
    // The chef-oraz / Lugares failure mode: provisioning row with nothing in it.
    const m = resolveProvisioningMarkers({}, "lugares-magicos");
    expect(m.sandbox_routable).toBe(true);
  });
});
