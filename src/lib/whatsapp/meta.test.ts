import { describe, it, expect, afterEach, vi } from "vitest";
import { toMetaRecipient, sendWhatsAppMeta } from "./meta";

describe("toMetaRecipient — Meta wants E.164 digits only", () => {
  it("strips whatsapp: prefix and '+'", () => {
    expect(toMetaRecipient("whatsapp:+34600111222")).toBe("34600111222");
    expect(toMetaRecipient("+34600111222")).toBe("34600111222");
    expect(toMetaRecipient("34600111222")).toBe("34600111222");
  });
  it("strips spaces, dashes and parentheses", () => {
    expect(toMetaRecipient("+34 600-111 (222)")).toBe("34600111222");
  });
  it("handles empty / garbage", () => {
    expect(toMetaRecipient("")).toBe("");
    expect(toMetaRecipient("whatsapp:")).toBe("");
  });
});

describe("sendWhatsAppMeta — Graph call shape & error handling", () => {
  const origToken = process.env.META_ACCESS_TOKEN;
  const origFrom = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  afterEach(() => {
    vi.restoreAllMocks();
    if (origToken === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = origToken;
    if (origFrom === undefined) delete process.env.META_WHATSAPP_PHONE_NUMBER_ID; else process.env.META_WHATSAPP_PHONE_NUMBER_ID = origFrom;
  });

  it("fails clearly when no token is configured", async () => {
    delete process.env.META_ACCESS_TOKEN;
    const r = await sendWhatsAppMeta("+34600111222", "hi");
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/META_ACCESS_TOKEN/);
  });

  it("posts JSON to graph.facebook.com with Bearer auth and E.164 'to'", async () => {
    process.env.META_ACCESS_TOKEN = "TESTTOKEN";
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "1095078260361095";
    const fetchMock = vi.fn(
      (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify({ messages: [{ id: "wamid.ABC" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await sendWhatsAppMeta("whatsapp:+34600111222", "hola");
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe("wamid.ABC");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://graph.facebook.com/");
    expect(String(url)).toContain("/1095078260361095/messages");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TESTTOKEN");
    expect(headers["Content-Type"]).toBe("application/json");
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toMatchObject({ messaging_product: "whatsapp", to: "34600111222", type: "text", text: { body: "hola" } });
  });

  it("returns ok:false with the Graph error message on non-2xx", async () => {
    process.env.META_ACCESS_TOKEN = "TESTTOKEN";
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "1095078260361095";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Invalid OAuth access token" } }),
      { status: 401, headers: { "content-type": "application/json" } }
    )));
    const r = await sendWhatsAppMeta("+34600111222", "hi");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.errorMessage).toMatch(/Invalid OAuth/);
  });
});
