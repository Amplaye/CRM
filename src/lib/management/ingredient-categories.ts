// Warehouse categories — how a storeroom is actually organised.
//
// The Inventory page used to group stock by MENU category, inferred from which
// dishes used an ingredient in a recipe. That reads the shelf through the menu:
// an onion had no place until a recipe claimed it, and the same onion showed up
// under Antipasti, Primi and Secondi at once. A warehouse is filed by what a
// thing IS, so the category lives on the ingredient and every row sits in
// exactly one bucket.
//
// The slug is the stored value; the label is translated at render time, so
// renaming "Bevande" never touches a single row. Free text in the DB — a tenant
// stocking something the list doesn't cover is never blocked.
//
// Pure and total: no DB, no I/O.

export const INGREDIENT_CATEGORIES = [
  "meat",
  "fish",
  "vegetables",
  "fruit",
  "dairy",
  "eggs",
  "cured_meats",
  "flour_cereals",
  "pasta_rice",
  "preserves",
  "spices",
  "oil_vinegar",
  "soft_drinks",
  "wine",
  "beer",
  "spirits",
  "frozen",
  "bread_pastry",
  "consumables",
  "other",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

/** Dictionary key for a category's display label. */
export const categoryLabelKey = (c: string) => `ing_cat_${c}` as const;

export function isIngredientCategory(v: string): v is IngredientCategory {
  return (INGREDIENT_CATEGORIES as readonly string[]).includes(v);
}

// ── Auto-classification ─────────────────────────────────────────────────────
//
// 181 ingredients already sit in the warehouse uncategorised, and nobody is
// going to file them by hand. Each category carries keyword stems matched
// against the normalised name, so an import lands pre-filed and the owner only
// corrects the misses.
//
// Stems are Italian, Spanish AND English: real warehouses in this product are
// mixed-language ("Zumo De Limon", "Queso Cheddar", "Sushi Rice" all sit in the
// same tenant), so an Italian-only list would dump most of the shelf into
// "other".
//
// Order matters: the list is scanned top-down and the FIRST hit wins, so
// narrower categories must precede broader ones that share a stem. The rule of
// thumb is that a PROCESSED good is named after the raw material it came from,
// so processed categories go first: "Pomodori pelati" and "Zumo de limon" are a
// preserve and a drink, not a vegetable and a fruit. Same reason "aceto di
// vino" beats wine, "spinaci surgelati" beats vegetables, and "bresaola di
// manzo" beats meat.

interface CategoryRule {
  category: IngredientCategory;
  /** Substrings matched against the accent-stripped lowercase name. */
  stems: string[];
}

const RULES: CategoryRule[] = [
  // ── Processed / prepared goods first ──────────────────────────────────────
  // These are named after the raw material they came from, so they must win
  // before the produce rules claim them.

  { category: "frozen", stems: ["surgelat", "congelat", "frozen", "helado", "iqf"] },

  // Vinegar before wine, so "aceto di vino" doesn't file itself as wine.
  { category: "oil_vinegar", stems: ["olio", "oliva", "aceto", "extraverg", "extra verg", "strutto", "vinagre", "vinegar", "aceite", "oil"] },

  // Sauces, jams, purées, tinned goods. Before produce ("pomodori pelati",
  // "pure de mango") and before dairy ("salsa cheddar" is a sauce).
  { category: "preserves", stems: ["pelati", "polpa pomodor", "polpa di pomodor", "passata", "concentrato", "conserv", "sottolio", "sott'olio", "sottacet", "capperi", "alcaparr", "olive ", "aceitun", "marmellat", "mermelad", "confettur", "miele", "miel", "honey", "senape", "mostard", "mostaz", "mustard", "maionese", "mayones", "veganesa", "ketchup", "salsa", "aderezo", "sugo", "pesto", "brodo", "caldo", "dado", "tabasco", "chipotle", "jalapeno", "pico de gallo", "guacamole", "hummus", "tahin", "soia", "soy", "hoisin", "worcester", "angostura", "granadina", "coulis", "pure de", "pure di", "in scatola", "encurtid", "pepinillo", "sauce", "jam", "bbq", "chutney", "dressing"] },

  { category: "cured_meats", stems: ["prosciutto", "salame", "salam", "speck", "bresaola", "pancetta", "guanciale", "mortadella", "capocollo", "lardo", "wurstel", "wurst", "salsiccia", "nduja", "culatello", "porchetta", "jamon", "chorizo", "cecina", "lomo embuchado", "bacon", "pastrami", "ham"] },

  { category: "eggs", stems: ["uovo", "uova", "huevo", "egg", "tuorlo", "albume", "yema", "clara de huevo", "frittata", "omelette"] },

  { category: "dairy", stems: ["latte", "leche", "panna", "nata ", "nata agria", "burro", "mantequilla", "yogur", "formagg", "queso", "cheese", "mozzarella", "bufala", "parmigian", "grana", "pecorino", "ricotta", "requeson", "mascarpone", "stracchino", "gorgonzola", "provola", "scamorza", "caciocavallo", "asiago", "fontina", "taleggio", "robiola", "brie", "camembert", "emmental", "cheddar", "gouda", "feta", "burrata", "stracciatella", "philadelphia", "creme fraiche", "kefir", "butter", "cream"] },

  { category: "bread_pastry", stems: ["pane", "panino", "pan ", "pan brioche", "pangrattat", "baguette", "focacc", "piadina", "tortilla", "grissini", "cracker", "nachos", "tortilla chips", "fette biscottate", "brioche", "cornetto", "croissant", "torta", "tarta", "dolce", "dolci", "postre", "biscott", "galleta", "cioccolat", "chocolate", "cacao", "zucchero", "azucar", "sugar", "gelato", "pasticc", "sfoglia", "pizza", "impasto", "masa", "bun", "bread", "waffle", "pancake"] },

  // ── Drinks (before produce: "zumo de limon" is a drink, not fruit) ────────

  { category: "wine", stems: ["vino", "prosecco", "spumante", "champagne", "franciacorta", "chianti", "barolo", "barbera", "merlot", "cabernet", "sauvignon", "chardonnay", "pinot", "lambrusco", "primitivo", "vermentino", "falanghina", "riesling", "moscato", "rosato", "sidra", "wine", "cava", "rioja", "albarino", "verdejo"] },

  { category: "beer", stems: ["birra", "cerveza", "beer", "lager", "pilsner", "weiss", "stout", "moretti", "peroni", "heineken", "cruzcampo", "estrella", "ichnusa", "mahou"] },

  { category: "spirits", stems: ["grappa", "amaro", "liquore", "licor", "liqueur", "vodka", "ginebra", "gin ", " gin", "ron ", " ron", "rum", "whisky", "whiskey", "bourbon", "jack daniel", "tequila", "mezcal", "brandy", "cognac", "vermouth", "vermut", "martini", "aperol", "campari", "limoncello", "sambuca", "baileys", "cointreau", "triple sec", "malibu", "matusalem", "cordiale", "distillat"] },

  { category: "soft_drinks", stems: ["acqua", "agua", "water", "bibit", "bevand", "refresco", "coca", "cola", "fanta", "sprite", "aranciat", "chinotto", "gassosa", "tonica", "tonic", "succo", "zumo", "juice", "spremut", "tisana", "infusion", "caffe", "cafe", "coffee", "espresso", "sciroppo", "sirope", "red bull", "energy", "kombucha", "horchata"] },

  // ── Raw materials ─────────────────────────────────────────────────────────

  { category: "fish", stems: ["pesce", "pescad", "salmone", "salmon", "tonno", "atun", "tuna", "merluzz", "bacalao", "baccal", "branzino", "lubina", "orata", "dorada", "spigola", "sgombro", "acciug", "anchoa", "alici", "sardin", "gamber", "gamba", "shrimp", "prawn", "langostino", "scampi", "astice", "arago", "cozze", "mejillon", "vongol", "almeja", "calamar", "totano", "polpo", "pulpo", "octopus", "seppi", "sepia", "capesante", "scallop", "vieira", "granchi", "cangrejo", "crab", "pescespada", "platessa", "sogliola", "trota", "trucha", "rombo", "bottarga", "surimi", "tobiko", "nori", "unagi", "sea eel", "toro", "snapper", "fillet", "fish", "anguila", "boquerones", "uni ", "erizo", "sea urchin", "ikura", "hamachi", "sashimi", "gunkan"] },

  { category: "meat", stems: ["carne", "manzo", "vitell", "ternera", "maiale", "cerdo", "cochino", "suino", "bovin", "agnell", "cordero", "pollo", "chicken", "pollame", "tacchino", "pavo", "anatra", "pato", "coniglio", "conejo", "hamburger", "burger", "patty", "macinat", "picada", "costat", "ribs", "filetto", "solomillo", "entrecote", "tagliata", "arrosto", "spezzatino", "ossobuco", "brasato", "petto di", "pechuga", "coscia", "muslo", "alette", "alitas", "fegato", "higado", "trippa", "callos", "beef", "angus", "pork", "lamb", "turkey", "mechado", "pulled"] },

  { category: "vegetables", stems: ["verdur", "ortagg", "insalat", "lechuga", "lattuga", "salad", "rucola", "rucula", "radicchio", "mezclum", "misticanza", "spinaci", "espinaca", "spinach", "bietol", "cicoria", "cavolo", "col ", "cavolfior", "coliflor", "broccol", "brocoli", "verza", "zucchin", "calabacin", "zucchini", "zucca", "calabaza", "melanzan", "berenjena", "peperon", "pimiento", "pepper flake", "pomodor", "tomate", "tomato", "cipoll", "cebolla", "onion", "aglio", "ajo", "garlic", "scalogno", "chalota", "porro", "puerro", "sedano", "apio", "carot", "zanahoria", "patat", "papa", "papas", "potato", "finocchi", "hinojo", "asparag", "esparrago", "carciof", "alcachofa", "funghi", "champin", "champignon", "setas", "mushroom", "porcini", "piselli", "guisante", "fagiolin", "judias", "ceci", "garbanzo", "lenticchi", "lenteja", "fagioli", "frijol", "mais", "maiz", "corn", "cetriol", "pepino", "cucumber", "ravanell", "rabano", "barbabietol", "remolacha", "topinambur", "germogli", "brotes", "puntarelle", "friarielli", "tartufo", "trufa", "truffle", "aguacate", "avocado", "jengibre", "wasabi"] },

  { category: "fruit", stems: ["limon", "lemon", "arance", "arancia", "naranja", "orange", "mandarin", "pompelmo", "pomelo", "grapefruit", "lime", "lima", "mela", "mele ", "manzana", "apple", "pera", "pere ", "banan", "platano", "fragol", "fresa", "strawberr", "lampon", "frambuesa", "mirtill", "arandano", "blueberr", "ciliegi", "cereza", "cherry", "pesca", "pesche", "melocoton", "peach", "albicocc", "albaricoque", "prugn", "ciruela", "susin", "uva", "grape", "melone", "melon", "anguria", "sandia", "cocomero", "kiwi", "ananas", "pina", "pineapple", "mango", "maracuya", "papaya", "fico", "fichi", "higo", "melagran", "granada", "cachi", "frutta", "fruta", "fruit", "frutti di bosco", "cocco", "coco", "coconut", "datter", "datil"] },

  // ── Dry goods & seasonings ────────────────────────────────────────────────

  { category: "pasta_rice", stems: ["pasta", "spaghett", "penne", "rigatoni", "fusilli", "tagliatell", "fettuccin", "linguin", "bucatini", "paccheri", "orecchiett", "gnocch", "noqui", "lasagn", "cannellon", "ravioli", "tortellin", "riso", "arroz", "rice", "risotto", "carnaroli", "arborio", "basmati", "noodle", "ramen", "udon", "fideo"] },

  { category: "flour_cereals", stems: ["farina", "harina", "flour", "semola", "semolino", "avena", "oat", "orzo", "farro", "segale", "centeno", "grano", "trigo", "crusca", "salvado", "amido", "almidon", "maizena", "lievito", "levadura", "yeast", "polenta", "quinoa", "cous cous", "couscous", "bulgur"] },

  { category: "spices", stems: ["sale", "sal ", " sal", "salt", "pepe nero", "pepe ", "pimienta", "pepper", "spezie", "especia", "spice", "origano", "oregano", "basilico", "albahaca", "basil", "prezzemol", "perejil", "parsley", "rosmarin", "romero", "salvia", "timo", "tomillo", "thyme", "alloro", "laurel", "menta", "hierbabuena", "mint", "maggiorana", "erba cipollina", "cebollino", "chive", "aneto", "eneldo", "coriandol", "cilantro", "curcuma", "curry", "zafferano", "azafran", "cannella", "canela", "cinnamon", "chiodi di garofano", "clavo", "noce moscata", "nuez moscada", "paprika", "pimenton", "peperoncin", "chili", "chile", "guindilla", "zenzero", "cumino", "comino", "anice", "anis", "vaniglia", "vainilla", "vanilla", "cardamomo", "ginepro", "enebro"] },

  { category: "consumables", stems: ["tovagli", "servilleta", "napkin", "sacchett", "bolsa", "sacco spazzatura", "basura", "carta forno", "papel", "cartone", "vaschett", "contenitor", "envase", "posate", "cubierto", "bicchier", "vaso ", "copa ", "piatt", "plato", "cannucce", "pajita", "straw", "coperchi", "tapa ", "pellicola", "film ", "alluminio", "aluminio", "detersiv", "detergent", "sgrassat", "igienizz", "desinfect", "disinfett", "limpieza", "guanti", "guante", "glove", "spugn", "esponja", "scottex", "asciugaman", "stuzzicaden", "palillo", "sottobicchier", "posavaso", "scontrin", "ticket", "rotolo", "rollo", "cleaning"] },
];

/** Accent-stripped, lowercase, single-spaced — what the stems are matched on. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `stem` starts a word inside the already-normalised `haystack`.
 *
 * Stems are word PREFIXES, never free substrings: plain `includes()` files
 * "tovaglioli" (napkins) under vegetables because it contains "aglio" (garlic),
 * and "pepinillo" under peppers. Anchoring to a word start keeps the useful
 * prefix behaviour — "pomodor" still catches "pomodori" — without the
 * accidental hits from the middle of an unrelated word.
 *
 * Multi-word stems ("pico de gallo") are anchored on their first word only,
 * which is what the anchor test below does for free.
 */
function hasStem(haystack: string, stem: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(stem, from);
    if (at < 0) return false;
    // Start of the string, or the character before it ends a word.
    if (at === 0 || !/[a-z0-9]/.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}

/**
 * Best-guess warehouse category for an ingredient name.
 *
 * Returns "other" when nothing matches — never null, so every row lands in a
 * chip and none goes missing from the list. First rule that hits wins (see the
 * ordering note above).
 */
export function classifyIngredient(name: string): IngredientCategory {
  const n = normalize(name);
  for (const rule of RULES) {
    for (const stem of rule.stems) {
      if (hasStem(n, stem.trim())) return rule.category;
    }
  }
  return "other";
}
