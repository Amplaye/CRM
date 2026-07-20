import { describe, it, expect } from "vitest";
import {
  countryFromPhone,
  complianceSettingsForPhone,
  normalizeCountry,
  complianceSettingsForCountry,
} from "./detect-country";

// This resolver assigns a LEGAL JURISDICTION, so the tests care as much about
// what it REFUSES to guess as about what it resolves.
describe("countryFromPhone", () => {
  it("resolves each supported market from a +prefix", () => {
    expect(countryFromPhone("+34 612 345 678")).toBe("ES");
    expect(countryFromPhone("+39 06 1234 5678")).toBe("IT");
    expect(countryFromPhone("+49 30 12345678")).toBe("DE");
    expect(countryFromPhone("+41 44 123 45 67")).toBe("CH");
  });

  it("accepts the 00 international form and bare country codes", () => {
    expect(countryFromPhone("0034612345678")).toBe("ES");
    expect(countryFromPhone("34612345678")).toBe("ES");
  });

  it("tolerates spaces, dashes, dots and parentheses", () => {
    expect(countryFromPhone(" +39-06.1234 (5678) ")).toBe("IT");
  });

  it("returns null for markets we don't support", () => {
    expect(countryFromPhone("+33 1 23 45 67 89")).toBeNull(); // FR
    expect(countryFromPhone("+1 646 381 0048")).toBeNull(); // US
    expect(countryFromPhone("+44 20 7123 4567")).toBeNull(); // UK
  });

  it("refuses a national number with a trunk prefix rather than guessing", () => {
    // "06…" is an Italian national format, but nothing in it names a country.
    expect(countryFromPhone("06 1234 5678")).toBeNull();
  });

  it("refuses numbers too short to carry a real subscriber number", () => {
    // Would otherwise match the "34" prefix on noise.
    expect(countryFromPhone("+34 12")).toBeNull();
    expect(countryFromPhone("3412345")).toBeNull();
  });

  it("returns null for empty, missing or non-numeric input", () => {
    expect(countryFromPhone(null)).toBeNull();
    expect(countryFromPhone(undefined)).toBeNull();
    expect(countryFromPhone("")).toBeNull();
    expect(countryFromPhone("   ")).toBeNull();
    expect(countryFromPhone("not a phone")).toBeNull();
  });
});

// The self-signup dropdown is untrusted form input: a country we can't govern must
// never reach settings.compliance, or the tenant looks configured while
// getComplianceConfig silently falls back to the unset defaults.
describe("normalizeCountry", () => {
  it("accepts the supported markets, case-insensitively", () => {
    expect(normalizeCountry("ES")).toBe("ES");
    expect(normalizeCountry("it")).toBe("IT");
    expect(normalizeCountry(" de ")).toBe("DE");
    expect(normalizeCountry("Ch")).toBe("CH");
  });

  it("rejects markets we have no RegionConfig for", () => {
    expect(normalizeCountry("FR")).toBeNull();
    expect(normalizeCountry("US")).toBeNull();
  });

  it("rejects empty and junk values instead of assigning a regime", () => {
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry("../../etc")).toBeNull();
  });
});

describe("complianceSettingsForCountry", () => {
  it("builds the block for a declared market", () => {
    expect(complianceSettingsForCountry("es")).toEqual({ country: "ES" });
  });

  it("returns null for an ungoverned market so the tenant stays unset", () => {
    expect(complianceSettingsForCountry("FR")).toBeNull();
  });
});

describe("complianceSettingsForPhone", () => {
  it("builds the settings block for a known market", () => {
    expect(complianceSettingsForPhone("+39 06 1234 5678")).toEqual({ country: "IT" });
  });

  it("returns null (not an empty object) when the market is unknown, so the tenant stays honestly unset", () => {
    expect(complianceSettingsForPhone("+33 1 23 45 67 89")).toBeNull();
    expect(complianceSettingsForPhone(null)).toBeNull();
  });
});
