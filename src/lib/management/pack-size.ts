// Reading the PACK FORMAT out of a supplier line, so the warehouse fills itself.
//
// A supplier bills in trade units: "1 CAR" of «ACETO BALSAMICO 6X500 ML» at
// 29,99. Booked literally that is "1 piece at 29.99" — true as an inventory
// count, useless for food cost, because 20 ml of that vinegar has no price
// until someone knows the carton holds 3 litres. This module reads the format
// printed in the description and converts the line into real units:
//
//   1 CAR × (6 × 500 ml) → 3 l at 10,00 €/l
//
// The hard part is WHICH size to believe. A line often prints two:
// «CF.1 KG (X10)» is a 1 kg pack, ten packs to a carton. If the U.M. is CF you
// bought one kilo; if it is CAR you bought ten. So we classify the purchased
// unit first (pack / carton / piece / weight) and read the matching descriptor,
// rather than grabbing the first number we see.
//
// Everything here is pure and total — no I/O. It never throws and returns null
// whenever it isn't confident: a wrong automatic conversion silently corrupts
// food cost, which is far worse than leaving the line for the owner to fill in.

import type { Unit } from "./units";

/** What the supplier's U.M. actually denotes. */
export type PurchasedAs =
  | "pack"    // CF, CONF, BUSTA — an inner pack
  | "carton"  // CAR, CT, CARTONE, COLLO — the outer box
  | "piece"   // NR, PZ, CAD — one sellable item
  | "weight"  // KG, GR, LT — already a real unit, no conversion needed
  | "unknown";

export interface PackSize {
  /** Content of ONE purchased unit, expressed in `unit`. */
  size: number;
  unit: Unit;
  /** How the size was written, for showing the owner our reasoning. */
  source: string;
}

export interface DerivedLine {
  /** Warehouse unit to book this line in. */
  unit: Unit;
  /** Total quantity entering stock (purchased qty × pack content). */
  quantity: number;
  /** Cost per `unit` — what food cost multiplies against. */
  unitCost: number | null;
  /** The pack we read, null when the line is booked as-is. */
  pack: PackSize | null;
  /** Human explanation, shown in the review step. */
  explanation: string | null;
}

// Real U.M. codes seen on Italian foodservice documents. Suppliers are wildly
// inconsistent — "KIL" for kilos, "LTR"/"Ltr" for litres, "BT" for bottles —
// and an unrecognised code silently books the line as pieces, which is exactly
// the wrong answer for something billed by weight.
const UM_CLASS: Array<[RegExp, PurchasedAs]> = [
  [/^(cf|conf|confez|confezione|busta|sacchetto|sacco|vasch|vaschetta|barattolo|bott|bottiglia|bt|flacone|latta|pacco|pf|sc)$/, "pack"],
  [/^(car|cart|cartone|ct|crt|collo|colli|cassa|cs|box|scat|scatola|bancale|pallet)$/, "carton"],
  [/^(nr|n|num|pz|pzi|pezzi|pezzo|cad|pce|pcs|ea|ud)$/, "piece"],
  [/^(kg|kgm|kil|kili|chilo|chili|g|gr|grammi|hg|l|lt|ltr|litri|litro|ml|cl|cc)$/, "weight"],
];

/** Classify the supplier's unit of measure. */
export function classifyUm(raw?: string | null): PurchasedAs {
  const k = (raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return "unknown";
  for (const [re, cls] of UM_CLASS) if (re.test(k)) return cls;
  return "unknown";
}

/** Trade unit token → canonical warehouse unit + factor to its base. */
const MEASURE: Record<string, { unit: Unit; toBase: number }> = {
  kg: { unit: "kg", toBase: 1000 }, kgm: { unit: "kg", toBase: 1000 },
  kil: { unit: "kg", toBase: 1000 }, kili: { unit: "kg", toBase: 1000 },
  chilo: { unit: "kg", toBase: 1000 }, chili: { unit: "kg", toBase: 1000 },
  g: { unit: "g", toBase: 1 }, gr: { unit: "g", toBase: 1 }, grammi: { unit: "g", toBase: 1 },
  hg: { unit: "g", toBase: 100 },
  l: { unit: "l", toBase: 1000 }, lt: { unit: "l", toBase: 1000 }, ltr: { unit: "l", toBase: 1000 },
  litri: { unit: "l", toBase: 1000 }, litro: { unit: "l", toBase: 1000 },
  ml: { unit: "ml", toBase: 1 }, cc: { unit: "ml", toBase: 1 }, cl: { unit: "ml", toBase: 10 },
};

// Longest-first: "lt" must not be matched as "l" and leave a stray "t".
const MEASURE_RE = "kgm|kili|kil|kg|chilo|chili|grammi|gr|hg|litri|litro|ltr|lt|ml|cc|cl|l|g";

const num = (s: string) => Number(s.replace(",", "."));

/**
 * Sizes that must never be read as a pack format. Supplier descriptions are
 * full of numbers that look like weights but aren't:
 *   "60/80", "41/50", "10/20"  → calibro (pieces per kg)
 *   "0%", "DEV.25%"            → glassatura / lavorazione
 *   "SG.41/50", "1P", "00"     → grade codes
 * Each is stripped before we look for a size.
 */
function stripDecoys(s: string): string {
  return s
    .replace(/\d+\s*[\/-]\s*\d+/g, " ")   // calibro 60/80
    .replace(/\d+(?:[.,]\d+)?\s*%/g, " ") // 0%, 25%
    .replace(/\bsg\.?\s*/gi, " ");        // SG.41/50 → the number already went
}

/** All "<n> <measure>" sizes in a string, largest-first, e.g. "1,7 KG" → 1700 g. */
function findSizes(text: string): Array<{ qty: number; unit: Unit; base: number; raw: string }> {
  const out: Array<{ qty: number; unit: Unit; base: number; raw: string }> = [];
  const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${MEASURE_RE})\\b`, "gi");
  for (const m of text.matchAll(re)) {
    const def = MEASURE[m[2].toLowerCase()];
    if (!def) continue;
    const qty = num(m[1]);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ qty, unit: def.unit, base: qty * def.toBase, raw: m[0].trim() });
  }
  return out;
}

/** Multipack written as "6X500 ML" / "6 x 500ml" — n units of a size. */
function findMultipack(text: string): { count: number; each: number; unit: Unit; base: number; raw: string } | null {
  const re = new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${MEASURE_RE})\\b`, "i");
  const m = text.match(re);
  if (!m) return null;
  const def = MEASURE[m[3].toLowerCase()];
  const count = num(m[1]);
  const each = num(m[2]);
  if (!def || !Number.isFinite(count) || !Number.isFinite(each) || count <= 0 || each <= 0) return null;
  return { count, each, unit: def.unit, base: count * each * def.toBase, raw: m[0].trim() };
}

/** Outer-carton multiplier "(X10)" — packs per carton, no size of its own. */
function findCartonMultiplier(text: string): number | null {
  const m = text.match(/\(\s*[x×]\s*(\d+)\s*\)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/**
 * Normalize a pack's content to the unit the trade buys in: kg for mass, l for
 * volume, whatever the label happened to print. A 800 g pack booked in grams
 * would cost €0,008625/g — unreadable, and lossy once rounded. The same pack as
 * 0,8 kg at €8,625/kg is how a supplier quotes it and how food cost reads it.
 */
function humanize(base: number, unit: Unit): { size: number; unit: Unit } {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  if (unit === "kg" || unit === "g") return { size: round(base / 1000), unit: "kg" };
  if (unit === "l" || unit === "ml") return { size: round(base / 1000), unit: "l" };
  return { size: round(base), unit: "pz" };
}

/**
 * Read the content of ONE purchased unit from a supplier description.
 *
 * `um` decides which descriptor wins: with U.M. = CF the "(X10)" carton
 * multiplier is somebody else's problem; with U.M. = CAR it is exactly what we
 * bought. Returns null when nothing is stated or the line is already in a real
 * unit — the caller then books the line untouched.
 */
export function parsePackSize(description: string, um?: string | null): PackSize | null {
  const cls = classifyUm(um);
  if (cls === "weight") return null; // already kg/l — nothing to unpack
  const text = stripDecoys(description || "");
  if (!text.trim()) return null;

  const multi = findMultipack(text);
  const sizes = findSizes(text);
  // A multipack's own numbers ("6X500 ML") would double-count as a plain size.
  const plain = multi ? sizes.filter((s) => !multi.raw.includes(s.raw)) : sizes;
  // Largest stated size is the pack content; smaller ones are usually grades.
  const biggest = plain.length > 0 ? plain.reduce((a, b) => (b.base > a.base ? b : a)) : null;

  // A carton: prefer the explicit multipack, else pack-size × (Xn).
  if (cls === "carton") {
    if (multi) {
      const h = humanize(multi.base, multi.unit);
      return { ...h, source: multi.raw };
    }
    if (biggest) {
      const mult = findCartonMultiplier(text);
      const base = mult ? biggest.base * mult : biggest.base;
      const h = humanize(base, biggest.unit);
      return { ...h, source: mult ? `${biggest.raw} × ${mult}` : biggest.raw };
    }
    return null;
  }

  // A pack or a single piece: its own size. The "(Xn)" here counts how many go
  // in the supplier's carton, which is not what we received.
  if (multi && !biggest) {
    const h = humanize(multi.base, multi.unit);
    return { ...h, source: multi.raw };
  }
  if (biggest) {
    const h = humanize(biggest.base, biggest.unit);
    return { ...h, source: biggest.raw };
  }
  return null;
}

/**
 * Turn a raw supplier line into what should actually enter the warehouse.
 *
 * `quantity` is how many trade units were delivered, `unitPrice` the price of
 * one of them. When a pack size is readable the result is expressed in real
 * units (kg / l) with the cost divided accordingly; otherwise the line is kept
 * as pieces so nothing is invented.
 */
export function deriveLine(input: {
  description: string;
  unit?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  /** Fallback when the supplier prints only a line total. */
  lineTotal?: number | null;
}): DerivedLine {
  const qty = Number.isFinite(input.quantity as number) && (input.quantity as number) > 0
    ? (input.quantity as number)
    : 1;
  const price =
    input.unitPrice != null && Number.isFinite(input.unitPrice)
      ? input.unitPrice
      : input.lineTotal != null && Number.isFinite(input.lineTotal)
        ? input.lineTotal / qty
        : null;

  const pack = parsePackSize(input.description, input.unit);

  // No readable format: book the trade unit as-is. A U.M. that is already a real
  // measure ("2,4 KG of prosciutto") still gets normalized to kg/l, so the
  // warehouse never mixes €/g and €/kg rows for the same dimension.
  if (!pack || pack.unit === "pz") {
    const measure = classifyUm(input.unit) === "weight" ? MEASURE[umKey(input.unit)] : undefined;
    if (measure) {
      const h = humanize(qty * measure.toBase, measure.unit);
      const factor = h.size > 0 ? qty / h.size : 1;
      const um = (input.unit || "").trim();
      return {
        unit: h.unit,
        quantity: h.size,
        unitCost: price != null ? round4(price * factor) : null,
        pack: null,
        // Even a pass-through gets an explanation: the owner sees "Ltr" on the
        // document and "l" in the field, and silence there reads as an error.
        explanation:
          um.toLowerCase() === h.unit ? null : `${qty} ${um || h.unit} = ${h.size} ${h.unit}`,
      };
    }
    return {
      unit: "pz",
      quantity: round3(qty),
      unitCost: price != null ? round4(price) : null,
      pack: null,
      explanation: null,
    };
  }

  const totalQty = qty * pack.size;
  return {
    unit: pack.unit,
    quantity: round3(totalQty),
    unitCost: price != null && pack.size > 0 ? round4(price / pack.size) : null,
    pack,
    explanation: `${qty} ${(input.unit || "").trim() || "pz"} × ${pack.source} = ${round3(totalQty)} ${pack.unit}`,
  };
}

const umKey = (raw?: string | null) => (raw || "").toLowerCase().replace(/[^a-z]/g, "");

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
