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
  optOther: string; personsUnit: string; // "Otro…" preset + the "personas" unit for the custom input
  largeGroups: string; deposit: string; lateTolerance: string; lateGrace: string;
  cancellationNotice: string; noShowRelease: string; lastLunch: string; lastDinner: string;
  cxNone: string; cxSameDay: string; cx2h: string; cx24h: string;
  nsNone: string;
  // Last-reservation dropdown: the owner picks how long before closing the last
  // booking is accepted. lrBeforeClose is the suffix appended to "30 min", "1 h"…
  lrAtClose: string; lrBeforeClose: string; lrNoService: string;
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
  // Inline ⓘ help bubbles for the non-obvious policy fields only. Plain-language
  // explanations the owner reads in THIS form; they answer "what does this field
  // actually do?" so the admin doesn't have to explain it by hand. Not every
  // field has one — obvious fields (name, wifi, terrace…) are intentionally left
  // without help.
  info: {
    autoConfirm: string; largeGroups: string; deposit: string; lateTolerance: string;
    lateGrace: string; cancellationNotice: string; noShowRelease: string; lastReservation: string;
    celiac: string; cannotGuarantee: string; severeAllergy: string; allergenSheet: string;
  };
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
  fCrmLang: string; fCrmLangHint: string;
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
  sumRestaurant: string; sumLanguages: string; sumCrmLang: string; sumTables: string;
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
    fCrmLang: "Idioma de tu panel (CRM)",
    fCrmLangHint: "El idioma en el que verás tu panel. Se fija ahora y no se puede cambiar después. Es independiente de los idiomas del asistente.",
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
      optOther: "Otro…", personsUnit: "personas",
      largeGroups: "¿Aceptáis grupos grandes (por encima de ese número)?", deposit: "¿Pedís depósito para grupos grandes?",
      lateTolerance: "Tolerancia de retraso", lateGrace: "¿Más margen si el cliente avisa con antelación?",
      cancellationNotice: "Aviso de cancelación", noShowRelease: "Liberar mesa por no-show tras",
      lastLunch: "Última reserva (comida)", lastDinner: "Última reserva (cena)",
      cxNone: "Sin aviso previo", cxSameDay: "El mismo día", cx2h: "2 h antes", cx24h: "24 h antes",
      nsNone: "No especificar",
      lrAtClose: "Hasta la hora de cierre", lrBeforeClose: "antes del cierre", lrNoService: "Sin este servicio",
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
      info: {
        autoConfirm: "Hasta cuántas personas el asistente confirma la reserva al instante, sin que tú tengas que aprobarla. Por encima de ese número, queda pendiente de tu OK.",
        largeGroups: "Si aceptáis mesas por encima del número de confirmación automática. Esas reservas no se confirman solas: te llegan para que las apruebes tú.",
        deposit: "Si para los grupos grandes pedís un anticipo o señal para confirmar. El asistente lo mencionará al gestionar esas reservas.",
        lateTolerance: "Cuántos minutos esperáis a un cliente que llega tarde antes de poder dar la mesa a otro.",
        lateGrace: "Si el cliente avisa de que llega tarde, ¿le guardáis la mesa más tiempo? El asistente será más flexible en ese caso.",
        cancellationNotice: "Con cuánta antelación debe avisar el cliente para cancelar sin problema. Sirve para que el asistente sepa cuándo una cancelación llega «a tiempo» o «tarde»; no bloquea nada por sí solo.",
        noShowRelease: "Si el cliente no aparece y no avisa, cuánto tiempo esperáis antes de liberar la mesa y darla a otro.",
        lastReservation: "Cuánto antes de la hora de cierre aceptáis la última reserva de ese servicio. El asistente lo calcula solo a partir del cierre de cada día (p. ej. cierre 22:30 + «1 h antes» = última reserva 21:30) y no ofrecerá horas posteriores.",
        celiac: "No es lo mismo que «sin gluten». Marca SÍ solo si preparáis el plato aparte, con utensilios y zona limpios, apto para un celíaco real.",
        cannotGuarantee: "Marca SÍ si en tu cocina no podéis asegurar la ausencia total de trazas. El asistente lo advertirá a quien pregunte por alergias.",
        severeAllergy: "Ante una alergia grave, ¿prefieres que el asistente no decida y lo derive a cocina o a un responsable? Marca SÍ para mayor seguridad.",
        allergenSheet: "Si tenéis la lista oficial de alérgenos para enseñar al cliente que la pida.",
      },
    },
    addDish: "+ añadir plato",
    sumRestaurant: "Restaurante", sumLanguages: "Idiomas del asistente", sumCrmLang: "Idioma del panel", sumTables: "Mesas iniciales",
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
    fCrmLang: "Lingua del tuo pannello (CRM)",
    fCrmLangHint: "La lingua in cui vedrai il tuo pannello. Si imposta ora e non si può cambiare dopo. È indipendente dalle lingue dell'assistente.",
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
      optOther: "Altro…", personsUnit: "persone",
      largeGroups: "Accettate gruppi numerosi (oltre quel numero)?", deposit: "Chiedete una caparra per i gruppi numerosi?",
      lateTolerance: "Tolleranza ritardo", lateGrace: "Più margine se il cliente avvisa in anticipo?",
      cancellationNotice: "Preavviso di cancellazione", noShowRelease: "Libera il tavolo per no-show dopo",
      lastLunch: "Ultima prenotazione (pranzo)", lastDinner: "Ultima prenotazione (cena)",
      cxNone: "Nessun preavviso", cxSameDay: "In giornata", cx2h: "2 h prima", cx24h: "24 h prima",
      nsNone: "Non specificare",
      lrAtClose: "Fino all'orario di chiusura", lrBeforeClose: "prima della chiusura", lrNoService: "Servizio non attivo",
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
      info: {
        autoConfirm: "Fino a quante persone l'assistente conferma la prenotazione subito, senza il tuo via libera. Oltre quel numero, resta in attesa della tua approvazione.",
        largeGroups: "Se accettate tavoli oltre il numero di conferma automatica. Quelle prenotazioni non si confermano da sole: arrivano a te per l'approvazione.",
        deposit: "Se per i gruppi numerosi chiedete un acconto o una caparra per confermare. L'assistente lo ricorderà gestendo quelle prenotazioni.",
        lateTolerance: "Quanti minuti aspettate un cliente in ritardo prima di poter dare il tavolo a qualcun altro.",
        lateGrace: "Se il cliente avvisa che farà tardi, gli tenete il tavolo più a lungo? In quel caso l'assistente sarà più flessibile.",
        cancellationNotice: "Con quanto anticipo il cliente deve avvisare per cancellare senza problemi. Serve all'assistente per capire quando una cancellazione è «in tempo» o «in ritardo»; da solo non blocca nulla.",
        noShowRelease: "Se il cliente non si presenta e non avvisa, quanto aspettate prima di liberare il tavolo e darlo ad altri.",
        lastReservation: "Quanto prima dell'orario di chiusura accettate l'ultima prenotazione di quel servizio. L'assistente la calcola da solo dalla chiusura di ogni giorno (es. chiusura 22:30 + «1 h prima» = ultima prenotazione 21:30) e non proporrà orari successivi.",
        celiac: "Non è come «senza glutine». Metti SÌ solo se preparate il piatto a parte, con utensili e zona puliti, adatto a un vero celiaco.",
        cannotGuarantee: "Metti SÌ se in cucina non potete garantire l'assenza totale di tracce. L'assistente avviserà chi chiede per allergie.",
        severeAllergy: "Davanti a un'allergia grave, preferisci che l'assistente non decida e passi la palla alla cucina o a un responsabile? Metti SÌ per maggiore sicurezza.",
        allergenSheet: "Se avete la lista ufficiale degli allergeni da mostrare al cliente che la chiede.",
      },
    },
    addDish: "+ aggiungi piatto",
    sumRestaurant: "Ristorante", sumLanguages: "Lingue dell'assistente", sumCrmLang: "Lingua del pannello", sumTables: "Tavoli iniziali",
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
    fCrmLang: "Your dashboard (CRM) language",
    fCrmLangHint: "The language your dashboard will be in. Set now and can't be changed later. Independent from the assistant languages.",
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
      optOther: "Other…", personsUnit: "people",
      largeGroups: "Do you accept large groups (above that number)?", deposit: "Do you ask for a deposit for large groups?",
      lateTolerance: "Late arrival tolerance", lateGrace: "More leeway if the guest lets you know in advance?",
      cancellationNotice: "Cancellation notice", noShowRelease: "Release the table for no-show after",
      lastLunch: "Last reservation (lunch)", lastDinner: "Last reservation (dinner)",
      cxNone: "No advance notice", cxSameDay: "Same day", cx2h: "2 h before", cx24h: "24 h before",
      nsNone: "Don't specify",
      lrAtClose: "Up to closing time", lrBeforeClose: "before closing", lrNoService: "No such service",
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
      info: {
        autoConfirm: "Up to how many people the assistant confirms a booking instantly, without your sign-off. Above that number, it waits for your OK.",
        largeGroups: "Whether you take tables above the auto-confirm number. Those bookings aren't confirmed automatically — they come to you to approve.",
        deposit: "Whether large groups must pay a deposit to confirm. The assistant will mention it when handling those bookings.",
        lateTolerance: "How many minutes you hold a table for a late guest before you can give it to someone else.",
        lateGrace: "If the guest warns you they'll be late, do you hold the table longer? The assistant will be more flexible in that case.",
        cancellationNotice: "How far in advance a guest must tell you to cancel without a problem. It lets the assistant know when a cancellation is “on time” or “late”; on its own it blocks nothing.",
        noShowRelease: "If a guest doesn't show up and didn't warn you, how long you wait before releasing the table to someone else.",
        lastReservation: "How long before closing you accept the last booking for that service. The assistant works the time out per day from each closing (e.g. closing 22:30 + “1 h before” = last booking 21:30) and won't offer times after it.",
        celiac: "Not the same as “gluten-free”. Tick YES only if you prepare the dish separately, with clean tools and area, safe for a real coeliac.",
        cannotGuarantee: "Tick YES if your kitchen can't guarantee the total absence of traces. The assistant will warn anyone asking about allergies.",
        severeAllergy: "For a severe allergy, would you rather the assistant not decide and hand it to the kitchen or a manager? Tick YES to be safe.",
        allergenSheet: "Whether you have the official allergen list to show a guest who asks for it.",
      },
    },
    addDish: "+ add dish",
    sumRestaurant: "Restaurant", sumLanguages: "Assistant languages", sumCrmLang: "Dashboard language", sumTables: "Initial tables",
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
    fCrmLang: "Sprache deines Dashboards (CRM)",
    fCrmLangHint: "Die Sprache deines Dashboards. Wird jetzt festgelegt und kann später nicht geändert werden. Unabhängig von den Sprachen des Assistenten.",
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
      optOther: "Andere…", personsUnit: "Personen",
      largeGroups: "Nehmt ihr große Gruppen an (über dieser Zahl)?", deposit: "Verlangt ihr eine Anzahlung für große Gruppen?",
      lateTolerance: "Verspätungstoleranz", lateGrace: "Mehr Spielraum, wenn der Gast vorher Bescheid gibt?",
      cancellationNotice: "Stornierungsfrist", noShowRelease: "Tisch bei No-Show freigeben nach",
      lastLunch: "Letzte Reservierung (Mittag)", lastDinner: "Letzte Reservierung (Abend)",
      cxNone: "Keine Vorankündigung", cxSameDay: "Am selben Tag", cx2h: "2 Std. vorher", cx24h: "24 Std. vorher",
      nsNone: "Nicht angeben",
      lrAtClose: "Bis zur Schließzeit", lrBeforeClose: "vor Schließung", lrNoService: "Kein solcher Service",
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
      info: {
        autoConfirm: "Bis zu wie vielen Personen der Assistent eine Reservierung sofort bestätigt, ohne deine Freigabe. Darüber wartet er auf dein OK.",
        largeGroups: "Ob ihr Tische über der Auto-Bestätigungszahl annehmt. Diese Reservierungen werden nicht automatisch bestätigt — sie kommen zu dir zur Freigabe.",
        deposit: "Ob große Gruppen eine Anzahlung zur Bestätigung leisten müssen. Der Assistent erwähnt das bei der Bearbeitung dieser Reservierungen.",
        lateTolerance: "Wie viele Minuten ihr einen verspäteten Gast haltet, bevor ihr den Tisch anderweitig vergeben könnt.",
        lateGrace: "Wenn der Gast Bescheid gibt, dass er später kommt, haltet ihr den Tisch länger? Der Assistent ist dann flexibler.",
        cancellationNotice: "Wie früh ein Gast Bescheid geben muss, um problemlos zu stornieren. So weiß der Assistent, wann eine Stornierung „rechtzeitig“ oder „spät“ ist; allein blockiert sie nichts.",
        noShowRelease: "Wenn ein Gast nicht erscheint und nicht Bescheid gibt, wie lange ihr wartet, bevor ihr den Tisch freigebt.",
        lastReservation: "Wie lange vor Schließung ihr die letzte Reservierung für diesen Service annehmt. Der Assistent berechnet die Zeit pro Tag aus der jeweiligen Schließzeit (z. B. Schließung 22:30 + „1 Std. vorher“ = letzte Reservierung 21:30) und bietet keine späteren Zeiten an.",
        celiac: "Nicht dasselbe wie „glutenfrei“. Wähle JA nur, wenn ihr das Gericht separat zubereitet, mit sauberem Werkzeug und Bereich, sicher für einen echten Zöliakie-Betroffenen.",
        cannotGuarantee: "Wähle JA, wenn eure Küche die völlige Spurenfreiheit nicht garantieren kann. Der Assistent warnt jeden, der nach Allergien fragt.",
        severeAllergy: "Soll der Assistent bei einer schweren Allergie lieber nicht entscheiden und an die Küche oder Leitung übergeben? Wähle JA für mehr Sicherheit.",
        allergenSheet: "Ob ihr die offizielle Allergenliste habt, um sie einem Gast auf Anfrage zu zeigen.",
      },
    },
    addDish: "+ Gericht hinzufügen",
    sumRestaurant: "Restaurant", sumLanguages: "Sprachen des Assistenten", sumCrmLang: "Dashboard-Sprache", sumTables: "Anfangstische",
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
