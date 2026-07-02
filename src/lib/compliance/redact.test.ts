import { describe, it, expect } from "vitest";
import { redactPII, resolveTokens } from "./redact";

describe("redactPII", () => {
  it("tokenizes emails and phones and round-trips exactly", () => {
    const text = "Soy Ana, escríbeme a ana@mail.com o llama al +34 612 345 678";
    const { redacted, map } = redactPII(text);
    expect(redacted).toContain("[EMAIL_1]");
    expect(redacted).toContain("[PHONE_1]");
    expect(redacted).not.toContain("ana@mail.com");
    expect(redacted).not.toContain("612 345 678");
    expect(resolveTokens(redacted, map)).toBe(text);
  });

  it("does not treat a small number (party size) as a phone", () => {
    const { redacted } = redactPII("Mesa para 4 personas a las 21");
    expect(redacted).not.toContain("[PHONE");
    expect(redacted).toContain("4 personas");
  });

  it("reuses one token for a repeated value", () => {
    const { redacted, tokens } = redactPII("write a@b.com, again a@b.com");
    expect(tokens.filter((t) => t.kind === "EMAIL")).toHaveLength(1);
    expect(redacted.match(/\[EMAIL_1\]/g)).toHaveLength(2);
  });

  it("redacts a known name via extraTerms", () => {
    const { redacted, map } = redactPII("Reserva para Mario Rossi", { extraTerms: ["Mario Rossi"] });
    expect(redacted).toContain("[TERM_1]");
    expect(redacted).not.toContain("Mario Rossi");
    expect(resolveTokens(redacted, map)).toContain("Mario Rossi");
  });

  it("redacts sensitive spans only when asked", () => {
    const plain = redactPII("sono allergico ai crostacei");
    expect(plain.redacted).toContain("allergico");

    const strict = redactPII("sono allergico ai crostacei", { redactSensitive: true });
    expect(strict.redacted).toContain("[HEALTH_1]");
    expect(strict.redacted).not.toContain("allergico");
    expect(resolveTokens(strict.redacted, strict.map)).toContain("allergico");
  });

  it("handles empty input", () => {
    const { redacted, map } = redactPII("");
    expect(redacted).toBe("");
    expect(map).toEqual({});
  });

  it("leaves unknown tokens untouched on resolve", () => {
    expect(resolveTokens("hi [PHONE_9]", {})).toBe("hi [PHONE_9]");
  });
});
