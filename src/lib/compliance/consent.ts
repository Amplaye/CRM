// Consent log — records and reads the explicit, logged consent we capture before
// processing SENSITIVE (Tier 1) data. The write is invisible to the user (it rides
// along with the one-tap "ok to save this?" affirmative); this module is the code
// that turns that affirmative into the accountability record in consent_records.
//
// Split into a PURE builder (buildConsentRecord — validates + normalizes, no I/O,
// fully unit-testable) and thin DB helpers that use whatever Supabase client the
// caller passes (service-role from the bot/API, so RLS is bypassed on write).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SensitiveCategory } from "./classifier";

export type ConsentChannel = "whatsapp" | "voice" | "web" | "staff";
export type ConsentCategory = SensitiveCategory | "ordinary";

export interface ConsentInput {
  tenant_id: string;
  /** Phone/email/guest-id identifying the subject. Normalized here. */
  subject_ref: string;
  /** What the consent is for, e.g. "store_allergy_for_kitchen". */
  purpose: string;
  data_category?: ConsentCategory;
  channel?: ConsentChannel;
  /** false = explicitly declined/withdrawn (still logged). Default true. */
  granted?: boolean;
  policy_version?: string;
  /** The raw affirmative text the subject sent. */
  evidence?: string;
  /** Hard link to the guest row when known. */
  guest_id?: string | null;
}

export interface ConsentRecord {
  tenant_id: string;
  subject_ref: string;
  purpose: string;
  data_category: ConsentCategory;
  channel: ConsentChannel;
  granted: boolean;
  policy_version: string;
  evidence: string | null;
  guest_id: string | null;
  created_at: string;
}

const VALID_CHANNELS: ConsentChannel[] = ["whatsapp", "voice", "web", "staff"];
const VALID_CATEGORIES: ConsentCategory[] = ["health", "accessibility", "ordinary"];

/** Normalize a subject reference so lookups match writes: trim + lowercase, and for
 * phone-looking values strip spaces/punctuation (keep a leading +). */
export function normalizeSubjectRef(ref: string): string {
  const t = (ref || "").trim().toLowerCase();
  // Phone-ish: mostly digits and separators → collapse to +?digits.
  if (/^[+\d][\d\s().-]{5,}$/.test(t)) {
    const plus = t.startsWith("+") ? "+" : "";
    return plus + t.replace(/\D/g, "");
  }
  return t;
}

/**
 * PURE: validate + normalize a consent input into the row we persist. Throws on the
 * few things that must never be logged wrong (missing tenant/subject/purpose,
 * unknown channel/category). Stamps `created_at` from the passed `nowISO` so it's
 * deterministic in tests.
 */
export function buildConsentRecord(input: ConsentInput, nowISO: string): ConsentRecord {
  const tenant_id = (input.tenant_id || "").trim();
  const subject_ref = normalizeSubjectRef(input.subject_ref || "");
  const purpose = (input.purpose || "").trim();
  if (!tenant_id) throw new Error("consent: tenant_id required");
  if (!subject_ref) throw new Error("consent: subject_ref required");
  if (!purpose) throw new Error("consent: purpose required");

  const data_category: ConsentCategory = input.data_category || "health";
  if (!VALID_CATEGORIES.includes(data_category)) {
    throw new Error(`consent: invalid data_category "${data_category}"`);
  }
  const channel: ConsentChannel = input.channel || "whatsapp";
  if (!VALID_CHANNELS.includes(channel)) {
    throw new Error(`consent: invalid channel "${channel}"`);
  }

  return {
    tenant_id,
    subject_ref,
    purpose,
    data_category,
    channel,
    granted: input.granted !== false,
    policy_version: (input.policy_version || "v1").trim(),
    evidence: input.evidence?.trim() ? input.evidence.trim() : null,
    guest_id: input.guest_id || null,
    created_at: nowISO,
  };
}

/** Persist a consent record. Uses the passed (service-role) client so RLS is
 * bypassed on write. Never throws on a DB error — returns {ok:false, error} so the
 * caller (a chat turn) can log-and-continue rather than break the conversation. */
export async function recordConsent(
  supabase: SupabaseClient,
  input: ConsentInput,
  now: Date = new Date(),
): Promise<{ ok: boolean; record?: ConsentRecord; error?: string }> {
  let row: ConsentRecord;
  try {
    row = buildConsentRecord(input, now.toISOString());
  } catch (e: any) {
    return { ok: false, error: e?.message || "invalid consent input" };
  }
  const { error } = await supabase.from("consent_records").insert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true, record: row };
}

/**
 * Has the subject given a still-valid, granted consent for this purpose? "Valid"
 * = the MOST RECENT record for (tenant, subject, purpose) is `granted = true`
 * (a later `granted = false` withdrawal wins). Returns false on any DB error.
 */
export async function hasValidConsent(
  supabase: SupabaseClient,
  args: { tenant_id: string; subject_ref: string; purpose: string },
): Promise<boolean> {
  const subject_ref = normalizeSubjectRef(args.subject_ref || "");
  if (!args.tenant_id || !subject_ref || !args.purpose) return false;
  const { data, error } = await supabase
    .from("consent_records")
    .select("granted")
    .eq("tenant_id", args.tenant_id)
    .eq("subject_ref", subject_ref)
    .eq("purpose", args.purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  return data.granted === true;
}

/** List a subject's consent trail (newest first) — for the admin panel / DSAR
 * export. When `subject_ref` is omitted, lists the whole tenant's trail. */
export async function listConsents(
  supabase: SupabaseClient,
  tenant_id: string,
  subject_ref?: string,
): Promise<ConsentRecord[]> {
  let q = supabase
    .from("consent_records")
    .select("*")
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false });
  if (subject_ref) q = q.eq("subject_ref", normalizeSubjectRef(subject_ref));
  const { data } = await q;
  return (data as ConsentRecord[]) || [];
}
