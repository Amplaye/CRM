// Server-side Web Push fan-out. Called from the write paths (new booking,
// new waitlist entry, inbound WhatsApp conversation) — NEVER from a cron
// (Hobby plan = daily crons only) and never blocking: callers fire-and-forget
// inside try/catch.
//
// Config: VAPID keys live ONLY in env (Vercel + .env.local). When they're
// missing the module degrades to a silent no-op so local/preview builds and
// tenants without push keep working.

import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type PushEvent = "reservation_new" | "reservation_escalated" | "waitlist_new" | "conversation_new";

type Lang = "en" | "it" | "es" | "de";

// Push copy lives here (server-side), not in the client dictionaries: it is
// rendered by the OS notification center, in the tenant's crm_locale.
const MESSAGES: Record<PushEvent, Record<Lang, { title: string; body: string }>> = {
  reservation_new: {
    en: { title: "New reservation", body: "{name} — {party} pax, {date} {time}" },
    it: { title: "Nuova prenotazione", body: "{name} — {party} coperti, {date} {time}" },
    es: { title: "Nueva reserva", body: "{name} — {party} pax, {date} {time}" },
    de: { title: "Neue Reservierung", body: "{name} — {party} Pers., {date} {time}" },
  },
  reservation_escalated: {
    en: { title: "Booking request to review", body: "{name} — {party} pax, {date} {time}" },
    it: { title: "Richiesta da approvare", body: "{name} — {party} coperti, {date} {time}" },
    es: { title: "Solicitud por revisar", body: "{name} — {party} pax, {date} {time}" },
    de: { title: "Anfrage zu prüfen", body: "{name} — {party} Pers., {date} {time}" },
  },
  waitlist_new: {
    en: { title: "New waitlist entry", body: "{name} — {party} pax, {date} {time}" },
    it: { title: "Nuova lista d'attesa", body: "{name} — {party} coperti, {date} {time}" },
    es: { title: "Nueva lista de espera", body: "{name} — {party} pax, {date} {time}" },
    de: { title: "Neuer Wartelisten-Eintrag", body: "{name} — {party} Pers., {date} {time}" },
  },
  conversation_new: {
    en: { title: "New WhatsApp message", body: "{name}: {preview}" },
    it: { title: "Nuovo messaggio WhatsApp", body: "{name}: {preview}" },
    es: { title: "Nuevo mensaje de WhatsApp", body: "{name}: {preview}" },
    de: { title: "Neue WhatsApp-Nachricht", body: "{name}: {preview}" },
  },
};

const EVENT_URL: Record<PushEvent, string> = {
  reservation_new: "/reservations",
  reservation_escalated: "/pending",
  waitlist_new: "/waitlist",
  conversation_new: "/conversations",
};

function vapidConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function interpolate(template: string, params: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v == null || v === "" ? "—" : String(v);
  });
}

/**
 * Send a push notification to every subscribed device of the tenant.
 * Best-effort: never throws, cleans up subscriptions the push service
 * reports as gone (404/410).
 */
export async function sendPushToTenant(
  tenantId: string,
  event: PushEvent,
  params: Record<string, string | number | null | undefined> = {},
  opts?: { url?: string; excludeUserId?: string },
): Promise<void> {
  try {
    if (!vapidConfigured() || !tenantId) return;

    const supabase = createServiceRoleClient();

    const [{ data: tenant }, { data: subs }] = await Promise.all([
      supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
      supabase
        .from("push_subscriptions")
        .select("id, endpoint, keys, user_id")
        .eq("tenant_id", tenantId),
    ]);
    if (!subs || subs.length === 0) return;

    const lang: Lang = ((tenant?.settings as any)?.crm_locale as Lang) || "en";
    const msg = MESSAGES[event][lang] || MESSAGES[event].en;
    const payload = JSON.stringify({
      title: interpolate(msg.title, params),
      body: interpolate(msg.body, params),
      url: opts?.url || EVENT_URL[event],
      tag: `${event}-${tenantId}`,
    });

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:info@pasqualericciardi.com",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    const gone: string[] = [];
    await Promise.allSettled(
      subs
        .filter((s: any) => !opts?.excludeUserId || s.user_id !== opts.excludeUserId)
        .map(async (s: any) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } },
              payload,
              { TTL: 3600 },
            );
          } catch (err: any) {
            const status = err?.statusCode;
            if (status === 404 || status === 410) gone.push(s.id);
          }
        }),
    );

    if (gone.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", gone);
    }
  } catch (err) {
    // Push must never break the main write path.
    console.error("sendPushToTenant failed:", err);
  }
}
