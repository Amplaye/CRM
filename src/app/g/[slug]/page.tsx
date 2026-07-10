import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { hasActivePlan } from "@/lib/billing/entitlements";
import GiftForm, { type GiftFormStrings } from "./GiftForm";

// Public gift-card purchase page ("Regala una cena") — same guest-page
// contract as /m and /s: service-role read, no auth, tenant-locale copy
// inline. The form POSTs to /api/gift-cards/checkout which answers with a
// Stripe Checkout url; the voucher itself is minted by the webhook.

type Params = { slug: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GiftLocale = "it" | "es" | "en" | "de";
const VALID_LOCALES: GiftLocale[] = ["it", "es", "en", "de"];

const STRINGS: Record<
  GiftLocale,
  GiftFormStrings & { title: string; subtitle: string; paidOk: string; paidKo: string }
> = {
  it: {
    title: "Regala una cena",
    subtitle: "Un buono da spendere al ristorante: scegli l'importo, lo inviamo via email con un codice.",
    paidOk: "Pagamento riuscito! Il buono arriverà via email tra pochi minuti.",
    paidKo: "Pagamento annullato. Nessun addebito effettuato.",
    amountLabel: "Importo",
    customAmount: "Altro importo (€)",
    buyerName: "Il tuo nome",
    buyerEmail: "La tua email",
    recipientName: "Nome del destinatario (opzionale)",
    recipientEmail: "Email del destinatario (se vuoto, il buono arriva a te)",
    message: "Messaggio (opzionale)",
    messagePh: "es. Buon compleanno! Goditi una cena speciale.",
    submit: "Vai al pagamento",
    submitting: "Un attimo…",
    errorGeneric: "Qualcosa è andato storto. Riprova.",
  },
  es: {
    title: "Regala una cena",
    subtitle: "Un vale para gastar en el restaurante: elige el importe y lo enviamos por email con un código.",
    paidOk: "¡Pago realizado! El vale llegará por email en unos minutos.",
    paidKo: "Pago cancelado. No se ha realizado ningún cargo.",
    amountLabel: "Importe",
    customAmount: "Otro importe (€)",
    buyerName: "Tu nombre",
    buyerEmail: "Tu email",
    recipientName: "Nombre del destinatario (opcional)",
    recipientEmail: "Email del destinatario (si está vacío, el vale te llega a ti)",
    message: "Mensaje (opcional)",
    messagePh: "p. ej. ¡Feliz cumpleaños! Disfruta de una cena especial.",
    submit: "Ir al pago",
    submitting: "Un momento…",
    errorGeneric: "Algo ha ido mal. Inténtalo de nuevo.",
  },
  en: {
    title: "Gift a dinner",
    subtitle: "A voucher to spend at the restaurant: pick the amount, we email it with a code.",
    paidOk: "Payment successful! The voucher will arrive by email in a few minutes.",
    paidKo: "Payment cancelled. Nothing was charged.",
    amountLabel: "Amount",
    customAmount: "Other amount (€)",
    buyerName: "Your name",
    buyerEmail: "Your email",
    recipientName: "Recipient's name (optional)",
    recipientEmail: "Recipient's email (leave empty to receive it yourself)",
    message: "Message (optional)",
    messagePh: "e.g. Happy birthday! Enjoy a special dinner.",
    submit: "Go to payment",
    submitting: "One moment…",
    errorGeneric: "Something went wrong. Please try again.",
  },
  de: {
    title: "Ein Abendessen schenken",
    subtitle: "Ein Gutschein für das Restaurant: Betrag wählen, wir senden ihn mit Code per E-Mail.",
    paidOk: "Zahlung erfolgreich! Der Gutschein kommt in wenigen Minuten per E-Mail.",
    paidKo: "Zahlung abgebrochen. Es wurde nichts belastet.",
    amountLabel: "Betrag",
    customAmount: "Anderer Betrag (€)",
    buyerName: "Ihr Name",
    buyerEmail: "Ihre E-Mail",
    recipientName: "Name des Empfängers (optional)",
    recipientEmail: "E-Mail des Empfängers (leer lassen, um ihn selbst zu erhalten)",
    message: "Nachricht (optional)",
    messagePh: "z. B. Alles Gute zum Geburtstag! Genieße ein besonderes Abendessen.",
    submit: "Zur Zahlung",
    submitting: "Einen Moment…",
    errorGeneric: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  },
};

export default async function GiftCardPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const sb = createServiceRoleClient();

  const { data: tenant } = (await sb
    .from("tenants")
    .select("id,name,slug,status,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: { id: string; name: string; slug: string; status: string; settings: TenantSettings } | null };

  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) notFound();
  if (!hasActivePlan(tenant.settings) || !getFeatures(tenant.settings).gift_cards_enabled) notFound();

  const rawLocale = tenant.settings?.crm_locale;
  const locale = VALID_LOCALES.includes(rawLocale as GiftLocale) ? (rawLocale as GiftLocale) : "it";
  const ui = STRINGS[locale];
  const accent =
    tenant.settings?.site_branding?.brand_color || tenant.settings?.menu_branding?.brand_color || "#c4956a";
  const paidRaw = Array.isArray(sp.paid) ? sp.paid[0] : sp.paid;
  const paid = paidRaw === "1" ? true : paidRaw === "0" ? false : null;

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ background: "#fcf6ed", ["--accent" as string]: accent } as CSSProperties}
    >
      <div className="mx-auto max-w-lg">
        <h1 className="text-center text-3xl font-bold text-black">{ui.title}</h1>
        <p className="mt-2 text-center text-black">{tenant.name}</p>
        <p className="mt-3 text-center text-sm text-black">{ui.subtitle}</p>

        {paid === true ? (
          <div className="mt-6 rounded-xl border-2 bg-white p-5 text-center" style={{ borderColor: accent }}>
            <p className="font-semibold text-black">{ui.paidOk}</p>
          </div>
        ) : null}
        {paid === false ? (
          <div className="mt-6 rounded-xl border-2 bg-white p-5 text-center" style={{ borderColor: accent }}>
            <p className="font-semibold text-black">{ui.paidKo}</p>
          </div>
        ) : null}

        {paid !== true ? <GiftForm slug={tenant.slug} accent={accent} strings={ui} /> : null}
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();
  const { data } = (await sb
    .from("tenants")
    .select("name")
    .eq("slug", slug)
    .maybeSingle()) as { data: { name: string } | null };
  return {
    title: data?.name ? `Gift card — ${data.name}` : "Gift card",
  };
}
