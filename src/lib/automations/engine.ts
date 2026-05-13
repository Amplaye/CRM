import { createServiceRoleClient } from "@/lib/supabase/server";
import type { AutomationRule, AutomationTrigger } from "@/lib/types";
import { logSystemEvent } from "@/lib/system-log";

/**
 * Context passed to the engine when a trigger fires.
 * The engine uses these fields both for condition evaluation and for
 * template interpolation in action messages.
 */
export interface AutomationContext {
  trigger: AutomationTrigger;
  tenantId: string;

  // Reservation-related (most triggers)
  reservationId?: string;
  guestId?: string;
  guestName?: string;
  guestPhone?: string;
  date?: string;
  time?: string;
  partySize?: number;
  status?: string;
  source?: string;
  shift?: string;
  notes?: string;

  // Tenant-related (resolved by engine)
  tenantName?: string;

  // Free-form extras
  extra?: Record<string, any>;
}

const TEMPLATE_KEYS = [
  "guest_name",
  "guest_phone",
  "date",
  "time",
  "party_size",
  "status",
  "source",
  "shift",
  "tenant_name",
] as const;

function interpolate(template: string, ctx: AutomationContext): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
    const k = key.toLowerCase();
    const map: Record<string, any> = {
      guest_name: ctx.guestName,
      guest_phone: ctx.guestPhone,
      date: ctx.date,
      time: ctx.time,
      party_size: ctx.partySize,
      status: ctx.status,
      source: ctx.source,
      shift: ctx.shift,
      tenant_name: ctx.tenantName,
    };
    if (k in map && map[k] !== undefined && map[k] !== null) return String(map[k]);
    return "";
  });
}

/**
 * Evaluate a simple JSON condition against context. Supports:
 *   { source: "ai_agent" }                         exact match
 *   { source_in: ["ai_agent", "phone"] }           membership
 *   { party_size_gte: 6 }                          numeric gte
 *   { party_size_lte: 2 }                          numeric lte
 *   { shift: "dinner" }
 * Returns true when no condition is set or all keys match.
 */
function passesCondition(rule: AutomationRule, ctx: AutomationContext): boolean {
  const cond = rule.condition;
  if (!cond || Object.keys(cond).length === 0) return true;
  const c: any = cond;
  if (c.source && c.source !== ctx.source) return false;
  if (Array.isArray(c.source_in) && !c.source_in.includes(ctx.source)) return false;
  if (typeof c.party_size_gte === "number" && (ctx.partySize ?? 0) < c.party_size_gte) return false;
  if (typeof c.party_size_lte === "number" && (ctx.partySize ?? Infinity) > c.party_size_lte) return false;
  if (c.shift && c.shift !== ctx.shift) return false;
  if (c.status && c.status !== ctx.status) return false;
  return true;
}

async function sendWhatsApp(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
  if (!TWILIO_SID || !TWILIO_TOKEN) return { ok: false, error: "Twilio not configured" };

  let whatsappTo = to.trim();
  if (!whatsappTo.startsWith("whatsapp:")) {
    if (!whatsappTo.startsWith("+")) whatsappTo = "+" + whatsappTo;
    whatsappTo = "whatsapp:" + whatsappTo;
  }

  const body = new URLSearchParams({ From: TWILIO_FROM, To: whatsappTo, Body: message });

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
        },
        body: body.toString(),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.message || `Twilio ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Twilio fetch failed" };
  }
}

async function executeAction(
  rule: AutomationRule,
  ctx: AutomationContext,
): Promise<{ status: "success" | "failed" | "skipped"; error?: string }> {
  const supabase = createServiceRoleClient();
  const payload = rule.action.payload || {};

  switch (rule.action.type) {
    case "send_sms": {
      const phone = (payload.to as string) || ctx.guestPhone;
      if (!phone) return { status: "skipped", error: "Nessun numero destinatario" };
      const message = interpolate(payload.message || "", ctx);
      if (!message) return { status: "skipped", error: "Messaggio vuoto" };
      const r = await sendWhatsApp(phone, message);
      return r.ok ? { status: "success" } : { status: "failed", error: r.error };
    }

    case "notify_staff": {
      const phones: string[] = Array.isArray(payload.phones) ? payload.phones : [];
      if (phones.length === 0) return { status: "skipped", error: "Nessun telefono staff configurato" };
      const message = interpolate(payload.message || "", ctx);
      if (!message) return { status: "skipped", error: "Messaggio vuoto" };
      const results = await Promise.all(phones.map((p) => sendWhatsApp(p, message)));
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) return { status: "success" };
      if (failed.length === results.length) return { status: "failed", error: failed[0].error };
      return { status: "success", error: `${failed.length}/${results.length} falliti` };
    }

    case "update_status": {
      if (!ctx.reservationId) return { status: "skipped", error: "Nessuna reservation_id nel contesto" };
      const newStatus = payload.status as string;
      if (!newStatus) return { status: "skipped", error: "Nessuno status nella payload" };
      const { error } = await supabase
        .from("reservations")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", ctx.reservationId)
        .eq("tenant_id", ctx.tenantId);
      if (error) return { status: "failed", error: error.message };
      return { status: "success" };
    }

    case "send_email":
      return { status: "skipped", error: "Email non ancora supportata" };

    default:
      return { status: "skipped", error: `Action type sconosciuto: ${(rule.action as any).type}` };
  }
}

/**
 * Fire automations for a trigger. Non-blocking: callers should not await this
 * unless they need the result. Errors are logged but never thrown.
 */
export async function dispatchAutomations(ctx: AutomationContext): Promise<void> {
  try {
    const supabase = createServiceRoleClient();

    const { data: rules, error: rulesErr } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("trigger", ctx.trigger)
      .eq("is_active", true);

    if (rulesErr) {
      logSystemEvent({
        category: "automation",
        severity: "high",
        title: "Automation fetch failed",
        description: rulesErr.message,
        metadata: { trigger: ctx.trigger, tenantId: ctx.tenantId },
      });
      return;
    }
    if (!rules || rules.length === 0) return;

    // Resolve tenant name once if needed
    if (!ctx.tenantName) {
      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", ctx.tenantId)
        .maybeSingle();
      ctx.tenantName = tenantRow?.name || "";
    }

    for (const rule of rules as AutomationRule[]) {
      let outcome: { status: "success" | "failed" | "skipped"; error?: string };
      try {
        if (!passesCondition(rule, ctx)) {
          outcome = { status: "skipped", error: "Condizione non soddisfatta" };
        } else {
          outcome = await executeAction(rule, ctx);
        }
      } catch (err: any) {
        outcome = { status: "failed", error: err?.message || "executor crash" };
      }

      // Persist run + update rule counters
      await supabase.from("automation_runs").insert({
        tenant_id: ctx.tenantId,
        rule_id: rule.id,
        trigger: ctx.trigger,
        context: {
          reservation_id: ctx.reservationId,
          guest_id: ctx.guestId,
          guest_name: ctx.guestName,
          date: ctx.date,
          time: ctx.time,
          party_size: ctx.partySize,
          source: ctx.source,
          status: ctx.status,
          shift: ctx.shift,
        },
        status: outcome.status,
        error: outcome.error || null,
      });

      if (outcome.status === "success") {
        await supabase
          .from("automation_rules")
          .update({
            last_run_at: new Date().toISOString(),
            run_count: (rule.run_count || 0) + 1,
          })
          .eq("id", rule.id);
      }
    }
  } catch (err: any) {
    logSystemEvent({
      category: "automation",
      severity: "high",
      title: "Automation engine crashed",
      description: err?.message || "unknown",
      metadata: { trigger: ctx.trigger, tenantId: ctx.tenantId },
    });
  }
}

export const AUTOMATION_TEMPLATE_KEYS = TEMPLATE_KEYS;
