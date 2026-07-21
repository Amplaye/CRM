// The storeroom every restaurant starts with.
//
// Until now a new tenant opened Inventory to an empty table and a "add your
// first ingredient" prompt, so Food Cost was unusable until someone typed a
// hundred rows by hand. Nobody did, which is why the AI recipe generator kept
// inventing ingredients that didn't exist: it had no real stock to ground in.
//
// This is that stock. It is deliberately a GENERIC professional storeroom — the
// things almost every kitchen holds — not a copy of any one tenant's shelf.
//
// Each entry carries its name in all four CRM languages, so a German owner sees
// "Hähnchenbrust" and an Italian sees "Petto di pollo" for the SAME row. The
// slug is the stable identity; the label is chosen at seed time from the
// tenant's locale. That also means the catalogue never inherits the mixed-
// language duplication of a hand-built warehouse (Miel + Miele + Honey as three
// separate rows, each with its own cost and stock).
//
// Costs are intentionally 0: a made-up price is worse than a visibly missing
// one, because it silently produces a plausible-looking wrong food cost. The
// owner fills them in, or the invoice importer does it for them.
//
// Pure data + pure functions: no DB, no I/O.

import type { IngredientCategory } from "./ingredient-categories";

export type Locale = "it" | "en" | "es" | "de";

export interface DefaultIngredient {
  /** Stable identity, never shown to the user. */
  slug: string;
  category: IngredientCategory;
  /** Warehouse unit this product is stocked in. */
  unit: string;
  /** Display name per CRM language. */
  names: Record<Locale, string>;
}

// Shorthand so the table below stays readable at a glance.
const i = (
  slug: string,
  category: IngredientCategory,
  unit: string,
  it: string,
  en: string,
  es: string,
  de: string,
): DefaultIngredient => ({ slug, category, unit, names: { it, en, es, de } });

export const DEFAULT_INGREDIENTS: DefaultIngredient[] = [
  // ── Carne ────────────────────────────────────────────────────────────────
  i("beef_mince", "meat", "kg", "Carne macinata di manzo", "Beef mince", "Carne picada de ternera", "Rinderhackfleisch"),
  i("beef_steak", "meat", "kg", "Controfiletto di manzo", "Beef striploin", "Lomo de ternera", "Rinderstreifenlende"),
  i("chicken_breast", "meat", "kg", "Petto di pollo", "Chicken breast", "Pechuga de pollo", "Hähnchenbrust"),
  i("chicken_thigh", "meat", "kg", "Coscia di pollo", "Chicken thigh", "Muslo de pollo", "Hähnchenschenkel"),
  i("pork_loin", "meat", "kg", "Lonza di maiale", "Pork loin", "Lomo de cerdo", "Schweinelende"),
  i("pork_ribs", "meat", "kg", "Costine di maiale", "Pork ribs", "Costillas de cerdo", "Schweinerippchen"),
  i("veal", "meat", "kg", "Vitello", "Veal", "Ternera", "Kalbfleisch"),
  i("lamb", "meat", "kg", "Agnello", "Lamb", "Cordero", "Lammfleisch"),
  i("burger_patty", "meat", "pz", "Hamburger (svizzera)", "Burger patty", "Hamburguesa (carne)", "Burger-Patty"),

  // ── Pesce ────────────────────────────────────────────────────────────────
  i("salmon", "fish", "kg", "Salmone", "Salmon", "Salmón", "Lachs"),
  i("tuna", "fish", "kg", "Tonno", "Tuna", "Atún", "Thunfisch"),
  i("cod", "fish", "kg", "Merluzzo", "Cod", "Bacalao", "Kabeljau"),
  i("sea_bass", "fish", "kg", "Branzino", "Sea bass", "Lubina", "Wolfsbarsch"),
  i("prawns", "fish", "kg", "Gamberi", "Prawns", "Gambas", "Garnelen"),
  i("mussels", "fish", "kg", "Cozze", "Mussels", "Mejillones", "Miesmuscheln"),
  i("clams", "fish", "kg", "Vongole", "Clams", "Almejas", "Venusmuscheln"),
  i("squid", "fish", "kg", "Calamari", "Squid", "Calamares", "Tintenfisch"),
  i("octopus", "fish", "kg", "Polpo", "Octopus", "Pulpo", "Oktopus"),
  i("anchovies", "fish", "g", "Acciughe", "Anchovies", "Anchoas", "Sardellen"),

  // ── Verdura ──────────────────────────────────────────────────────────────
  i("tomato", "vegetables", "kg", "Pomodori", "Tomatoes", "Tomates", "Tomaten"),
  i("cherry_tomato", "vegetables", "kg", "Pomodorini", "Cherry tomatoes", "Tomates cherry", "Kirschtomaten"),
  i("onion", "vegetables", "kg", "Cipolle", "Onions", "Cebollas", "Zwiebeln"),
  i("red_onion", "vegetables", "kg", "Cipolla rossa", "Red onion", "Cebolla roja", "Rote Zwiebel"),
  i("garlic", "vegetables", "g", "Aglio", "Garlic", "Ajo", "Knoblauch"),
  i("potato", "vegetables", "kg", "Patate", "Potatoes", "Patatas", "Kartoffeln"),
  i("carrot", "vegetables", "kg", "Carote", "Carrots", "Zanahorias", "Karotten"),
  i("celery", "vegetables", "kg", "Sedano", "Celery", "Apio", "Sellerie"),
  i("courgette", "vegetables", "kg", "Zucchine", "Courgettes", "Calabacines", "Zucchini"),
  i("aubergine", "vegetables", "kg", "Melanzane", "Aubergines", "Berenjenas", "Auberginen"),
  i("bell_pepper", "vegetables", "kg", "Peperoni", "Bell peppers", "Pimientos", "Paprika"),
  i("lettuce", "vegetables", "kg", "Lattuga", "Lettuce", "Lechuga", "Kopfsalat"),
  i("rocket", "vegetables", "g", "Rucola", "Rocket", "Rúcula", "Rucola"),
  i("spinach", "vegetables", "kg", "Spinaci", "Spinach", "Espinacas", "Spinat"),
  i("mushroom", "vegetables", "kg", "Funghi champignon", "Mushrooms", "Champiñones", "Champignons"),
  i("cucumber", "vegetables", "kg", "Cetrioli", "Cucumber", "Pepino", "Gurken"),
  i("avocado", "vegetables", "pz", "Avocado", "Avocado", "Aguacate", "Avocado"),
  i("broccoli", "vegetables", "kg", "Broccoli", "Broccoli", "Brócoli", "Brokkoli"),

  // ── Frutta ───────────────────────────────────────────────────────────────
  i("lemon", "fruit", "kg", "Limoni", "Lemons", "Limones", "Zitronen"),
  i("lime", "fruit", "kg", "Lime", "Limes", "Limas", "Limetten"),
  i("orange", "fruit", "kg", "Arance", "Oranges", "Naranjas", "Orangen"),
  i("apple", "fruit", "kg", "Mele", "Apples", "Manzanas", "Äpfel"),
  i("strawberry", "fruit", "kg", "Fragole", "Strawberries", "Fresas", "Erdbeeren"),
  i("banana", "fruit", "kg", "Banane", "Bananas", "Plátanos", "Bananen"),
  i("pineapple", "fruit", "pz", "Ananas", "Pineapple", "Piña", "Ananas"),

  // ── Latticini ────────────────────────────────────────────────────────────
  i("milk", "dairy", "l", "Latte intero", "Whole milk", "Leche entera", "Vollmilch"),
  i("cream", "dairy", "l", "Panna fresca", "Fresh cream", "Nata líquida", "Sahne"),
  i("butter", "dairy", "kg", "Burro", "Butter", "Mantequilla", "Butter"),
  i("mozzarella", "dairy", "kg", "Mozzarella", "Mozzarella", "Mozzarella", "Mozzarella"),
  i("parmesan", "dairy", "kg", "Parmigiano Reggiano", "Parmesan", "Parmesano", "Parmesan"),
  i("cheddar", "dairy", "kg", "Cheddar", "Cheddar", "Cheddar", "Cheddar"),
  i("goat_cheese", "dairy", "kg", "Formaggio di capra", "Goat cheese", "Queso de cabra", "Ziegenkäse"),
  i("yoghurt", "dairy", "kg", "Yogurt naturale", "Plain yoghurt", "Yogur natural", "Naturjoghurt"),
  i("ricotta", "dairy", "kg", "Ricotta", "Ricotta", "Requesón", "Ricotta"),

  // ── Uova ─────────────────────────────────────────────────────────────────
  i("egg", "eggs", "pz", "Uova", "Eggs", "Huevos", "Eier"),

  // ── Salumi ───────────────────────────────────────────────────────────────
  i("bacon", "cured_meats", "kg", "Bacon", "Bacon", "Bacon", "Bacon"),
  i("parma_ham", "cured_meats", "kg", "Prosciutto crudo", "Cured ham", "Jamón serrano", "Rohschinken"),
  i("cooked_ham", "cured_meats", "kg", "Prosciutto cotto", "Cooked ham", "Jamón cocido", "Kochschinken"),
  i("salami", "cured_meats", "kg", "Salame", "Salami", "Salchichón", "Salami"),
  i("sausage", "cured_meats", "kg", "Salsiccia", "Sausage", "Salchicha", "Bratwurst"),

  // ── Farine e cereali ─────────────────────────────────────────────────────
  i("flour_00", "flour_cereals", "kg", "Farina 00", "Plain flour", "Harina de trigo", "Weizenmehl"),
  i("semolina", "flour_cereals", "kg", "Semola rimacinata", "Semolina flour", "Sémola de trigo", "Hartweizengrieß"),
  i("yeast", "flour_cereals", "g", "Lievito di birra", "Fresh yeast", "Levadura fresca", "Frischhefe"),
  i("breadcrumbs", "flour_cereals", "kg", "Pangrattato", "Breadcrumbs", "Pan rallado", "Semmelbrösel"),
  i("cornstarch", "flour_cereals", "kg", "Amido di mais", "Cornstarch", "Maicena", "Speisestärke"),

  // ── Pasta e riso ─────────────────────────────────────────────────────────
  i("spaghetti", "pasta_rice", "kg", "Spaghetti", "Spaghetti", "Espaguetis", "Spaghetti"),
  i("penne", "pasta_rice", "kg", "Penne rigate", "Penne", "Penne", "Penne"),
  i("rice_risotto", "pasta_rice", "kg", "Riso Carnaroli", "Risotto rice", "Arroz para risotto", "Risottoreis"),
  i("rice_long", "pasta_rice", "kg", "Riso basmati", "Basmati rice", "Arroz basmati", "Basmatireis"),
  i("gnocchi", "pasta_rice", "kg", "Gnocchi di patate", "Potato gnocchi", "Ñoquis de patata", "Kartoffelgnocchi"),

  // ── Conserve e salse ─────────────────────────────────────────────────────
  i("tomato_passata", "preserves", "kg", "Passata di pomodoro", "Tomato passata", "Tomate triturado", "Passierte Tomaten"),
  i("peeled_tomato", "preserves", "kg", "Pomodori pelati", "Peeled tomatoes", "Tomate pelado", "Geschälte Tomaten"),
  i("tuna_oil", "preserves", "kg", "Tonno sott'olio", "Tinned tuna", "Atún en aceite", "Thunfisch in Öl"),
  i("olives", "preserves", "kg", "Olive", "Olives", "Aceitunas", "Oliven"),
  i("capers", "preserves", "g", "Capperi", "Capers", "Alcaparras", "Kapern"),
  i("mayonnaise", "preserves", "kg", "Maionese", "Mayonnaise", "Mayonesa", "Mayonnaise"),
  i("ketchup", "preserves", "kg", "Ketchup", "Ketchup", "Kétchup", "Ketchup"),
  i("mustard", "preserves", "kg", "Senape", "Mustard", "Mostaza", "Senf"),
  i("bbq_sauce", "preserves", "l", "Salsa barbecue", "BBQ sauce", "Salsa barbacoa", "BBQ-Sauce"),
  i("soy_sauce", "preserves", "l", "Salsa di soia", "Soy sauce", "Salsa de soja", "Sojasauce"),
  i("honey", "preserves", "kg", "Miele", "Honey", "Miel", "Honig"),
  i("stock_cube", "preserves", "pz", "Dado da brodo", "Stock cube", "Pastilla de caldo", "Brühwürfel"),

  // ── Spezie ed erbe ───────────────────────────────────────────────────────
  i("salt", "spices", "kg", "Sale fino", "Salt", "Sal", "Salz"),
  i("black_pepper", "spices", "g", "Pepe nero", "Black pepper", "Pimienta negra", "Schwarzer Pfeffer"),
  i("sugar", "spices", "kg", "Zucchero", "Sugar", "Azúcar", "Zucker"),
  i("basil", "spices", "g", "Basilico", "Basil", "Albahaca", "Basilikum"),
  i("parsley", "spices", "g", "Prezzemolo", "Parsley", "Perejil", "Petersilie"),
  i("oregano", "spices", "g", "Origano", "Oregano", "Orégano", "Oregano"),
  i("rosemary", "spices", "g", "Rosmarino", "Rosemary", "Romero", "Rosmarin"),
  i("thyme", "spices", "g", "Timo", "Thyme", "Tomillo", "Thymian"),
  i("bay_leaf", "spices", "g", "Alloro", "Bay leaves", "Laurel", "Lorbeerblätter"),
  i("chilli", "spices", "g", "Peperoncino", "Chilli", "Guindilla", "Chili"),
  // "Paprika" alone is the spice in English but the vegetable in German, so the
  // label says "powder" in every language and the row can't be misread.
  i("paprika", "spices", "g", "Paprika dolce in polvere", "Paprika powder", "Pimentón molido", "Paprikapulver"),
  i("cinnamon", "spices", "g", "Cannella", "Cinnamon", "Canela", "Zimt"),
  i("nutmeg", "spices", "g", "Noce moscata", "Nutmeg", "Nuez moscada", "Muskatnuss"),
  i("curry", "spices", "g", "Curry", "Curry powder", "Curry", "Currypulver"),
  i("vanilla", "spices", "g", "Vaniglia", "Vanilla", "Vainilla", "Vanille"),

  // ── Olio e aceto ─────────────────────────────────────────────────────────
  i("evoo", "oil_vinegar", "l", "Olio extravergine d'oliva", "Extra virgin olive oil", "Aceite de oliva virgen extra", "Natives Olivenöl extra"),
  i("seed_oil", "oil_vinegar", "l", "Olio di semi", "Seed oil", "Aceite de girasol", "Sonnenblumenöl"),
  i("balsamic_vinegar", "oil_vinegar", "l", "Aceto balsamico", "Balsamic vinegar", "Vinagre balsámico", "Balsamico-Essig"),
  i("white_vinegar", "oil_vinegar", "l", "Aceto di vino bianco", "White wine vinegar", "Vinagre de vino blanco", "Weißweinessig"),

  // ── Bevande analcoliche ──────────────────────────────────────────────────
  i("water_still", "soft_drinks", "bt", "Acqua naturale", "Still water", "Agua sin gas", "Stilles Wasser"),
  i("water_sparkling", "soft_drinks", "bt", "Acqua frizzante", "Sparkling water", "Agua con gas", "Sprudelwasser"),
  i("cola", "soft_drinks", "bt", "Cola", "Cola", "Cola", "Cola"),
  i("orange_soda", "soft_drinks", "bt", "Aranciata", "Orange soda", "Naranjada", "Orangenlimonade"),
  i("tonic_water", "soft_drinks", "bt", "Acqua tonica", "Tonic water", "Tónica", "Tonic Water"),
  i("orange_juice", "soft_drinks", "l", "Succo d'arancia", "Orange juice", "Zumo de naranja", "Orangensaft"),
  i("coffee_beans", "soft_drinks", "kg", "Caffè in grani", "Coffee beans", "Café en grano", "Kaffeebohnen"),
  i("tea", "soft_drinks", "pz", "Tè in filtri", "Tea bags", "Té en bolsitas", "Teebeutel"),

  // ── Vino / Birra / Alcolici ──────────────────────────────────────────────
  i("white_wine", "wine", "bt", "Vino bianco", "White wine", "Vino blanco", "Weißwein"),
  i("red_wine", "wine", "bt", "Vino rosso", "Red wine", "Vino tinto", "Rotwein"),
  i("prosecco", "wine", "bt", "Prosecco", "Prosecco", "Prosecco", "Prosecco"),
  i("beer_lager", "beer", "bt", "Birra lager", "Lager beer", "Cerveza lager", "Lagerbier"),
  i("beer_draft", "beer", "l", "Birra alla spina", "Draft beer", "Cerveza de barril", "Fassbier"),
  i("vodka", "spirits", "bt", "Vodka", "Vodka", "Vodka", "Wodka"),
  i("gin", "spirits", "bt", "Gin", "Gin", "Ginebra", "Gin"),
  i("rum", "spirits", "bt", "Rum", "Rum", "Ron", "Rum"),
  i("whisky", "spirits", "bt", "Whisky", "Whisky", "Whisky", "Whisky"),
  i("aperol", "spirits", "bt", "Aperol", "Aperol", "Aperol", "Aperol"),
  i("limoncello", "spirits", "bt", "Limoncello", "Limoncello", "Limoncello", "Limoncello"),

  // ── Surgelati ────────────────────────────────────────────────────────────
  i("frozen_chips", "frozen", "kg", "Patatine fritte surgelate", "Frozen chips", "Patatas fritas congeladas", "Tiefkühl-Pommes"),
  i("frozen_peas", "frozen", "kg", "Piselli surgelati", "Frozen peas", "Guisantes congelados", "Tiefkühlerbsen"),
  i("ice_cream", "frozen", "kg", "Gelato", "Ice cream", "Helado", "Speiseeis"),
  i("ice_cubes", "frozen", "kg", "Ghiaccio", "Ice cubes", "Hielo", "Eiswürfel"),

  // ── Pane e dolci ─────────────────────────────────────────────────────────
  i("bread", "bread_pastry", "kg", "Pane", "Bread", "Pan", "Brot"),
  i("burger_bun", "bread_pastry", "pz", "Panino da hamburger", "Burger bun", "Pan de hamburguesa", "Burgerbrötchen"),
  i("dark_chocolate", "bread_pastry", "kg", "Cioccolato fondente", "Dark chocolate", "Chocolate negro", "Zartbitterschokolade"),
  i("cocoa", "bread_pastry", "kg", "Cacao amaro", "Cocoa powder", "Cacao en polvo", "Kakaopulver"),
  i("biscuits", "bread_pastry", "kg", "Biscotti secchi", "Biscuits", "Galletas", "Kekse"),

  // ── Materiale di consumo ─────────────────────────────────────────────────
  i("napkins", "consumables", "pz", "Tovaglioli", "Napkins", "Servilletas", "Servietten"),
  i("takeaway_box", "consumables", "pz", "Vaschette da asporto", "Takeaway containers", "Envases para llevar", "Take-away-Behälter"),
  i("baking_paper", "consumables", "pz", "Carta da forno", "Baking paper", "Papel de horno", "Backpapier"),
  i("cling_film", "consumables", "pz", "Pellicola trasparente", "Cling film", "Film transparente", "Frischhaltefolie"),
  i("aluminium_foil", "consumables", "pz", "Alluminio in rotolo", "Aluminium foil", "Papel de aluminio", "Alufolie"),
  i("gloves", "consumables", "pz", "Guanti monouso", "Disposable gloves", "Guantes desechables", "Einweghandschuhe"),
  i("degreaser", "consumables", "l", "Sgrassatore", "Degreaser", "Desengrasante", "Fettlöser"),
  i("sanitiser", "consumables", "l", "Igienizzante superfici", "Surface sanitiser", "Desinfectante de superficies", "Flächendesinfektion"),
];

/** The catalogue rendered in one language, ready to insert as ingredient rows. */
export function defaultIngredientsFor(locale: string): Array<{
  name: string;
  unit: string;
  category: IngredientCategory;
}> {
  const l: Locale = (["it", "en", "es", "de"] as const).includes(locale as Locale)
    ? (locale as Locale)
    : "en";
  return DEFAULT_INGREDIENTS.map((d) => ({
    name: d.names[l],
    unit: d.unit,
    category: d.category,
  }));
}
