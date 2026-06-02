// One-shot: popola menu_items.image_url per il tenant PICNIC con foto coerenti
// (royalty-free, Unsplash) scelte per macro-tipo del piatto, e rimuove il piatto
// di test "PROVA". Le foto sono per macro-categoria (pizza, sashimi, dolce,
// cocktail, ...), non foto del piatto specifico — coerenza visiva, non identità.
//
// Uso:  node scripts/seed-picnic-photos.mjs           (dry-run: stampa il piano)
//       node scripts/seed-picnic-photos.mjs --apply   (scrive su DB)
//
// Legge SUPABASE URL + SERVICE ROLE da .env.local.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const TENANT = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5"; // PICNIC

// --- env -------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SRK) throw new Error("Missing Supabase env");

const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

// --- photo library by macro-type (Unsplash, fixed crops ~1400px webp) -------
// Each entry: a hand-picked Unsplash photo id rendered at a consistent size.
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1400&q=72`;
const PHOTO = {
  pizza:      U("1513104890138-7c749659a591"),
  pasta:      U("1621996346565-e3dbc646d9a9"),
  risotto:    U("1476124369491-e7addf5db371"),
  gnocchi:    U("1607330289024-1535c6b4e1c1"),
  ravioli:    U("1587740908075-9e245070dfaa"),
  sashimi:    U("1579584425555-c3ce17fd4351"),
  tartare:    U("1625944525533-473f1a3d54e7"),
  crostacei:  U("1559737558-2f5a35f4523b"),
  pesce:      U("1535140728325-a4d3707eee61"),
  scampi:     U("1565680018434-b513d5e5fd47"),
  carne:      U("1546964124-0cce460f38ef"),
  agnello:    U("1432139555190-58524dae6a55"),
  anatra:     U("1432139509613-5c4255815697"),
  maiale:     U("1544025162-d76694265947"),
  fritti:     U("1599490659213-e2b9527bd087"),
  antipasto:  U("1541529086526-db283c563270"),
  verdure:    U("1540420773420-3366772f4999"),
  formaggio:  U("1452195100486-9cc805987862"),
  salume:     U("1606851091851-e8c8c0fca5ba"),
  uovo:       U("1482049016688-2d3e1b311543"),
  asparagi:   U("1580013759032-c96505e24c1f"),
  tiramisu:   U("1571877227200-a0d98ea607e9"),
  dolce:      U("1488477181946-6428a0291777"),
  cannolo:    U("1607920591413-4ec007e70023"),
  panna:      U("1488477304112-4944851de03d"),
  gelato:     U("1567206563064-6f60f40a2b57"),
  cioccolato: U("1511381939415-e44015466834"),
  spritz:     U("1560512823-829485b8bf24"),
  cocktail:   U("1551024601-bec78aea704b"),
  gintonic:   U("1514362545857-3bc16c4c7d1b"),
  birra:      U("1535958636474-b021ee887b13"),
  vino:       U("1510812431401-41d2bd2722f3"),
  caffe:      U("1509042239860-f550ce710b93"),
  acqua:      U("1523362628745-0c100150b504"),
  bibita:     U("1622483767028-3f66f32aef97"),
  focaccia:   U("1509440159596-0249088772ff"),
  crostino:   U("1528735602780-2552fd46c7af"),
  generic:    U("1414235077428-338989a2e8c0"),
};

// keyword → photo key (first match wins; order matters: specific before generic)
const RULES = [
  [/focaccia/i, "focaccia"],
  [/crostino/i, "crostino"],
  [/pizza|margherita|marinara|capricciosa|napoli|boscaiola|puttanesca|amatriciana|parmigiana de|bufala e reggiano|vacanze romane|datte foco|saltimbocca|bello de nonna|fiori e alici|fiordilatte|^rossa /i, "pizza"],
  [/tiramis/i, "tiramisu"],
  [/cannolo/i, "cannolo"],
  [/panna coatta|panna cotta/i, "panna"],
  [/gelat|helado/i, "gelato"],
  [/cioccolat|sigaro|paris-brest|mini banana/i, "cioccolato"],
  [/dolce|crème caramel|creme caramel|visciole|crème/i, "dolce"],
  [/spritz/i, "spritz"],
  [/gin tonic/i, "gintonic"],
  [/birr/i, "birra"],
  [/vini|vino|mesciata/i, "vino"],
  [/caff[èe]/i, "caffe"],
  [/acqua/i, "acqua"],
  [/bibit|lattina/i, "bibita"],
  [/amari|grapp|amaro/i, "cocktail"],
  [/sashimi|crudo di pesce|tartare|carpaccio/i, "sashimi"],
  [/scampi/i, "scampi"],
  [/crostace|padellata|gamber|mazzancoll/i, "crostacei"],
  [/cozze|ostrich|anguilla|baccal|triglia|branzino|pescatrice|morone|ossobuco di pesc|pescato|sandwich di triglia|ricciola/i, "pesce"],
  [/risotto/i, "risotto"],
  [/gnocchi/i, "gnocchi"],
  [/ravioli|plin|cannellone|orecchiette|pennette|spaghetti|pasta verde/i, "pasta"],
  [/agnello|costoletta/i, "agnello"],
  [/anatra|piccione|petto d/i, "anatra"],
  [/maialino|maiale|sella di/i, "maiale"],
  [/tagliata|straccetti|bresaola|manzo|vitello|lingua|animella|wagyu|foie gras/i, "carne"],
  [/asparag/i, "asparagi"],
  [/uovo|uova/i, "uovo"],
  [/misto di pecorino|pecorino|formagg/i, "formaggio"],
  [/prosciutto|melone|salume|salame/i, "salume"],
  [/suppl|crocchett|filetto di baccal|olive all|fiori di zucchin|pizzetta fritta|fritt/i, "fritti"],
  [/verdure|caponata|melanzane|tortino/i, "verdure"],
  [/antipast/i, "antipasto"],
];

function pickPhoto(name, desc) {
  const hay = `${name} ${desc}`.toLowerCase();
  for (const [re, key] of RULES) if (re.test(hay)) return { key, url: PHOTO[key] };
  return { key: "generic", url: PHOTO.generic };
}

// --- run -------------------------------------------------------------------
const res = await fetch(
  `${SUPA_URL}/rest/v1/menu_items?tenant_id=eq.${TENANT}&select=id,name,description,image_url&order=name.asc`,
  { headers: H }
);
const items = await res.json();

let prova = null;
const plan = [];
for (const it of items) {
  if (it.name.trim().toUpperCase() === "PROVA") { prova = it; continue; }
  const { key, url } = pickPhoto(it.name, it.description || "");
  plan.push({ id: it.id, name: it.name, key, url });
}

// report
const byKey = {};
for (const p of plan) byKey[p.key] = (byKey[p.key] || 0) + 1;
console.log(`\nPICNIC — ${items.length} piatti totali, ${plan.length} da fotografare, PROVA da rimuovere: ${prova ? "SÌ" : "no"}\n`);
console.log("Distribuzione per tipo foto:");
for (const [k, n] of Object.entries(byKey).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log("\nEsempi mapping:");
for (const p of plan.slice(0, 12)) console.log(`  ${p.name.slice(0, 40).padEnd(42)} → ${p.key}`);

if (!APPLY) {
  console.log("\n(dry-run) Rilancia con --apply per scrivere su DB.\n");
  process.exit(0);
}

// apply: update each item's image_url, delete PROVA
let ok = 0, fail = 0;
for (const p of plan) {
  const r = await fetch(`${SUPA_URL}/rest/v1/menu_items?id=eq.${p.id}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({ image_url: p.url }),
  });
  if (r.ok) ok++; else { fail++; console.error("FAIL", p.name, r.status, await r.text()); }
}
if (prova) {
  const r = await fetch(`${SUPA_URL}/rest/v1/menu_items?id=eq.${prova.id}`, { method: "DELETE", headers: H });
  console.log(`PROVA delete: ${r.status}`);
}
console.log(`\nFatto. image_url aggiornati: ${ok}, falliti: ${fail}.\n`);
