import type { createServiceRoleClient } from "@/lib/supabase/server";
import { logSystemEvent } from "@/lib/system-log";
import { MockTransport, type FiscalRecordPayload, type FiscalTransport, type TransportResult } from "./transport";
import { VerifactiTransport } from "./verifacti";

// The send queue.
//
// Art. 17 Orden HAC/1177/2024 requires pending records to be retried AT LEAST ONCE
// EVERY HOUR. Vercel Hobby only allows daily crons at a fixed minute+hour (anything
// sub-daily fails the deploy outright) — a head-on collision. Rather than change
// plan, the duty is met by three layers, none of which can block a payment:
//
//   1. INLINE, right after the payment commits (fire-and-forget). Covers the normal
//      case in a second or two.
//   2. HOURLY, from n8n — which already runs — hitting /api/cron/fiscal-flush with
//      the same Bearer CRON_SECRET as every other cron. This is the layer that
//      actually satisfies art. 17.
//   3. DAILY, the Vercel cron, as a safety net for when n8n itself is down.
//
// The claim is `for update skip locked` (fn_fiscal_claim_pending), so all three can
// fire at once without ever sending the same record twice.
//
// The invariant that outranks all of this: THE TILL NEVER STOPS TAKING MONEY. If
// AEAT is unreachable the record is already committed and chained; it just stays
// `pending` and goes out later. A restaurant losing a lunch service because the
// Agencia Tributaria has a bad afternoon would be a worse bug than the one we're
// fixing.

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** Which transport is in play. Verifacti when its key is configured, otherwise the
 * mock (local dev / the E2E driver / an Italy-only deployment). A Spanish tenant
 * cannot reach `native` mode without an onboarded NIF, which requires the key. */
export function getTransport(): FiscalTransport {
  const key = process.env.VERIFACTI_API_KEY;
  if (key && process.env.FISCAL_TRANSPORT !== "mock") return new VerifactiTransport(key);
  return new MockTransport();
}

const RECORD_SELECT = `
  id, tipo, num_serie, fecha_expedicion, tipo_factura, desglose, cuota_total,
  importe_total, prev_huella, huella, fecha_hora_huso, sistema_informatico,
  chain_index, rectifica, tenant_id, obligado_id,
  fiscal_obligados!inner(nif, razon_social)
`;

function toPayload(row: any): FiscalRecordPayload {
  return {
    recordId: row.id,
    nif: row.fiscal_obligados.nif,
    razonSocial: row.fiscal_obligados.razon_social || "",
    tipo: row.tipo,
    numSerie: row.num_serie,
    fechaExpedicion: row.fecha_expedicion,
    tipoFactura: row.tipo_factura,
    descripcion: row.tipo === "anulacion" ? "Anulación de factura simplificada" : "Consumición en local",
    desglose: Array.isArray(row.desglose) ? row.desglose : [],
    cuotaTotal: Number(row.cuota_total) || 0,
    importeTotal: Number(row.importe_total) || 0,
    prevHuella: row.prev_huella,
    huella: row.huella,
    fechaHoraHuso: row.fecha_hora_huso,
    chainIndex: Number(row.chain_index) || 0,
    sistema: row.sistema_informatico,
    rectifica: row.rectifica,
  };
}

/** Write the transport's verdict back onto the submission. fiscal_records is never
 * touched — it CAN'T be (the immutability trigger) — which is exactly why the
 * mutable half of the world lives in its own table. */
async function applyResult(svc: ServiceClient, result: TransportResult, tenantId: string | null) {
  const patch: Record<string, unknown> = {
    provider_response: (result.raw ?? {}) as object,
    last_error: result.error,
    updated_at: new Date().toISOString(),
  };

  if (result.status === "accepted" || result.status === "accepted_with_errors") {
    patch.status = result.status;
    patch.aeat_csv = result.csv;
  } else if (result.status === "rejected") {
    patch.status = "rejected";
    // A rejected record is a human problem: a malformed desglose, a chain AEAT
    // disagrees with. Retrying on a timer would hide it. Shout instead.
    await logSystemEvent({
      tenant_id: tenantId || undefined,
      category: "api_error",
      severity: "critical",
      title: "VeriFactu: registro RIFIUTATO da AEAT",
      description: `Record ${result.recordId}: ${result.error || "senza motivo"}. Il ticket è stato emesso ma non risulta registrato — serve intervento manuale.`,
    });
  } else {
    // pending: leave next_retry_at as the claim set it (exponential backoff, ≤1h).
    patch.status = "pending";
  }

  await svc.from("fiscal_submissions").update(patch).eq("record_id", result.recordId);
}

/** Send ONE record right now — the inline path, called just after a payment commits.
 * Fire-and-forget by contract: it never throws at the caller, because nothing that
 * happens here may un-cash a bill that is already paid. */
export async function flushSubmission(svc: ServiceClient, recordId: string): Promise<void> {
  try {
    const { data: row } = await svc.from("fiscal_records").select(RECORD_SELECT).eq("id", recordId).maybeSingle();
    if (!row) return;

    // Take the row through the same claim as the cron, so an inline send and an
    // hourly flush racing on the same record can't both send it.
    const { data: claimed } = await svc
      .from("fiscal_submissions")
      .update({ status: "sent", attempts: 1, sent_at: new Date().toISOString() })
      .eq("record_id", recordId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) return; // someone else has it

    const [result] = await getTransport().submit([toPayload(row)]);
    if (result) await applyResult(svc, result, (row as any).tenant_id);
  } catch {
    // Swallowed on purpose. The record is committed and queued; the hourly flush is
    // the safety net. A throw here would surface as a failed payment on a bill the
    // guest has already paid.
  }
}

export interface FlushSummary {
  claimed: number;
  accepted: number;
  rejected: number;
  pending: number;
}

/** Drain the queue — the hourly (n8n) and daily (Vercel) path.
 *
 * Records go out IN CHAIN ORDER, per obligado: AEAT rejects a record whose
 * predecessor it has never seen, so a queue that sent record 7 before record 6
 * would manufacture rejections out of nothing. */
export async function flushPending(svc: ServiceClient, limit = 100): Promise<FlushSummary> {
  const { data: claimed, error } = await svc.rpc("fn_fiscal_claim_pending", { p_limit: limit });
  if (error) throw new Error(error.message);

  const rows = (claimed || []) as Array<{ record_id: string; tenant_id: string | null; obligado_id: string }>;
  const summary: FlushSummary = { claimed: rows.length, accepted: 0, rejected: 0, pending: 0 };
  if (rows.length === 0) return summary;

  const { data: records } = await svc
    .from("fiscal_records")
    .select(RECORD_SELECT)
    .in("id", rows.map((r) => r.record_id));

  const byId = new Map((records || []).map((r: any) => [r.id, r]));
  const ordered = [...(records || [])].sort((a: any, b: any) => {
    if (a.obligado_id !== b.obligado_id) return String(a.obligado_id).localeCompare(String(b.obligado_id));
    return Number(a.chain_index) - Number(b.chain_index);
  });

  const transport = getTransport();
  for (const row of ordered) {
    const [result] = await transport.submit([toPayload(row)]);
    if (!result) continue;
    await applyResult(svc, result, (byId.get((row as any).id) as any)?.tenant_id ?? null);
    if (result.status === "accepted" || result.status === "accepted_with_errors") summary.accepted++;
    else if (result.status === "rejected") summary.rejected++;
    else summary.pending++;
  }

  return summary;
}

/** How many records this tenant still owes AEAT. The law wants this visible to the
 * user, so it drives a badge in the cassa and in Settings → Fiscale. */
export async function pendingCount(svc: ServiceClient, tenantId: string): Promise<number> {
  const { count } = await svc
    .from("fiscal_submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "sent"]);
  return count || 0;
}
