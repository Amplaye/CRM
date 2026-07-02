import { describe, it, expect } from "vitest";
import { buildSubjectExport, eraseSubject, ERASED_SUBJECT_REF } from "./dsar";

describe("buildSubjectExport", () => {
  it("folds the per-store rows into one export", () => {
    const out = buildSubjectExport("t1", "2026-07-02T00:00:00.000Z", {
      guest: { id: "g1", name: "Ana" },
      reservations: [{ id: "r1" }, { id: "r2" }],
      waitlist_entries: [],
      conversations: [{ id: "c1" }],
      consent_records: [{ id: "k1" }],
    });
    expect(out.tenant_id).toBe("t1");
    expect(out.guest.name).toBe("Ana");
    expect(out.reservations).toHaveLength(2);
    expect(out.conversations).toHaveLength(1);
    expect(out.exported_at).toBe("2026-07-02T00:00:00.000Z");
  });
  it("tolerates a missing subject", () => {
    const out = buildSubjectExport("t1", "x", { guest: null, reservations: [], waitlist_entries: [], conversations: [], consent_records: [] });
    expect(out.guest).toBe(null);
  });
});

/** Chainable fake supabase that records mutations and returns canned rows. */
function fakeSupabase(state: { guest: any; counts?: Record<string, number>; consentIds?: string[] }) {
  const calls: string[] = [];
  function builder(table: string) {
    let op: "select" | "update" | "delete" | "insert" = "select";
    const b: any = {
      select() { return b; },
      insert() { op = "insert"; calls.push(`insert:${table}`); return b; },
      update() { op = "update"; calls.push(`update:${table}`); return b; },
      delete() { op = "delete"; calls.push(`delete:${table}`); return b; },
      eq() { return b; },
      order() { return b; },
      limit() { return b; },
      async maybeSingle() {
        if (table === "guests" && op === "select") return { data: state.guest, error: null };
        return { data: null, error: null };
      },
      then(resolve: any) {
        if (op === "select") {
          const count = state.counts?.[table] ?? 0;
          return resolve({ data: [], count, error: null });
        }
        if (op === "update" && table === "consent_records") {
          return resolve({ data: (state.consentIds || []).map((id) => ({ id })), error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return b;
  }
  return { calls, from: (t: string) => builder(t) } as any;
}

describe("eraseSubject", () => {
  it("returns not-found when the guest doesn't exist", async () => {
    const sb = fakeSupabase({ guest: null });
    const r = await eraseSubject(sb, "t1", { guest_id: "nope" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("anonymize: strips the guest, clears reservations, deletes transcripts, tombstones consent", async () => {
    const sb = fakeSupabase({
      guest: { id: "g1" },
      counts: { reservations: 2, waitlist_entries: 1, conversations: 3 },
      consentIds: ["k1", "k2"],
    });
    const r = await eraseSubject(sb, "t1", { guest_id: "g1" }, "anonymize");
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("anonymize");
    expect(r.affected).toMatchObject({ guest: true, reservations: 2, waitlist_entries: 1, conversations: 3, consent_tombstoned: 2 });
    expect(sb.calls).toContain("update:guests");
    expect(sb.calls).toContain("update:reservations");
    expect(sb.calls).toContain("delete:conversations");
    expect(sb.calls).toContain("delete:waitlist_entries");
    expect(sb.calls).toContain("update:consent_records");
    expect(sb.calls).not.toContain("delete:guests");
  });

  it("delete: hard-deletes the guest and still tombstones consent", async () => {
    const sb = fakeSupabase({ guest: { id: "g1" }, counts: { reservations: 1 }, consentIds: ["k1"] });
    const r = await eraseSubject(sb, "t1", { guest_id: "g1" }, "delete");
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("delete");
    expect(sb.calls).toContain("delete:guests");
    expect(sb.calls).toContain("update:consent_records"); // tombstone still runs
    expect(sb.calls).not.toContain("update:guests");
  });

  it("uses the erased tombstone constant", () => {
    expect(ERASED_SUBJECT_REF).toBe("[erased]");
  });
});
