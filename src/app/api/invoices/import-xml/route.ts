import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseFatturaPa } from "@/lib/invoices/fatturapa";
import { assertManagement } from "@/lib/billing/guard";
import { classifyLine } from "@/lib/management/line-kind";
import { apiError } from "@/lib/api-error";

// Import one or more FatturaPA (SDI XML) files. Unlike the photo path there's no
// OCR and no credit burn — the XML is authoritative — so we parse locally and
// store a supplier_invoices header + lines with status 'parsed', plus the one
// thing the photo can't give us: due_date (DataScadenzaPagamento). The owner then
// reviews/pays them in /invoices (and can confirm to feed the P&L).
//
// Auth: signed-in dashboard user; RLS scopes writes to manageable tenants.

export const runtime = "nodejs";
export const maxDuration = 60;

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

// Find or create the supplier (prefer VAT, then case-insensitive name).
async function resolveSupplier(
  supabase: ServerClient,
  tenantId: string,
  rawName: string | null | undefined,
  rawVat: string | null | undefined,
): Promise<{ id: string | null; defaultKind: string | null }> {
  const name = rawName?.trim() || "";
  const vat = rawVat?.trim() || "";
  if (!name && !vat) return { id: null, defaultKind: null };

  let existing: { id: string; default_kind: string | null } | null = null;
  if (vat) {
    const { data } = await supabase.from("suppliers").select("id, default_kind").eq("tenant_id", tenantId).eq("vat", vat).maybeSingle();
    existing = data as any;
  }
  if (!existing && name) {
    const { data } = await supabase.from("suppliers").select("id, default_kind").eq("tenant_id", tenantId).ilike("name", name).limit(1).maybeSingle();
    existing = data as any;
  }
  if (existing) return { id: existing.id, defaultKind: existing.default_kind ?? null };

  const { data: created } = await supabase.from("suppliers").insert({ tenant_id: tenantId, name: name || vat, vat: vat || null }).select("id, default_kind").maybeSingle();
  return { id: (created as any)?.id ?? null, defaultKind: (created as any)?.default_kind ?? null };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const tenantId = form?.get("tenant_id");
  const files = form?.getAll("files").filter((f): f is File => f instanceof File) ?? [];
  if (!form || typeof tenantId !== "string" || !tenantId || files.length === 0) {
    return NextResponse.json({ error: "Missing tenant_id or files" }, { status: 400 });
  }

  const gate = await assertManagement(tenantId);
  if (gate) return gate;

  let imported = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = await file.text();
    } catch {
      errors.push(`${file.name}: unreadable`);
      continue;
    }
    let parsed;
    try {
      parsed = parseFatturaPa(text);
    } catch (e: any) {
      errors.push(`${file.name}: ${e?.message || "parse error"}`);
      continue;
    }
    if (!parsed.length) {
      errors.push(`${file.name}: no invoice found`);
      continue;
    }

    for (const inv of parsed) {
      const supplier = await resolveSupplier(supabase, tenantId, inv.supplierName, inv.supplierVat);
      const { data: header, error: invErr } = await supabase
        .from("supplier_invoices")
        .insert({
          tenant_id: tenantId,
          source: "sdi_xml",
          supplier_id: supplier.id,
          supplier_name: inv.supplierName,
          supplier_vat: inv.supplierVat,
          invoice_number: inv.invoiceNumber,
          invoice_date: inv.invoiceDate,
          currency: inv.currency,
          net_total: inv.netTotal,
          tax_total: inv.taxTotal,
          gross_total: inv.grossTotal,
          due_date: inv.dueDate,
          status: "parsed",
          raw_payload: inv as any,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (invErr || !header) {
        // (tenant, supplier_vat, invoice_number) unique index → already imported.
        if (invErr?.code === "23505") { duplicates++; continue; }
        errors.push(`${inv.invoiceNumber || file.name}: ${invErr?.message || "insert failed"}`);
        continue;
      }

      const forcedKind = supplier.defaultKind && supplier.defaultKind !== "goods" ? supplier.defaultKind : null;
      const rows = inv.lines.map((l) => ({
        tenant_id: tenantId,
        invoice_id: header.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unitPrice,
        line_total: l.lineTotal,
        tax_rate: l.taxRate,
        kind: forcedKind ?? classifyLine(l.description),
        raw_payload: l as any,
      }));
      if (rows.length > 0) {
        const { error: linesErr } = await supabase.from("supplier_invoice_items").insert(rows);
        if (linesErr) errors.push(`${inv.invoiceNumber || file.name}: lines ${linesErr.message}`);
      }
      imported++;
    }
  }

  try {
    return NextResponse.json({ ok: true, imported, duplicates, errors });
  } catch (e) {
    return apiError(e, { route: "invoices/import-xml", publicMessage: "Import failed", status: 500 });
  }
}
