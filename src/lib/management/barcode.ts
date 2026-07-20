// Telling a product barcode apart from the other codes printed on paperwork.
//
// Suppliers print a barcode on the delivery note itself (the DDT number, an
// order id…). Scanning one of those in the inventory can never find a product,
// and "no product with that code — add it as new" sends the owner off to create
// a bogus ingredient. So we check the shape first: retail packaging carries an
// EAN-13, EAN-8 or UPC-A, all of which are fixed-length and self-checking.

const RETAIL_LENGTHS = new Set([8, 12, 13, 14]); // EAN-8, UPC-A, EAN-13, ITF-14

/**
 * GS1 mod-10 check digit: sum the digits with alternating weights, counting
 * from the right so the same routine works for every supported length.
 */
function hasValidCheckDigit(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    const digit = Number(digits[digits.length - 2 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits[digits.length - 1]);
}

/**
 * True when the scanned string looks like a barcode off a product package.
 * A code that fails this is almost certainly document paperwork — the caller
 * should point the owner at the invoice importer rather than at "add as new".
 */
export function isRetailBarcode(code: string): boolean {
  const value = code.trim();
  if (!/^\d+$/.test(value)) return false; // alphanumeric → internal reference
  if (!RETAIL_LENGTHS.has(value.length)) return false;
  return hasValidCheckDigit(value);
}
