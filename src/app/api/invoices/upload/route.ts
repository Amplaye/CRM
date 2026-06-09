import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extractInvoice } from "@/lib/invoices/extract";
import { assertManagement } from "@/lib/billing/guard";

// Upload a supplier-invoice photo/PDF → OCR it synchronously (an invoice is a
// single page, so unlike the menu importer we don't need the async job) → store
// a supplier_invoices header + its lines with status 'parsed'. The owner then
// reviews/corrects and confirms via /api/invoices/confirm.
//
// Auth: signed-in dashboard user; RLS scopes the writes to tenants the user can
// manage (members have full access to supplier_invoices/_items).

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const mediaType = ALLOWED[(file.type || "").toLowerCase()];
  if (!mediaType) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let extracted;
  try {
    extracted = await extractInvoice(base64, mediaType);
  } catch (e: any) {
    return NextResponse.json({ error: "Extraction failed", details: e?.message }, { status: 502 });
  }

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
  if (rows.length > 0) {
    const { error: linesErr } = await supabase.from("supplier_invoice_items").insert(rows);
    if (linesErr) {
      return NextResponse.json({ error: "Failed to store lines", details: linesErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, invoice_id: invoice.id, extracted });
}
