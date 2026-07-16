import { describe, it, expect } from "vitest";
import {
  parseCsv, guestsToCsv, detectColumnMapping, normalizePhone,
  rowsToGuestInputs, planImport, EXPORT_HEADERS,
} from "./porting";

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, escaped quotes, CRLF", () => {
    const csv = 'name,phone,notes\r\n"Rossi, Mario","+39 333","line1\nline2"\r\n"O""Brien","+1",""';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["Rossi, Mario", "+39 333", "line1\nline2"]);
    expect(rows[2][0]).toBe('O"Brien');
  });
  it("strips a BOM and drops blank trailing lines", () => {
    const rows = parseCsv("﻿name,phone\nAna,+34\n\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["name", "phone"]);
  });
});

describe("guestsToCsv", () => {
  it("emits every field with the canonical header and joins tags with ;", () => {
    const csv = guestsToCsv([
      { name: "Ana", phone: "+34", email: "a@x.com", visit_count: 3, tags: ["vip", "regular"], dietary_notes: "nuts" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(EXPORT_HEADERS.map((h) => `"${h}"`).join(","));
    expect(lines[1]).toContain('"Ana"');
    expect(lines[1]).toContain('"vip;regular"');
    expect(lines[1]).toContain('"nuts"');
  });
  it("round-trips through parseCsv losslessly for core fields", () => {
    const csv = guestsToCsv([{ name: "Ann", phone: "+1 (555) 12", email: "e@e.com", notes: "hi, there", tags: ["a"] }]);
    const rows = parseCsv(csv);
    const { guests } = rowsToGuestInputs(rows);
    expect(guests[0]).toMatchObject({ name: "Ann", phone: "+1 (555) 12", email: "e@e.com", notes: "hi, there", tags: ["a"] });
  });
});

describe("detectColumnMapping — multilingual", () => {
  it("maps Italian headers", () => {
    const m = detectColumnMapping(["Nome", "Telefono", "Email", "Allergie", "Note"]);
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, dietary_notes: 3, notes: 4 });
  });
  it("maps Spanish headers with accents", () => {
    const m = detectColumnMapping(["Nombre", "Teléfono", "Correo", "Alergias"]);
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, dietary_notes: 3 });
  });
  it("maps German headers", () => {
    const m = detectColumnMapping(["Name", "Telefon", "E-Mail", "Allergien", "Familie"]);
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, dietary_notes: 3, family_notes: 4 });
  });
  it("returns a partial map when columns are missing", () => {
    const m = detectColumnMapping(["Nome", "Cellulare"]);
    expect(m.name).toBe(0);
    expect(m.phone).toBe(1);
    expect(m.email).toBeUndefined();
  });
});

describe("normalizePhone", () => {
  it("keeps a leading + and strips the rest", () => {
    expect(normalizePhone("+34 612-345 678")).toBe("+34612345678");
    expect(normalizePhone("")).toBe("");
  });
  it("folds the 00 international prefix to + so the same number compares equal", () => {
    expect(normalizePhone("0034612345678")).toBe("+34612345678");
    expect(normalizePhone("(0034) 600 111 222")).toBe("+34600111222");
    // +34… and 0034… are the same number
    expect(normalizePhone("+34612345678")).toBe(normalizePhone("0034 612 345 678"));
  });
  it("leaves a single national leading zero untouched", () => {
    expect(normalizePhone("06 1234 5678")).toBe("0612345678");
  });
});

describe("rowsToGuestInputs", () => {
  it("parses fields, splits tags, coerces spend, skips empty rows", () => {
    const rows = [
      ["Nome", "Telefono", "Tag", "Spesa"],
      ["Mario", "+39 333", "vip;regular", "45,50"],
      ["", "", "", ""], // skipped
    ];
    const { guests, skipped, mapping } = rowsToGuestInputs(rows);
    expect(mapping.name).toBe(0);
    expect(skipped).toBe(1);
    expect(guests).toHaveLength(1);
    expect(guests[0].tags).toEqual(["vip", "regular"]);
    expect(guests[0].estimated_spend).toBe(45.5);
  });
  it("falls back name→phone when only a phone is present", () => {
    const { guests } = rowsToGuestInputs([["name", "phone"], ["", "+3912345"]]);
    expect(guests[0].name).toBe("+3912345");
  });
});

describe("planImport — dedup by phone", () => {
  const incoming = rowsToGuestInputs([
    ["name", "phone", "email"],
    ["Ana New", "+34 600 111", "ana@x.com"],   // new
    ["Bob Update", "+39 333 222", ""],          // matches existing
    ["Dup", "+34 600 111", ""],                 // in-file duplicate of Ana's phone
    ["No Phone Guy", "", ""],                    // insert, can't dedupe
  ]).guests;

  const existing = [{ id: "g1", phone: "+39333222", name: "Bob Old" }];

  it("splits inserts vs updates and MERGES in-file duplicates (first-seen kept, no data lost)", () => {
    const plan = planImport(incoming, existing, 0);
    // Ana (merged with Dup, keeps her name/email) + No Phone Guy = 2 inserts; Bob = 1 update.
    expect(plan.toInsert.map((g) => g.name).sort()).toEqual(["Ana New", "No Phone Guy"]);
    expect(plan.toInsert.find((g) => g.name === "Ana New")?.email).toBe("ana@x.com"); // preserved through merge
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe("g1");
    expect(plan.toUpdate[0].fields.name).toBe("Bob Update");
    expect(plan.duplicatesInFile).toBe(1);
  });

  it("update fields never wipe existing data with empty cells", () => {
    const plan = planImport(
      rowsToGuestInputs([["name", "phone", "email"], ["Keep", "+1", ""]]).guests,
      [{ id: "x", phone: "+1", name: "Old", email: "old@x.com" }],
    );
    expect(plan.toUpdate[0].fields.name).toBe("Keep");
    expect("email" in plan.toUpdate[0].fields).toBe(false); // empty email not written
  });
});
