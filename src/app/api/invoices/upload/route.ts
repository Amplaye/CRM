import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractInvoice } from "@/lib/invoices/extract";
import { assertManagement } from "@/lib/billing/guard";
import { assertCredits, consumeCredits } from "@/lib/billing/credits";
import { suggestLineMatches } from "@/lib/management/ingredient-match";
import { classifyLine } from "@/lib/management/line-kind";
import { apiError } from "@/lib/api-error";
import { authorizeInvoiceRequest } from "@/lib/ai/manager-auth";

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

// Find or create the supplier for this tenant. Prefer VAT (the unique key);
// fall back to a case-insensitive name match; create a bare record otherwise.
async function resolveSupplier(
  supabase: SupabaseClient,
  tenantId: string,
  rawName: string | null | undefined,
  rawVat: string | null | undefined,
): Promise<{ id: string | null; defaultKind: "goods" | "service" | "charge" | null }> {
  const name = rawName?.trim() || "";
  const vat = rawVat?.trim() || "";
  if (!name && !vat) return { id: null, defaultKind: null };

  let existing: { id: string; default_kind: string | null } | null = null;
  if (vat) {
    const { data } = await supabase
      .from("suppliers")
      .select("id, default_kind")
      .eq("tenant_id", tenantId)
      .eq("vat", vat)
      .maybeSingle();
    existing = data as any;
  }
  if (!existing && name) {
    const { data } = await supabase
      .from("suppliers")
      .select("id, default_kind")
      .eq("tenant_id", tenantId)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    existing = data as any;
  }
  if (existing) return { id: existing.id, defaultKind: (existing.default_kind as any) ?? null };

  const { data: created } = await supabase
    .from("suppliers")
    .insert({ tenant_id: tenantId, name: name || vat, vat: vat || null })
    .select("id, default_kind")
    .maybeSingle();
  return { id: (created as any)?.id ?? null, defaultKind: (created as any)?.default_kind ?? null };
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const tenantId = form?.get("tenant_id");
  const file = form?.get("file");
  if (!form || typeof tenantId !== "string" || !tenantId || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing tenant_id or file" }, { status: 400 });
  }

  // Dashboard user (RLS) OR the WhatsApp bot on behalf of a verified staff member
  // (x-ai-secret + service-role) — the "fattura da foto" path. `phone` is present
  // only on the bot request.
  const phoneField = form.get("phone");
  const auth = await authorizeInvoiceRequest(req, tenantId, typeof phoneField === "string" ? phoneField : undefined);
  if ("error" in auth) return auth.error;
  const supabase = auth.supabase;

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

  // Supplier entity: resolve (or create) the supplier so its remembered
  // default_kind can force this invoice's classification — a service supplier
  // (e.g. CENTROCASSA: RT rental, maintenance) never books its lines to stock.
  const supplier = await resolveSupplier(supabase, tenantId, extracted.supplierName, extracted.supplierVat);

  // Header
  let { data: invoice, error: invErr } = await supabase
    .from("supplier_invoices")
    .insert({
      tenant_id: tenantId,
      source: "photo",
      supplier_id: supplier.id,
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
      created_by: auth.createdBy,
    })
    .select("id")
    .single();
  if (invErr || !invoice) {
    // A tenant re-photographing a document they already imported hits the
    // (tenant, supplier_vat, invoice_number) unique index. That index is doing
    // its job — booking the same delivery twice would double the stock — but
    // "Failed to store invoice" tells the owner nothing. Answer precisely, and
    // pick up where they left off when nothing has been booked yet.
    if (invErr?.code === "23505" && extracted.supplierVat && extracted.invoiceNumber) {
      const { data: existing } = await supabase
        .from("supplier_invoices")
        .select("id, status, invoice_date, created_at")
        .eq("tenant_id", tenantId)
        .eq("supplier_vat", extracted.supplierVat)
        .eq("invoice_number", extracted.invoiceNumber)
        .maybeSingle();

      if (existing?.status === "confirmed") {
        return NextResponse.json(
          {
            error: "duplicate_confirmed",
            invoice_id: existing.id,
            supplier_name: extracted.supplierName,
            invoice_number: extracted.invoiceNumber,
            booked_on: existing.invoice_date || existing.created_at,
          },
          { status: 409 },
        );
      }
      if (existing) {
        // Parsed but never confirmed: nothing has entered stock, so replace the
        // stale lines with this fresh read and let the review continue.
        await supabase
          .from("supplier_invoice_items")
          .delete()
          .eq("invoice_id", existing.id)
          .eq("tenant_id", tenantId);
        invoice = { id: existing.id };
        invErr = null;
      }
    }
    if (invErr || !invoice) {
      return apiError(invErr, {
        route: "invoices/upload",
        publicMessage: `Non sono riuscito a salvare il documento${invErr?.message ? `: ${invErr.message}` : ""}`,
        status: 500,
      });
    }
  }

  // Lines. Persist the classification (goods/service/charge) so the confirm step
  // and P&L can trust it. A non-goods supplier default forces every line off the
  // warehouse; otherwise each line is classified from its own description.
  const forcedKind = supplier.defaultKind && supplier.defaultKind !== "goods" ? supplier.defaultKind : null;
  const rows = extracted.lines.map((l) => ({
    tenant_id: tenantId,
    invoice_id: invoice.id,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unit_price: l.unitPrice,
    line_total: l.lineTotal,
    tax_rate: l.taxRate,
    kind: forcedKind ?? classifyLine(l.description),
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
