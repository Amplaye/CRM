import { describe, it, expect, vi } from "vitest";
import { composeCaption, toGraphCaption } from "./compose";

const ctx = {
  restaurantName: "Picnic",
  locale: "it",
  postType: "image" as const,
  dishes: ["Bruschetta", "Tiramisù"],
};

describe("composeCaption", () => {
  it("returns ai_not_configured without a key", async () => {
    const r = await composeCaption(ctx, { apiKey: "", fetchImpl: vi.fn() });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ai_not_configured");
  });

  it("parses caption + hashtags from the responses payload", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ output_text: JSON.stringify({ caption: "Che bontà!", hashtags: ["#food", "picnic"] }) }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const r = await composeCaption(ctx, { apiKey: "K", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.caption).toBe("Che bontà!");
    // strips the leading # and keeps them clean
    expect(r.hashtags).toEqual(["food", "picnic"]);
  });

  it("returns ok:false (uncharged) on a non-2xx OpenAI response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const r = await composeCaption(ctx, { apiKey: "K", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("openai 500");
  });

  it("returns ok:false on unparseable JSON (never throws)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "not json at all" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await composeCaption(ctx, { apiKey: "K", fetchImpl });
    expect(r.ok).toBe(false);
  });
});

describe("toGraphCaption", () => {
  it("joins caption + hashtags with #", () => {
    expect(toGraphCaption("Ciao", ["food", "picnic"])).toBe("Ciao\n\n#food #picnic");
  });
  it("returns the bare caption when there are no hashtags", () => {
    expect(toGraphCaption("Ciao", [])).toBe("Ciao");
  });
});
