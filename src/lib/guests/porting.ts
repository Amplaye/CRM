// Guest data portability — bulk EXPORT (backup / take-your-data-with-you) and
// bulk IMPORT (a restaurant arriving with an existing customer base). Distinct from
// the per-subject DSAR flow: this is the whole guest book at once, for onboarding
// and portability.
//
// All logic here is PURE and testable (parse, column mapping, dedup planning); the
// page wires it to the tenant-scoped Supabase client (RLS enforces the tenant, and
// the plan gate applies), so no new server surface is introduced.
//
// Design:
//   • Export writes EVERY meaningful guest field with a stable header, so a re-import
//     is lossless.
//   • Import auto-detects the incoming column names in EN/IT/ES/DE (a restaurant's
//     old export won't use our headers), maps them, and DEDUPES by normalized phone
//     against the existing guest book — so re-importing updates instead of creating
//     duplicates. Rows without a name AND phone are skipped, never guessed.

/** The canonical guest fields we export/import, in order. `visit_count` etc. are
 * exported for completeness but NOT overwritten on import (they're our counters). */
export const EXPORT_HEADERS = [
  "name", "phone", "email",
  "visit_count", "no_show_count", "cancellation_count",
  "tags", "notes", "dietary_notes", "accessibility_notes", "family_notes",
  "estimated_spend", "created_at",
] as const;

/** A guest as parsed from an import file (the writable subset). */
export interface GuestPortRow {
  name: string;
  phone: string;
  email: string | null;
  notes: string;
  dietary_notes: string | null;
  accessibility_notes: string | null;
  family_notes: string | null;
  tags: string[];
  estimated_spend: number | null;
}

/** Minimal existing-guest shape the dedup planner needs. */
export interface ExistingGuest {
  id: string;
  phone: string | null;
  [k: string]: any;
}

// ── CSV primitives ───────────────────────────────────────────────────────────

/** Escape one CSV cell (RFC 4180): wrap in quotes, double any inner quote. */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Robust CSV parser: handles quoted fields containing commas, embedded newlines
 * and escaped quotes (""), plus CRLF line endings. Returns rows of string cells.
 * (The old split-on-\n parser broke on any note containing a newline or comma.)
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present (Excel exports add one).
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++; // consume CRLF as one
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  // Flush the last cell/row unless the file ended on a clean newline.
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  // Drop rows that are entirely empty (e.g. a trailing blank line).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Build the full export CSV (header + one row per guest, all fields). */
export function guestsToCsv(guests: any[]): string {
  const header = EXPORT_HEADERS.map(csvCell).join(",");
  const lines = (guests || []).map((g) =>
    EXPORT_HEADERS.map((h) => {
      if (h === "tags") return csvCell(Array.isArray(g.tags) ? g.tags.join(";") : "");
      return csvCell(g[h]);
    }).join(","),
  );
  return [header, ...lines].join("\r\n");
}

// ── Column mapping (multilingual header → our field) ─────────────────────────

type Field = keyof Omit<GuestPortRow, never>;

/** Accent-insensitive lowercase for header matching. */
function norm(h: string): string {
  return (h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Header synonyms per field, EN/IT/ES/DE. Matched by exact normalized equality or
 * "contains" for the compound ones. */
const HEADER_SYNONYMS: Record<Field, string[]> = {
  name: ["name", "nome", "nombre", "cliente", "guest", "full name", "nome cliente", "customer"],
  phone: ["phone", "telefono", "tel", "mobile", "cellulare", "movil", "numero", "number", "whatsapp", "telefon", "phone number"],
  email: ["email", "e-mail", "mail", "correo", "correo electronico", "posta"],
  notes: ["notes", "note", "notas", "notizen", "anmerkung", "commenti", "comment", "comments"],
  dietary_notes: ["dietary", "dietary notes", "allergies", "allergy", "allergie", "allergien", "allergia", "alergias", "alergia", "dieta", "note dietetiche", "restrizioni", "restrictions", "unvertraglichkeiten", "intolleranze"],
  accessibility_notes: ["accessibility", "accessibilita", "accesibilidad", "barrierefrei", "mobility", "movilidad", "accessibility notes"],
  family_notes: ["family", "famiglia", "familia", "familie", "kids", "children", "bambini", "ninos", "family notes"],
  tags: ["tags", "tag", "etichette", "etiquetas", "labels", "label"],
  estimated_spend: ["estimated_spend", "estimated spend", "spend", "spesa", "spesa media", "gasto", "ticket", "ticket medio", "avg spend"],
};

/** Detect which incoming column index feeds each of our fields. Returns a partial
 * map (fields whose column wasn't found are absent). First matching column wins. */
export function detectColumnMapping(headers: string[]): Partial<Record<Field, number>> {
  const normed = headers.map(norm);
  const map: Partial<Record<Field, number>> = {};
  (Object.keys(HEADER_SYNONYMS) as Field[]).forEach((field) => {
    const syns = HEADER_SYNONYMS[field];
    let idx = normed.findIndex((h) => syns.includes(h));
    if (idx === -1) idx = normed.findIndex((h) => h && syns.some((s) => h.includes(s)));
    if (idx !== -1) map[field] = idx;
  });
  return map;
}

/** Normalize a phone to compare across systems (so a re-import updates instead of
 * duplicating). Digits only, and the international-access prefix `00` is folded to
 * `+`, so "+34 612 345 678", "0034612345678" and "(+34) 612-345-678" all compare
 * equal. A single national leading zero (e.g. Italian "06…") is left untouched. */
export function normalizePhone(phone: string | null | undefined): string {
  const t = (phone || "").trim();
  if (!t) return "";
  const digits = t.replace(/\D/g, "");
  if (!digits) return "";
  if (t.startsWith("+")) return "+" + digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  return digits;
}

function cell(row: string[], idx: number | undefined): string {
  return idx == null ? "" : (row[idx] || "").trim();
}

/**
 * Turn parsed CSV rows (INCLUDING the header row) into normalized guest inputs.
 * Rows missing BOTH a usable name and phone are skipped and counted. `tags` are
 * split on ; | or , inside the (already single) cell.
 */
export function rowsToGuestInputs(
  rows: string[][],
): { mapping: Partial<Record<Field, number>>; guests: GuestPortRow[]; skipped: number } {
  if (!rows.length) return { mapping: {}, guests: [], skipped: 0 };
  const [header, ...body] = rows;
  const mapping = detectColumnMapping(header);
  const guests: GuestPortRow[] = [];
  let skipped = 0;

  for (const row of body) {
    const name = cell(row, mapping.name);
    const phone = cell(row, mapping.phone);
    // A guest needs at least a name or a phone to be useful; require at least one,
    // and require a name for insert-worthiness (a bare phone with no name is kept
    // too — name falls back to the phone so the row isn't lost).
    if (!name && !phone) { skipped++; continue; }
    const tagsRaw = cell(row, mapping.tags);
    const spendRaw = cell(row, mapping.estimated_spend).replace(",", ".").replace(/[^\d.-]/g, "");
    const spend = spendRaw ? Number(spendRaw) : NaN;
    guests.push({
      name: name || phone,
      phone,
      email: cell(row, mapping.email) || null,
      notes: cell(row, mapping.notes),
      dietary_notes: cell(row, mapping.dietary_notes) || null,
      accessibility_notes: cell(row, mapping.accessibility_notes) || null,
      family_notes: cell(row, mapping.family_notes) || null,
      tags: tagsRaw ? tagsRaw.split(/[;|,]/).map((s) => s.trim()).filter(Boolean) : [],
      estimated_spend: Number.isFinite(spend) ? spend : null,
    });
  }
  return { mapping, guests, skipped };
}

// ── Import planning (dedup by phone) ─────────────────────────────────────────

export interface ImportPlan {
  /** New guests to insert (no phone match in the existing book). */
  toInsert: GuestPortRow[];
  /** Existing guests to update (phone matched), with the merged writable fields. */
  toUpdate: Array<{ id: string; fields: Partial<GuestPortRow> }>;
  /** Rows skipped upstream (no name/phone). */
  skipped: number;
  /** Incoming rows collapsed because the same phone appeared twice in the file. */
  duplicatesInFile: number;
}

/** Merge two rows that share a phone within the same file: keep `base`'s non-empty
 * values, fill the gaps from `extra`, and union the tags — so no data is lost when
 * the same customer appears twice (e.g. one row has the email, another the allergy). */
function mergeRows(base: GuestPortRow, extra: GuestPortRow): GuestPortRow {
  return {
    name: base.name || extra.name,
    phone: base.phone || extra.phone,
    email: base.email || extra.email,
    notes: base.notes || extra.notes,
    dietary_notes: base.dietary_notes || extra.dietary_notes,
    accessibility_notes: base.accessibility_notes || extra.accessibility_notes,
    family_notes: base.family_notes || extra.family_notes,
    tags: Array.from(new Set([...(base.tags || []), ...(extra.tags || [])])),
    estimated_spend: base.estimated_spend ?? extra.estimated_spend,
  };
}

/** Only non-empty incoming values overwrite; empty cells never wipe existing data. */
function mergedFields(incoming: GuestPortRow): Partial<GuestPortRow> {
  const out: Partial<GuestPortRow> = { name: incoming.name };
  if (incoming.email) out.email = incoming.email;
  if (incoming.notes) out.notes = incoming.notes;
  if (incoming.dietary_notes) out.dietary_notes = incoming.dietary_notes;
  if (incoming.accessibility_notes) out.accessibility_notes = incoming.accessibility_notes;
  if (incoming.family_notes) out.family_notes = incoming.family_notes;
  if (incoming.tags.length) out.tags = incoming.tags;
  if (incoming.estimated_spend != null) out.estimated_spend = incoming.estimated_spend;
  return out;
}

/**
 * Build the insert/update plan by matching normalized phones against the existing
 * guest book. Within the file, a repeated phone collapses to the LAST occurrence
 * (later rows win) and is counted. A row with no phone can't be deduped → insert.
 */
export function planImport(
  incoming: GuestPortRow[],
  existing: ExistingGuest[],
  precomputedSkipped = 0,
): ImportPlan {
  const existingByPhone = new Map<string, ExistingGuest>();
  for (const g of existing) {
    const p = normalizePhone(g.phone);
    if (p) existingByPhone.set(p, g);
  }

  // Collapse in-file duplicates by phone (keep last), preserving order of first sight.
  const order: string[] = [];
  const byPhone = new Map<string, GuestPortRow>();
  const noPhone: GuestPortRow[] = [];
  let duplicatesInFile = 0;
  for (const row of incoming) {
    const p = normalizePhone(row.phone);
    if (!p) { noPhone.push(row); continue; }
    if (byPhone.has(p)) { byPhone.set(p, mergeRows(byPhone.get(p)!, row)); duplicatesInFile++; }
    else { order.push(p); byPhone.set(p, row); }
  }

  const toInsert: GuestPortRow[] = [];
  const toUpdate: ImportPlan["toUpdate"] = [];
  for (const p of order) {
    const row = byPhone.get(p)!;
    const match = existingByPhone.get(p);
    if (match) toUpdate.push({ id: match.id, fields: mergedFields(row) });
    else toInsert.push(row);
  }
  // Phone-less rows can only ever be inserts.
  toInsert.push(...noPhone);

  return { toInsert, toUpdate, skipped: precomputedSkipped, duplicatesInFile };
}
