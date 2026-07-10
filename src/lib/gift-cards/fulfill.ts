// Gift-card fulfillment — called by the Stripe webhook on
// checkout.session.completed (metadata.kind = "gift_card"): mint the unique
// code, persist the voucher, email it to the recipient. Idempotent by the
// unique stripe_checkout_session_id: a Stripe re-delivery finds the existing
// row and (at most) retries the email with the same idempotency key, so a
// retry can never mint a second voucher or double-send.

import { generateGiftCode, formatGiftCents } from "./gift-cards";
import { sendEmail, emailConfigured } from "@/lib/email/send";
import { renderEmailLayout, escapeHtml } from "@/lib/email/templates/base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any; // service-role Supabase client (same loose typing as the webhook)

const COPY: Record<
  "it" | "es" | "en" | "de",
  { subject: (name: string) => string; intro: (buyer: string, venue: string) => string; codeLabel: string; valueLabel: string; how: string; msgLabel: string }
> = {
  it: {
    subject: (name) => `Hai ricevuto un buono regalo — ${name}`,
    intro: (buyer, venue) => `${buyer} ti ha regalato un buono da usare da <strong>${venue}</strong>.`,
    codeLabel: "Il tuo codice",
    valueLabel: "Valore",
    how: "Mostra questo codice al momento di pagare: verrà scalato dal conto.",
    msgLabel: "Messaggio per te",
  },
  es: {
    subject: (name) => `Has recibido una tarjeta regalo — ${name}`,
    intro: (buyer, venue) => `${buyer} te ha regalado un vale para usar en <strong>${venue}</strong>.`,
    codeLabel: "Tu código",
    valueLabel: "Valor",
    how: "Enseña este código al pagar: se descontará de la cuenta.",
    msgLabel: "Mensaje para ti",
  },
  en: {
    subject: (name) => `You've received a gift card — ${name}`,
    intro: (buyer, venue) => `${buyer} sent you a gift card to spend at <strong>${venue}</strong>.`,
    codeLabel: "Your code",
    valueLabel: "Value",
    how: "Show this code when paying: it will be deducted from the bill.",
    msgLabel: "A message for you",
  },
  de: {
    subject: (name) => `Sie haben einen Geschenkgutschein erhalten — ${name}`,
    intro: (buyer, venue) => `${buyer} hat Ihnen einen Gutschein für <strong>${venue}</strong> geschenkt.`,
    codeLabel: "Ihr Code",
    valueLabel: "Wert",
    how: "Zeigen Sie diesen Code beim Bezahlen vor: er wird von der Rechnung abgezogen.",
    msgLabel: "Eine Nachricht für Sie",
  },
};

/** Create (or find) the voucher for a completed Checkout session and email the
 * code. Never throws — the webhook must 200 to Stripe once the payment is
 * real; failures are returned for the caller to log. */
export async function fulfillGiftCardSession(
  svc: Svc,
  session: {
    id: string;
    payment_intent?: string | null;
    amount_total?: number | null;
    currency?: string | null;
    customer_email?: string | null;
    customer_details?: { email?: string | null } | null;
    metadata?: Record<string, string> | null;
  },
): Promise<{ ok: boolean; code?: string; error?: string }> {
  try {
    const meta = session.metadata || {};
    const tenantId = meta.tenant_id;
    if (!tenantId) return { ok: false, error: "missing tenant_id" };

    const amountCents = Number(session.amount_total) || 0;
    if (amountCents <= 0) return { ok: false, error: "zero amount" };
    const currency = String(session.currency || "eur").toUpperCase();
    const buyerEmail = session.customer_details?.email || session.customer_email || meta.buyer_email || null;

    // Already fulfilled (webhook re-delivery)? Reuse the existing voucher.
    const { data: existing } = await svc
      .from("gift_cards")
      .select("id, code")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

    let code: string = existing?.code || "";
    if (!existing) {
      // Mint with retry: the unique constraint on `code` arbitrates collisions.
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        code = generateGiftCode();
        const { error } = await svc.from("gift_cards").insert({
          tenant_id: tenantId,
          code,
          amount_cents: amountCents,
          balance_cents: amountCents,
          currency,
          buyer_email: buyerEmail,
          recipient_email: meta.recipient_email || null,
          recipient_name: meta.recipient_name || null,
          message: meta.message || "",
          status: "active",
          stripe_payment_intent_id: session.payment_intent || null,
          stripe_checkout_session_id: session.id,
        });
        if (!error) inserted = true;
        else if (error.code === "23505" && String(error.message || "").includes("stripe_checkout_session_id")) {
          // Concurrent re-delivery won the race — that row is the voucher.
          const { data: raced } = await svc
            .from("gift_cards")
            .select("code")
            .eq("stripe_checkout_session_id", session.id)
            .maybeSingle();
          code = raced?.code || code;
          inserted = true;
        } else if (error.code !== "23505") {
          return { ok: false, error: `insert failed: ${error.message}` };
        }
        // 23505 on `code` → loop and mint a fresh one.
      }
      if (!inserted) return { ok: false, error: "could not mint a unique code" };
    }

    // Email the recipient (fall back to the buyer buying for themselves).
    const to = meta.recipient_email || buyerEmail;
    if (to && emailConfigured()) {
      const { data: tenant } = await svc
        .from("tenants")
        .select("name, settings")
        .eq("id", tenantId)
        .maybeSingle();
      const venueName = tenant?.name || "Restaurant";
      const locale = (["it", "es", "en", "de"] as const).includes(tenant?.settings?.crm_locale)
        ? (tenant.settings.crm_locale as "it" | "es" | "en" | "de")
        : "it";
      const c = COPY[locale];
      const buyerLabel = escapeHtml(meta.buyer_name || buyerEmail || venueName);
      const message = (meta.message || "").trim();
      const bodyHtml = `
        <p>${c.intro(buyerLabel, escapeHtml(venueName))}</p>
        ${message ? `<p style="border-left:3px solid #e5e7eb;padding-left:12px;font-style:italic;">${c.msgLabel}: “${escapeHtml(message)}”</p>` : ""}
        <div style="margin:24px 0;padding:20px;border:2px dashed #9ca3af;border-radius:12px;text-align:center;">
          <div style="font-size:13px;color:#111827;">${c.codeLabel}</div>
          <div style="font-size:26px;font-weight:800;letter-spacing:2px;color:#111827;">${escapeHtml(code)}</div>
          <div style="margin-top:6px;font-size:14px;color:#111827;">${c.valueLabel}: <strong>${formatGiftCents(amountCents, currency)}</strong></div>
        </div>
        <p>${c.how}</p>`;
      const branding = {
        name: venueName,
        brand_color: tenant?.settings?.site_branding?.brand_color || tenant?.settings?.menu_branding?.brand_color,
        logo_url: tenant?.settings?.menu_branding?.logo_url,
      };
      try {
        await sendEmail({
          to,
          subject: c.subject(venueName),
          html: renderEmailLayout({ branding, preheader: c.subject(venueName), bodyHtml }),
          idempotencyKey: `gift_${session.id}`,
        });
      } catch (e) {
        // Voucher exists and is paid — an email hiccup must not fail the webhook.
        return { ok: true, code, error: `email failed: ${e instanceof Error ? e.message : e}` };
      }
    }

    return { ok: true, code };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
