// Self-serve KB generator.
//
// The restaurateur is NOT a writer (see [[feedback_no_power_user_features]]):
// they never type free-form KB articles. Instead the client wizard collects a
// FIXED-FIELD questionnaire (yes/no, dropdowns, short fields) and this pure
// server-side function turns those structured answers into well-formatted
// knowledge_articles — modelled on the hand-written DEFAULT_KB that used to
// live in the admin wizard. The 4 questionnaire cards map 1:1 to 4 articles:
//
//   1. Prenotazioni e gruppi   → "Política de reservas"      (policies)
//   2. Servizi pratici         → "Servicios adicionales"     (general)
//   3. Diete e allergie        → "Dietas y alergias"         (policies)
//   4. Come arrivare           → "Ubicación y cómo llegar"   (general)
//
// Articles are written in the restaurant's primary `language` because they are
// consumed by the AI agent (WhatsApp + voice) which speaks that language.

export type Lang = "es" | "it" | "en" | "de";

export type PaymentMethod = "cash" | "card" | "contactless" | "bizum";
export type ParkingKind = "own" | "public" | "street" | "none";

/** The fixed-field answers the client wizard collects. NO free-text prose. */
export interface KbQuestionnaire {
  // Card 1 — Prenotazioni e gruppi
  capacity_seats: number; // short number field
  auto_confirm_max: number; // dropdown: party size auto-confirmed (e.g. 6)
  accepts_large_groups: boolean; // yes/no — groups above the threshold at all
  late_tolerance_min: number; // dropdown: 10/15/20/30
  last_lunch: string; // time "14:45" ("" = no lunch service)
  last_dinner: string; // time "21:30" ("" = no dinner service)
  deposit_required: boolean; // yes/no — deposit for large groups

  // Card 2 — Servizi pratici
  high_chairs: boolean;
  pets: boolean;
  accessible: boolean;
  payments: PaymentMethod[]; // multi-select dropdown
  wifi: boolean;
  parking_lot: boolean; // own parking on site
  terrace: boolean;
  takeaway: boolean;

  // Card 3 — Diete e allergie
  vegetarian: boolean;
  vegan: boolean;
  gluten_free: boolean;
  celiac_safe: boolean; // protocol / separate prep for coeliacs
  lactose_free: boolean;
  allergen_info: boolean; // allergen sheet available on request

  // Card 4 — Come arrivare
  address: string; // short field
  parking_info: ParkingKind; // dropdown
  public_transport: boolean; // yes/no
  landmark: string; // short field — reference point ("" = none)
}

export interface KbContext {
  restaurant_name: string;
  restaurant_phone: string;
  language: Lang;
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
  // titles
  tReservations: string;
  tServices: string;
  tDiets: string;
  tLocation: string;
  // reservations
  capacity: string;
  autoConfirm: string; // "{n}" placeholder
  largeGroups: string;
  largeGroupsYes: string;
  largeGroupsNo: string;
  lateTolerance: string; // "{n}"
  lastLunch: string;
  lastDinner: string;
  noService: string;
  deposit: string;
  depositYes: string;
  depositNo: string;
  minutes: string;
  // services
  highChairs: string;
  pets: string;
  petsYes: string;
  accessible: string;
  payments: string;
  wifi: string;
  parking: string; // on-site parking line label
  terrace: string;
  takeaway: string;
  // diets
  vegetarian: string;
  vegan: string;
  glutenFree: string;
  celiac: string;
  lactoseFree: string;
  allergenInfo: string;
  allergenInfoYes: string;
  noneDeclared: string;
  // location
  address: string;
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
    yes: "Sí", no: "No", available: "disponible", notAvailable: "no disponible",
    tReservations: "Política de reservas", tServices: "Servicios adicionales",
    tDiets: "Dietas y alergias", tLocation: "Ubicación y cómo llegar",
    capacity: "Capacidad", autoConfirm: "Grupos 1-{n}: confirmación automática si hay disponibilidad",
    largeGroups: "Grupos grandes", largeGroupsYes: "Grupos {n}+: solicitud pendiente, el responsable contacta al cliente",
    largeGroupsNo: "No se aceptan grupos de más de {n} personas",
    lateTolerance: "Tolerancia de retraso", lastLunch: "Última reserva almuerzo", lastDinner: "Última reserva cena",
    noService: "sin servicio", deposit: "Depósito",
    depositYes: "se solicita depósito para grupos grandes", depositNo: "no se solicita depósito", minutes: "min",
    highChairs: "Familias: tronas", pets: "Mascotas", petsYes: "sí, avisar al reservar",
    accessible: "Accesibilidad: entrada accesible", payments: "Pagos", wifi: "WiFi",
    parking: "Parking propio", terrace: "Terraza", takeaway: "Comida para llevar",
    vegetarian: "Opciones vegetarianas", vegan: "Opciones veganas", glutenFree: "Opciones sin gluten",
    celiac: "Protocolo para celíacos", lactoseFree: "Opciones sin lactosa",
    allergenInfo: "Información de alérgenos", allergenInfoYes: "disponible bajo petición",
    noneDeclared: "Sin opciones especiales declaradas — consultar al reservar",
    address: "Dirección", parkingInfo: "Aparcamiento",
    parkOwn: "parking propio", parkPublic: "parking público cercano", parkStreet: "aparcamiento en la calle", parkNone: "sin aparcamiento propio",
    publicTransport: "Transporte público", landmark: "Referencia", phone: "Teléfono",
    payCash: "efectivo", payCard: "tarjeta", payContactless: "contactless", payBizum: "Bizum",
  },
  it: {
    yes: "Sì", no: "No", available: "disponibile", notAvailable: "non disponibile",
    tReservations: "Politica di prenotazione", tServices: "Servizi aggiuntivi",
    tDiets: "Diete e allergie", tLocation: "Posizione e come arrivare",
    capacity: "Capienza", autoConfirm: "Gruppi 1-{n}: conferma automatica se c'è disponibilità",
    largeGroups: "Gruppi numerosi", largeGroupsYes: "Gruppi {n}+: richiesta in sospeso, il responsabile ricontatta il cliente",
    largeGroupsNo: "Non si accettano gruppi di più di {n} persone",
    lateTolerance: "Tolleranza ritardo", lastLunch: "Ultima prenotazione pranzo", lastDinner: "Ultima prenotazione cena",
    noService: "nessun servizio", deposit: "Caparra",
    depositYes: "è richiesta una caparra per i gruppi numerosi", depositNo: "nessuna caparra richiesta", minutes: "min",
    highChairs: "Famiglie: seggioloni", pets: "Animali", petsYes: "sì, avvisare alla prenotazione",
    accessible: "Accessibilità: ingresso accessibile", payments: "Pagamenti", wifi: "WiFi",
    parking: "Parcheggio proprio", terrace: "Terrazza", takeaway: "Cibo da asporto",
    vegetarian: "Opzioni vegetariane", vegan: "Opzioni vegane", glutenFree: "Opzioni senza glutine",
    celiac: "Protocollo per celiaci", lactoseFree: "Opzioni senza lattosio",
    allergenInfo: "Informazioni sugli allergeni", allergenInfoYes: "disponibili su richiesta",
    noneDeclared: "Nessuna opzione speciale dichiarata — chiedere alla prenotazione",
    address: "Indirizzo", parkingInfo: "Parcheggio",
    parkOwn: "parcheggio proprio", parkPublic: "parcheggio pubblico vicino", parkStreet: "parcheggio su strada", parkNone: "nessun parcheggio proprio",
    publicTransport: "Trasporto pubblico", landmark: "Riferimento", phone: "Telefono",
    payCash: "contanti", payCard: "carta", payContactless: "contactless", payBizum: "Bizum",
  },
  en: {
    yes: "Yes", no: "No", available: "available", notAvailable: "not available",
    tReservations: "Reservation policy", tServices: "Additional services",
    tDiets: "Diets and allergies", tLocation: "Location and how to get there",
    capacity: "Capacity", autoConfirm: "Groups of 1-{n}: confirmed automatically if there is availability",
    largeGroups: "Large groups", largeGroupsYes: "Groups of {n}+: request pending, the manager contacts the guest",
    largeGroupsNo: "Groups larger than {n} are not accepted",
    lateTolerance: "Late arrival tolerance", lastLunch: "Last lunch reservation", lastDinner: "Last dinner reservation",
    noService: "no service", deposit: "Deposit",
    depositYes: "a deposit is required for large groups", depositNo: "no deposit required", minutes: "min",
    highChairs: "Families: high chairs", pets: "Pets", petsYes: "yes, please mention when booking",
    accessible: "Accessibility: accessible entrance", payments: "Payments", wifi: "WiFi",
    parking: "Private parking", terrace: "Terrace", takeaway: "Takeaway",
    vegetarian: "Vegetarian options", vegan: "Vegan options", glutenFree: "Gluten-free options",
    celiac: "Coeliac protocol", lactoseFree: "Lactose-free options",
    allergenInfo: "Allergen information", allergenInfoYes: "available on request",
    noneDeclared: "No special options declared — please ask when booking",
    address: "Address", parkingInfo: "Parking",
    parkOwn: "private car park", parkPublic: "public car park nearby", parkStreet: "street parking", parkNone: "no private parking",
    publicTransport: "Public transport", landmark: "Landmark", phone: "Phone",
    payCash: "cash", payCard: "card", payContactless: "contactless", payBizum: "Bizum",
  },
  de: {
    yes: "Ja", no: "Nein", available: "verfügbar", notAvailable: "nicht verfügbar",
    tReservations: "Reservierungsrichtlinie", tServices: "Zusätzliche Leistungen",
    tDiets: "Diäten und Allergien", tLocation: "Lage und Anfahrt",
    capacity: "Kapazität", autoConfirm: "Gruppen 1-{n}: automatische Bestätigung bei Verfügbarkeit",
    largeGroups: "Große Gruppen", largeGroupsYes: "Gruppen ab {n}: Anfrage offen, die Leitung kontaktiert den Gast",
    largeGroupsNo: "Gruppen größer als {n} werden nicht angenommen",
    lateTolerance: "Verspätungstoleranz", lastLunch: "Letzte Mittagsreservierung", lastDinner: "Letzte Abendreservierung",
    noService: "kein Service", deposit: "Anzahlung",
    depositYes: "für große Gruppen ist eine Anzahlung erforderlich", depositNo: "keine Anzahlung erforderlich", minutes: "Min.",
    highChairs: "Familien: Hochstühle", pets: "Haustiere", petsYes: "ja, bitte bei der Buchung angeben",
    accessible: "Barrierefreiheit: barrierefreier Eingang", payments: "Zahlung", wifi: "WLAN",
    parking: "Eigener Parkplatz", terrace: "Terrasse", takeaway: "Essen zum Mitnehmen",
    vegetarian: "Vegetarische Optionen", vegan: "Vegane Optionen", glutenFree: "Glutenfreie Optionen",
    celiac: "Zöliakie-Protokoll", lactoseFree: "Laktosefreie Optionen",
    allergenInfo: "Allergeninformationen", allergenInfoYes: "auf Anfrage verfügbar",
    noneDeclared: "Keine besonderen Optionen angegeben — bitte bei der Buchung erfragen",
    address: "Adresse", parkingInfo: "Parken",
    parkOwn: "eigener Parkplatz", parkPublic: "öffentlicher Parkplatz in der Nähe", parkStreet: "Parken auf der Straße", parkNone: "kein eigener Parkplatz",
    publicTransport: "Öffentliche Verkehrsmittel", landmark: "Orientierungspunkt", phone: "Telefon",
    payCash: "Bargeld", payCard: "Karte", payContactless: "kontaktlos", payBizum: "Bizum",
  },
};

const fill = (s: string, n: number) => s.replace("{n}", String(n));

function paymentLabel(L: Labels, m: PaymentMethod): string {
  return m === "cash" ? L.payCash : m === "card" ? L.payCard : m === "contactless" ? L.payContactless : L.payBizum;
}

function yn(L: Labels, v: boolean): string {
  return v ? L.yes : L.no;
}

/**
 * Turn the questionnaire into 4 formatted KB articles. Pure: same input →
 * same output. The voice prompt is generated separately (see voice-prompt.ts);
 * this only produces the knowledge sources the agent reads.
 */
export function generateKbArticles(q: KbQuestionnaire, ctx: KbContext): GeneratedArticle[] {
  const L = DICT[ctx.language] || DICT.es;
  const threshold = q.auto_confirm_max + 1;

  // --- Card 1: Reservation policy ---
  const reservationLines: string[] = [];
  if (q.capacity_seats > 0) reservationLines.push(`${L.capacity}: ${q.capacity_seats}`);
  reservationLines.push(fill(L.autoConfirm, q.auto_confirm_max));
  reservationLines.push(q.accepts_large_groups ? fill(L.largeGroupsYes, threshold) : fill(L.largeGroupsNo, q.auto_confirm_max));
  reservationLines.push(`${L.lateTolerance}: ${q.late_tolerance_min} ${L.minutes}`);
  reservationLines.push(`${L.lastLunch}: ${q.last_lunch || L.noService}`);
  reservationLines.push(`${L.lastDinner}: ${q.last_dinner || L.noService}`);
  if (q.accepts_large_groups) {
    reservationLines.push(`${L.deposit}: ${q.deposit_required ? L.depositYes : L.depositNo}`);
  }

  // --- Card 2: Additional services ---
  const serviceLines: string[] = [];
  serviceLines.push(`${L.highChairs}: ${q.high_chairs ? L.available : L.notAvailable}`);
  serviceLines.push(`${L.pets}: ${q.pets ? L.petsYes : L.no}`);
  if (q.accessible) serviceLines.push(L.accessible);
  const pay = q.payments.length ? q.payments.map((p) => paymentLabel(L, p)).join(", ") : L.notAvailable;
  serviceLines.push(`${L.payments}: ${pay}`);
  serviceLines.push(`${L.wifi}: ${yn(L, q.wifi)}`);
  serviceLines.push(`${L.parking}: ${yn(L, q.parking_lot)}`);
  serviceLines.push(`${L.terrace}: ${yn(L, q.terrace)}`);
  serviceLines.push(`${L.takeaway}: ${yn(L, q.takeaway)}`);

  // --- Card 3: Diets and allergies ---
  const dietPairs: Array<[string, boolean]> = [
    [L.vegetarian, q.vegetarian],
    [L.vegan, q.vegan],
    [L.glutenFree, q.gluten_free],
    [L.celiac, q.celiac_safe],
    [L.lactoseFree, q.lactose_free],
  ];
  const dietLines = dietPairs.filter(([, v]) => v).map(([label]) => `${label}: ${L.yes}`);
  if (q.allergen_info) dietLines.push(`${L.allergenInfo}: ${L.allergenInfoYes}`);
  if (dietLines.length === 0) dietLines.push(L.noneDeclared);

  // --- Card 4: Location ---
  const parkKind =
    q.parking_info === "own" ? L.parkOwn :
    q.parking_info === "public" ? L.parkPublic :
    q.parking_info === "street" ? L.parkStreet : L.parkNone;
  const locationLines: string[] = [ctx.restaurant_name];
  if (q.address.trim()) locationLines.push(`${L.address}: ${q.address.trim()}`);
  locationLines.push(`${L.parkingInfo}: ${parkKind}`);
  locationLines.push(`${L.publicTransport}: ${yn(L, q.public_transport)}`);
  if (q.landmark.trim()) locationLines.push(`${L.landmark}: ${q.landmark.trim()}`);
  if (ctx.restaurant_phone.trim()) locationLines.push(`${L.phone}: ${ctx.restaurant_phone.trim()}`);

  return [
    { title: L.tReservations, category: "policies", content: reservationLines.join("\n") },
    { title: L.tServices, category: "general", content: serviceLines.join("\n") },
    { title: L.tDiets, category: "policies", content: dietLines.join("\n") },
    { title: L.tLocation, category: "general", content: locationLines.join("\n") },
  ];
}

/** Sensible defaults so the wizard never starts blank (client just edits). */
export function defaultQuestionnaire(): KbQuestionnaire {
  return {
    capacity_seats: 50,
    auto_confirm_max: 6,
    accepts_large_groups: true,
    late_tolerance_min: 15,
    last_lunch: "14:45",
    last_dinner: "21:30",
    deposit_required: false,
    high_chairs: true,
    pets: false,
    accessible: true,
    payments: ["cash", "card", "contactless"],
    wifi: true,
    parking_lot: false,
    terrace: true,
    takeaway: false,
    vegetarian: true,
    vegan: false,
    gluten_free: true,
    celiac_safe: false,
    lactose_free: false,
    allergen_info: true,
    address: "",
    parking_info: "public",
    public_transport: true,
    landmark: "",
  };
}
