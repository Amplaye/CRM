import type { SiteLocale } from "./booking-strings";
import type { SiteLabels } from "./types";

// Guest-facing generic labels for the public micro-site, per tenant locale —
// inline per language like the public menu (the i18n dictionaries are for the
// CRM UI, not for guest pages). Shared by the classic /s design, the demo-site
// templates and the visual editor preview.

export const SITE_STRINGS: Record<SiteLocale, SiteLabels> = {
  it: {
    book: "Prenota un tavolo", viewMenu: "Guarda il menù", fullMenu: "Menù completo",
    about: "Chi siamo", menu: "Dal nostro menù", gallery: "Galleria", reviews: "Dicono di noi",
    hours: "Orari", contact: "Dove siamo", closed: "Chiuso", address: "Indirizzo",
    phone: "Telefono", map: "Apri in Maps", giftCta: "Regala una cena",
    giftTitle: "Buono regalo", reviewsEmpty: "Ancora nessuna recensione.",
    allergens: "Allergeni", close: "Chiudi",
    days: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    poweredPrefix: "Sito di",
  },
  es: {
    book: "Reservar mesa", viewMenu: "Ver la carta", fullMenu: "Carta completa",
    about: "Quiénes somos", menu: "De nuestra carta", gallery: "Galería", reviews: "Opiniones",
    hours: "Horario", contact: "Dónde estamos", closed: "Cerrado", address: "Dirección",
    phone: "Teléfono", map: "Abrir en Maps", giftCta: "Regala una cena",
    giftTitle: "Tarjeta regalo", reviewsEmpty: "Aún no hay opiniones.",
    allergens: "Alérgenos", close: "Cerrar",
    days: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
    poweredPrefix: "Web de",
  },
  en: {
    book: "Book a table", viewMenu: "See the menu", fullMenu: "Full menu",
    about: "About us", menu: "From our menu", gallery: "Gallery", reviews: "What guests say",
    hours: "Opening hours", contact: "Find us", closed: "Closed", address: "Address",
    phone: "Phone", map: "Open in Maps", giftCta: "Gift a dinner",
    giftTitle: "Gift card", reviewsEmpty: "No reviews yet.",
    allergens: "Allergens", close: "Close",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    poweredPrefix: "Website of",
  },
  de: {
    book: "Tisch reservieren", viewMenu: "Speisekarte ansehen", fullMenu: "Ganze Speisekarte",
    about: "Über uns", menu: "Aus unserer Karte", gallery: "Galerie", reviews: "Gästestimmen",
    hours: "Öffnungszeiten", contact: "So finden Sie uns", closed: "Geschlossen", address: "Adresse",
    phone: "Telefon", map: "In Maps öffnen", giftCta: "Ein Abendessen schenken",
    giftTitle: "Geschenkgutschein", reviewsEmpty: "Noch keine Bewertungen.",
    allergens: "Allergene", close: "Schließen",
    days: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    poweredPrefix: "Website von",
  },
};
