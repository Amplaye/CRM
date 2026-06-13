// Reservation notes & zone helpers — keep guest-facing notes CLEAN.
//
// The booking/modify flow used to append INTERNAL routing state to a
// reservation's free-text `notes`: the zone preference ("Prefiere interior"),
// the large-group flag ("Grupo grande, pendiente de revision"), waitlist and
// capacity markers — all in Spanish, regardless of the guest's language. That
// state belongs in structured columns (`status`, `tags`), never in the note the
// guest reads back. These helpers strip the legacy phrases and store the zone
// preference as a `tags` entry instead.

/** Internal phrases the old code appended to notes. Removed in-place (not by
 *  splitting) so a marker glued onto the guest's text with ". " or "," never
 *  takes the guest's own words down with it. */
const INTERNAL_NOTE_PHRASES: RegExp[] = [
  /Grupo\s+grande\s*[-—,]?\s*(?:pendiente\s+de\s+revisi[oó]n|solicitud\s+pendiente)/gi,
  /Prefiere\s+(?:interior|exterior)/gi,
  /GRUPO\s+MODIFICADO\s+A\s+\d+\s+PERSONAS\s*—?\s*REVISAR/gi,
  /GRUPO\s+GRANDE\s*—?\s*REVISAR/gi,
  /Sin\s+capacidad\s+tras\s+modificaci[oó]n[^—]*/gi,
  /Ampliaci[oó]n\s+a\s+\d+\s+pax[^—]*/gi,
  /Sin\s+plazas[^—]*?(?:lista\s+de\s+espera|turno|zona|confirmar)[^—]*/gi,
  /a[ñn]adido\s+a\s+lista\s+de\s+espera/gi,
  /No\s+hay\s+suficientes\s+mesas,?\s*pendiente\s+de\s+revisi[oó]n/gi,
  /Oferta\s+(?:desde|de)\s+lista\s+de\s+espera[^—]*/gi,
  /esperando\s+CONFIRMO[^—]*/gi,
  /pendiente\s+de\s+revisi[oó]n/gi,
  /solicitud\s+pendiente/gi,
];

/** Strip the internal routing annotations, leaving only the guest's own note. */
export function cleanGuestNotes(raw?: string | null): string {
  if (!raw) return "";
  let s = String(raw);
  for (const re of INTERNAL_NOTE_PHRASES) s = s.replace(re, "");
  return s
    .replace(/\s*[—–]\s*/g, " — ") // normalise dash separators
    .replace(/(?:\s*—\s*)+/g, " — ") // collapse repeated separators left by removals
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[\s,.\-—]+|[\s,.\-—]+$/g, "") // trim leftover punctuation/separators
    .trim();
}

/** The zone preference as a `tags` entry (empty when no preference). */
export function zoneTag(zone?: "inside" | "outside" | null): string[] {
  return zone === "inside" || zone === "outside" ? [`zone:${zone}`] : [];
}

/** Read the zone preference from a `tags` array, if present. */
export function zoneFromTags(tags?: unknown): "inside" | "outside" | null {
  if (!Array.isArray(tags)) return null;
  if (tags.includes("zone:inside")) return "inside";
  if (tags.includes("zone:outside")) return "outside";
  return null;
}

/** Legacy fallback: zone used to live in notes as "Prefiere interior/exterior".
 *  Read it for rows created before the move to `tags`. */
export function zoneFromLegacyNotes(notes?: string | null): "inside" | "outside" | null {
  const m = String(notes || "").match(/Prefiere\s+(interior|exterior)/i);
  return m ? (m[1].toLowerCase() === "interior" ? "inside" : "outside") : null;
}

/** Zone preference, tags first then legacy notes — the single read path. */
export function readZonePref(tags?: unknown, notes?: string | null): "inside" | "outside" | null {
  return zoneFromTags(tags) ?? zoneFromLegacyNotes(notes);
}

/** Return `tags` with the zone:* entry set to `zone` (replacing any existing). */
export function withZoneTag(tags: unknown, zone?: "inside" | "outside" | null): string[] {
  const base = (Array.isArray(tags) ? tags : []).filter(
    (t) => t !== "zone:inside" && t !== "zone:outside",
  );
  return [...base, ...zoneTag(zone)];
}
