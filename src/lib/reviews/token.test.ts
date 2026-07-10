import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReviewToken, verifyReviewToken } from "./token";

const PAYLOAD = { s: "picnic", r: "3fa85f64-5717-4562-b3fc-2c963f66afa6" };

describe("review token", () => {
  beforeEach(() => { process.env.REVIEW_LINK_SECRET = "test-secret"; });
  afterEach(() => { delete process.env.REVIEW_LINK_SECRET; });

  it("round-trips a payload", () => {
    const token = createReviewToken(PAYLOAD);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // one URL-safe path segment
    expect(verifyReviewToken(token)).toEqual(PAYLOAD);
  });

  it("rejects tampering and garbage", () => {
    const token = createReviewToken(PAYLOAD);
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, r: "other" }), "utf8").toString("base64url");
    expect(verifyReviewToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyReviewToken(`${data}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(verifyReviewToken("not-a-token")).toBeNull();
    expect(verifyReviewToken("")).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = createReviewToken(PAYLOAD);
    process.env.REVIEW_LINK_SECRET = "rotated";
    expect(verifyReviewToken(token)).toBeNull();
  });
});
