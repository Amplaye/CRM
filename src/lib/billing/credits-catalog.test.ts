import { describe, it, expect, afterEach } from "vitest";
import {
  ACTION_MC,
  PLAN_CREDITS_MC,
  CREDIT_PACKS,
  MC_PER_CREDIT,
  EUR_PER_CREDIT,
  mcFor,
  toCredits,
  formatCredits,
  creditsToEur,
  getCreditPack,
  resolveCreditPackPriceId,
  type CreditAction,
} from "./credits-catalog";

// The credits catalog decides what we DEBIT from a paying tenant. A wrong number
// here doesn't crash anything — it silently overcharges a restaurant, or lets
// one burn our OpenAI/Meta/Vapi budget for free. So the invariants get tested,
// not just the happy path.

describe("ACTION_MC — integers only", () => {
  // The whole point of millicredits. A float here (0.04 instead of 40) would
  // typecheck, would look right in the UI, and would drift the balance by
  // fractions of a credit over hundreds of thousands of debits.
  it("every action costs a whole number of millicredits", () => {
    for (const [action, mc] of Object.entries(ACTION_MC)) {
      expect(Number.isInteger(mc), `${action} = ${mc} is not an integer`).toBe(true);
      expect(mc).toBeGreaterThan(0);
    }
  });

  it("prices match the agreed table", () => {
    expect(ACTION_MC.bot_message).toBe(40); // 0,04 cr
    expect(ACTION_MC.marketing_whatsapp).toBe(400); // 0,4 cr per recipient
    expect(ACTION_MC.marketing_email).toBe(10); // 0,01 cr
    expect(ACTION_MC.voice_minute).toBe(500); // 0,5 cr
    expect(ACTION_MC.invoice_ocr).toBe(200); // 0,2 cr
    expect(ACTION_MC.menu_import).toBe(400); // 0,4 cr per chunk
    expect(ACTION_MC.transcription).toBe(20); // 0,02 cr
    expect(ACTION_MC.ai_text).toBe(50); // 0,05 cr
  });

  // Markup sanity: a credit sells for €0.20 and the priciest single action
  // (a voice minute, ~€0.09 live) must still cost the tenant more than it costs
  // us. If a future price change breaks this we'd be selling minutes at a loss.
  it("the priciest action is still sold above its live cost", () => {
    const voiceLiveCostEur = 0.09;
    expect(creditsToEur(ACTION_MC.voice_minute)).toBeGreaterThan(voiceLiveCostEur);
  });
});

describe("mcFor", () => {
  it("defaults to one unit", () => {
    expect(mcFor("bot_message")).toBe(40);
  });

  it("multiplies by quantity — 300 campaign recipients", () => {
    expect(mcFor("marketing_whatsapp", 300)).toBe(120_000); // 120 cr
  });

  it("rounds partial units UP — a 90-second call bills 2 minutes", () => {
    expect(mcFor("voice_minute", 1.5)).toBe(1000);
  });

  it("never returns a negative charge", () => {
    expect(mcFor("ai_text", -5)).toBe(0);
    expect(mcFor("ai_text", 0)).toBe(0);
  });
});

describe("formatCredits — the one place credits are written for humans", () => {
  it("shows 2 decimals under 10 credits, so a single action never reads as free", () => {
    expect(formatCredits(40)).toBe("0,04"); // one bot message
    expect(formatCredits(20)).toBe("0,02"); // one transcription
    expect(formatCredits(500)).toBe("0,50"); // one voice minute
  });

  it("shows whole credits with a thousands separator from 10 up", () => {
    expect(formatCredits(1_847_000)).toBe("1.847");
    expect(formatCredits(10_000)).toBe("10");
    expect(formatCredits(2_000_000)).toBe("2.000");
  });

  it("rounds to the nearest whole credit above the threshold", () => {
    expect(formatCredits(1_846_960)).toBe("1.847");
  });

  it("handles an empty wallet", () => {
    expect(formatCredits(0)).toBe("0,00");
  });
});

describe("conversions", () => {
  it("1 credit = 1000 mc = €0.20", () => {
    expect(MC_PER_CREDIT).toBe(1000);
    expect(toCredits(1000)).toBe(1);
    expect(creditsToEur(1000)).toBeCloseTo(EUR_PER_CREDIT, 10);
  });

  it("a full Premium allowance is worth €400 at list price", () => {
    expect(creditsToEur(PLAN_CREDITS_MC.premium)).toBeCloseTo(400, 10);
  });
});

describe("plan allowances", () => {
  it("Premium = 2.000 cr/month, Business = 1.250 cr/month", () => {
    expect(PLAN_CREDITS_MC.premium).toBe(2_000_000);
    expect(PLAN_CREDITS_MC.business).toBe(1_250_000);
  });

  // What the allowance actually BUYS — the sentence the owner needs to be true.
  it("Premium covers ~500 bot messages a day for a month", () => {
    const messages = PLAN_CREDITS_MC.premium / ACTION_MC.bot_message;
    expect(messages).toBe(50_000); // ≈ 1.600/day
  });

  it("Premium covers 5.000 WhatsApp campaign recipients", () => {
    expect(PLAN_CREDITS_MC.premium / ACTION_MC.marketing_whatsapp).toBe(5_000);
  });
});

describe("top-up packs", () => {
  it("all pack sizes are whole millicredit amounts", () => {
    for (const p of CREDIT_PACKS) {
      expect(Number.isInteger(p.creditsMc)).toBe(true);
    }
  });

  it("bigger packs are cheaper per credit — the reason to top up once, not five times", () => {
    const perCredit = CREDIT_PACKS.map((p) => p.amount / toCredits(p.creditsMc));
    expect(perCredit[1]).toBeLessThan(perCredit[0]);
    expect(perCredit[2]).toBeLessThan(perCredit[1]);
  });

  it("every pack is discounted vs the €0.20 list price", () => {
    for (const p of CREDIT_PACKS) {
      expect(p.amount / toCredits(p.creditsMc)).toBeLessThan(EUR_PER_CREDIT);
    }
  });

  it("getCreditPack resolves a known id and rejects junk", () => {
    expect(getCreditPack("credits_1500")?.creditsMc).toBe(1_500_000);
    expect(getCreditPack("credits_9999")).toBeUndefined();
  });
});

describe("resolveCreditPackPriceId", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the STRIPE_PRICE_CREDITS_<size> env var", () => {
    process.env.STRIPE_PRICE_CREDITS_1500 = "price_abc123";
    expect(resolveCreditPackPriceId("credits_1500")).toBe("price_abc123");
  });

  it("returns undefined when the price isn't configured, so checkout can 503 cleanly", () => {
    delete process.env.STRIPE_PRICE_CREDITS_5000;
    expect(resolveCreditPackPriceId("credits_5000")).toBeUndefined();
  });
});

describe("action list is closed", () => {
  // Guards against an action being metered at a call site but never priced —
  // mcFor would return NaN and the RPC would raise. Keep this list in sync.
  it("has exactly the eight metered actions", () => {
    const expected: CreditAction[] = [
      "bot_message",
      "marketing_whatsapp",
      "marketing_email",
      "voice_minute",
      "invoice_ocr",
      "menu_import",
      "transcription",
      "ai_text",
    ];
    expect(Object.keys(ACTION_MC).sort()).toEqual([...expected].sort());
  });
});
