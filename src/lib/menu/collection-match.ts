import type { CollectionKind } from "@/lib/types";

// Maps a customer's natural-language phrase to a collection kind, so the bot can
// answer "quali piatti consigliate?" / "¿qué recomiendan?" / "what do you
// recommend?" / "cosa c'è nel menu del giorno?" by returning the right
// collection. Keys are stored already accent-folded + lowercased (see norm()),
// matched as substrings of the (folded) question. Longest key wins so
// "menu del dia" beats a stray "menu".
const COLLECTION_QUERY_SYNONYMS: Record<string, CollectionKind> = {
  // recommended
  consigliati: "consigliati",
  consigliato: "consigliati",
  consigliate: "consigliati",
  consigli: "consigliati",
  recomendados: "consigliati",
  recomendado: "consigliati",
  recomiendan: "consigliati",
  recomienda: "consigliati",
  recomendacion: "consigliati",
  recommended: "consigliati",
  recommend: "consigliati",
  recommendation: "consigliati",
  empfehl: "consigliati", // stem: empfehlen / empfehlung / empfehlungen / empfiehlst
  empfiehl: "consigliati",
  // menu of the day
  "menu del giorno": "menu_del_giorno",
  "menu del dia": "menu_del_giorno",
  "menu of the day": "menu_del_giorno",
  "menu of day": "menu_del_giorno",
  "daily menu": "menu_del_giorno",
  "del giorno": "menu_del_giorno",
  "del dia": "menu_del_giorno",
  tagesmenu: "menu_del_giorno",
  tagesgericht: "menu_del_giorno",
  // house specials
  specialita: "specialita",
  especialidad: "specialita",
  especialidades: "specialita",
  "house special": "specialita",
  "house specials": "specialita",
  "de la casa": "specialita",
  "della casa": "specialita",
  signature: "specialita",
  spezialitat: "specialita",
  spezialitaten: "specialita",
  // new
  novita: "novita",
  novedades: "novita",
  novedad: "novita",
  nuevos: "novita",
  nuevo: "novita",
  "new": "novita", // short, but in a menu question "new" reliably means novelties
  news: "novita",
  neuheiten: "novita",
  neuheit: "novita",
};

// Mirror of the route's accent/case folding so this module is self-contained
// and unit-testable. "Menú del día" → "menu del dia".
export function normForMatch(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Detect a collection intent in a free-text query. Returns the matched kind, or
 * null if the text doesn't look like a "recommended / menu of the day / house
 * special / new" ask. Longest synonym wins.
 */
export function matchCollectionKind(query: string): CollectionKind | null {
  const q = normForMatch(query);
  if (!q) return null;
  let best: { key: string; kind: CollectionKind } | null = null;
  for (const key of Object.keys(COLLECTION_QUERY_SYNONYMS)) {
    if (q.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, kind: COLLECTION_QUERY_SYNONYMS[key] };
    }
  }
  return best?.kind ?? null;
}

// The tag that corresponds to a collection kind, for the "owner tagged dishes
// but built no collection" fallback. menu_del_giorno has no tag analogue.
export const KIND_TO_TAG: Partial<Record<CollectionKind, string>> = {
  consigliati: "consigliato",
  specialita: "specialita",
  novita: "novita",
};
