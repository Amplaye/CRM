// Shelf-life suggestions by ingredient name. A supplier invoice almost never
// prints a use-by date, and a non-expert owner shouldn't have to guess how many
// days mozzarella keeps. So we match the product name against a small table of
// typical restaurant shelf lives and SUGGEST a value — always editable, and
// null when we can't tell (never a confident wrong guess).
//
// Ordered, first match wins: long-life qualifiers ("in scatola", "surgelato",
// "secca") are checked before the fresh categories, so "tonno in scatola" reads
// as pantry (365d) while plain "tonno" reads as fresh fish (2d).

type Preset = { keywords: string[]; days: number };

// Days are conservative "fresh from delivery" figures for a working kitchen,
// not sealed-warehouse maximums.
const PRESETS: Preset[] = [
  // Frozen
  { keywords: ["surgelat", "congelat", "gelato"], days: 180 },
  // Pantry / canned / dry qualifiers (beat the fresh categories below)
  { keywords: ["in scatola", "scatoletta", "in barattolo", "sott'olio", "sottolio", "sott olio", "essiccat", "disidratat", "liofilizzat"], days: 365 },
  // Dry staples
  { keywords: ["farina", "zucchero", "riso", "pasta secca", "semola", "legumi", "fagioli", "ceci", "lenticchie", "olio ", "aceto", "conserva", "pelati", "passata", "concentrato", "caffè", "caffe", "spezie", "zafferano", "lievito", "sale "], days: 365 },
  // Beverages
  { keywords: ["vino", "birra", "acqua", "bibita", "bevanda", "coca", "succo", "spumante", "prosecco", "liquore", "amaro", "aperitiv"], days: 365 },
  // Aged cheese
  { keywords: ["parmigiano", "grana", "pecorino", "provolone", "stagionat", "asiago"], days: 60 },
  // Cured meats
  { keywords: ["prosciutto", "salame", "salami", "mortadella", "speck", "bresaola", "guanciale", "pancetta", "coppa", "culatello", "salumi"], days: 20 },
  // Eggs
  { keywords: ["uova", "uovo"], days: 21 },
  // Fresh dairy
  { keywords: ["mozzarella", "bufala", "fiordilatte", "fior di latte", "burrata", "stracciatella", "ricotta", "mascarpone", "panna", "latte", "yogurt", "yoghurt", "stracchino", "crescenza", "robiola", "scamorza"], days: 5 },
  // Fresh fish / seafood
  { keywords: ["pesce", "gamber", "cozze", "vongole", "salmone", "tonno", "branzino", "orata", "calamar", "polpo", "seppia", "alici", "acciughe", "frutti di mare", "crostacei", "baccalà", "baccala"], days: 2 },
  // Fresh meat / poultry
  { keywords: ["pollo", "tacchino", "carne", "manzo", "vitello", "maiale", "macinat", "salsiccia", "hamburger", "agnello", "coniglio", "fesa", "petto", "bistecca", "braciol"], days: 3 },
  // Fresh pasta / bread
  { keywords: ["pasta fresca", "gnocchi", "ravioli", "tortellini", "tagliatelle fresche", "pane", "focaccia", "impasto"], days: 3 },
  // Vegetables / fruit / herbs (long-keeping roots deliberately left out)
  { keywords: ["insalata", "lattuga", "rucola", "pomodor", "zucchin", "melanzan", "peperone", "funghi", "verdura", "ortagg", "basilico", "prezzemolo", "spinaci", "carote", "frutta", "limon", "mela", "banana", "fragole", "agrumi"], days: 5 },
];

/** Normalized haystack for matching: lowercase, collapsed spaces. */
function norm(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Suggested shelf life in days for an ingredient name, or null when unknown.
 * A hint to pre-fill `shelf_life_days`, never authoritative.
 */
export function suggestShelfLife(name: string | null | undefined): number | null {
  if (!name) return null;
  const h = norm(name);
  if (!h) return null;
  for (const p of PRESETS) {
    if (p.keywords.some((k) => h.includes(k))) return p.days;
  }
  return null;
}
