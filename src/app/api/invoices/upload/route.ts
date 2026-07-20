import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extractInvoice } from "@/lib/invoices/extract";
import { assertManagement } from "@/lib/billing/guard";
import { assertCredits, consumeCredits } from "@/lib/billing/credits";
import { suggestLineMatches } from "@/lib/management/ingredient-match";
import { apiError } from "@/lib/api-error";

// Upload a supplier-invoice photo/PDF → OCR it synchronously (an invoice is a
// single page, so unlike the menu importer we don't need the async job) → store
// a supplier_invoices header + its lines with status 'parsed'. Each stored line
// is auto-matched against the tenant's warehouse (fuzzy name match); confident
// matches are persisted onto the line so the review step arrives pre-filled.
// The owner then reviews/corrects and confirms via /api/invoices/confirm.
//
// Auth: signed-in dashboard user; RLS scopes the writes to tenants the user can
// manage (members have full access to supplier_invoices/_items).

export const runtime = "nodejs";
// A dense invoice (a dozen lines, a scanned photo) can keep the model busy well
// past a minute, and the retries in extractInvoice add to that. The owner is
// standing at the till watching the bar — better a slow success than a timeout
// that makes them shoot the whole document again.
export const maxDuration = 300;

const ALLOWED: Record<string, "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const tenantId = form?.get("tenant_id");
  const file = form?.get("file");
  if (!form || typeof tenantId !== "string" || !tenantId || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing tenant_id or file" }, { status: 400 });
  }

  // Paid add-on gate: invoice OCR is part of the gestionale. Check before the
  // expensive extraction so an unentitled tenant never burns an OCR call.
  const gate = await assertManagement(tenantId);
  if (gate) return gate;

  // Credit gate, same reason as the add-on gate above it: refuse BEFORE the OCR
  // call, so an empty wallet costs us nothing.
  const credits = await assertCredits(tenantId, "invoice_ocr");
  if (credits) return credits;

  const mediaType = ALLOWED[(file.type || "").toLowerCase()];
  if (!mediaType) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let extracted;
  try {
    extracted = await extractInvoice(base64, mediaType);
  } catch (e: any) {
    // Not charged: the extraction never produced anything.
    return apiError(e, { route: "invoices/upload", publicMessage: "Extraction failed", status: 502 });
  }

  // Charged only now that the OCR actually returned.
  await consumeCredits(tenantId, "invoice_ocr", {
    costEur: 0.03,
    metadata: { media_type: mediaType },
  });

  // Header
  const { data: invoice, error: invErr } = await supabase
    .from("supplier_invoices")
    .insert({
      tenant_id: tenantId,
      source: "photo",
      supplier_name: extracted.supplierName,
      supplier_vat: extracted.supplierVat,
      invoice_number: extracted.invoiceNumber,
      invoice_date: extracted.invoiceDate,
      currency: extracted.currency,
      net_total: extracted.netTotal,
      tax_total: extracted.taxTotal,
      gross_total: extracted.grossTotal,
      status: "parsed",
      raw_payload: extracted as any,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (invErr || !invoice) {
    return NextResponse.json({ error: "Failed to store invoice", details: invErr?.message }, { status: 500 });
  }

  // Lines
  const rows = extracted.lines.map((l) => ({
    tenant_id: tenantId,
    invoice_id: invoice.id,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unit_price: l.unitPrice,
    line_total: l.lineTotal,
    tax_rate: l.taxRate,
    raw_payload: l as any,
  }));
  let stored: Array<{ id: string; description: string | null; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null }> = [];
  if (rows.length > 0) {
    const { data: inserted, error: linesErr } = await supabase
      .from("supplier_invoice_items")
      .insert(rows)
      .select("id, description, quantity, unit, unit_price, line_total");
    if (linesErr) {
      return NextResponse.json({ error: "Failed to store lines", details: linesErr.message }, { status: 500 });
    }
    stored = inserted || [];
  }

  // Auto-match every line against the warehouse so the review arrives pre-filled.
  // High-confidence matches are persisted immediately (the owner can still change
  // them); the full suggestion set (incl. new-ingredient proposals) goes back to
  // the UI.
  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id, name, unit")
    .eq("tenant_id", tenantId)
    .eq("archived", false);
  const matches = suggestLineMatches(
    stored.map((l) => ({
      id: l.id,
      description: l.description || "",
      unit: l.unit,
      // The pack format ("CF.1 KG", "6X500 ML") only converts into real units
      // with the numbers alongside it, so the matcher needs them too.
      quantity: l.quantity,
      unitPrice: l.unit_price,
      lineTotal: l.line_total,
    })),
    (ingredients || []) as Array<{ id: string; name: string; unit: string }>,
  );
  const byLine = new Map(matches.map((m) => [m.lineId, m]));
  for (const m of matches) {
    if (m.confidence === "high" && m.ingredientId) {
      await supabase
        .from("supplier_invoice_items")
        .update({ ingredient_id: m.ingredientId })
        .eq("id", m.lineId)
        .eq("tenant_id", tenantId);
    }
  }

  return NextResponse.json({
    ok: true,
    invoice_id: invoice.id,
    extracted,
    supplier_name: extracted.supplierName,
    lines: stored.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      line_total: l.line_total,
      suggestion: byLine.get(l.id) || null,
    })),
  });
}
