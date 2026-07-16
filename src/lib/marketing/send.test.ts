import { describe, it, expect, vi, beforeEach } from "vitest";

// The invariant this file exists to protect: a tenant with no Resend key of its
// own sends NO email, and a campaign it tries to send must be refused WHOLE —
// before a recipient row is claimed, before a credit is debited, before Resend is
// touched. There is no shared platform account to quietly fall back on.
//
// A half-refused campaign would be the worst outcome: some guests told about
// tonight's offer, some not, credits burned, and a ledger nobody can resume.

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  getCreditBalance: vi.fn(),
  consumeCredits: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/whatsapp/meta", () => ({ sendWhatsAppTemplate: mocks.sendWhatsAppTemplate }));
vi.mock("@/lib/billing/credits", () => ({
  getCreditBalance: mocks.getCreditBalance,
  consumeCredits: mocks.consumeCredits,
}));

import { sendCampaign, type CampaignRow } from "./send";

const campaign = (channel: "email" | "whatsapp"): CampaignRow => ({
  id: "camp-1",
  tenant_id: "tenant-1",
  channel,
  segment: { kind: "all" },
  subject: "Offerta di stasera",
  body: "Vieni a trovarci",
});

const tenant = { id: "tenant-1", name: "Picnic", settings: null };

/** email_secrets → no row. Every OTHER table throws, which is the assertion: if
 * the refusal ever moves below the ledger/credit work, this test explodes. */
const svcNoKeyStrict = {
  from(table: string) {
    if (table === "email_secrets") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
    }
    throw new Error(`campaign touched "${table}" with no email key connected`);
  },
};

/** Same missing key, but every other table answers empty — so a WhatsApp campaign
 * can run past the email guard and prove it isn't caught by it. */
function svcNoKeyPermissive() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (data: unknown[]): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = Promise.resolve({ data, error: null });
    p.select = () => q(data);
    p.eq = () => q(data);
    p.gte = () => q(data);
    p.update = () => q(data);
    p.upsert = () => q(data);
    p.maybeSingle = async () => ({ data: null });
    return p;
  };
  return {
    from(table: string) {
      if (table === "email_secrets") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
      }
      return q([]);
    },
  };
}

beforeEach(() => {
  mocks.sendEmail.mockReset();
  mocks.sendWhatsAppTemplate.mockReset();
  mocks.getCreditBalance.mockReset();
  mocks.consumeCredits.mockReset();
});

describe("sendCampaign — email with no tenant Resend key", () => {
  it("refuses the whole campaign instead of sending on somebody else's account", async () => {
    const res = await sendCampaign(svcNoKeyStrict, campaign("email"), tenant);
    expect(res.email_not_configured).toBe(true);
    expect(res).toMatchObject({ recipients: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("never calls Resend", async () => {
    await sendCampaign(svcNoKeyStrict, campaign("email"), tenant);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("burns no credits — the owner presses send again once the key is connected", async () => {
    await sendCampaign(svcNoKeyStrict, campaign("email"), tenant);
    expect(mocks.getCreditBalance).not.toHaveBeenCalled();
    expect(mocks.consumeCredits).not.toHaveBeenCalled();
  });
});

describe("sendCampaign — WhatsApp is untouched by the email key", () => {
  it("runs past the email guard (a missing Resend key is not a WhatsApp problem)", async () => {
    const res = await sendCampaign(svcNoKeyPermissive(), campaign("whatsapp"), tenant);
    expect(res.email_not_configured).toBeUndefined();
    expect(res.sent).toBe(0); // no guests in this fixture — the point is it wasn't refused
  });
});
