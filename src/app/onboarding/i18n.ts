// UI strings for the whole onboarding wizard, switched from the top-right
// control — this is the wizard's own interface language, NOT the language(s)
// the assistant will speak.
//
// The `q4` block covers the step-4 questionnaire labels/placeholders the owner
// reads while filling it in. Note: the KB ARTICLES generated server-side
// (titles like "Política de reservas") stay in the assistant's language and are
// unrelated to these UI labels.

export const UI_LANGS = ["es", "it", "en", "de"] as const;
export type UiLang = (typeof UI_LANGS)[number];

// Step-4 questionnaire labels. `optPersons` formats the party-size dropdown
// ("6 personas" / "6 people" …); other dropdown values reuse chrome strings.
interface Q4Strings {
  cardReservations: string; cardServices: string; cardDiets: string; cardLocation: string; cardChef: string;
  // card 1
  capacity: string; autoConfirmUpTo: string; optPersons: (n: number) => string;
  largeGroups: string; deposit: string; lateTolerance: string; lateGrace: string;
  cancellationNotice: string; noShowRelease: string; lastLunch: string; lastDinner: string;
  cxNone: string; cxSameDay: string; cx2h: string; cx24h: string;
  nsNone: string;
  // card 2
  highChairs: string; kidsMenu: string; pets: string; accessible: string; wifi: string;
  ownParking: string; terrace: string; takeaway: string; takeawayWait: string;
  delivery: string; deliveryPlatform: string; celebrations: string; outsideCake: string;
  paymentMethods: string; payCash: string; payCard: string; payContactless: string;
  // card 3
  vegetarian: string; vegan: string; glutenFree: string; lactoseFree: string; celiac: string;
  allergensTitle: string; allergensHint: string; cannotGuarantee: string; severeAllergy: string; allergenSheet: string;
  alGluten: string; alDairy: string; alEgg: string; alNuts: string; alPeanuts: string; alFish: string; alShellfish: string; alSoy: string; alSesame: string;
  // card 4
  cuisineType: string; address: string; cityPostal: string; area: string; parking: string;
  publicTransport: string; landmark: string;
  pkOwn: string; pkPublic: string; pkStreet: string; pkNone: string;
  // card 5
  chefHint: string;
  optional: string; // suffix " (opcional)" used in several labels
}

interface UiStrings {
  uiLangLabel: string;
  title: string;
  subtitle: string;
  // step headers
  s1: string; s2: string; s3: string; s4: string; s5: string;
  s2hint: string; s3hint: string; s4hint: string;
  // step 1 fields
  fName: string; fPhone: string; fWhatsapp: string; fReview: string;
  fTimezone: string; fLanguages: string; fLanguagesHint: string;
  primary: string; makePrimaryHint: string;
  // step 2
  days: string[]; // Monday-first
  addSlot: string; closed: string; remove: string;
  // step 3
  tblSmall: string; tblSmallD: string;
  tblMedium: string; tblMediumD: string;
  tblLarge: string; tblLargeD: string;
  // step 4 questionnaire
  q4: Q4Strings;
  // step 4 / 5
  addDish: string;
  sumRestaurant: string; sumLanguages: string; sumTables: string;
  sumCapacity: string; sumAutoConfirm: string; sumPayments: string; sumFootnote: string;
  // nav + yes/no
  back: string; next: string; createCrm: string; yes: string; no: string;
  // provisioning screen
  creatingTitle: string; creatingDone: string; creatingFail: string; creatingBusy: string;
  inProgress: string; goToPanel: string; retry: string;
}

export const UI: Record<UiLang, UiStrings> = {
  es: {
    uiLangLabel: "Idioma de la interfaz",
    title: "Configura tu restaurante",
    subtitle: "5 pasos rápidos. Al terminar, tu asistente queda listo automáticamente.",
    s1: "Datos del restaurante", s2: "Horario de apertura", s3: "Mesas (distribución inicial)",
    s4: "Cuestionario", s5: "Resumen",
    s2hint: "Deja un día vacío si cierras. Varios tramos = comida + cena.",
    s3hint: "Elige el tamaño. Podrás mover/añadir/quitar mesas después desde el plano.",
    s4hint: "Responde estas preguntas: con ellas creamos automáticamente lo que el asistente necesita saber. No hay que escribir textos.",
    fName: "Nombre del restaurante", fPhone: "Teléfono público",
    fWhatsapp: "Tu WhatsApp (avisos al personal)", fReview: "Enlace de reseñas Google (opcional)",
    fTimezone: "Zona horaria", fLanguages: "Idiomas del asistente",
    fLanguagesHint: "Elige uno o varios. El primero (★) es el principal: define el saludo y la voz.",
    primary: "Principal", makePrimaryHint: "Marcar como principal",
    days: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
    addSlot: "+ tramo", closed: "Cerrado", remove: "quitar",
    tblSmall: "Pequeño (6)", tblSmallD: "<30 comensales",
    tblMedium: "Mediano (12)", tblMediumD: "30-60 comensales",
    tblLarge: "Grande (20)", tblLargeD: ">60 comensales",
    q4: {
      cardReservations: "Reservas y grupos", cardServices: "Servicios prácticos",
      cardDiets: "Dietas y alergias", cardLocation: "Cómo llegar", cardChef: "Platos recomendados (opcional)",
      capacity: "Aforo (plazas)", autoConfirmUpTo: "Confirmación automática hasta", optPersons: (n) => `${n} personas`,
      largeGroups: "¿Aceptáis grupos grandes (por encima de ese número)?", deposit: "¿Pedís depósito para grupos grandes?",
      lateTolerance: "Tolerancia de retraso", lateGrace: "¿Más margen si el cliente avisa con antelación?",
      cancellationNotice: "Aviso de cancelación", noShowRelease: "Liberar mesa por no-show tras",
      lastLunch: "Última reserva (comida)", lastDinner: "Última reserva (cena)",
      cxNone: "Sin aviso previo", cxSameDay: "El mismo día", cx2h: "2 h antes", cx24h: "24 h antes",
      nsNone: "No especificar",
      highChairs: "¿Tronas para niños?", kidsMenu: "¿Menú infantil?", pets: "¿Se admiten mascotas?",
      accessible: "¿Entrada accesible?", wifi: "¿WiFi para clientes?", ownParking: "¿Parking propio?",
      terrace: "¿Terraza?", takeaway: "¿Comida para llevar?", takeawayWait: "Tiempo de espera para llevar (opcional)",
      delivery: "¿Delivery (a domicilio)?", deliveryPlatform: "Plataforma de delivery (opcional)",
      celebrations: "¿Aceptáis celebraciones (cumpleaños, etc.)?", outsideCake: "¿Se puede traer tarta propia?",
      paymentMethods: "Métodos de pago", payCash: "Efectivo", payCard: "Tarjeta", payContactless: "Contactless",
      vegetarian: "¿Opciones vegetarianas?", vegan: "¿Opciones veganas?", glutenFree: "¿Opciones sin gluten?",
      lactoseFree: "¿Opciones sin lactosa?", celiac: "¿Protocolo para celíacos (preparación separada)?",
      allergensTitle: "Alérgenos presentes en cocina",
      allergensHint: "Marca los que se manipulan: el asistente avisará del riesgo de contaminación cruzada.",
      cannotGuarantee: "¿No podéis garantizar ausencia total de trazas?",
      severeAllergy: "¿Alergia severa → consultar cocina / responsable?",
      allergenSheet: "¿Hoja de alérgenos disponible bajo petición?",
      alGluten: "Gluten / trigo", alDairy: "Lácteos", alEgg: "Huevo", alNuts: "Frutos secos", alPeanuts: "Cacahuetes",
      alFish: "Pescado", alShellfish: "Marisco", alSoy: "Soja", alSesame: "Sésamo",
      cuisineType: "Tipo de cocina / concepto (opcional)", address: "Dirección",
      cityPostal: "Población / código postal (opcional)", area: "Zona / barrio (opcional)", parking: "Aparcamiento",
      publicTransport: "¿Bien comunicado en transporte público?", landmark: "Punto de referencia (opcional)",
      pkOwn: "Parking propio", pkPublic: "Parking público cercano", pkStreet: "En la calle", pkNone: "Sin aparcamiento",
      chefHint: "Añade hasta 6 platos que recomiendas, con una nota corta. El asistente los usará para responder «¿qué me recomiendas?». Déjalo vacío si prefieres remitir a la carta.",
      optional: " (opcional)",
    },
    addDish: "+ añadir plato",
    sumRestaurant: "Restaurante", sumLanguages: "Idiomas del asistente", sumTables: "Mesas iniciales",
    sumCapacity: "Aforo", sumAutoConfirm: "confirmación auto hasta", sumPayments: "Métodos de pago",
    sumFootnote: "Al pulsar Crear mi CRM configuramos todo automáticamente (~1 minuto).",
    back: "Atrás", next: "Siguiente", createCrm: "Crear mi CRM", yes: "Sí", no: "No",
    creatingTitle: "Estamos creando tu CRM…",
    creatingDone: "✅ ¡Listo! Te llevamos a tu panel.",
    creatingFail: "❌ Algo falló. Revisa los pasos y vuelve a intentar.",
    creatingBusy: "Configurando tu restaurante, la base de conocimiento y el asistente…",
    inProgress: "en curso…", goToPanel: "Ir a mi panel →", retry: "Reintentar",
  },
  it: {
    uiLangLabel: "Lingua dell'interfaccia",
    title: "Configura il tuo ristorante",
    subtitle: "5 passaggi rapidi. Al termine, il tuo assistente è pronto automaticamente.",
    s1: "Dati del ristorante", s2: "Orari di apertura", s3: "Tavoli (disposizione iniziale)",
    s4: "Questionario", s5: "Riepilogo",
    s2hint: "Lascia vuoto un giorno se chiudi. Più fasce = pranzo + cena.",
    s3hint: "Scegli la dimensione. Potrai spostare/aggiungere/togliere tavoli dopo dalla pianta.",
    s4hint: "Rispondi a queste domande: con esse creiamo automaticamente ciò che l'assistente deve sapere. Non devi scrivere testi.",
    fName: "Nome del ristorante", fPhone: "Telefono pubblico",
    fWhatsapp: "Il tuo WhatsApp (avvisi al personale)", fReview: "Link recensioni Google (opzionale)",
    fTimezone: "Fuso orario", fLanguages: "Lingue dell'assistente",
    fLanguagesHint: "Scegline una o più. La prima (★) è la principale: definisce il saluto e la voce.",
    primary: "Principale", makePrimaryHint: "Imposta come principale",
    days: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    addSlot: "+ fascia", closed: "Chiuso", remove: "rimuovi",
    tblSmall: "Piccolo (6)", tblSmallD: "<30 coperti",
    tblMedium: "Medio (12)", tblMediumD: "30-60 coperti",
    tblLarge: "Grande (20)", tblLargeD: ">60 coperti",
    q4: {
      cardReservations: "Prenotazioni e gruppi", cardServices: "Servizi pratici",
      cardDiets: "Diete e allergie", cardLocation: "Come arrivare", cardChef: "Piatti consigliati (opzionale)",
      capacity: "Capienza (coperti)", autoConfirmUpTo: "Conferma automatica fino a", optPersons: (n) => `${n} persone`,
      largeGroups: "Accettate gruppi numerosi (oltre quel numero)?", deposit: "Chiedete una caparra per i gruppi numerosi?",
      lateTolerance: "Tolleranza ritardo", lateGrace: "Più margine se il cliente avvisa in anticipo?",
      cancellationNotice: "Preavviso di cancellazione", noShowRelease: "Libera il tavolo per no-show dopo",
      lastLunch: "Ultima prenotazione (pranzo)", lastDinner: "Ultima prenotazione (cena)",
      cxNone: "Nessun preavviso", cxSameDay: "In giornata", cx2h: "2 h prima", cx24h: "24 h prima",
      nsNone: "Non specificare",
      highChairs: "Seggioloni per bambini?", kidsMenu: "Menù bambini?", pets: "Sono ammessi animali?",
      accessible: "Ingresso accessibile?", wifi: "WiFi per i clienti?", ownParking: "Parcheggio proprio?",
      terrace: "Terrazza?", takeaway: "Cibo da asporto?", takeawayWait: "Tempo di attesa per l'asporto (opzionale)",
      delivery: "Delivery (a domicilio)?", deliveryPlatform: "Piattaforma di delivery (opzionale)",
      celebrations: "Accettate celebrazioni (compleanni, ecc.)?", outsideCake: "Si può portare la propria torta?",
      paymentMethods: "Metodi di pagamento", payCash: "Contanti", payCard: "Carta", payContactless: "Contactless",
      vegetarian: "Opzioni vegetariane?", vegan: "Opzioni vegane?", glutenFree: "Opzioni senza glutine?",
      lactoseFree: "Opzioni senza lattosio?", celiac: "Protocollo per celiaci (preparazione separata)?",
      allergensTitle: "Allergeni presenti in cucina",
      allergensHint: "Seleziona quelli che vengono manipolati: l'assistente avviserà del rischio di contaminazione crociata.",
      cannotGuarantee: "Non potete garantire l'assenza totale di tracce?",
      severeAllergy: "Allergia grave → consultare cucina / responsabile?",
      allergenSheet: "Scheda allergeni disponibile su richiesta?",
      alGluten: "Glutine / frumento", alDairy: "Latticini", alEgg: "Uova", alNuts: "Frutta a guscio", alPeanuts: "Arachidi",
      alFish: "Pesce", alShellfish: "Crostacei", alSoy: "Soia", alSesame: "Sesamo",
      cuisineType: "Tipo di cucina / concept (opzionale)", address: "Indirizzo",
      cityPostal: "Città / CAP (opzionale)", area: "Zona / quartiere (opzionale)", parking: "Parcheggio",
      publicTransport: "Ben servito dai mezzi pubblici?", landmark: "Punto di riferimento (opzionale)",
      pkOwn: "Parcheggio proprio", pkPublic: "Parcheggio pubblico vicino", pkStreet: "Su strada", pkNone: "Nessun parcheggio",
      chefHint: "Aggiungi fino a 6 piatti che consigli, con una nota breve. L'assistente li userà per rispondere «cosa mi consigli?». Lascia vuoto se preferisci rimandare al menù.",
      optional: " (opzionale)",
    },
    addDish: "+ aggiungi piatto",
    sumRestaurant: "Ristorante", sumLanguages: "Lingue dell'assistente", sumTables: "Tavoli iniziali",
    sumCapacity: "Capienza", sumAutoConfirm: "conferma auto fino a", sumPayments: "Metodi di pagamento",
    sumFootnote: "Premendo Crea il mio CRM configuriamo tutto automaticamente (~1 minuto).",
    back: "Indietro", next: "Avanti", createCrm: "Crea il mio CRM", yes: "Sì", no: "No",
    creatingTitle: "Stiamo creando il tuo CRM…",
    creatingDone: "✅ Fatto! Ti portiamo al tuo pannello.",
    creatingFail: "❌ Qualcosa è andato storto. Controlla i passaggi e riprova.",
    creatingBusy: "Stiamo configurando il tuo ristorante, la base di conoscenza e l'assistente…",
    inProgress: "in corso…", goToPanel: "Vai al mio pannello →", retry: "Riprova",
  },
  en: {
    uiLangLabel: "Interface language",
    title: "Set up your restaurant",
    subtitle: "5 quick steps. When you finish, your assistant is ready automatically.",
    s1: "Restaurant details", s2: "Opening hours", s3: "Tables (initial layout)",
    s4: "Questionnaire", s5: "Summary",
    s2hint: "Leave a day empty if you're closed. Multiple slots = lunch + dinner.",
    s3hint: "Pick the size. You can move/add/remove tables later from the floor plan.",
    s4hint: "Answer these questions: from them we automatically build what the assistant needs to know. No writing required.",
    fName: "Restaurant name", fPhone: "Public phone",
    fWhatsapp: "Your WhatsApp (staff alerts)", fReview: "Google reviews link (optional)",
    fTimezone: "Time zone", fLanguages: "Assistant languages",
    fLanguagesHint: "Pick one or more. The first one (★) is primary: it sets the greeting and the voice.",
    primary: "Primary", makePrimaryHint: "Set as primary",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    addSlot: "+ slot", closed: "Closed", remove: "remove",
    tblSmall: "Small (6)", tblSmallD: "<30 covers",
    tblMedium: "Medium (12)", tblMediumD: "30-60 covers",
    tblLarge: "Large (20)", tblLargeD: ">60 covers",
    q4: {
      cardReservations: "Reservations and groups", cardServices: "Practical services",
      cardDiets: "Diets and allergies", cardLocation: "How to get there", cardChef: "Recommended dishes (optional)",
      capacity: "Capacity (seats)", autoConfirmUpTo: "Auto-confirm up to", optPersons: (n) => `${n} people`,
      largeGroups: "Do you accept large groups (above that number)?", deposit: "Do you ask for a deposit for large groups?",
      lateTolerance: "Late arrival tolerance", lateGrace: "More leeway if the guest lets you know in advance?",
      cancellationNotice: "Cancellation notice", noShowRelease: "Release the table for no-show after",
      lastLunch: "Last reservation (lunch)", lastDinner: "Last reservation (dinner)",
      cxNone: "No advance notice", cxSameDay: "Same day", cx2h: "2 h before", cx24h: "24 h before",
      nsNone: "Don't specify",
      highChairs: "High chairs for children?", kidsMenu: "Kids' menu?", pets: "Are pets allowed?",
      accessible: "Accessible entrance?", wifi: "WiFi for guests?", ownParking: "Private parking?",
      terrace: "Terrace?", takeaway: "Takeaway?", takeawayWait: "Takeaway wait time (optional)",
      delivery: "Delivery (to home)?", deliveryPlatform: "Delivery platform (optional)",
      celebrations: "Do you accept celebrations (birthdays, etc.)?", outsideCake: "Can guests bring their own cake?",
      paymentMethods: "Payment methods", payCash: "Cash", payCard: "Card", payContactless: "Contactless",
      vegetarian: "Vegetarian options?", vegan: "Vegan options?", glutenFree: "Gluten-free options?",
      lactoseFree: "Lactose-free options?", celiac: "Coeliac protocol (separate preparation)?",
      allergensTitle: "Allergens present in the kitchen",
      allergensHint: "Tick the ones you handle: the assistant will warn about the cross-contamination risk.",
      cannotGuarantee: "Can't you guarantee the total absence of traces?",
      severeAllergy: "Severe allergy → check with kitchen / manager?",
      allergenSheet: "Allergen sheet available on request?",
      alGluten: "Gluten / wheat", alDairy: "Dairy", alEgg: "Egg", alNuts: "Tree nuts", alPeanuts: "Peanuts",
      alFish: "Fish", alShellfish: "Shellfish", alSoy: "Soy", alSesame: "Sesame",
      cuisineType: "Cuisine type / concept (optional)", address: "Address",
      cityPostal: "City / postcode (optional)", area: "Area / neighbourhood (optional)", parking: "Parking",
      publicTransport: "Well connected by public transport?", landmark: "Landmark (optional)",
      pkOwn: "Private parking", pkPublic: "Public car park nearby", pkStreet: "On the street", pkNone: "No parking",
      chefHint: "Add up to 6 dishes you recommend, with a short note. The assistant will use them to answer “what do you recommend?”. Leave empty if you prefer to point to the menu.",
      optional: " (optional)",
    },
    addDish: "+ add dish",
    sumRestaurant: "Restaurant", sumLanguages: "Assistant languages", sumTables: "Initial tables",
    sumCapacity: "Capacity", sumAutoConfirm: "auto-confirm up to", sumPayments: "Payment methods",
    sumFootnote: "When you press Create my CRM we set everything up automatically (~1 minute).",
    back: "Back", next: "Next", createCrm: "Create my CRM", yes: "Yes", no: "No",
    creatingTitle: "We're creating your CRM…",
    creatingDone: "✅ Done! Taking you to your panel.",
    creatingFail: "❌ Something failed. Review the steps and try again.",
    creatingBusy: "Setting up your restaurant, the knowledge base and the assistant…",
    inProgress: "in progress…", goToPanel: "Go to my panel →", retry: "Retry",
  },
  de: {
    uiLangLabel: "Sprache der Oberfläche",
    title: "Richte dein Restaurant ein",
    subtitle: "5 schnelle Schritte. Am Ende ist dein Assistent automatisch bereit.",
    s1: "Restaurantdaten", s2: "Öffnungszeiten", s3: "Tische (anfängliche Anordnung)",
    s4: "Fragebogen", s5: "Zusammenfassung",
    s2hint: "Lass einen Tag leer, wenn geschlossen ist. Mehrere Zeitfenster = Mittag + Abend.",
    s3hint: "Wähle die Größe. Tische kannst du später im Plan verschieben/hinzufügen/entfernen.",
    s4hint: "Beantworte diese Fragen: daraus erstellen wir automatisch, was der Assistent wissen muss. Kein Text nötig.",
    fName: "Name des Restaurants", fPhone: "Öffentliche Telefonnummer",
    fWhatsapp: "Dein WhatsApp (Personal-Benachrichtigungen)", fReview: "Google-Bewertungslink (optional)",
    fTimezone: "Zeitzone", fLanguages: "Sprachen des Assistenten",
    fLanguagesHint: "Wähle eine oder mehrere. Die erste (★) ist die primäre: sie bestimmt Begrüßung und Stimme.",
    primary: "Primär", makePrimaryHint: "Als primär festlegen",
    days: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    addSlot: "+ Zeitfenster", closed: "Geschlossen", remove: "entfernen",
    tblSmall: "Klein (6)", tblSmallD: "<30 Gäste",
    tblMedium: "Mittel (12)", tblMediumD: "30-60 Gäste",
    tblLarge: "Groß (20)", tblLargeD: ">60 Gäste",
    q4: {
      cardReservations: "Reservierungen und Gruppen", cardServices: "Praktische Leistungen",
      cardDiets: "Diäten und Allergien", cardLocation: "Anfahrt", cardChef: "Empfohlene Gerichte (optional)",
      capacity: "Kapazität (Plätze)", autoConfirmUpTo: "Automatische Bestätigung bis", optPersons: (n) => `${n} Personen`,
      largeGroups: "Nehmt ihr große Gruppen an (über dieser Zahl)?", deposit: "Verlangt ihr eine Anzahlung für große Gruppen?",
      lateTolerance: "Verspätungstoleranz", lateGrace: "Mehr Spielraum, wenn der Gast vorher Bescheid gibt?",
      cancellationNotice: "Stornierungsfrist", noShowRelease: "Tisch bei No-Show freigeben nach",
      lastLunch: "Letzte Reservierung (Mittag)", lastDinner: "Letzte Reservierung (Abend)",
      cxNone: "Keine Vorankündigung", cxSameDay: "Am selben Tag", cx2h: "2 Std. vorher", cx24h: "24 Std. vorher",
      nsNone: "Nicht angeben",
      highChairs: "Hochstühle für Kinder?", kidsMenu: "Kindermenü?", pets: "Sind Haustiere erlaubt?",
      accessible: "Barrierefreier Eingang?", wifi: "WLAN für Gäste?", ownParking: "Eigener Parkplatz?",
      terrace: "Terrasse?", takeaway: "Essen zum Mitnehmen?", takeawayWait: "Wartezeit zum Mitnehmen (optional)",
      delivery: "Lieferung (nach Hause)?", deliveryPlatform: "Lieferplattform (optional)",
      celebrations: "Nehmt ihr Feiern an (Geburtstage usw.)?", outsideCake: "Darf eigene Torte mitgebracht werden?",
      paymentMethods: "Zahlungsarten", payCash: "Bargeld", payCard: "Karte", payContactless: "Kontaktlos",
      vegetarian: "Vegetarische Optionen?", vegan: "Vegane Optionen?", glutenFree: "Glutenfreie Optionen?",
      lactoseFree: "Laktosefreie Optionen?", celiac: "Zöliakie-Protokoll (separate Zubereitung)?",
      allergensTitle: "In der Küche vorhandene Allergene",
      allergensHint: "Markiere die, die verarbeitet werden: der Assistent warnt vor dem Risiko der Kreuzkontamination.",
      cannotGuarantee: "Könnt ihr die völlige Spurenfreiheit nicht garantieren?",
      severeAllergy: "Schwere Allergie → Küche / Leitung fragen?",
      allergenSheet: "Allergenliste auf Anfrage verfügbar?",
      alGluten: "Gluten / Weizen", alDairy: "Milchprodukte", alEgg: "Ei", alNuts: "Schalenfrüchte", alPeanuts: "Erdnüsse",
      alFish: "Fisch", alShellfish: "Schalentiere", alSoy: "Soja", alSesame: "Sesam",
      cuisineType: "Küchenart / Konzept (optional)", address: "Adresse",
      cityPostal: "Stadt / PLZ (optional)", area: "Gegend / Viertel (optional)", parking: "Parken",
      publicTransport: "Gut mit öffentlichen Verkehrsmitteln erreichbar?", landmark: "Orientierungspunkt (optional)",
      pkOwn: "Eigener Parkplatz", pkPublic: "Öffentlicher Parkplatz in der Nähe", pkStreet: "Auf der Straße", pkNone: "Kein Parkplatz",
      chefHint: "Füge bis zu 6 empfohlene Gerichte mit einer kurzen Notiz hinzu. Der Assistent nutzt sie, um auf „Was empfiehlst du?“ zu antworten. Leer lassen, wenn du lieber auf die Karte verweist.",
      optional: " (optional)",
    },
    addDish: "+ Gericht hinzufügen",
    sumRestaurant: "Restaurant", sumLanguages: "Sprachen des Assistenten", sumTables: "Anfangstische",
    sumCapacity: "Kapazität", sumAutoConfirm: "Auto-Bestätigung bis", sumPayments: "Zahlungsarten",
    sumFootnote: "Wenn du Mein CRM erstellen drückst, richten wir alles automatisch ein (~1 Minute).",
    back: "Zurück", next: "Weiter", createCrm: "Mein CRM erstellen", yes: "Ja", no: "Nein",
    creatingTitle: "Wir erstellen dein CRM…",
    creatingDone: "✅ Fertig! Wir bringen dich zu deinem Panel.",
    creatingFail: "❌ Etwas ist fehlgeschlagen. Überprüfe die Schritte und versuche es erneut.",
    creatingBusy: "Wir richten dein Restaurant, die Wissensdatenbank und den Assistenten ein…",
    inProgress: "läuft…", goToPanel: "Zu meinem Panel →", retry: "Erneut versuchen",
  },
};
