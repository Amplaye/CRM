// Localized display labels for menu allergens and tags.
//
// Allergens and tags are STORED as fixed Italian canonical tokens (the closed
// lists in extract.ts: ALLOWED_ALLERGENS / ALLOWED_TAGS). That keeps the AI
// extraction, the DB, and the bot/voice menu reader on one stable vocabulary —
// we never translate the stored value. Translation happens only at render time,
// here, so a Spanish/English/German CRM (and the public menu page) shows
// "Gluten" / "Lactose" / "Vegan" instead of the raw Italian "glutine" token.
//
// The keys below MUST stay in sync with ALLOWED_ALLERGENS and ALLOWED_TAGS in
// extract.ts. If a token is added there, add its 4 labels here too — otherwise
// the chip falls back to a prettified raw token (still readable, just untranslated).

export type MenuLocale = "it" | "es" | "en" | "de";

// The 14 EU-regulated allergens (Reg. 1169/2011, Annex II), keyed by the Italian
// canonical token used in storage.
const ALLERGEN_LABELS: Record<string, Record<MenuLocale, string>> = {
  glutine: { it: "Glutine", es: "Gluten", en: "Gluten", de: "Gluten" },
  latticini: { it: "Latticini", es: "Lácteos", en: "Dairy", de: "Milch" },
  uova: { it: "Uova", es: "Huevo", en: "Egg", de: "Ei" },
  pesce: { it: "Pesce", es: "Pescado", en: "Fish", de: "Fisch" },
  crostacei: { it: "Crostacei", es: "Crustáceos", en: "Crustaceans", de: "Krebstiere" },
  frutta_secca: { it: "Frutta a guscio", es: "Frutos secos", en: "Tree nuts", de: "Schalenfrüchte" },
  arachidi: { it: "Arachidi", es: "Cacahuetes", en: "Peanuts", de: "Erdnüsse" },
  soia: { it: "Soia", es: "Soja", en: "Soy", de: "Soja" },
  sedano: { it: "Sedano", es: "Apio", en: "Celery", de: "Sellerie" },
  senape: { it: "Senape", es: "Mostaza", en: "Mustard", de: "Senf" },
  sesamo: { it: "Sesamo", es: "Sésamo", en: "Sesame", de: "Sesam" },
  solfiti: { it: "Solfiti", es: "Sulfitos", en: "Sulphites", de: "Sulfite" },
  lupini: { it: "Lupini", es: "Altramuces", en: "Lupin", de: "Lupinen" },
  molluschi: { it: "Molluschi", es: "Moluscos", en: "Molluscs", de: "Weichtiere" },
};

const TAG_LABELS: Record<string, Record<MenuLocale, string>> = {
  vegano: { it: "Vegano", es: "Vegano", en: "Vegan", de: "Vegan" },
  vegetariano: { it: "Vegetariano", es: "Vegetariano", en: "Vegetarian", de: "Vegetarisch" },
  piccante: { it: "Piccante", es: "Picante", en: "Spicy", de: "Scharf" },
  consigliato: { it: "Consigliato", es: "Recomendado", en: "Recommended", de: "Empfohlen" },
  novita: { it: "Novità", es: "Novedad", en: "New", de: "Neu" },
  specialita: { it: "Specialità", es: "Especialidad", en: "House special", de: "Spezialität" },
};

// Localized display names for the "classic" collections, keyed by `kind`. A
// custom collection (kind = null) is shown with its user-given name instead.
// Self-contained union (mirrors CollectionKind in types/index.ts) so this module
// stays dependency-free, same as MenuLocale.
export type CollectionKind = "consigliati" | "menu_del_giorno" | "specialita" | "novita";

const COLLECTION_LABELS: Record<CollectionKind, Record<MenuLocale, string>> = {
  consigliati: { it: "Consigliati", es: "Recomendados", en: "Recommended", de: "Empfehlungen" },
  menu_del_giorno: { it: "Menu del giorno", es: "Menú del día", en: "Menu of the day", de: "Tagesmenü" },
  specialita: {
    it: "Specialità della casa",
    es: "Especialidades de la casa",
    en: "House specials",
    de: "Spezialitäten des Hauses",
  },
  novita: { it: "Novità", es: "Novedades", en: "New", de: "Neuheiten" },
};

// Prettify an unknown token so an off-list value still reads cleanly
// ("frutta_secca" → "frutta secca") instead of showing the raw underscore.
function prettify(token: string): string {
  return token.replace(/_/g, " ");
}

/** Localized label for a stored allergen token. Falls back to the prettified token. */
export function allergenLabel(token: string, locale: MenuLocale): string {
  return ALLERGEN_LABELS[token]?.[locale] ?? prettify(token);
}

/** Localized label for a stored tag token. Falls back to the prettified token. */
export function tagLabel(token: string, locale: MenuLocale): string {
  return TAG_LABELS[token]?.[locale] ?? prettify(token);
}

/**
 * Display name for a collection. Classic collections (a known `kind`) get the
 * localized name; custom collections (kind = null) show their user-given name.
 */
export function collectionLabel(
  kind: CollectionKind | null,
  customName: string,
  locale: MenuLocale
): string {
  if (kind && COLLECTION_LABELS[kind]) return COLLECTION_LABELS[kind][locale];
  return customName;
}

/** The classic collection kinds, in the order they should be offered/displayed. */
export const CLASSIC_COLLECTION_KINDS: CollectionKind[] = [
  "consigliati",
  "menu_del_giorno",
  "specialita",
  "novita",
];
