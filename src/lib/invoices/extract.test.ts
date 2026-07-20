import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseInvoice, normalizeInvoice, SYSTEM_PROMPT, extractInvoice } from "@/lib/invoices/extract";

describe("parseInvoice", () => {
  it("strips markdown fences and leading prose", () => {
    const raw = "Here you go:\n```json\n{\"supplierName\":\"Metro\",\"lines\":[]}\n```";
    expect(parseInvoice(raw)).toMatchObject({ supplierName: "Metro" });
  });
});

describe("normalizeInvoice", () => {
  it("coerces numbers, converts dd/mm/yyyy, strips IT vat prefix", () => {
    const inv = normalizeInvoice({
      supplierName: "  Ortofrutta Rossi  ",
      supplierVat: "IT 01234567890",
      invoiceNumber: "2026/123",
      invoiceDate: "07/06/2026",
      currency: "eur",
      netTotal: "100,50",
      taxTotal: 10.05,
      grossTotal: "110,55",
      lines: [
        { description: "Pomodori", quantity: "5", unit: "kg", unitPrice: "2,00", lineTotal: "10,00", taxRate: 10 },
      ],
    });
    expect(inv.supplierName).toBe("Ortofrutta Rossi");
    expect(inv.supplierVat).toBe("01234567890");
    expect(inv.invoiceDate).toBe("2026-06-07");
    expect(inv.currency).toBe("EUR");
    expect(inv.netTotal).toBe(100.5);
    expect(inv.grossTotal).toBe(110.55);
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ description: "Pomodori", quantity: 5, unitPrice: 2, lineTotal: 10, taxRate: 10 });
  });

  it("returns nulls + empty lines for an unreadable doc", () => {
    const inv = normalizeInvoice({ rawNotes: "not an invoice", lines: [] });
    expect(inv.supplierName).toBeNull();
    expect(inv.lines).toEqual([]);
    expect(inv.currency).toBe("EUR");
  });

  it("rejects an invalid date (keeps null, never a bad value)", () => {
    expect(normalizeInvoice({ invoiceDate: "garbage" }).invoiceDate).toBeNull();
  });
});

// The prompt is the whole product here: a real Ristogamma DDT (delivery note,
// no VAT summary) came back as {"lines":[],"rawNotes":"not an invoice"} because
// the prompt only ever said "fattura" and told the model to bail on anything
// else. The owner saw "0 things added to inventory". These pin the contract
// that made that document extract — verified against the real PDF.
describe("SYSTEM_PROMPT contract", () => {
  it("accepts delivery notes, not just invoices", () => {
    for (const kind of ["documento di trasporto", "DDT", "bolla"]) {
      expect(SYSTEM_PROMPT.toLowerCase()).toContain(kind.toLowerCase());
    }
  });

  it("never lets a missing price or total suppress the lines", () => {
    expect(SYSTEM_PROMPT).toMatch(/no VAT summary and sometimes no prices/i);
    expect(SYSTEM_PROMPT).toMatch(/NEVER a reason to return no lines/i);
    expect(SYSTEM_PROMPT).toMatch(/EVERY goods line[\s\S]*no price/i);
  });

  it("only bails out when the document carries no goods at all", () => {
    // The old rule keyed on "is it an invoice?"; the new one keys on "are there goods?".
    expect(SYSTEM_PROMPT).not.toContain('"not an invoice"');
    expect(SYSTEM_PROMPT).toContain('"not a supplier document"');
  });

  it("tells supplier from recipient so goods aren't filed under the restaurant", () => {
    // The Ristogamma DDT prints the recipient's P.IVA in the top-right box and
    // the supplier's only in the letterhead — gpt-4o picked the recipient until
    // the prompt named these labels explicitly.
    for (const label of ["Intestatario", "Destinatario", "letterhead"]) {
      expect(SYSTEM_PROMPT).toContain(label);
    }
    expect(SYSTEM_PROMPT).toMatch(/NEVER put the Intestatario\/Destinatario/i);
  });

  it("skips the legal boilerplate printed under the goods table", () => {
    expect(SYSTEM_PROMPT).toMatch(/art\. 62/);
  });
});

// Two consecutive upload failures sent the owner back to square one with a
// bare "Extraction failed". A rate-limited or hiccuping model call is normal
// and must not cost them the whole document.
describe("extractInvoice resilience", () => {
  const OK = {
    ok: true, status: 200,
    json: async () => ({ output_text: '{"supplierName":"Metro","lines":[]}' }),
  };
  const fail = (status: number) => ({ ok: false, status, text: async () => "upstream boom" });

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.OPENAI_API_KEY = "sk-test";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Run `p` while letting every pending retry delay elapse. */
  async function withTimers<T>(p: Promise<T>): Promise<T> {
    const settled = p.then((v) => ({ v }), (e) => ({ e }));
    await vi.runAllTimersAsync();
    const r = (await settled) as { v?: T; e?: unknown };
    if (r.e) throw r.e;
    return r.v as T;
  }

  it("retries a 429 and succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(OK);
    vi.stubGlobal("fetch", fetchMock);
    const inv = await withTimers(extractInvoice("Zm9v", "application/pdf"));
    expect(inv.supplierName).toBe("Metro");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a dropped connection", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(OK);
    vi.stubGlobal("fetch", fetchMock);
    await withTimers(extractInvoice("Zm9v", "application/pdf"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting the retries, reporting the real reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(withTimers(extractInvoice("Zm9v", "application/pdf"))).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(4); // first try + 3 retries
  });

  it("does NOT retry a request that is wrong on our side", async () => {
    // A 400 would fail identically every time; retrying only delays the error.
    const fetchMock = vi.fn().mockResolvedValue(fail(400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(withTimers(extractInvoice("Zm9v", "application/pdf"))).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
