import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/meta";
import { tenantWhatsAppFrom } from "@/lib/whatsapp/from";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { logSystemEvent } from "@/lib/system-log";
import { formatDateFull } from "@/lib/format-date";

// Daily-window booking reminder cron.
//
// WHY a template (not free text): the reminder fires the day BEFORE the visit,
// i.e. almost always >24h after the guest last messaged us, so Meta blocks
// plain text — it must go out as the approved `booking_reminder` template.
//
// Idempotency: every send is recorded in audit_events as action
// 'reminder_sent' (entity_id = reservation.id). We skip any reservation that
// already has that row, so an hourly cron never double-reminds. No schema
// change — audit_events is the same table the reminder pipeline already uses.
//
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` (see vercel.json).

// Reservations whose start is this many hours away get reminded. Window is wide
// enough that an hourly cron catches every booking exactly once the day before.
const MIN_HOURS_AHEAD = 20;
const MAX_HOURS_AHEAD = 28;

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
  const now = Date.now();
  const minTs = new Date(now + MIN_HOURS_AHEAD * 3600_000);
  const maxTs = new Date(now + MAX_HOURS_AHEAD * 3600_000);
  // Compare on the date portion — reservations store date + time separately.
  const minDate = minTs.toISOString().slice(0, 10);
  const maxDate = maxTs.toISOString().slice(0, 10);

  // Pull candidate reservations across all tenants in the window, with the
  // guest contact + the per-tenant settings (sender number, feature flags).
  const { data: rows } = await supabase
    .from("reservations")
    .select("id, tenant_id, date, time, party_size, status, language, guests(name, phone), tenants(name, settings)")
    .in("status", ["confirmed", "pending_confirmation"])
    .gte("date", minDate)
    .lte("date", maxDate);

  let sent = 0, skipped = 0, failed = 0;
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

  type Row = {
    id: string; tenant_id: string; date: string; time: string; party_size: number;
    language: string | null;
    guests: { name: string | null; phone: string | null } | null;
    tenants: { name: string | null; settings: TenantSettings | null } | null;
  };
  for (const r of (rows || []) as unknown as Row[]) {
    // Recompute the exact hours-ahead now that we have date + time.
    const startMs = new Date(`${r.date}T${(r.time || "00:00")}:00`).getTime();
    const hoursAhead = (startMs - now) / 3600_000;
    if (hoursAhead < MIN_HOURS_AHEAD || hoursAhead > MAX_HOURS_AHEAD) {
      skipped++; continue;
    }

    // Per-tenant gate: reminders feature must be on for this tenant.
    const settings = r.tenants?.settings;
    // Entry-package tenants (no active plan) don't get reservation reminders.
    if (!hasActivePlan(settings) || !getFeatures(settings).reminders_enabled) { skipped++; continue; }

    const phone = r.guests?.phone;
    if (!phone) { skipped++; results.push({ id: r.id, ok: false, reason: "no_phone" }); continue; }

    // Idempotency: already reminded?
    const { data: prior } = await supabase
      .from("audit_events")
      .select("id")
      .eq("tenant_id", r.tenant_id)
      .eq("action", "reminder_sent")
      .eq("entity_id", r.id)
      .limit(1);
    if (prior && prior.length) { skipped++; continue; }

    // Language: the reservation's own pinned language (set in /api/ai/book from
    // the customer's chat language) wins; fall back to the tenant's primary
    // language so a null never defaults to Spanish for a non-ES tenant.
    const tenantPrimaryLang = (r.tenants?.settings as { bot_config?: { primary_language?: string } } | null)?.bot_config?.primary_language;
    const lang = asLang(r.language ?? tenantPrimaryLang);
    const guestName = r.guests?.name || (lang === "es" ? "Cliente" : lang === "it" ? "Cliente" : "Guest");
    const restaurant = r.tenants?.name || "";
    const from = tenantWhatsAppFrom(settings);

    // booking_reminder vars: {{1}}=name {{2}}=date {{3}}=time {{4}}=party {{5}}=restaurant
    const res = await sendWhatsAppTemplate(
      phone,
      "booking_reminder",
      lang,
      [guestName, formatDateFull(r.date, lang), r.time, String(r.party_size), restaurant],
      from
    );

    if (res.ok) {
      sent++;
      results.push({ id: r.id, ok: true });
      // Record the send so we never remind this reservation again.
      await supabase.from("audit_events").insert({
        tenant_id: r.tenant_id,
        action: "reminder_sent",
        entity_id: r.id,
        source: "system",
        idempotency_key: `reminder:${r.id}`,
        details: { channel: "whatsapp", template: "booking_reminder", lang, message_id: res.messageId },
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
      title: `Booking reminders: ${failed} failed to send`,
      metadata: { sent, skipped, failed, results: results.filter((x) => !x.ok).slice(0, 20) },
    });
  }

  return NextResponse.json({ ok: true, sent, skipped, failed });
}
