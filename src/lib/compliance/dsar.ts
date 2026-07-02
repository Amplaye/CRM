// DSAR — Data-Subject Access Request handling. GDPR (Art. 15/17/20) and revFADP
// both give a person the right to GET a copy of their data and to have it ERASED.
// This module does both for a single subject (a guest) across every store that
// holds their personal data, scoped to one tenant.
//
// Two operations:
//   • gatherSubject()  → assemble an export of everything we hold about the guest
//                        (access + portability). Read-only.
//   • eraseSubject()   → remove/anonymize it (erasure). Two modes:
//        - 'anonymize' (default): keep the aggregate rows (visit counts, past
//          bookings for accounting) but strip every identifier/PII in place, and
//          delete the free-text transcripts. Safest for business records.
//        - 'delete': hard-delete the guest row; FK cascades remove reservations,
//          conversations and waitlist entries. The consent ledger survives
//          (guest_id → null) but is tombstoned so it holds no PII.
//
// The consent_records ledger is always PRESERVED (tombstoned) on erasure: proving
// we HAD consent is itself an accountability obligation that outlives the data.
//
// All DB access goes through the passed (service-role) client. The pure assembler
// buildSubjectExport() is separated out for unit testing without a DB.

import type { SupabaseClient } from "@supabase/supabase-js";

export type EraseMode = "anonymize" | "delete";

export interface SubjectExport {
  exported_at: string;
  tenant_id: string;
  guest: any | null;
  reservations: any[];
  waitlist_entries: any[];
  conversations: any[];
  consent_records: any[];
}

/** A tombstone that replaces a subject reference on erasure — keeps the consent
 * ledger row intact (timestamp, category, purpose) while removing the PII. */
export const ERASED_SUBJECT_REF = "[erased]";

/** Resolve a guest within a tenant by id or phone. Returns the guest row or null. */
export async function resolveGuest(
  supabase: SupabaseClient,
  tenant_id: string,
  by: { guest_id?: string; phone?: string },
): Promise<any | null> {
  if (by.guest_id) {
    const { data } = await supabase
      .from("guests").select("*").eq("tenant_id", tenant_id).eq("id", by.guest_id).maybeSingle();
    if (data) return data;
  }
  if (by.phone) {
    const { data } = await supabase
      .from("guests").select("*").eq("tenant_id", tenant_id).eq("phone", by.phone).maybeSingle();
    if (data) return data;
  }
  return null;
}

/** PURE: fold the per-store query results into one export object. */
export function buildSubjectExport(
  tenant_id: string,
  nowISO: string,
  rows: {
    guest: any | null;
    reservations: any[];
    waitlist_entries: any[];
    conversations: any[];
    consent_records: any[];
  },
): SubjectExport {
  return {
    exported_at: nowISO,
    tenant_id,
    guest: rows.guest ?? null,
    reservations: rows.reservations || [],
    waitlist_entries: rows.waitlist_entries || [],
    conversations: rows.conversations || [],
    consent_records: rows.consent_records || [],
  };
}

/**
 * Gather everything we hold about a guest (access + portability request). The
 * guest must be resolved first (by id or phone). Returns the full export, or an
 * export with `guest: null` when the subject isn't found.
 */
export async function gatherSubject(
  supabase: SupabaseClient,
  tenant_id: string,
  by: { guest_id?: string; phone?: string },
  now: Date = new Date(),
): Promise<SubjectExport> {
  const guest = await resolveGuest(supabase, tenant_id, by);
  if (!guest) {
    return buildSubjectExport(tenant_id, now.toISOString(), {
      guest: null, reservations: [], waitlist_entries: [], conversations: [], consent_records: [],
    });
  }
  const gid = guest.id as string;
  const [reservations, waitlist, conversations, consents] = await Promise.all([
    supabase.from("reservations").select("*").eq("tenant_id", tenant_id).eq("guest_id", gid),
    supabase.from("waitlist_entries").select("*").eq("tenant_id", tenant_id).eq("guest_id", gid),
    supabase.from("conversations").select("*").eq("tenant_id", tenant_id).eq("guest_id", gid),
    supabase.from("consent_records").select("*").eq("tenant_id", tenant_id).eq("guest_id", gid),
  ]);
  return buildSubjectExport(tenant_id, now.toISOString(), {
    guest,
    reservations: (reservations as any).data || [],
    waitlist_entries: (waitlist as any).data || [],
    conversations: (conversations as any).data || [],
    consent_records: (consents as any).data || [],
  });
}

export interface EraseResult {
  ok: boolean;
  mode: EraseMode;
  guest_id: string | null;
  /** Human summary of what was removed/anonymized, for the audit log + UI. */
  affected: {
    guest: boolean;
    reservations: number;
    waitlist_entries: number;
    conversations: number;
    consent_tombstoned: number;
  };
  error?: string;
}

/**
 * Erase a subject. Resolves the guest, then either anonymizes in place or hard-
 * deletes (relying on FK cascades), and ALWAYS tombstones the consent ledger so it
 * survives without PII. Returns a summary; never throws (returns {ok:false,error}).
 */
export async function eraseSubject(
  supabase: SupabaseClient,
  tenant_id: string,
  by: { guest_id?: string; phone?: string },
  mode: EraseMode = "anonymize",
): Promise<EraseResult> {
  const empty: EraseResult["affected"] = {
    guest: false, reservations: 0, waitlist_entries: 0, conversations: 0, consent_tombstoned: 0,
  };
  try {
    const guest = await resolveGuest(supabase, tenant_id, by);
    if (!guest) return { ok: false, mode, guest_id: null, affected: empty, error: "subject not found" };
    const gid = guest.id as string;

    // Count what we're about to touch (best-effort; nulls → 0).
    const [rc, wc, cc] = await Promise.all([
      supabase.from("reservations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id).eq("guest_id", gid),
      supabase.from("waitlist_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id).eq("guest_id", gid),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id).eq("guest_id", gid),
    ]);
    const affected: EraseResult["affected"] = {
      guest: true,
      reservations: (rc as any).count || 0,
      waitlist_entries: (wc as any).count || 0,
      conversations: (cc as any).count || 0,
      consent_tombstoned: 0,
    };

    // Always tombstone the consent ledger (strip PII, keep the accountability fact).
    const { data: tomb } = await supabase
      .from("consent_records")
      .update({ subject_ref: ERASED_SUBJECT_REF, evidence: null, guest_id: null })
      .eq("tenant_id", tenant_id)
      .eq("guest_id", gid)
      .select("id");
    affected.consent_tombstoned = (tomb as any[])?.length || 0;

    if (mode === "delete") {
      // Hard delete the guest — FK cascades remove reservations/conversations/waitlist.
      const { error } = await supabase.from("guests").delete().eq("tenant_id", tenant_id).eq("id", gid);
      if (error) return { ok: false, mode, guest_id: gid, affected, error: error.message };
      return { ok: true, mode, guest_id: gid, affected };
    }

    // Anonymize in place: strip every identifier + free-text PII on the guest, and
    // clear the sensitive/free-text fields on their reservations. Aggregate counters
    // (visit_count etc.) are kept — they carry no identity.
    const { error: gErr } = await supabase
      .from("guests")
      .update({
        name: ERASED_SUBJECT_REF,
        phone: "",
        email: null,
        notes: "",
        dietary_notes: null,
        accessibility_notes: null,
        family_notes: null,
        tags: [],
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenant_id)
      .eq("id", gid);
    if (gErr) return { ok: false, mode, guest_id: gid, affected, error: gErr.message };

    // Clear free-text PII on the guest's reservations (keep the booking rows for
    // accounting; drop the notes/allergies that identify or reveal health).
    await supabase
      .from("reservations")
      .update({ notes: "", allergies: null })
      .eq("tenant_id", tenant_id)
      .eq("guest_id", gid);

    // Transcripts are pure PII with no business-record value → delete them.
    await supabase.from("conversations").delete().eq("tenant_id", tenant_id).eq("guest_id", gid);
    await supabase.from("waitlist_entries").delete().eq("tenant_id", tenant_id).eq("guest_id", gid);

    return { ok: true, mode, guest_id: gid, affected };
  } catch (e: any) {
    return { ok: false, mode, guest_id: null, affected: empty, error: e?.message || "erase failed" };
  }
}
