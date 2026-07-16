import { describe, it, expect } from "vitest";
import { assertCredits, walletEverFunded, getCreditBalance } from "./credits";

// These exist because of a real outage. On 2026-07-13 the credit gate went into
// the WhatsApp engine and was, in that moment, ready to silence the bot of all
// five live restaurants: nobody had ever been granted a credit, so every wallet
// read back as zero, and zero was taken to mean "spent". It got rolled back
// before a single customer message landed — luck, not design.
//
// The bug was one missing distinction, and it is the thing these tests defend:
//
//   a wallet at zero because it was DRAINED  →  block. The meter is working.
//   a wallet at zero because it was NEVER FILLED  →  allow. The tenant isn't on
//   the credits system at all, and refusing them means WE take a restaurant off
//   the air over billing WE never set up.
//
// `credit_balances` cannot tell the two apart — consume_credits materializes a
// zeroed row on first use, so merely asking the question creates the row. Only
// the ledger remembers: a wallet that was ever funded has a positive
// credit_events entry. Hence walletEverFunded, and hence these tests.

/** Minimal stand-in for the Supabase service client: just the two chains the
 *  credit code actually walks. Each table is handed the rows it should return
 *  (or an error), and the chain is a no-op that resolves to them. */
function fakeClient(opts: {
  balanceRow?: Record<string, unknown> | null;
  ledgerRows?: Array<Record<string, unknown>>;
  ledgerError?: string;
  balanceThrows?: boolean;
}) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        limit: () =>
          Promise.resolve(
            opts.ledgerError
              ? { data: null, error: { message: opts.ledgerError } }
              : { data: opts.ledgerRows ?? [], error: null },
          ),
        maybeSingle: () => {
          if (opts.balanceThrows) return Promise.reject(new Error("supabase is down"));
          return Promise.resolve({ data: opts.balanceRow ?? null, error: null });
        },
      };
      void table;
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const wallet = (includedMc: number, purchasedMc = 0) => ({
  included_remaining_mc: includedMc,
  purchased_remaining_mc: purchasedMc,
  included_granted_mc: includedMc,
  period_start: "2026-07-01",
});

const A_GRANT = [{ id: "evt-1" }]; // one positive ledger row = wallet was funded

describe("walletEverFunded", () => {
  it("is false when the ledger has never credited the tenant", async () => {
    expect(await walletEverFunded("t1", fakeClient({ ledgerRows: [] }))).toBe(false);
  });

  it("is true once a grant has been written to the ledger", async () => {
    expect(await walletEverFunded("t1", fakeClient({ ledgerRows: A_GRANT }))).toBe(true);
  });

  it("reports NOT funded when the ledger read fails, so a broken meter never blocks", async () => {
    expect(await walletEverFunded("t1", fakeClient({ ledgerError: "boom" }))).toBe(false);
  });
});

describe("assertCredits — the wallet that was never filled", () => {
  // THE regression test. This is the exact shape of the 2026-07-13 outage: an
  // active restaurant, no credits, no grant, no subscription. It must be allowed
  // through, because it was never on the credits system to begin with.
  it("ALLOWS a tenant with no wallet at all (never granted a credit)", async () => {
    const res = await assertCredits(
      "never-onboarded",
      "bot_message",
      1,
      fakeClient({ balanceRow: null, ledgerRows: [] }),
    );
    expect(res).toBeNull();
  });

  it("ALLOWS a tenant whose row exists at zero but was never funded", async () => {
    // consume_credits creates this row itself, so it proves nothing on its own.
    const res = await assertCredits(
      "row-but-never-funded",
      "bot_message",
      1,
      fakeClient({ balanceRow: wallet(0, 0), ledgerRows: [] }),
    );
    expect(res).toBeNull();
  });
});

describe("assertCredits — the wallet that was drained", () => {
  it("BLOCKS a funded tenant who has spent everything", async () => {
    const res = await assertCredits(
      "spent-it-all",
      "bot_message",
      1,
      fakeClient({ balanceRow: wallet(0, 0), ledgerRows: A_GRANT }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("credits_exhausted");
    expect(body.needed_mc).toBe(40); // bot_message
    expect(body.remaining_mc).toBe(0);
  });

  it("BLOCKS when the balance cannot cover the whole job, not just one unit", async () => {
    // 300-recipient campaign against a wallet that can pay for a handful. The
    // point of the pre-flight: refuse the whole campaign rather than run out at
    // recipient 180 with Meta already billing us for the first 179.
    const res = await assertCredits(
      "half-funded",
      "marketing_whatsapp", // 400 mc per recipient → 300 of them = 120_000 mc
      300,
      fakeClient({ balanceRow: wallet(1_000), ledgerRows: A_GRANT }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.needed_mc).toBe(120_000);
  });

  it("ALLOWS a funded tenant who can cover the action", async () => {
    const res = await assertCredits(
      "funded",
      "bot_message",
      1,
      fakeClient({ balanceRow: wallet(100_000), ledgerRows: A_GRANT }),
    );
    expect(res).toBeNull();
  });
});

describe("assertCredits — fail-open", () => {
  it("ALLOWS when the balance read throws: a broken meter must not close a restaurant", async () => {
    const res = await assertCredits(
      "db-blip",
      "bot_message",
      1,
      fakeClient({ balanceThrows: true }),
    );
    expect(res).toBeNull();
  });

  it("ALLOWS a drained wallet if the LEDGER read fails — we eat the cost rather than guess", async () => {
    const res = await assertCredits(
      "ledger-down",
      "bot_message",
      1,
      fakeClient({ balanceRow: wallet(0, 0), ledgerError: "boom" }),
    );
    expect(res).toBeNull();
  });
});

describe("getCreditBalance", () => {
  it("returns a zeroed balance (not null) for a tenant with no row", async () => {
    // Deliberate: callers never branch on null. Which is exactly why zero cannot
    // be read as "spent" — hence walletEverFunded.
    const b = await getCreditBalance("nobody", fakeClient({ balanceRow: null }));
    expect(b.totalRemainingMc).toBe(0);
    expect(b.periodStart).toBeNull();
  });

  it("sums included + purchased", async () => {
    const b = await getCreditBalance("t1", fakeClient({ balanceRow: wallet(2_000, 500) }));
    expect(b.includedRemainingMc).toBe(2_000);
    expect(b.purchasedRemainingMc).toBe(500);
    expect(b.totalRemainingMc).toBe(2_500);
  });
});
