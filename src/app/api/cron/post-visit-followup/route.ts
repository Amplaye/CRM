import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/meta";
import { tenantWhatsAppFrom } from "@/lib/whatsapp/from";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { logSystemEvent } from "@/lib/system-log";

// Post-visit follow-up cron (thank-you + review request).
//
// WHY a template: this fires the day AFTER the visit, always outside the 24h
// window → the approved `post_visit_followup` MARKETING template.
//
// Opt-in: gated on the tenant's `followup_enabled` flag (default OFF). A
// MARKETING template is opt-out-able and costs more than UTILITY, so we never
// send it unless the owner switched it on.
//
// Idempotency: recorded in audit_events as action 'followup_sent'
// (entity_id = reservation.id). Hourly/daily cron never double-sends.

type Lang = "es" | "it" | "en" | "de";
function asLang(v: unknown): Lang {
  const c = String(v || "").slice(0, 2).toLowerCase();
  return (["es", "it", "en", "de"] as const).includes(c as Lang) ? (c as Lang) : "es";
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  // Visits from yesterday (local-ish: we use the date column, which is the
  // booking date). One day back catches the previous service.
  const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from("reservations")
    .select("id, tenant_id, date, status, language, guests(name, phone), tenants(name, settings)")
    .eq("date", yesterday)
    .in("status", ["completed", "seated"]); // guest actually showed up

  let sent = 0, skipped = 0, failed = 0;
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

  type Row = {
    id: string; tenant_id: string; date: string; status: string;
    language: string | null;
    guests: { name: string | null; phone: string | null } | null;
    tenants: { name: string | null; settings: TenantSettings | null } | null;
  };
  for (const r of (rows || []) as unknown as Row[]) {
    const settings = r.tenants?.settings;
    // Opt-in gate — default OFF.
    if (!getFeatures(settings).followup_enabled) { skipped++; continue; }

    const phone = r.guests?.phone;
    if (!phone) { skipped++; continue; }

    const { data: prior } = await supabase
      .from("audit_events")
      .select("id")
      .eq("tenant_id", r.tenant_id)
      .eq("action", "followup_sent")
      .eq("entity_id", r.id)
      .limit(1);
    if (prior && prior.length) { skipped++; continue; }

    // Reservation's pinned chat language wins; fall back to the tenant primary
    // language so a null never silently becomes Spanish for a non-ES tenant.
    const tenantPrimaryLang = (r.tenants?.settings as { bot_config?: { primary_language?: string } } | null)?.bot_config?.primary_language;
    const lang = asLang(r.language ?? tenantPrimaryLang);
    const guestName = r.guests?.name || (lang === "en" ? "Guest" : "Cliente");
    const restaurant = r.tenants?.name || "";
    const from = tenantWhatsAppFrom(settings);

    // post_visit_followup vars: {{1}}=name {{2}}=restaurant
    const res = await sendWhatsAppTemplate(
      phone,
      "post_visit_followup",
      lang,
      [guestName, restaurant],
      from
    );

    if (res.ok) {
      sent++;
      results.push({ id: r.id, ok: true });
      await supabase.from("audit_events").insert({
        tenant_id: r.tenant_id,
        action: "followup_sent",
        entity_id: r.id,
        source: "system",
        idempotency_key: `followup:${r.id}`,
        details: { channel: "whatsapp", template: "post_visit_followup", lang, message_id: res.messageId },
      });
    } else {
      failed++;
      results.push({ id: r.id, ok: false, reason: res.errorMessage });
    }
  }

  if (failed) {
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "high",
      title: `Post-visit follow-up: ${failed} failed to send`,
      metadata: { sent, skipped, failed, results: results.filter((x) => !x.ok).slice(0, 20) },
    });
  }

  return NextResponse.json({ ok: true, sent, skipped, failed });
}
