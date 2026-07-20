/**
 * Announcement selection — the pure half of the "new feature" modal.
 *
 * Deciding WHICH announcement a given user should see is the part with real
 * rules (published, inside its window, right audience, not already dismissed),
 * so it lives here as plain functions the API route calls and the tests cover.
 * No Supabase, no React.
 */

export type AnnouncementLang = "en" | "it" | "es" | "de";
export type L10nText = Partial<Record<AnnouncementLang, string>>;

/** Who gets interrupted. Deliberately coarse — no per-tenant targeting. */
export type AnnouncementAudience = "owner_manager" | "all";

export interface Announcement {
  id: string;
  slug: string;
  title: L10nText;
  body: L10nText;
  cta_label: L10nText;
  cta_href: string | null;
  audience: AnnouncementAudience;
  published: boolean;
  starts_at: string;
  ends_at: string | null;
}

/**
 * Roles that count as "decision makers". `admin` is the legacy DB-enum spelling
 * of owner (see tenant-membership.ts) and platform admins are normalised to
 * `owner` upstream, so both land here.
 */
const DECISION_ROLES = new Set(["owner", "admin", "manager"]);

/** Inside its publication window at `now`. A missing/invalid date never shows. */
export function isLiveAt(a: Announcement, now: Date): boolean {
  if (!a.published) return false;
  const start = Date.parse(a.starts_at);
  if (!Number.isFinite(start) || start > now.getTime()) return false;
  if (a.ends_at) {
    const end = Date.parse(a.ends_at);
    if (!Number.isFinite(end) || end <= now.getTime()) return false;
  }
  return true;
}

/**
 * Audience match. A null role (no membership resolved yet) sees nothing —
 * we would rather skip the announcement than interrupt the wrong person.
 */
export function matchesAudience(a: Announcement, role: string | null): boolean {
  if (!role) return false;
  if (a.audience === "all") return true;
  return DECISION_ROLES.has(role);
}

/**
 * The one to show, or null. Newest start date wins, so publishing a fresh
 * announcement supersedes an older one that is still live.
 */
export function pickAnnouncement(
  list: Announcement[],
  opts: { role: string | null; now: Date; dismissedIds: Iterable<string> }
): Announcement | null {
  const dismissed = new Set(opts.dismissedIds);
  const eligible = list.filter(
    (a) =>
      !dismissed.has(a.id) &&
      isLiveAt(a, opts.now) &&
      matchesAudience(a, opts.role)
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((newest, a) =>
    Date.parse(a.starts_at) > Date.parse(newest.starts_at) ? a : newest
  );
}

/**
 * Read one language out of an L10n blob: asked-for language → English →
 * any non-empty translation → "". Mirrors the i18n t() fallback chain, so a
 * half-translated announcement still renders something rather than a blank.
 */
export function pickText(text: L10nText | null | undefined, lang: string): string {
  if (!text) return "";
  const own = text[lang as AnnouncementLang];
  if (own && own.trim()) return own.trim();
  if (text.en && text.en.trim()) return text.en.trim();
  for (const value of Object.values(text)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * An announcement is publishable only if it says something in at least one
 * language. Used by the admin route to reject an empty publish.
 */
export function hasAnyText(text: L10nText | null | undefined): boolean {
  return pickText(text, "en") !== "";
}

const LANGS: AnnouncementLang[] = ["it", "en", "es", "de"];

/**
 * Normalise an L10n blob coming off the wire: keep only the four supported
 * languages, trim, drop empties. Stops the admin form from persisting
 * whitespace or stray keys into jsonb.
 */
export function sanitizeL10n(input: unknown): L10nText {
  const out: L10nText = {};
  if (!input || typeof input !== "object") return out;
  for (const lang of LANGS) {
    const value = (input as Record<string, unknown>)[lang];
    if (typeof value === "string" && value.trim()) out[lang] = value.trim();
  }
  return out;
}
