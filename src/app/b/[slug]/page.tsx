import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasActivePlan } from "@/lib/billing/entitlements";
import type { TenantSettings } from "@/lib/types/tenant-settings";
import BookingWidget, { type BookingStrings } from "./BookingWidget";

// Public booking widget (Fase 7) — the "Prenota" button of the micro-site and
// the deep-link target for Instagram/Facebook bios. Same guest-page contract
// as /m /s /g: service-role read, no auth, tenant-locale copy inline. Booking
// goes through /api/public/book which reuses the full AI booking pipeline
// (availability, table fit, WhatsApp confirmation, deposit link).

type Params = { slug: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WLocale = "it" | "es" | "en" | "de";
const VALID_LOCALES: WLocale[] = ["it", "es", "en", "de"];

const STRINGS: Record<WLocale, BookingStrings & { title: string }> = {
  it: {
    title: "Prenota un tavolo",
    dateLabel: "Data",
    peopleLabel: "Persone",
    timeLabel: "Orario",
    checkBtn: "Vedi disponibilità",
    checking: "Controllo…",
    closedDay: "Quel giorno siamo chiusi. Prova un'altra data.",
    noSlots: "Nessun orario disponibile per quella data. Prova un'altra data.",
    nameLabel: "Nome e cognome",
    phoneLabel: "Cellulare (con prefisso, es. +39…)",
    notesLabel: "Note (opzionale)",
    notesPh: "es. seggiolone, allergie…",
    bookBtn: "Conferma prenotazione",
    booking: "Invio…",
    okConfirmed: "Prenotazione confermata! Riceverai conferma su WhatsApp.",
    okPending: "Richiesta ricevuta! Il ristorante ti confermerà a breve su WhatsApp.",
    okWaitlist: "Il turno è pieno: ti abbiamo messo in lista d'attesa. Ti avvisiamo se si libera un tavolo.",
    okDeposit: "Per completare, paga la caparra qui:",
    depositBtn: "Paga la caparra",
    koFull: "Il turno è al completo. Prova un altro orario o un'altra data.",
    koPhone: "Numero di telefono non valido: usa il prefisso internazionale (es. +39…).",
    koGeneric: "Non siamo riusciti a completare la prenotazione. Riprova.",
    newBooking: "Nuova prenotazione",
  },
  es: {
    title: "Reservar mesa",
    dateLabel: "Fecha",
    peopleLabel: "Personas",
    timeLabel: "Hora",
    checkBtn: "Ver disponibilidad",
    checking: "Comprobando…",
    closedDay: "Ese día estamos cerrados. Prueba otra fecha.",
    noSlots: "No hay horas disponibles para esa fecha. Prueba otra fecha.",
    nameLabel: "Nombre y apellido",
    phoneLabel: "Móvil (con prefijo, p. ej. +34…)",
    notesLabel: "Notas (opcional)",
    notesPh: "p. ej. trona, alergias…",
    bookBtn: "Confirmar reserva",
    booking: "Enviando…",
    okConfirmed: "¡Reserva confirmada! Recibirás la confirmación por WhatsApp.",
    okPending: "¡Solicitud recibida! El restaurante te confirmará en breve por WhatsApp.",
    okWaitlist: "El turno está completo: te hemos puesto en lista de espera. Te avisaremos si se libera una mesa.",
    okDeposit: "Para completar, paga la señal aquí:",
    depositBtn: "Pagar la señal",
    koFull: "El turno está completo. Prueba otra hora u otra fecha.",
    koPhone: "Teléfono no válido: usa el prefijo internacional (p. ej. +34…).",
    koGeneric: "No hemos podido completar la reserva. Inténtalo de nuevo.",
    newBooking: "Nueva reserva",
  },
  en: {
    title: "Book a table",
    dateLabel: "Date",
    peopleLabel: "People",
    timeLabel: "Time",
    checkBtn: "See availability",
    checking: "Checking…",
    closedDay: "We're closed that day. Try another date.",
    noSlots: "No times available for that date. Try another date.",
    nameLabel: "Full name",
    phoneLabel: "Mobile (with country code, e.g. +44…)",
    notesLabel: "Notes (optional)",
    notesPh: "e.g. high chair, allergies…",
    bookBtn: "Confirm booking",
    booking: "Sending…",
    okConfirmed: "Booking confirmed! You'll get a WhatsApp confirmation.",
    okPending: "Request received! The restaurant will confirm shortly on WhatsApp.",
    okWaitlist: "That service is full: we've added you to the waitlist and will let you know if a table frees up.",
    okDeposit: "To complete, pay the deposit here:",
    depositBtn: "Pay the deposit",
    koFull: "That service is fully booked. Try another time or date.",
    koPhone: "Invalid phone number: include the country code (e.g. +44…).",
    koGeneric: "We couldn't complete the booking. Please try again.",
    newBooking: "New booking",
  },
  de: {
    title: "Tisch reservieren",
    dateLabel: "Datum",
    peopleLabel: "Personen",
    timeLabel: "Uhrzeit",
    checkBtn: "Verfügbarkeit prüfen",
    checking: "Wird geprüft…",
    closedDay: "An diesem Tag sind wir geschlossen. Bitte anderes Datum wählen.",
    noSlots: "Keine Zeiten an diesem Datum verfügbar. Bitte anderes Datum wählen.",
    nameLabel: "Vor- und Nachname",
    phoneLabel: "Handy (mit Ländervorwahl, z. B. +49…)",
    notesLabel: "Hinweise (optional)",
    notesPh: "z. B. Hochstuhl, Allergien…",
    bookBtn: "Reservierung bestätigen",
    booking: "Wird gesendet…",
    okConfirmed: "Reservierung bestätigt! Sie erhalten eine WhatsApp-Bestätigung.",
    okPending: "Anfrage erhalten! Das Restaurant bestätigt in Kürze per WhatsApp.",
    okWaitlist: "Die Schicht ist voll: Sie stehen auf der Warteliste. Wir melden uns, wenn ein Tisch frei wird.",
    okDeposit: "Zum Abschluss zahlen Sie hier die Anzahlung:",
    depositBtn: "Anzahlung zahlen",
    koFull: "Die Schicht ist ausgebucht. Bitte andere Zeit oder anderes Datum wählen.",
    koPhone: "Ungültige Telefonnummer: bitte mit Ländervorwahl (z. B. +49…).",
    koGeneric: "Die Reservierung konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
    newBooking: "Neue Reservierung",
  },
};

export default async function BookingPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();

  const { data: tenant } = (await sb
    .from("tenants")
    .select("id,name,slug,status,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: { id: string; name: string; slug: string; status: string; settings: TenantSettings } | null };

  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) notFound();
  if (!hasActivePlan(tenant.settings)) notFound();

  const rawLocale = tenant.settings?.crm_locale;
  const locale = VALID_LOCALES.includes(rawLocale as WLocale) ? (rawLocale as WLocale) : "it";
  const ui = STRINGS[locale];
  const accent =
    tenant.settings?.site_branding?.brand_color || tenant.settings?.menu_branding?.brand_color || "#c4956a";

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ background: "#fcf6ed", ["--accent" as string]: accent } as CSSProperties}
    >
      <div className="mx-auto max-w-lg">
        <h1 className="text-center text-3xl font-bold text-black">{ui.title}</h1>
        <p className="mt-2 text-center text-black">{tenant.name}</p>
        <BookingWidget slug={tenant.slug} accent={accent} strings={ui} />
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
    title: data?.name ? `Prenota — ${data.name}` : "Prenota",
  };
}
