import { describe, it, expect } from "vitest";
import {
  getBotEngine,
  isCloudflareEngineHealthy,
  cloudflareEngineHealthUrl,
  CLOUDFLARE_ENGINE_BASE_URL,
} from "./engine-health";

describe("getBotEngine", () => {
  it("absent settings → n8n (legacy default)", () => {
    expect(getBotEngine(null)).toBe("n8n");
    expect(getBotEngine(undefined)).toBe("n8n");
  });
  it("absent flag → n8n", () => {
    expect(getBotEngine({})).toBe("n8n");
    expect(getBotEngine({ provisioning: {} })).toBe("n8n");
    expect(getBotEngine({ provisioning: { whatsapp_attached: true } })).toBe("n8n");
  });
  it("explicit values", () => {
    expect(getBotEngine({ provisioning: { engine: "n8n" } })).toBe("n8n");
    expect(getBotEngine({ provisioning: { engine: "cloudflare" } })).toBe("cloudflare");
  });
  it("garbage → n8n (only explicit cloudflare moves a tenant)", () => {
    expect(getBotEngine({ provisioning: { engine: "banana" } })).toBe("n8n");
    expect(getBotEngine({ provisioning: { engine: 42 } })).toBe("n8n");
  });
});

describe("cloudflare engine health", () => {
  it("health url", () => {
    expect(cloudflareEngineHealthUrl()).toBe(`${CLOUDFLARE_ENGINE_BASE_URL}/health`);
    expect(cloudflareEngineHealthUrl()).toBe("https://bot-engine.sofia-f88.workers.dev/health");
  });
  it("strict {ok:true}", () => {
    expect(isCloudflareEngineHealthy({ ok: true })).toBe(true);
    expect(isCloudflareEngineHealthy({ ok: false })).toBe(false);
    expect(isCloudflareEngineHealthy({ ok: "true" })).toBe(false);
    expect(isCloudflareEngineHealthy({})).toBe(false);
    expect(isCloudflareEngineHealthy(null)).toBe(false);
    expect(isCloudflareEngineHealthy(undefined)).toBe(false);
    expect(isCloudflareEngineHealthy("ok")).toBe(false);
  });
});
