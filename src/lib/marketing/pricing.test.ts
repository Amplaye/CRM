import { describe, it, expect } from "vitest";
import {
  whatsappPriceForPhone,
  estimateWhatsAppCost,
  estimateEmailCost,
  EMAIL_EUR_PER_SEND,
} from "./pricing";

describe("whatsappPriceForPhone", () => {
  it("prices by country prefix (longest match wins)", () => {
    expect(whatsappPriceForPhone("34612345678")).toBe(0.0592); // Spain
    expect(whatsappPriceForPhone("393331234567")).toBe(0.0691); // Italy
    expect(whatsappPriceForPhone("+49 170 1234567")).toBe(0.1365); // Germany, formatted
  });

  it("falls back to default for unknown countries", () => {
    expect(whatsappPriceForPhone("99912345")).toBe(0.08);
  });

  it("handles empty / junk input", () => {
    expect(whatsappPriceForPhone("")).toBe(0.08);
    expect(whatsappPriceForPhone("+++")).toBe(0.08);
  });
});

describe("estimateWhatsAppCost", () => {
  it("sums per-recipient prices and rounds up to the cent", () => {
    const est = estimateWhatsAppCost(["34600000001", "34600000002", "34600000003"]);
    expect(est.billable).toBe(3);
    expect(est.per_message_eur).toBe(0.0592); // all same country
    expect(est.total_eur).toBe(Math.ceil(0.0592 * 3 * 100) / 100);
  });

  it("returns null per-message when countries are mixed", () => {
    const est = estimateWhatsAppCost(["34600000001", "393331234567"]);
    expect(est.per_message_eur).toBeNull();
    expect(est.billable).toBe(2);
  });

  it("is zero for an empty audience", () => {
    expect(estimateWhatsAppCost([])).toEqual({ billable: 0, total_eur: 0, per_message_eur: 0 });
  });
});

describe("estimateEmailCost", () => {
  it("multiplies count by the flat per-send rate", () => {
    const est = estimateEmailCost(1000);
    expect(est.billable).toBe(1000);
    expect(est.per_message_eur).toBe(EMAIL_EUR_PER_SEND);
    expect(est.total_eur).toBe(Math.ceil(1000 * EMAIL_EUR_PER_SEND * 100) / 100);
  });
});
