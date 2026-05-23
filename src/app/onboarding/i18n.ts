// UI strings for the onboarding wizard CHROME (titles, buttons, step headers,
// the language section). This is the wizard's own interface language, switched
// from the top-right control — NOT the language(s) the assistant will speak.
//
// Scope is deliberately the navigation/structure strings the owner sees on
// every step; the step-4 questionnaire field labels stay in Spanish because
// they map 1:1 to the Spanish KB categories generated server-side.

export const UI_LANGS = ["es", "it", "en", "de"] as const;
export type UiLang = (typeof UI_LANGS)[number];

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
