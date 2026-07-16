// Self-serve KB generator.
//
// The restaurateur is NOT a writer (see [[feedback_no_power_user_features]]):
// they never type free-form KB articles. Instead the client wizard collects a
// FIXED-FIELD questionnaire (yes/no, dropdowns, multi-selects, short fields)
// and this pure server-side function turns those structured answers into
// well-formatted knowledge_articles — modelled on the hand-written PICNIC KB,
// the most complete one we have. The questionnaire cards map to articles:
//
//   Schedule (from opening_hours)   → "Horario del restaurante"   (general)
//   Reservas y grupos               → "Política de reservas"      (policies)
//   Dietas y alergias               → "Dietas y alergias"         (policies)
//   Servicios prácticos             → "Servicios adicionales"     (general)
//   Cómo llegar                     → "Ubicación y cómo llegar"   (general)
// (Recommended dishes are no longer a wizard step — see chef_recommendations.)
//
// Articles are written in the restaurant's primary `language` because they are
// consumed by the AI agent (WhatsApp + voice) which speaks that language.

export type Lang = "es" | "it" | "en" | "de";

export type PaymentMethod = "cash" | "card" | "contactless" | "bizum";
export type ParkingKind = "own" | "public" | "street" | "none";
// Major kitchen allergens whose PRESENCE drives cross-contamination warnings.
// Independent from the diet OPTIONS the kitchen offers: a place can serve
// gluten-free dishes yet still handle wheat (cross-contamination risk).
export type Allergen =
  | "gluten" | "nuts" | "peanuts" | "dairy" | "egg" | "fish" | "shellfish" | "soy" | "sesame";
// How far in advance a cancellation should be notified.
export type CancellationNotice = "none" | "same_day" | "2h" | "24h";

export type OpeningHoursSlot = { open: string; close: string };
export type OpeningHours = Record<string, OpeningHoursSlot[]>; // keys "0".."6" (Sunday = 0)

/** The fixed-field answers the client wizard collects. NO free-text prose
 *  (the only multi-value text is the short chef-recommendation lines). */
export interface KbQuestionnaire {
  // Card 1 — Reservas y grupos
  capacity_seats: number; // short number field
  auto_confirm_max: number; // dropdown: party size auto-confirmed (e.g. 6)
  accepts_large_groups: boolean; // yes/no — groups above the threshold at all
  deposit_required: boolean; // yes/no — deposit for large groups
  deposit_amount: string; // short free-text, e.g. "20€ a persona" ("" = unspecified)
  late_tolerance_min: number; // dropdown: 10/15/20/30
  late_grace_if_notified: boolean; // yes/no — more margin if the guest warns ahead
  // Minutes BEFORE closing time that the last reservation is accepted, chosen
  // from a dropdown. The actual cut-off time is derived per day from that
  // shift's closing time (close − offset). -1 = no service for that shift.
  last_lunch_offset_min: number; // e.g. 30 / 45 / 60 / 90 ; -1 = no lunch service
  last_dinner_offset_min: number; // e.g. 30 / 45 / 60 / 90 ; -1 = no dinner service
  cancellation_notice: CancellationNotice; // dropdown
  noshow_release_min: number; // dropdown: 0 = don't state / 15 / 30 / 45 / 60

  // Card 2 — Servicios prácticos
  high_chairs: boolean;
  kids_menu: boolean;
  pets: boolean;
  accessible: boolean;
  payments: PaymentMethod[]; // multi-select
  wifi: boolean;
  terrace: boolean;
  takeaway: boolean;
  takeaway_wait: string; // short field, e.g. "20-30 min" ("" = omit)
  delivery: boolean;
  delivery_platform: string; // short field, e.g. "Glovo, Uber Eats" ("" = generic)
  celebrations: boolean; // birthdays / celebrations welcome
  outside_cake: boolean; // bringing your own cake allowed

  // Card 3 — Dietas y alergias
  vegetarian: boolean;
  vegan: boolean;
  gluten_free: boolean;
  lactose_free: boolean;
  celiac_safe: boolean; // protocol / separate prep for coeliacs
  kitchen_allergens: Allergen[]; // multi-select — allergens present in the kitchen
  cannot_guarantee_traces: boolean; // safety disclaimer (default yes)
  severe_allergy_escalate: boolean; // severe allergy → consult kitchen / manager (default yes)
  allergen_info: boolean; // allergen sheet available on request

  // Card 4 — Cómo llegar
  cuisine_type: string; // short field, e.g. "Trattoria Napoletana" ("" = omit)
  address: string; // street, short field
  city: string; // short field, e.g. "35002 Las Palmas de Gran Canaria"
  neighborhood: string; // short field, e.g. "Triana / Vegueta"
  parking_info: ParkingKind[]; // multi-select (a venue can have several parking options at once)
  public_transport: boolean; // yes/no
  landmark: string; // short field — reference point ("" = none)

  // DEPRECATED (2026-06-01): recommended dishes are no longer collected in the
  // wizard — the owner curates them as a Menu category (e.g. "Platos recomendados")
  // that the bot reads live via /api/ai/menu. Kept (defaults to []) only so old
  // payloads/rows don't break; no KB article is generated from it any more.
  chef_recommendations: string[];
}

export interface KbContext {
  restaurant_name: string;
  restaurant_phone: string;
  language: Lang;
  opening_hours?: OpeningHours; // when provided, a Schedule article is generated
  // Per-language translations of the FREE-TEXT prose fields. The owner types
  // these once (in one language); for a multilingual KB each block must read them
  // in ITS language, so the caller translates them up front and passes the
  // already-translated values here. Only descriptive prose is translated
  // (landmark, cuisine_type) — NOT proper nouns like address/city/neighborhood.
  // Absent/empty fields fall back to the questionnaire's original text.
  freeTextOverrides?: { landmark?: string; cuisine_type?: string };
}

// The booking-relevant subset of the questionnaire, persisted on the tenant
// (settings.venue) so the WhatsApp/voice booking confirmation can repeat it
// without re-parsing the KB prose. Built once at onboarding (venueFromQuestionnaire).
export interface VenueInfo {
  address: string;
  city: string;
  parking: ParkingKind[];
  deposit_required: boolean;
  deposit_amount: string;
  // Structured deposit policy (Fase 1 — real Stripe deposits). The legacy
  // deposit_required/deposit_amount pair stays the INFORMATIONAL fallback the
  // recap prints; these three make the amount computable so the bot/staff can
  // generate a payable Checkout link. Editable in Settings → Bookings.
  /** Deposit in cents (per person or flat, see deposit_policy). */
  deposit_amount_cents?: number;
  /** "per_person" multiplies by party size; "flat" charges once. */
  deposit_policy?: "per_person" | "flat";
  /** First party size that owes a deposit. 1 = every booking. Unset → the
   * bot's large-group threshold (bot_config.party_size_threshold_large). */
  deposit_min_party?: number;
  cancellation_notice: CancellationNotice;
  // Short Google-Maps link (via da.gd) shown in the WhatsApp recap instead of the long
  // bare URL that widened the chat. Optional + best-effort: when absent the bot falls
  // back to the long mapsLink(). maps_short_src records the long URL it was generated
  // from, so it's only regenerated when the address changes. See scripts/venue-maps-short.mjs.
  maps_short?: string;
  maps_short_src?: string;
}

/** The booking-policy thresholds the cloned n8n bot reads from settings.bot_config.
 *  Derived from the wizard so the bot enforces the OWNER's policy instead of its
 *  hardcoded Picnic fallbacks (large=7, block=13, closing offset=45). */
export interface BookingPolicy {
  party_size_threshold_large: number;
  party_size_block_threshold: number;
  closing_time_offset_min: number;
}

/** Map the questionnaire to the bot's booking-policy keys.
 *  - large threshold = first party size that needs manual confirmation = auto_confirm_max + 1
 *    (the KB prose says the same — see generateKbArticles' `threshold`).
 *  - block threshold = the size above which we refuse outright. When the owner
 *    accepts large groups there is no hard block, so we leave the bot's generous
 *    default headroom; when they DON'T, the block IS the large threshold (anything
 *    needing manual review is simply refused).
 *  - closing offset = the stricter (larger) of the lunch/dinner margins the owner
 *    picked; the bot uses ONE offset for its last-reservation gate. A shift the
 *    venue doesn't serve (-1) is ignored so it can't drag the offset to a negative. */
/** Derive the hard-block threshold from the large threshold.
 *  There is no explicit "hard block" question. If large groups are accepted, keep
 *  ample headroom (matches the bot's old 13 default relative to a 6-cap Picnic);
 *  if not, refuse anything past the large threshold. Shared by onboarding and the
 *  Settings auto-confirm control so both compute it identically. */
export function largeToBlock(largeThreshold: number, acceptsLargeGroups: boolean): number {
  return acceptsLargeGroups ? Math.max(largeThreshold + 6, 13) : largeThreshold;
}

export function botConfigFromQuestionnaire(q: KbQuestionnaire): BookingPolicy {
  const largeThreshold = Math.max(1, (q.auto_confirm_max || 0) + 1);
  const offsets = [q.last_lunch_offset_min, q.last_dinner_offset_min].filter((n) => n >= 0);
  const closingOffset = offsets.length ? Math.max(...offsets) : 45;
  return {
    party_size_threshold_large: largeThreshold,
    party_size_block_threshold: largeToBlock(largeThreshold, q.accepts_large_groups),
    closing_time_offset_min: closingOffset,
  };
}

/** Pull the booking-confirmation venue subset out of a full questionnaire. */
export function venueFromQuestionnaire(q: KbQuestionnaire): VenueInfo {
  return {
    address: q.address,
    city: q.city,
    parking: q.parking_info,
    deposit_required: q.deposit_required,
    deposit_amount: q.deposit_amount,
    cancellation_notice: q.cancellation_notice,
  };
}

/**
 * Localized lines for the booking confirmation recap (WhatsApp + voice), built
 * from the persisted VenueInfo in the GUEST's booking language. Reuses the same
 * DICT as the KB so wording never drifts. Every field is optional in the output:
 * a line is "" when there's nothing to say (no address, no deposit, notice=none),
 * so the caller appends only the non-empty ones.
 */
export function bookingVenueLines(venue: VenueInfo, language: Lang): {
  mapsUrl: string;
  address: string;
  parking: string;
  deposit: string;
  cancellation: string;
} {
  const L = DICT[language] || DICT.es;
  const addr = [venue.address, venue.city].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  const parkChosen = (venue.parking || []).filter((k) => k !== "none");
  const parkKind = parkChosen.length
    ? parkChosen.map((k) => (k === "own" ? L.parkOwn : k === "public" ? L.parkPublic : L.parkStreet)).join(", ")
    : "";
  const depositOn = venue.deposit_required;
  return {
    mapsUrl: mapsLink(venue.address, venue.city),
    address: addr,
    parking: parkKind,
    deposit: depositOn
      ? L.depositYes + (formatDepositAmount(venue.deposit_amount) ? ` (${formatDepositAmount(venue.deposit_amount)})` : "")
      : "",
    cancellation: venue.cancellation_notice && venue.cancellation_notice !== "none"
      ? L.cancellations[venue.cancellation_notice]
      : "",
  };
}

export interface GeneratedArticle {
  title: string;
  content: string;
  category: string;
}

// --- Localised label dictionary -------------------------------------------
// One compact table per language. Keeps the generator language-agnostic: the
// composition logic below is shared, only the words change.

interface Labels {
  yes: string;
  no: string;
  available: string;
  notAvailable: string;
  and: string;
  // titles
  tSchedule: string;
  tReservations: string;
  tServices: string;
  tDiets: string;
  tChef: string;
  tLocation: string;
  // schedule
  days: string[]; // length 7, index 0 = Sunday
  closed: string;
  lunch: string;
  dinner: string;
  // reservations
  capacity: string;
  autoConfirm: string; // "{n}"
  largeGroups: string;
  largeGroupsYes: string; // "{n}"
  largeGroupsNo: string; // "{n}"
  lateTolerance: string; // "{n}"
  lateGrace: string; // appended phrase when grace-if-notified
  lastLunch: string;
  lastDinner: string;
  lastResAtClose: string; // "up to closing time" (offset 0)
  lastResBefore: string; // "{n} min before closing"
  lastResVaries: string; // "e.g. {n} depending on the day" — {n} = comma list of times
  noService: string;
  deposit: string;
  depositYes: string;
  depositNo: string;
  cancellation: string;
  cancellations: Record<CancellationNotice, string>;
  noShow: string; // "{n}"
  terraceNotGuaranteed: string;
  minutes: string;
  // services
  highChairs: string;
  kidsMenu: string;
  pets: string;
  petsYes: string;
  accessible: string; // full enriched line (yes case)
  accessibleLabel: string; // short noun for the "no" case
  celebrations: string; // full enriched line (yes case)
  celebrationsLabel: string; // short noun for the "no" case
  outsideCake: string; // full enriched line (yes case)
  outsideCakeLabel: string; // short noun for the "no" case
  payments: string;
  wifi: string;
  parking: string; // on-site parking line label
  terrace: string;
  takeaway: string;
  takeawayWait: string; // label for the wait-time suffix, e.g. "tiempo de espera"
  delivery: string;
  deliveryYes: string; // generic, no platform
  deliveryVia: string; // "{p}" platform suffix
  // diets
  vegetarian: string;
  vegan: string;
  glutenFree: string;
  lactoseFree: string;
  celiacYes: string; // "Protocolo para celíacos: preparación separada disponible"
  allergenIntro: string; // header before the present-allergen bullet list
  allergens: Record<Allergen, string>;
  cannotGuarantee: string;
  severeAllergy: string;
  allergenInfo: string;
  allergenInfoYes: string;
  noneDeclared: string;
  // location
  address: string;
  mapsLabel: string; // "Mapa / Cómo llegar" — label before the maps link
  city: string;
  neighborhood: string;
  parkingInfo: string;
  parkOwn: string;
  parkPublic: string;
  parkStreet: string;
  parkNone: string;
  publicTransport: string;
  landmark: string;
  phone: string;
  // payment method names
  payCash: string;
  payCard: string;
  payContactless: string;
  payBizum: string;
}

const DICT: Record<Lang, Labels> = {
  es: {
    yes: "Sí", no: "No", available: "disponible", notAvailable: "no disponible", and: "y",
    tSchedule: "Horario del restaurante", tReservations: "Política de reservas",
    tServices: "Servicios adicionales", tDiets: "Dietas y alergias",
    tChef: "Recomendaciones del chef", tLocation: "Ubicación y cómo llegar",
    days: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
    closed: "CERRADO", lunch: "almuerzo", dinner: "cena",
    capacity: "Capacidad", autoConfirm: "Grupos 1-{n}: confirmación automática si hay disponibilidad",
    largeGroups: "Grupos grandes", largeGroupsYes: "Grupos {n}+: solicitud pendiente, el responsable contacta al cliente",
    largeGroupsNo: "No se aceptan grupos de más de {n} personas",
    lateTolerance: "Tolerancia de retraso", lateGrace: "más margen si el cliente avisa con antelación",
    lastLunch: "Última reserva almuerzo", lastDinner: "Última reserva cena",
    lastResAtClose: "hasta la hora de cierre", lastResBefore: "{n} min antes del cierre",
    lastResVaries: "p. ej. {n} según el día",
    noService: "sin servicio", deposit: "Depósito",
    depositYes: "se solicita depósito para grupos grandes", depositNo: "no se solicita depósito",
    cancellation: "Cancelación",
    cancellations: {
      none: "no requiere aviso previo", same_day: "avisar el mismo día",
      "2h": "avisar con al menos 2 h de antelación", "24h": "avisar con al menos 24 h de antelación",
    },
    noShow: "No-show: la mesa se libera pasados {n} min sin avisar",
    terraceNotGuaranteed: "Terraza: sujeta a disponibilidad, no se garantiza",
    minutes: "min",
    highChairs: "Familias: tronas", kidsMenu: "Menú infantil", pets: "Mascotas", petsYes: "sí, avisar al reservar",
    accessible: "Accesibilidad: entrada accesible, mesa cómoda con aviso previo", accessibleLabel: "Accesibilidad",
    celebrations: "Celebraciones (cumpleaños, aniversarios): bienvenidas, avisar al reservar", celebrationsLabel: "Celebraciones",
    outsideCake: "Tarta propia: se permite traerla (avisar al reservar)", outsideCakeLabel: "Tarta propia",
    payments: "Pagos", wifi: "WiFi", parking: "Parking propio", terrace: "Terraza",
    takeaway: "Comida para llevar", takeawayWait: "tiempo de espera", delivery: "Delivery",
    deliveryYes: "sí", deliveryVia: "sí, a través de {p}",
    vegetarian: "Opciones vegetarianas", vegan: "Opciones veganas", glutenFree: "Opciones sin gluten",
    lactoseFree: "Opciones sin lactosa", celiacYes: "Protocolo para celíacos: preparación separada disponible",
    allergenIntro: "IMPORTANTE — alérgenos presentes en cocina (riesgo de contaminación cruzada):",
    allergens: {
      gluten: "gluten / harina de trigo", nuts: "frutos secos", peanuts: "cacahuetes", dairy: "lácteos",
      egg: "huevo", fish: "pescado", shellfish: "marisco / crustáceos", soy: "soja", sesame: "sésamo",
    },
    cannotGuarantee: "No se puede garantizar la ausencia total de trazas.",
    severeAllergy: "ALERGIA SEVERA = el cliente dice \"alergia grave/severa\", \"shock anafiláctico\", \"EpiPen\", \"me puede matar\", o nombra como ALERGIA (no simple preferencia) un alérgeno presente en cocina. En ese caso: NO garantices la seguridad del plato, advierte del riesgo de contaminación cruzada y propón confirmarlo con cocina o el responsable antes de reservar.",
    allergenInfo: "Información de alérgenos", allergenInfoYes: "disponible bajo petición",
    noneDeclared: "Sin opciones especiales declaradas — consultar al reservar",
    address: "Dirección", mapsLabel: "Mapa / Cómo llegar", city: "Población", neighborhood: "Zona", parkingInfo: "Aparcamiento",
    parkOwn: "parking propio", parkPublic: "parking público cercano", parkStreet: "aparcamiento en la calle", parkNone: "sin aparcamiento propio",
    publicTransport: "Transporte público", landmark: "Referencia", phone: "Teléfono",
    payCash: "efectivo", payCard: "tarjeta", payContactless: "contactless", payBizum: "Bizum",
  },
  it: {
    yes: "Sì", no: "No", available: "disponibile", notAvailable: "non disponibile", and: "e",
    tSchedule: "Orari del ristorante", tReservations: "Politica di prenotazione",
    tServices: "Servizi aggiuntivi", tDiets: "Diete e allergie",
    tChef: "Consigli dello chef", tLocation: "Posizione e come arrivare",
    days: ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"],
    closed: "CHIUSO", lunch: "pranzo", dinner: "cena",
    capacity: "Capienza", autoConfirm: "Gruppi 1-{n}: conferma automatica se c'è disponibilità",
    largeGroups: "Gruppi numerosi", largeGroupsYes: "Gruppi {n}+: richiesta in sospeso, il responsabile ricontatta il cliente",
    largeGroupsNo: "Non si accettano gruppi di più di {n} persone",
    lateTolerance: "Tolleranza ritardo", lateGrace: "più margine se il cliente avvisa in anticipo",
    lastLunch: "Ultima prenotazione pranzo", lastDinner: "Ultima prenotazione cena",
    lastResAtClose: "fino all'orario di chiusura", lastResBefore: "{n} min prima della chiusura",
    lastResVaries: "es. {n} a seconda del giorno",
    noService: "nessun servizio", deposit: "Caparra",
    depositYes: "è richiesta una caparra per i gruppi numerosi", depositNo: "nessuna caparra richiesta",
    cancellation: "Cancellazione",
    cancellations: {
      none: "nessun preavviso richiesto", same_day: "avvisare in giornata",
      "2h": "avvisare almeno 2 h prima", "24h": "avvisare almeno 24 h prima",
    },
    noShow: "No-show: il tavolo viene liberato dopo {n} min senza avviso",
    terraceNotGuaranteed: "Terrazza: soggetta a disponibilità, non garantita",
    minutes: "min",
    highChairs: "Famiglie: seggioloni", kidsMenu: "Menù bambini", pets: "Animali", petsYes: "sì, avvisare alla prenotazione",
    accessible: "Accessibilità: ingresso accessibile, tavolo comodo con preavviso", accessibleLabel: "Accessibilità",
    celebrations: "Celebrazioni (compleanni, anniversari): benvenute, avvisare alla prenotazione", celebrationsLabel: "Celebrazioni",
    outsideCake: "Torta propria: è consentito portarla (avvisare alla prenotazione)", outsideCakeLabel: "Torta propria",
    payments: "Pagamenti", wifi: "WiFi", parking: "Parcheggio proprio", terrace: "Terrazza",
    takeaway: "Cibo da asporto", takeawayWait: "tempo di attesa", delivery: "Delivery",
    deliveryYes: "sì", deliveryVia: "sì, tramite {p}",
    vegetarian: "Opzioni vegetariane", vegan: "Opzioni vegane", glutenFree: "Opzioni senza glutine",
    lactoseFree: "Opzioni senza lattosio", celiacYes: "Protocollo per celiaci: preparazione separata disponibile",
    allergenIntro: "IMPORTANTE — allergeni presenti in cucina (rischio di contaminazione crociata):",
    allergens: {
      gluten: "glutine / farina di frumento", nuts: "frutta a guscio", peanuts: "arachidi", dairy: "latticini",
      egg: "uova", fish: "pesce", shellfish: "crostacei / molluschi", soy: "soia", sesame: "sesamo",
    },
    cannotGuarantee: "Non è possibile garantire l'assenza totale di tracce.",
    severeAllergy: "ALLERGIA GRAVE = il cliente dice \"allergia grave/severa\", \"shock anafilattico\", \"EpiPen\", \"rischio la vita\", o nomina come ALLERGIA (non semplice preferenza) un allergene presente in cucina. In quel caso: NON garantire la sicurezza del piatto, avvisa del rischio di contaminazione crociata e proponi di farlo confermare dalla cucina o dal responsabile prima di prenotare.",
    allergenInfo: "Informazioni sugli allergeni", allergenInfoYes: "disponibili su richiesta",
    noneDeclared: "Nessuna opzione speciale dichiarata — chiedere alla prenotazione",
    address: "Indirizzo", mapsLabel: "Mappa / Come arrivare", city: "Città", neighborhood: "Zona", parkingInfo: "Parcheggio",
    parkOwn: "parcheggio proprio", parkPublic: "parcheggio pubblico vicino", parkStreet: "parcheggio su strada", parkNone: "nessun parcheggio proprio",
    publicTransport: "Trasporto pubblico", landmark: "Riferimento", phone: "Telefono",
    payCash: "contanti", payCard: "carta", payContactless: "contactless", payBizum: "Bizum",
  },
  en: {
    yes: "Yes", no: "No", available: "available", notAvailable: "not available", and: "and",
    tSchedule: "Opening hours", tReservations: "Reservation policy",
    tServices: "Additional services", tDiets: "Diets and allergies",
    tChef: "Chef's recommendations", tLocation: "Location and how to get there",
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    closed: "CLOSED", lunch: "lunch", dinner: "dinner",
    capacity: "Capacity", autoConfirm: "Groups of 1-{n}: confirmed automatically if there is availability",
    largeGroups: "Large groups", largeGroupsYes: "Groups of {n}+: request pending, the manager contacts the guest",
    largeGroupsNo: "Groups larger than {n} are not accepted",
    lateTolerance: "Late arrival tolerance", lateGrace: "more leeway if the guest lets us know in advance",
    lastLunch: "Last lunch reservation", lastDinner: "Last dinner reservation",
    lastResAtClose: "up to closing time", lastResBefore: "{n} min before closing",
    lastResVaries: "e.g. {n} depending on the day",
    noService: "no service", deposit: "Deposit",
    depositYes: "a deposit is required for large groups", depositNo: "no deposit required",
    cancellation: "Cancellation",
    cancellations: {
      none: "no advance notice required", same_day: "let us know the same day",
      "2h": "let us know at least 2 h in advance", "24h": "let us know at least 24 h in advance",
    },
    noShow: "No-show: the table is released after {n} min without notice",
    terraceNotGuaranteed: "Terrace: subject to availability, not guaranteed",
    minutes: "min",
    highChairs: "Families: high chairs", kidsMenu: "Kids' menu", pets: "Pets", petsYes: "yes, please mention when booking",
    accessible: "Accessibility: accessible entrance, comfortable table with prior notice", accessibleLabel: "Accessibility",
    celebrations: "Celebrations (birthdays, anniversaries): welcome, please mention when booking", celebrationsLabel: "Celebrations",
    outsideCake: "Own cake: you may bring your own (please mention when booking)", outsideCakeLabel: "Own cake",
    payments: "Payments", wifi: "WiFi", parking: "Private parking", terrace: "Terrace",
    takeaway: "Takeaway", takeawayWait: "wait time", delivery: "Delivery",
    deliveryYes: "yes", deliveryVia: "yes, via {p}",
    vegetarian: "Vegetarian options", vegan: "Vegan options", glutenFree: "Gluten-free options",
    lactoseFree: "Lactose-free options", celiacYes: "Coeliac protocol: separate preparation available",
    allergenIntro: "IMPORTANT — allergens present in the kitchen (cross-contamination risk):",
    allergens: {
      gluten: "gluten / wheat", nuts: "tree nuts", peanuts: "peanuts", dairy: "dairy",
      egg: "egg", fish: "fish", shellfish: "shellfish / crustaceans", soy: "soy", sesame: "sesame",
    },
    cannotGuarantee: "We cannot guarantee the total absence of traces.",
    severeAllergy: "SEVERE ALLERGY = the guest says \"severe/serious allergy\", \"anaphylactic shock\", \"EpiPen\", \"life-threatening\", or names an allergen present in the kitchen as an ALLERGY (not a mere preference). In that case: do NOT guarantee the dish is safe, warn about the cross-contamination risk, and offer to confirm with the kitchen or the manager before booking.",
    allergenInfo: "Allergen information", allergenInfoYes: "available on request",
    noneDeclared: "No special options declared — please ask when booking",
    address: "Address", mapsLabel: "Map / Directions", city: "City", neighborhood: "Area", parkingInfo: "Parking",
    parkOwn: "private car park", parkPublic: "public car park nearby", parkStreet: "street parking", parkNone: "no private parking",
    publicTransport: "Public transport", landmark: "Landmark", phone: "Phone",
    payCash: "cash", payCard: "card", payContactless: "contactless", payBizum: "Bizum",
  },
  de: {
    yes: "Ja", no: "Nein", available: "verfügbar", notAvailable: "nicht verfügbar", and: "und",
    tSchedule: "Öffnungszeiten", tReservations: "Reservierungsrichtlinie",
    tServices: "Zusätzliche Leistungen", tDiets: "Diäten und Allergien",
    tChef: "Empfehlungen des Küchenchefs", tLocation: "Lage und Anfahrt",
    days: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
    closed: "GESCHLOSSEN", lunch: "Mittag", dinner: "Abend",
    capacity: "Kapazität", autoConfirm: "Gruppen 1-{n}: automatische Bestätigung bei Verfügbarkeit",
    largeGroups: "Große Gruppen", largeGroupsYes: "Gruppen ab {n}: Anfrage offen, die Leitung kontaktiert den Gast",
    largeGroupsNo: "Gruppen größer als {n} werden nicht angenommen",
    lateTolerance: "Verspätungstoleranz", lateGrace: "mehr Spielraum, wenn der Gast vorher Bescheid gibt",
    lastLunch: "Letzte Mittagsreservierung", lastDinner: "Letzte Abendreservierung",
    lastResAtClose: "bis zur Schließzeit", lastResBefore: "{n} Min. vor Schließung",
    lastResVaries: "z. B. {n} je nach Tag",
    noService: "kein Service", deposit: "Anzahlung",
    depositYes: "für große Gruppen ist eine Anzahlung erforderlich", depositNo: "keine Anzahlung erforderlich",
    cancellation: "Stornierung",
    cancellations: {
      none: "keine Vorankündigung nötig", same_day: "am selben Tag Bescheid geben",
      "2h": "mindestens 2 Std. vorher Bescheid geben", "24h": "mindestens 24 Std. vorher Bescheid geben",
    },
    noShow: "No-Show: der Tisch wird nach {n} Min. ohne Nachricht freigegeben",
    terraceNotGuaranteed: "Terrasse: je nach Verfügbarkeit, nicht garantiert",
    minutes: "Min.",
    highChairs: "Familien: Hochstühle", kidsMenu: "Kindermenü", pets: "Haustiere", petsYes: "ja, bitte bei der Buchung angeben",
    accessible: "Barrierefreiheit: barrierefreier Eingang, bequemer Tisch mit Voranmeldung", accessibleLabel: "Barrierefreiheit",
    celebrations: "Feiern (Geburtstage, Jubiläen): willkommen, bitte bei der Buchung angeben", celebrationsLabel: "Feiern",
    outsideCake: "Eigene Torte: darf mitgebracht werden (bitte bei der Buchung angeben)", outsideCakeLabel: "Eigene Torte",
    payments: "Zahlung", wifi: "WLAN", parking: "Eigener Parkplatz", terrace: "Terrasse",
    takeaway: "Essen zum Mitnehmen", takeawayWait: "Wartezeit", delivery: "Lieferung",
    deliveryYes: "ja", deliveryVia: "ja, über {p}",
    vegetarian: "Vegetarische Optionen", vegan: "Vegane Optionen", glutenFree: "Glutenfreie Optionen",
    lactoseFree: "Laktosefreie Optionen", celiacYes: "Zöliakie-Protokoll: separate Zubereitung möglich",
    allergenIntro: "WICHTIG — in der Küche vorhandene Allergene (Risiko von Kreuzkontamination):",
    allergens: {
      gluten: "Gluten / Weizen", nuts: "Schalenfrüchte", peanuts: "Erdnüsse", dairy: "Milchprodukte",
      egg: "Ei", fish: "Fisch", shellfish: "Schalentiere / Krebstiere", soy: "Soja", sesame: "Sesam",
    },
    cannotGuarantee: "Eine vollständige Spurenfreiheit kann nicht garantiert werden.",
    severeAllergy: "SCHWERE ALLERGIE = der Gast sagt \"schwere/starke Allergie\", \"anaphylaktischer Schock\", \"EpiPen\", \"lebensbedrohlich\", oder nennt ein in der Küche vorhandenes Allergen als ALLERGIE (keine bloße Vorliebe). In diesem Fall: Sicherheit des Gerichts NICHT garantieren, auf das Risiko der Kreuzkontamination hinweisen und anbieten, es vor der Buchung mit der Küche oder der Leitung abzuklären.",
    allergenInfo: "Allergeninformationen", allergenInfoYes: "auf Anfrage verfügbar",
    noneDeclared: "Keine besonderen Optionen angegeben — bitte bei der Buchung erfragen",
    address: "Adresse", mapsLabel: "Karte / Anfahrt", city: "Stadt", neighborhood: "Gegend", parkingInfo: "Parken",
    parkOwn: "eigener Parkplatz", parkPublic: "öffentlicher Parkplatz in der Nähe", parkStreet: "Parken auf der Straße", parkNone: "kein eigener Parkplatz",
    publicTransport: "Öffentliche Verkehrsmittel", landmark: "Orientierungspunkt", phone: "Telefon",
    payCash: "Bargeld", payCard: "Karte", payContactless: "kontaktlos", payBizum: "Bizum",
  },
};

const fill = (s: string, n: number | string) => s.replace("{n}", String(n)).replace("{p}", String(n));

// Owners type the deposit as free text. A bare number ("70", "20.5", "1.000")
// reads as a naked figure in the KB and the WhatsApp recap ("Depósito: ... (70)"),
// which an owner reported as confusing. When the value is JUST a number we append
// the currency symbol ("70 €"); anything with words or an existing symbol
// ("10 a persona", "20€", "$15") is left exactly as written. EUR is the only
// currency the wizard offers, so € is the default; pass another symbol if needed.
const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
export function formatDepositAmount(raw: string, currency = "EUR"): string {
  const v = (raw || "").trim();
  if (!v) return "";
  // Bare amount = digits with optional thousands/decimal separators, nothing else.
  if (/^\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(v)) {
    return `${v} ${CURRENCY_SYMBOL[currency] || currency}`;
  }
  return v;
}

// Build a clickable Google Maps link from the free-text address (+ city). Used
// both in the Location KB article and, at booking time, in the WhatsApp recap
// (the book route reuses this so the two never drift). Returns "" if no address.
export function mapsLink(address: string, city?: string): string {
  const q = [address, city].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

/** Shorten a long Maps URL via da.gd (free, no key, redirects straight to the target —
 *  no tracker, and unlike is.gd it doesn't block google.com/maps URLs). Best-effort:
 *  returns "" on any failure/timeout so callers can fall back to the long URL. */
export async function shortenMapsLink(longUrl: string): Promise<string> {
  if (!longUrl) return "";
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch("https://da.gd/s?url=" + encodeURIComponent(longUrl), {
      headers: { "User-Agent": "baliflow-crm/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const text = (await r.text()).trim();
    return r.ok && /^https?:\/\/da\.gd\//.test(text) ? text : "";
  } catch {
    return "";
  }
}

function paymentLabel(L: Labels, m: PaymentMethod): string {
  return m === "cash" ? L.payCash : m === "card" ? L.payCard : m === "contactless" ? L.payContactless : L.payBizum;
}

function yn(L: Labels, v: boolean): string {
  return v ? L.yes : L.no;
}

// Classify an opening slot as lunch or dinner by its start hour (< 17:00 = lunch).
function slotPeriod(L: Labels, open: string): string {
  const h = parseInt(open.slice(0, 2), 10);
  return Number.isFinite(h) && h < 17 ? L.lunch : L.dinner;
}

const hhmm = (min: number) => {
  // Wrap past-midnight cut-offs back onto the clock (e.g. 24:05 → 00:05).
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Latest reservation time(s) for a shift = (closing time of that shift) − offset.
// Returns the DISTINCT cut-offs across every day that serves the shift, so a
// venue that closes at different times on different days gets a correct answer
// for each (rather than one representative time that's wrong for the others).
// A close earlier than its open means the shift runs past midnight (e.g.
// 19:30–00:30) and is counted as +24h so it sorts and subtracts correctly.
// Returns null when no day serves that shift or the shift is switched off (-1).
function lastReservationCutoffs(
  hours: OpeningHours | undefined,
  shift: "lunch" | "dinner",
  offsetMin: number,
): string[] | null {
  if (!hours || offsetMin < 0) return null;
  const closeMins = new Set<number>();
  for (const slots of Object.values(hours)) {
    for (const s of slots) {
      if (!s.open || !s.close) continue;
      const startH = parseInt(s.open.slice(0, 2), 10);
      const isLunch = Number.isFinite(startH) && startH < 17;
      if ((shift === "lunch") !== isLunch) continue;
      const [oh, om] = s.open.split(":").map(Number);
      const [ch, cm] = s.close.split(":").map(Number);
      let closeMin = ch * 60 + cm;
      if (closeMin <= oh * 60 + om) closeMin += 1440; // closes after midnight
      closeMins.add(closeMin);
    }
  }
  if (closeMins.size === 0) return null;
  // Distinct cut-offs, ordered the way the schedule reads (a past-midnight
  // 00:00 belongs after 23:00, so sort by the raw minute value before wrapping).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...closeMins].sort((a, b) => a - b)) {
    const t = hhmm(c - offsetMin);
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// One human line for a shift's last-reservation policy. Uses the schedule's
// per-day closings: a single cut-off renders as "HH:MM (N min before closing)";
// several render as "N min before closing (e.g. A, B, C depending on the day)";
// offset 0 renders as "up to closing time". null cut-offs → "no service".
function lastReservationLine(L: Labels, label: string, cutoffs: string[] | null, offsetMin: number): string {
  if (!cutoffs || cutoffs.length === 0) return `${label}: ${L.noService}`;
  if (offsetMin === 0) {
    return cutoffs.length === 1
      ? `${label}: ${cutoffs[0]} (${L.lastResAtClose})`
      : `${label}: ${L.lastResAtClose} (${fill(L.lastResVaries, cutoffs.join(", "))})`;
  }
  const margin = fill(L.lastResBefore, offsetMin);
  return cutoffs.length === 1
    ? `${label}: ${cutoffs[0]} (${margin})`
    : `${label}: ${margin} (${fill(L.lastResVaries, cutoffs.join(", "))})`;
}

/** Schedule lines (Mon→Sun). Returns [] when no day is open. */
function buildScheduleLines(L: Labels, hours?: OpeningHours): string[] {
  if (!hours) return [];
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first, Sunday last
  const lines: string[] = [];
  let anyOpen = false;
  for (const d of order) {
    const slots = hours[String(d)] || [];
    if (slots.length === 0) {
      lines.push(`${L.days[d]}: ${L.closed}`);
    } else {
      anyOpen = true;
      const parts = slots
        .filter((s) => s.open && s.close)
        .map((s) => `${s.open}-${s.close} (${slotPeriod(L, s.open)})`);
      lines.push(`${L.days[d]}: ${parts.join(` ${L.and} `)}`);
    }
  }
  return anyOpen ? lines : [];
}

/**
 * Turn the questionnaire into formatted KB articles. Pure: same input → same
 * output. The voice prompt is generated separately (see voice-prompt.ts); this
 * only produces the knowledge sources the agent reads. Article count varies
 * (4-6): the Schedule article appears only with opening hours, and the Chef
 * recommendations article only when the owner listed any dishes.
 */
export function generateKbArticles(q: KbQuestionnaire, ctx: KbContext): GeneratedArticle[] {
  const L = DICT[ctx.language] || DICT.es;
  const threshold = q.auto_confirm_max + 1;
  const articles: GeneratedArticle[] = [];

  // --- Schedule (from opening_hours) ---
  const scheduleLines = buildScheduleLines(L, ctx.opening_hours);
  if (scheduleLines.length) {
    articles.push({ title: L.tSchedule, category: "general", content: scheduleLines.join("\n") });
  }

  // --- Reservation policy ---
  const reservationLines: string[] = [];
  if (q.capacity_seats > 0) reservationLines.push(`${L.capacity}: ${q.capacity_seats}`);
  reservationLines.push(fill(L.autoConfirm, q.auto_confirm_max));
  reservationLines.push(q.accepts_large_groups ? fill(L.largeGroupsYes, threshold) : fill(L.largeGroupsNo, q.auto_confirm_max));
  const tolerance = `${L.lateTolerance}: ${q.late_tolerance_min} ${L.minutes}` + (q.late_grace_if_notified ? ` (${L.lateGrace})` : "");
  reservationLines.push(tolerance);
  reservationLines.push(`${L.cancellation}: ${L.cancellations[q.cancellation_notice]}`);
  if (q.noshow_release_min > 0) reservationLines.push(fill(L.noShow, q.noshow_release_min));
  const lastLunch = lastReservationCutoffs(ctx.opening_hours, "lunch", q.last_lunch_offset_min);
  const lastDinner = lastReservationCutoffs(ctx.opening_hours, "dinner", q.last_dinner_offset_min);
  reservationLines.push(lastReservationLine(L, L.lastLunch, lastLunch, q.last_lunch_offset_min));
  reservationLines.push(lastReservationLine(L, L.lastDinner, lastDinner, q.last_dinner_offset_min));
  if (q.accepts_large_groups) {
    const depAmt = formatDepositAmount(q.deposit_amount);
    const depositValue = q.deposit_required
      ? L.depositYes + (depAmt ? ` (${depAmt})` : "")
      : L.depositNo;
    reservationLines.push(`${L.deposit}: ${depositValue}`);
  }
  if (q.terrace) reservationLines.push(L.terraceNotGuaranteed);
  articles.push({ title: L.tReservations, category: "policies", content: reservationLines.join("\n") });

  // --- Diets and allergies (diet options + real allergen safety protocol) ---
  const dietLines: string[] = [];
  const dietPairs: Array<[string, boolean]> = [
    [L.vegetarian, q.vegetarian],
    [L.vegan, q.vegan],
    [L.glutenFree, q.gluten_free],
    [L.lactoseFree, q.lactose_free],
  ];
  for (const [label, v] of dietPairs) if (v) dietLines.push(`${label}: ${L.yes}`);
  if (q.celiac_safe) dietLines.push(L.celiacYes);
  if (q.kitchen_allergens.length) {
    dietLines.push("", L.allergenIntro);
    for (const a of q.kitchen_allergens) dietLines.push(`- ${L.allergens[a]}`);
    if (q.cannot_guarantee_traces) dietLines.push(L.cannotGuarantee);
    if (q.severe_allergy_escalate) dietLines.push(L.severeAllergy);
  }
  if (q.allergen_info) dietLines.push(`${L.allergenInfo}: ${L.allergenInfoYes}`);
  if (dietLines.filter((l) => l.trim()).length === 0) dietLines.push(L.noneDeclared);
  articles.push({ title: L.tDiets, category: "policies", content: dietLines.join("\n") });

  // --- Additional services ---
  // Every practical service is stated yes/no (not omitted-when-false): a fact
  // the guest may ask about directly ("is it accessible?", "kids' menu?"). If we
  // dropped the false ones the bot would have no answer and improvise; with an
  // explicit "no" it answers correctly. (Diets stay opt-in — see the diet block.)
  const serviceLines: string[] = [];
  serviceLines.push(`${L.highChairs} ${q.high_chairs ? L.available : L.notAvailable}`);
  serviceLines.push(`${L.kidsMenu}: ${yn(L, q.kids_menu)}`);
  serviceLines.push(`${L.pets}: ${q.pets ? L.petsYes : L.no}`);
  serviceLines.push(q.accessible ? L.accessible : `${L.accessibleLabel}: ${L.no}`);
  serviceLines.push(q.celebrations ? L.celebrations : `${L.celebrationsLabel}: ${L.no}`);
  serviceLines.push(q.outside_cake ? L.outsideCake : `${L.outsideCakeLabel}: ${L.no}`);
  const pay = q.payments.length ? q.payments.map((p) => paymentLabel(L, p)).join(", ") : L.notAvailable;
  serviceLines.push(`${L.payments}: ${pay}`);
  serviceLines.push(`${L.wifi}: ${yn(L, q.wifi)}`);
  // Parking is covered once, with detail, in the Location article (parking_info).
  serviceLines.push(`${L.terrace}: ${yn(L, q.terrace)}`);
  const takeawayLine = `${L.takeaway}: ${q.takeaway ? L.yes : L.no}` +
    (q.takeaway && q.takeaway_wait.trim() ? ` (${L.takeawayWait}: ${q.takeaway_wait.trim()})` : "");
  serviceLines.push(takeawayLine);
  const deliveryValue = !q.delivery ? L.no : q.delivery_platform.trim() ? fill(L.deliveryVia, q.delivery_platform.trim()) : L.deliveryYes;
  serviceLines.push(`${L.delivery}: ${deliveryValue}`);
  articles.push({ title: L.tServices, category: "general", content: serviceLines.join("\n") });

  // Recommended dishes are intentionally NOT generated here any more: the owner
  // curates them as a Menu category the bot reads live (see chef_recommendations
  // deprecation note). No "Recomendaciones del chef" KB article is produced.

  // --- Location ---
  const parkLabel = (k: ParkingKind) =>
    k === "own" ? L.parkOwn : k === "public" ? L.parkPublic : k === "street" ? L.parkStreet : L.parkNone;
  const parkChosen = q.parking_info.filter((k) => k !== "none");
  const parkKind = parkChosen.length ? parkChosen.map(parkLabel).join(", ") : L.parkNone;
  // Free-text prose reads in this block's language when a translation was supplied
  // (multilingual KB); otherwise the owner's original text. Proper nouns
  // (address/city/neighborhood) are never translated.
  const cuisine = (ctx.freeTextOverrides?.cuisine_type || q.cuisine_type).trim();
  const landmark = (ctx.freeTextOverrides?.landmark || q.landmark).trim();
  const header = cuisine ? `${ctx.restaurant_name} - ${cuisine}` : ctx.restaurant_name;
  const locationLines: string[] = [header];
  if (q.address.trim()) locationLines.push(`${L.address}: ${q.address.trim()}`);
  if (q.city.trim()) locationLines.push(`${L.city}: ${q.city.trim()}`);
  const maps = mapsLink(q.address, q.city);
  if (maps) locationLines.push(`${L.mapsLabel}: ${maps}`);
  if (q.neighborhood.trim()) locationLines.push(`${L.neighborhood}: ${q.neighborhood.trim()}`);
  locationLines.push(`${L.parkingInfo}: ${parkKind}`);
  locationLines.push(`${L.publicTransport}: ${yn(L, q.public_transport)}`);
  if (landmark) locationLines.push(`${L.landmark}: ${landmark}`);
  if (ctx.restaurant_phone.trim()) locationLines.push(`${L.phone}: ${ctx.restaurant_phone.trim()}`);
  articles.push({ title: L.tLocation, category: "general", content: locationLines.join("\n") });

  return articles;
}

// English name of each language, used to label article sections when the
// assistant speaks several languages (so the agent knows which block to quote).
const LANG_NAME: Record<Lang, string> = {
  es: "Español", it: "Italiano", en: "English", de: "Deutsch",
};

/**
 * Multi-language KB. The assistant answers in several languages, so each article
 * is generated once per selected language and merged: one article per topic,
 * its body stacking every language separated by a language header. With a single
 * language this is byte-identical to generateKbArticles (no header noise).
 *
 * `languages[0]` is the primary one — its TITLE/category label the merged
 * article and its block comes first. Articles are merged by POSITION, not by
 * title, because titles are themselves localized ("Horario del restaurante" vs
 * "Öffnungszeiten"). This is sound: generateKbArticles emits the same article
 * topics in the same order for every language — the only conditional articles
 * (Schedule, Chef recommendations) depend on the questionnaire/hours, not the
 * language, so all languages agree on which are present.
 */
export function generateKbArticlesMulti(
  q: KbQuestionnaire,
  ctx: Omit<KbContext, "language" | "freeTextOverrides">,
  languages: Lang[],
  // Translations of the free-text prose fields, keyed by language. The owner
  // types landmark/cuisine_type once; the caller (route.ts) translates them into
  // every selected language up front and passes them here so each language block
  // reads them in its own language. A missing language/field falls back to the
  // questionnaire's original text. Proper nouns are never translated.
  freeTextByLang?: Partial<Record<Lang, { landmark?: string; cuisine_type?: string }>>,
): GeneratedArticle[] {
  const langs = languages.length ? languages : (["es"] as Lang[]);
  const ctxFor = (lang: Lang): KbContext =>
    ({ ...ctx, language: lang, freeTextOverrides: freeTextByLang?.[lang] });
  if (langs.length === 1) {
    return generateKbArticles(q, ctxFor(langs[0]));
  }

  // Per-language article lists, all the same length & topic order (see docblock).
  const perLang = langs.map((lang) => ({ lang, arts: generateKbArticles(q, ctxFor(lang)) }));
  const primary = perLang[0].arts; // titles/categories come from the primary language

  return primary.map((art, i) => {
    const content = perLang
      .map(({ lang, arts }) => `[${LANG_NAME[lang]}]\n${arts[i].content}`)
      .join("\n\n");
    return { title: art.title, category: art.category, content };
  });
}

/** Sensible defaults so the wizard never starts blank (client just edits).
 *  Safety-sensitive policy fields (no-show release, cuisine, city…) default to
 *  "unset" so we never invent a policy the restaurant didn't state; the present
 *  allergens seed common kitchen staples (gluten + dairy) the owner adjusts. */
export function defaultQuestionnaire(): KbQuestionnaire {
  return {
    capacity_seats: 50,
    auto_confirm_max: 6,
    accepts_large_groups: true,
    deposit_required: false,
    deposit_amount: "",
    late_tolerance_min: 15,
    late_grace_if_notified: true,
    last_lunch_offset_min: 45,
    last_dinner_offset_min: 60,
    cancellation_notice: "same_day",
    noshow_release_min: 0,
    high_chairs: true,
    kids_menu: false,
    pets: false,
    accessible: true,
    payments: ["cash", "card", "contactless"],
    wifi: true,
    terrace: true,
    takeaway: false,
    takeaway_wait: "",
    delivery: false,
    delivery_platform: "",
    celebrations: true,
    outside_cake: false,
    vegetarian: true,
    vegan: false,
    gluten_free: true,
    lactose_free: false,
    celiac_safe: false,
    kitchen_allergens: ["gluten", "dairy"],
    cannot_guarantee_traces: true,
    severe_allergy_escalate: true,
    allergen_info: true,
    cuisine_type: "",
    address: "",
    city: "",
    neighborhood: "",
    parking_info: ["public"],
    public_transport: true,
    landmark: "",
    chef_recommendations: [],
  };
}

// --- Post-onboarding editing of the reservation-policy article -------------
// Settings → Bookings lets an owner change the booking rules they chose at
// onboarding (cancellation notice, late tolerance, last-reservation cut-offs,
// deposit). The structured values are read LIVE by /api/ai/availability and
// /api/ai/book, but the assistant also QUOTES the policy from the reservation KB
// article — so a change must regenerate THAT one article (in the same language(s)
// it already has) or the bot would say the old policy while enforcing the new one
// (the exact desync this feature exists to avoid). Pure → unit-tested.

/** Titles of the reservation-policy article in every supported language. Lets a
 *  caller find the existing row no matter which language the tenant runs in. */
export const RESERVATION_TITLES: readonly string[] = (Object.keys(DICT) as Lang[]).map((l) => DICT[l].tReservations);

/** Recover the language order of a (possibly multi-language) merged article from
 *  its "[Español]/[Italiano]/…" section headers, so a regeneration restacks the
 *  blocks in the same order. No headers → single-language: use `fallback`. */
export function detectArticleLangs(content: string, fallback: Lang): Lang[] {
  const nameToCode: Record<string, Lang> = { Español: "es", Italiano: "it", English: "en", Deutsch: "de" };
  const hits: Array<{ code: Lang; idx: number }> = [];
  for (const [name, code] of Object.entries(nameToCode)) {
    const idx = content.indexOf(`[${name}]`);
    if (idx >= 0) hits.push({ code, idx });
  }
  if (!hits.length) return [fallback];
  return hits.sort((a, b) => a.idx - b.idx).map((h) => h.code);
}

const LANG_SECTION_NAME: Record<string, Lang> = { Español: "es", Italiano: "it", English: "en", Deutsch: "de" };

/** Pull a SINGLE language section out of a merged "[Español]…[Italiano]…" KB
 *  article body. The voice prompt only needs the facts in the call's own
 *  language — the agent translates them to the caller as it does any tool data —
 *  so injecting all 3–4 languages tripled the prompt and primed the model to
 *  leak the others. Returns just the requested language's body (header line
 *  dropped). No language headers → already single-language: return as-is.
 *  Requested language absent → fall back to the FIRST section present (the
 *  blocks are stored primary-first, so that is the venue's own language). */
export function extractArticleLang(content: string, lang: Lang): string {
  const text = content || "";
  const hits: Array<{ code: Lang; start: number; bodyAt: number }> = [];
  for (const [name, code] of Object.entries(LANG_SECTION_NAME)) {
    const marker = `[${name}]`;
    const idx = text.indexOf(marker);
    if (idx >= 0) hits.push({ code, start: idx, bodyAt: idx + marker.length });
  }
  if (!hits.length) return text.trim();
  hits.sort((a, b) => a.start - b.start);
  let i = hits.findIndex((h) => h.code === lang);
  if (i === -1) i = 0; // requested language not present → first (primary) section
  const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
  return text.slice(hits[i].bodyAt, end).trim();
}

/** The booking rules an owner edits after onboarding (Settings → Bookings). */
export interface BookingPolicyForm {
  cancellation_notice: CancellationNotice;
  late_tolerance_min: number;
  late_grace_if_notified: boolean;
  last_lunch_offset_min: number;
  last_dinner_offset_min: number;
  deposit_required: boolean;
  deposit_amount: string;
}

/** The non-edited facts the reservation article also needs, read from the
 *  tenant's current state (not from the form) so they survive the regeneration. */
export interface ReservationArticleContext {
  restaurant_name: string;
  restaurant_phone: string;
  opening_hours?: OpeningHours;
  languages: Lang[];        // detected order, primary first
  capacity_seats: number;   // 0 → capacity line omitted
  auto_confirm_max: number;
  accepts_large_groups: boolean;
  terrace: boolean;
  noshow_release_min?: number;
}

/** Regenerate ONLY the reservation-policy article from the edited booking rules
 *  plus the tenant's current non-edited facts. Returns the merged article
 *  ({title, content, category}); the other KB articles are left untouched. */
export function reservationArticleFromForm(form: BookingPolicyForm, ctx: ReservationArticleContext): GeneratedArticle {
  const q: KbQuestionnaire = {
    ...defaultQuestionnaire(),
    capacity_seats: ctx.capacity_seats,
    auto_confirm_max: ctx.auto_confirm_max,
    accepts_large_groups: ctx.accepts_large_groups,
    deposit_required: form.deposit_required,
    deposit_amount: form.deposit_amount,
    late_tolerance_min: form.late_tolerance_min,
    late_grace_if_notified: form.late_grace_if_notified,
    last_lunch_offset_min: form.last_lunch_offset_min,
    last_dinner_offset_min: form.last_dinner_offset_min,
    cancellation_notice: form.cancellation_notice,
    noshow_release_min: ctx.noshow_release_min ?? 0,
    terrace: ctx.terrace,
  };
  const langs = ctx.languages.length ? ctx.languages : (["es"] as Lang[]);
  const articles = generateKbArticlesMulti(
    q,
    { restaurant_name: ctx.restaurant_name, restaurant_phone: ctx.restaurant_phone, opening_hours: ctx.opening_hours },
    langs,
  );
  // The reservation policy is the FIRST 'policies' article (pushed before diets).
  return articles.find((a) => a.category === "policies") || articles[0];
}
