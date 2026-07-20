// Telling goods from everything else on a supplier document.
//
// Not every line a restaurant is billed for is an ingredient. A Centrocassa
// invoice reads "NOLEGGIO MISURATORE TELEMATICO … 180,00" and "RINNOVO
// CONTRATTO ASSISTENZA TECNICA … 400,00": real costs, but booking them into
// the warehouse invents a €400 ingredient that food cost will happily average
// into a pizza. Delivery notes carry their own non-goods too — transport fees,
// pallet deposits, CONAI contributions, fuel surcharges.
//
// So each line gets classified. Goods flow into the warehouse; services and
// charges are surfaced but default to "don't create an ingredient", leaving the
// owner one click to override. We bias toward "goods" on anything ambiguous:
// a missed service is a wrong row the owner can delete, while a skipped
// ingredient is a stock count that silently never happens.

export type LineKind = "goods" | "service" | "charge";

/** Services and rentals — never stock, however they are worded. */
const SERVICE_RE = new RegExp(
  [
    "noleggio", "canone", "abbonament", "assistenz", "manutenzion", "riparazion",
    "installazion", "configurazion", "consulenz", "formazion", "corso ", "corsi ",
    "contratto", "rinnovo", "licenz", "software", "hosting", "dominio",
    "servizio", "servizi ", "prestazion", "intervent", "sopralluog",
    "smaltiment", "disinfestazion", "sanificazion", "pulizi",
    "commission", "provvigion", "onorari", "diritti di", "spese banc",
  ].join("|"),
  "i",
);

/** Charges attached to a delivery rather than goods received. */
const CHARGE_RE = new RegExp(
  [
    "trasporto", "spese di trasporto", "spedizion", "consegna", "porto ",
    "contributo conai", "conai", "cauzion", "deposito cauzion", "vuoto a rendere",
    "pallet", "epal", "bancal", "imballagg", "carburant", "gasolio",
    "sconto", "abbuono", "arrotondament", "bollo", "spese incasso",
    "acconto", "saldo fattura", "nota di credito",
  ].join("|"),
  "i",
);

/**
 * Words that look like services but describe food. "Servizio piatti" is a
 * tableware set; "pane servito" is bread. Checked first so they win.
 */
const FOOD_OVERRIDE_RE =
  /\b(pane|pizza|pasta|carne|pesce|verdur|frutt|formagg|salum|vino|birra|acqua|olio|farin|latte|uova|riso|dolc|gelat|caff)/i;

/**
 * Classify a document line. `description` is what the supplier printed.
 *
 * Note this is deliberately conservative: only a clear service/charge phrase
 * reclassifies a line, because the cost of a false "service" (an ingredient
 * that never reaches the warehouse) is invisible, while a false "goods" is a
 * junk row the owner sees immediately.
 */
export function classifyLine(description: string): LineKind {
  const d = (description || "").trim();
  if (!d) return "goods";
  if (FOOD_OVERRIDE_RE.test(d)) return "goods";
  if (SERVICE_RE.test(d)) return "service";
  if (CHARGE_RE.test(d)) return "charge";
  return "goods";
}

/** True when this line should become / top up a warehouse ingredient. */
export function isStockable(description: string): boolean {
  return classifyLine(description) === "goods";
}
