import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { flushPending } from "@/lib/fiscal/queue";
import { logSystemEvent } from "@/lib/system-log";

// Drain the VeriFactu send queue. Same auth as every other cron here:
// `Authorization: Bearer ${CRON_SECRET}`.
//
// Called from TWO places, on purpose:
//
//   • n8n, HOURLY. Art. 17 Orden HAC/1177/2024 requires pending records to be
//     retried at least once an hour — and Vercel Hobby refuses to deploy a
//     sub-daily cron at all. n8n already runs, already holds CRON_SECRET, and has
//     no such restriction, so it is the layer that actually meets the duty.
//
//   • Vercel, DAILY (vercel.json). The safety net for the day n8n itself is down.
//
// The claim inside flushPending is `for update skip locked`, so both callers can
// fire at the same second without a record ever going out twice.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceRoleClient();
  try {
    const summary = await flushPending(svc, 200);
    if (summary.rejected > 0) {
      await logSystemEvent({
        category: "api_error",
        severity: "critical",
        title: "VeriFactu: registri rifiutati nello svuotamento coda",
        description: `${summary.rejected} record rifiutati da AEAT su ${summary.claimed} inviati. Ticket già consegnati agli ospiti ma non registrati.`,
      });
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    await logSystemEvent({
      category: "api_error",
      severity: "high",
      title: "VeriFactu: svuotamento coda fallito",
      description: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "flush_failed" }, { status: 500 });
  }
}
