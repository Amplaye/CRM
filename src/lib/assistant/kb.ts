// Knowledge base of the built-in CRM assistant ("Aiuto" bubble in the dashboard).
// 100% local and free: no LLM, no external API — a curated topic list matched
// by keywords in src/lib/assistant/engine.ts. Content is written per-language
// here (NOT in the i18n dictionaries) so a topic stays one self-contained unit.

export type AssistantLang = "en" | "it" | "es" | "de";
export type L10n = Record<AssistantLang, string>;

export interface KbLink {
  href: string;
  label: L10n;
}

export interface KbTopic {
  id: string;
  title: L10n;
  /** Matching material, all languages mixed; multi-word entries match as phrases. */
  keywords: string[];
  answer: L10n;
  steps?: Record<AssistantLang, string[]>;
  links?: KbLink[];
  related?: string[];
}

// ---------------------------------------------------------------- UI strings
export const UI: Record<
  AssistantLang,
  {
    title: string;
    placeholder: string;
    welcome: string;
    suggestionsLabel: string;
    relatedLabel: string;
    clear: string;
    openLabel: string;
  }
> = {
  it: {
    title: "Assistente",
    placeholder: "Chiedimi qualsiasi cosa… (es. come apro la cassa?)",
    welcome:
      "Ciao, sono il tuo assistente, come posso aiutarti oggi? 👋 Posso spiegarti ogni sezione del CRM e fare le cose al posto tuo: creare o cancellare prenotazioni, farti il recap della giornata, dirti l'incasso, aprire o chiudere la cassa. Ecco alcuni argomenti:",
    suggestionsLabel: "Argomenti utili",
    relatedLabel: "Vedi anche",
    clear: "Nuova conversazione",
    openLabel: "Apri l'assistente",
  },
  en: {
    title: "Assistant",
    placeholder: "Ask me anything… (e.g. how do I open the till?)",
    welcome:
      "Hi, I'm your assistant — how can I help you today? 👋 I can explain every section of the CRM and do things for you: create or cancel reservations, recap your day, tell you today's takings, open or close the till. Some useful topics:",
    suggestionsLabel: "Useful topics",
    relatedLabel: "See also",
    clear: "New conversation",
    openLabel: "Open the assistant",
  },
  es: {
    title: "Asistente",
    placeholder: "Pregúntame lo que sea… (ej. ¿cómo abro la caja?)",
    welcome:
      "Hola, soy tu asistente, ¿en qué puedo ayudarte hoy? 👋 Puedo explicarte cada sección del CRM y hacer cosas por ti: crear o cancelar reservas, hacerte el resumen del día, decirte la recaudación, abrir o cerrar la caja. Algunos temas útiles:",
    suggestionsLabel: "Temas útiles",
    relatedLabel: "Ver también",
    clear: "Nueva conversación",
    openLabel: "Abrir el asistente",
  },
  de: {
    title: "Assistent",
    placeholder: "Frag mich alles… (z. B. wie öffne ich die Kasse?)",
    welcome:
      "Hallo, ich bin dein Assistent — wie kann ich dir heute helfen? 👋 Ich kann dir jeden Bereich des CRM erklären und Dinge für dich erledigen: Reservierungen anlegen oder stornieren, den Tag zusammenfassen, dir den Umsatz nennen, die Kasse öffnen oder schließen. Nützliche Themen:",
    suggestionsLabel: "Nützliche Themen",
    relatedLabel: "Siehe auch",
    clear: "Neues Gespräch",
    openLabel: "Assistent öffnen",
  },
};

export const SMALLTALK: Record<
  "greeting" | "thanks" | "bye",
  { triggers: string[]; reply: L10n }
> = {
  greeting: {
    triggers: ["ciao", "salve", "buongiorno", "buonasera", "hello", "hi", "hey", "hola", "buenas", "hallo", "servus", "moin"],
    reply: {
      it: "Ciao! 👋 Dimmi pure: come posso aiutarti con il CRM?",
      en: "Hi! 👋 Tell me — how can I help you with the CRM?",
      es: "¡Hola! 👋 Dime, ¿en qué te ayudo con el CRM?",
      de: "Hallo! 👋 Sag mir — wie kann ich dir mit dem CRM helfen?",
    },
  },
  thanks: {
    triggers: ["grazie", "thanks", "thank you", "gracias", "danke", "merci"],
    reply: {
      it: "Di niente! Se ti serve altro sono qui. 😊",
      en: "You're welcome! I'm here if you need anything else. 😊",
      es: "¡De nada! Aquí estoy si necesitas algo más. 😊",
      de: "Gern geschehen! Ich bin da, wenn du noch etwas brauchst. 😊",
    },
  },
  bye: {
    triggers: ["arrivederci", "a dopo", "bye", "goodbye", "adios", "adiós", "tschuss", "tschüss", "ciao ciao"],
    reply: {
      it: "A presto! Buon servizio! 🍽️",
      en: "See you soon! Have a great service! 🍽️",
      es: "¡Hasta pronto! ¡Buen servicio! 🍽️",
      de: "Bis bald! Guten Service! 🍽️",
    },
  },
};

export const FALLBACK: L10n = {
  it: "Non ho trovato una risposta precisa. 🤔 Prova con altre parole (es. «come aggiungo un piatto», «chiudere la cassa») oppure scegli un argomento:",
  en: "I couldn't find an exact answer. 🤔 Try other words (e.g. “how do I add a dish”, “close the till”) or pick a topic:",
  es: "No encontré una respuesta exacta. 🤔 Prueba con otras palabras (ej. «cómo añado un plato», «cerrar la caja») o elige un tema:",
  de: "Ich habe keine genaue Antwort gefunden. 🤔 Versuch andere Wörter (z. B. „Gericht hinzufügen“, „Kasse schließen“) oder wähle ein Thema:",
};

// ------------------------------------------------------------------- topics
export const KB: KbTopic[] = [
  {
    id: "overview",
    title: {
      it: "Panoramica del CRM",
      en: "CRM overview",
      es: "Visión general del CRM",
      de: "CRM-Überblick",
    },
    keywords: [
      "panoramica", "overview", "cosa fa", "come funziona il crm", "iniziare", "getting started", "empezar", "einstieg", "guida", "guide", "tutorial", "aiuto generale", "sezioni",
    ],
    answer: {
      it: "Il CRM riunisce tutto il ristorante: Prenotazioni (con conferme automatiche via WhatsApp), Clienti, Menu digitale, Sala e tavoli, Cassa (POS), Gestionale (Inventario, Food Cost, Conto Economico), Statistiche, Chat coi clienti e Impostazioni. Ogni sezione è nel menu laterale a sinistra.",
      en: "The CRM brings the whole restaurant together: Reservations (with automatic WhatsApp confirmations), Guests, digital Menu, Floor & tables, Till (POS), Management (Inventory, Food Cost, P&L), Analytics, customer Chat and Settings. Each section lives in the left sidebar.",
      es: "El CRM reúne todo el restaurante: Reservas (con confirmaciones automáticas por WhatsApp), Clientes, Menú digital, Sala y mesas, Caja (POS), Gestión (Inventario, Food Cost, Cuenta de resultados), Estadísticas, Chat con clientes y Ajustes. Cada sección está en el menú lateral izquierdo.",
      de: "Das CRM vereint das ganze Restaurant: Reservierungen (mit automatischen WhatsApp-Bestätigungen), Gäste, digitale Speisekarte, Saal & Tische, Kasse (POS), Verwaltung (Inventar, Food Cost, GuV), Statistiken, Gäste-Chat und Einstellungen. Jeder Bereich ist in der linken Seitenleiste.",
    },
    links: [
      { href: "/", label: { it: "Vai alla dashboard", en: "Go to the dashboard", es: "Ir al panel", de: "Zum Dashboard" } },
    ],
    related: ["reservations", "cassa-orders", "menu-manage", "whatsapp-connect"],
  },
  {
    id: "reservations",
    title: {
      it: "Prenotazioni: creare, modificare, cancellare",
      en: "Reservations: create, edit, cancel",
      es: "Reservas: crear, editar, cancelar",
      de: "Reservierungen: anlegen, ändern, stornieren",
    },
    keywords: [
      "prenotazione", "prenotazioni", "reservation", "booking", "reserva", "reservas", "reservierung", "tavolo prenotato", "book a table", "cancellare prenotazione", "no show", "turno", "shift",
    ],
    answer: {
      it: "Nella pagina Prenotazioni vedi la giornata a colpo d'occhio. Le prenotazioni arrivano da WhatsApp/telefono (bot) o le inserisci tu a mano; puoi cambiarne stato (confermata, seduta, conclusa, no-show), spostarle di tavolo o cancellarle.",
      en: "The Reservations page shows the day at a glance. Bookings arrive via WhatsApp/phone (bot) or you add them manually; you can change status (confirmed, seated, finished, no-show), move tables or cancel.",
      es: "La página Reservas muestra el día de un vistazo. Las reservas llegan por WhatsApp/teléfono (bot) o las añades a mano; puedes cambiar el estado (confirmada, sentada, terminada, no-show), mover de mesa o cancelar.",
      de: "Die Seite Reservierungen zeigt den Tag auf einen Blick. Reservierungen kommen per WhatsApp/Telefon (Bot) oder du legst sie manuell an; du kannst den Status ändern (bestätigt, sitzt, beendet, No-Show), Tische wechseln oder stornieren.",
    },
    steps: {
      it: ["Apri Prenotazioni dal menu laterale", "Premi il pulsante per una nuova prenotazione e compila data, ora, coperti e nome", "Tocca una prenotazione esistente per modificarla, spostarla o cancellarla"],
      en: ["Open Reservations from the sidebar", "Press the new-reservation button and fill date, time, covers and name", "Tap an existing booking to edit, move or cancel it"],
      es: ["Abre Reservas en el menú lateral", "Pulsa el botón de nueva reserva y rellena fecha, hora, comensales y nombre", "Toca una reserva existente para editarla, moverla o cancelarla"],
      de: ["Öffne Reservierungen in der Seitenleiste", "Drücke den Button für eine neue Reservierung und fülle Datum, Zeit, Personen und Name aus", "Tippe auf eine bestehende Reservierung, um sie zu ändern, zu verschieben oder zu stornieren"],
    },
    links: [{ href: "/reservations", label: { it: "Apri Prenotazioni", en: "Open Reservations", es: "Abrir Reservas", de: "Reservierungen öffnen" } }],
    related: ["pending", "waitlist", "floor"],
  },
  {
    id: "pending",
    title: {
      it: "Richieste in sospeso (da confermare)",
      en: "Pending requests (to confirm)",
      es: "Solicitudes pendientes (por confirmar)",
      de: "Offene Anfragen (zu bestätigen)",
    },
    keywords: ["in sospeso", "pending", "da confermare", "richieste", "confirm request", "pendiente", "pendientes", "ausstehend", "bestatigen", "approvare prenotazione"],
    answer: {
      it: "In Sospeso trovi le richieste di prenotazione che il bot non ha potuto confermare da solo (es. troppi coperti, fuori orario, tavoli pieni). Tu decidi: confermi, proponi un'alternativa o rifiuti — il cliente riceve la risposta su WhatsApp.",
      en: "Pending holds booking requests the bot could not auto-confirm (e.g. too many covers, off-hours, full room). You decide: confirm, propose an alternative or decline — the guest gets the reply on WhatsApp.",
      es: "En Pendientes están las solicitudes que el bot no pudo confirmar solo (ej. demasiados comensales, fuera de horario, sala llena). Tú decides: confirmar, proponer una alternativa o rechazar — el cliente recibe la respuesta por WhatsApp.",
      de: "Unter Ausstehend liegen Anfragen, die der Bot nicht allein bestätigen konnte (z. B. zu viele Personen, außerhalb der Zeiten, voll). Du entscheidest: bestätigen, Alternative vorschlagen oder ablehnen — der Gast bekommt die Antwort per WhatsApp.",
    },
    links: [{ href: "/pending", label: { it: "Apri In sospeso", en: "Open Pending", es: "Abrir Pendientes", de: "Ausstehend öffnen" } }],
    related: ["reservations", "waitlist", "conversations"],
  },
  {
    id: "waitlist",
    title: {
      it: "Lista d'attesa",
      en: "Waitlist",
      es: "Lista de espera",
      de: "Warteliste",
    },
    keywords: ["lista d'attesa", "lista attesa", "waitlist", "waiting list", "lista de espera", "warteliste", "attesa tavolo"],
    answer: {
      it: "Quando il locale è pieno, i clienti finiscono in Lista d'attesa. Appena si libera un tavolo puoi promuoverli a prenotazione: il cliente viene avvisato automaticamente su WhatsApp.",
      en: "When the restaurant is full, guests go on the Waitlist. As soon as a table frees up you can promote them to a booking: the guest is notified automatically on WhatsApp.",
      es: "Cuando el local está lleno, los clientes pasan a la Lista de espera. En cuanto se libera una mesa puedes convertirlos en reserva: el cliente recibe aviso automático por WhatsApp.",
      de: "Ist das Lokal voll, kommen Gäste auf die Warteliste. Sobald ein Tisch frei wird, kannst du sie zur Reservierung machen: der Gast wird automatisch per WhatsApp benachrichtigt.",
    },
    links: [{ href: "/waitlist", label: { it: "Apri Lista d'attesa", en: "Open Waitlist", es: "Abrir Lista de espera", de: "Warteliste öffnen" } }],
    related: ["reservations", "pending"],
  },
  {
    id: "floor",
    title: {
      it: "Sala e tavoli: aggiungere, modificare, zone",
      en: "Floor & tables: add, edit, zones",
      es: "Sala y mesas: añadir, editar, zonas",
      de: "Saal & Tische: hinzufügen, ändern, Zonen",
    },
    keywords: [
      "sala", "tavolo", "tavoli", "aggiungere tavolo", "floor", "table", "tables", "mesa", "mesas", "tisch", "tische", "mappa sala", "posti", "seats", "zona", "zone", "pianta",
    ],
    answer: {
      it: "Nella pagina Sala disegni la mappa del locale: aggiungi tavoli, imposti posti e forma, li raggruppi in zone (es. dehors, sala interna). Gli stessi tavoli vengono usati dalle prenotazioni e dalla cassa.",
      en: "On the Floor page you draw your room map: add tables, set seats and shape, group them into zones (e.g. terrace, main room). The same tables are used by reservations and by the till.",
      es: "En la página Sala dibujas el plano del local: añades mesas, defines plazas y forma, y las agrupas en zonas (ej. terraza, sala interior). Las mismas mesas se usan en reservas y en la caja.",
      de: "Auf der Seite Saal zeichnest du den Raumplan: Tische hinzufügen, Plätze und Form festlegen, in Zonen gruppieren (z. B. Terrasse, Innenraum). Dieselben Tische nutzen Reservierungen und Kasse.",
    },
    steps: {
      it: ["Apri Sala dal menu laterale", "Aggiungi un tavolo e trascinalo dove vuoi sulla mappa", "Imposta nome, numero di posti e zona", "Salva: il tavolo appare subito anche in Cassa e Prenotazioni"],
      en: ["Open Floor from the sidebar", "Add a table and drag it anywhere on the map", "Set name, seats and zone", "Save: the table immediately appears in the Till and Reservations too"],
      es: ["Abre Sala en el menú lateral", "Añade una mesa y arrástrala en el plano", "Define nombre, plazas y zona", "Guarda: la mesa aparece al momento también en Caja y Reservas"],
      de: ["Öffne Saal in der Seitenleiste", "Füge einen Tisch hinzu und ziehe ihn auf dem Plan", "Lege Name, Plätze und Zone fest", "Speichern: der Tisch erscheint sofort auch in Kasse und Reservierungen"],
    },
    links: [{ href: "/floor", label: { it: "Apri Sala", en: "Open Floor", es: "Abrir Sala", de: "Saal öffnen" } }],
    related: ["reservations", "cassa-orders"],
  },
  {
    id: "guests",
    title: {
      it: "Clienti: schede, storico e note",
      en: "Guests: profiles, history and notes",
      es: "Clientes: fichas, historial y notas",
      de: "Gäste: Profile, Historie und Notizen",
    },
    keywords: ["cliente", "clienti", "guest", "guests", "customers", "schede clienti", "storico cliente", "gast", "gaste", "kunden", "allergie cliente", "note cliente", "telefono cliente"],
    answer: {
      it: "In Clienti trovi la scheda di ogni ospite: contatti, storico prenotazioni, preferenze, allergie e note. Le schede si creano da sole quando un cliente prenota; puoi anche aggiungerle o modificarle a mano.",
      en: "Guests holds a profile for every guest: contacts, booking history, preferences, allergies and notes. Profiles are created automatically when a guest books; you can also add or edit them manually.",
      es: "En Clientes está la ficha de cada comensal: contactos, historial de reservas, preferencias, alergias y notas. Las fichas se crean solas cuando alguien reserva; también puedes añadirlas o editarlas a mano.",
      de: "Unter Gäste liegt das Profil jedes Gasts: Kontakte, Reservierungshistorie, Vorlieben, Allergien und Notizen. Profile entstehen automatisch bei einer Reservierung; du kannst sie auch manuell anlegen oder ändern.",
    },
    links: [{ href: "/guests", label: { it: "Apri Clienti", en: "Open Guests", es: "Abrir Clientes", de: "Gäste öffnen" } }],
    related: ["reservations", "conversations"],
  },
  {
    id: "menu-manage",
    title: {
      it: "Menu: aggiungere e togliere piatti",
      en: "Menu: add and remove dishes",
      es: "Menú: añadir y quitar platos",
      de: "Speisekarte: Gerichte hinzufügen und entfernen",
    },
    keywords: [
      "menu", "piatto", "piatti", "aggiungere piatto", "rimuovere piatto", "categoria", "categorie", "dish", "dishes", "add dish", "remove dish", "plato", "platos", "anadir plato", "gericht", "gerichte", "speisekarte", "prezzo piatto", "price", "foto piatto", "allergeni", "allergens", "disponibile", "esaurito",
    ],
    answer: {
      it: "Nella pagina Menu gestisci categorie e piatti: nome, prezzo, descrizione, foto, allergeni e disponibilità. Un piatto segnato non disponibile sparisce dal menu digitale e dalla cassa. Puoi anche importare un menu esistente da file o foto.",
      en: "On the Menu page you manage categories and dishes: name, price, description, photo, allergens and availability. A dish marked unavailable disappears from the digital menu and the till. You can also import an existing menu from a file or photo.",
      es: "En la página Menú gestionas categorías y platos: nombre, precio, descripción, foto, alérgenos y disponibilidad. Un plato marcado como no disponible desaparece del menú digital y de la caja. También puedes importar un menú existente desde archivo o foto.",
      de: "Auf der Seite Speisekarte verwaltest du Kategorien und Gerichte: Name, Preis, Beschreibung, Foto, Allergene und Verfügbarkeit. Ein als nicht verfügbar markiertes Gericht verschwindet aus digitaler Karte und Kasse. Du kannst auch eine bestehende Karte aus Datei oder Foto importieren.",
    },
    steps: {
      it: ["Apri Menu dal menu laterale", "Crea prima la categoria (es. Antipasti), poi «Aggiungi piatto»", "Compila nome e prezzo (foto e allergeni sono facoltativi)", "Per toglierlo: aprilo e usa elimina, oppure spegni «disponibile» per nasconderlo temporaneamente"],
      en: ["Open Menu from the sidebar", "Create the category first (e.g. Starters), then “Add dish”", "Fill name and price (photo and allergens are optional)", "To remove it: open it and delete, or switch off “available” to hide it temporarily"],
      es: ["Abre Menú en el menú lateral", "Crea primero la categoría (ej. Entrantes) y luego «Añadir plato»", "Rellena nombre y precio (foto y alérgenos son opcionales)", "Para quitarlo: ábrelo y elimínalo, o apaga «disponible» para ocultarlo temporalmente"],
      de: ["Öffne Speisekarte in der Seitenleiste", "Lege zuerst die Kategorie an (z. B. Vorspeisen), dann „Gericht hinzufügen“", "Fülle Name und Preis aus (Foto und Allergene optional)", "Zum Entfernen: öffnen und löschen, oder „verfügbar“ ausschalten, um es vorübergehend zu verbergen"],
    },
    links: [{ href: "/menu", label: { it: "Apri Menu", en: "Open Menu", es: "Abrir Menú", de: "Speisekarte öffnen" } }],
    related: ["menu-variants", "menu-digital", "food-cost"],
  },
  {
    id: "menu-variants",
    title: {
      it: "Varianti, IVA e reparto comanda dei piatti",
      en: "Dish variants, VAT and prep station",
      es: "Variantes, IVA y estación de comanda",
      de: "Varianten, MwSt. und Bon-Station",
    },
    keywords: ["variante", "varianti", "variant", "variants", "iva piatto", "vat", "aliquota", "reparto", "station", "cucina o bar", "doppia porzione", "aggiunta", "extra", "supplemento", "estacion", "zuschlag", "gang station"],
    answer: {
      it: "Su ogni piatto puoi impostare: le varianti (es. doppia porzione, aggiunta) con prezzo ±, l'aliquota IVA usata dalla cassa per lo scontrino, e il reparto comanda (cucina, bar, pizzeria) così ogni comanda si stampa nel reparto giusto.",
      en: "On each dish you can set: variants (e.g. double portion, extra topping) with a ± price, the VAT rate the till uses on receipts, and the prep station (kitchen, bar, pizzeria) so each order prints at the right station.",
      es: "En cada plato puedes definir: variantes (ej. ración doble, extra) con precio ±, el tipo de IVA que la caja usa en el ticket, y la estación de comanda (cocina, barra, pizzería) para que cada comanda se imprima donde toca.",
      de: "Bei jedem Gericht kannst du festlegen: Varianten (z. B. doppelte Portion, Extra) mit ±-Preis, den MwSt.-Satz für den Bon und die Bon-Station (Küche, Bar, Pizzeria), damit jeder Bon an der richtigen Station gedruckt wird.",
    },
    links: [{ href: "/menu", label: { it: "Apri Menu", en: "Open Menu", es: "Abrir Menú", de: "Speisekarte öffnen" } }],
    related: ["menu-manage", "cassa-orders"],
  },
  {
    id: "menu-digital",
    title: {
      it: "Menu digitale e QR code",
      en: "Digital menu & QR code",
      es: "Menú digital y código QR",
      de: "Digitale Speisekarte & QR-Code",
    },
    keywords: ["menu digitale", "qr", "qr code", "codice qr", "link menu", "menu online", "digital menu", "menu publico", "menu link", "carta digital", "online karte"],
    answer: {
      it: "Il tuo menu ha una pagina pubblica con link e QR code da mettere sui tavoli: i clienti la aprono dal telefono, senza app. Si aggiorna da sola ogni volta che modifichi il menu nel CRM.",
      en: "Your menu has a public page with a link and QR code to put on tables: guests open it on their phone, no app needed. It updates automatically whenever you edit the menu in the CRM.",
      es: "Tu menú tiene una página pública con enlace y código QR para poner en las mesas: los clientes la abren desde el móvil, sin app. Se actualiza sola cada vez que editas el menú en el CRM.",
      de: "Deine Speisekarte hat eine öffentliche Seite mit Link und QR-Code für die Tische: Gäste öffnen sie am Handy, ohne App. Sie aktualisiert sich automatisch, sobald du die Karte im CRM änderst.",
    },
    links: [{ href: "/menu", label: { it: "Apri Menu (link e QR)", en: "Open Menu (link & QR)", es: "Abrir Menú (enlace y QR)", de: "Speisekarte öffnen (Link & QR)" } }],
    related: ["menu-manage"],
  },
  {
    id: "cassa-open-close",
    title: {
      it: "Cassa: aprire e chiudere la giornata",
      en: "Till: open and close the day",
      es: "Caja: abrir y cerrar la jornada",
      de: "Kasse: Tag öffnen und schließen",
    },
    keywords: [
      "aprire cassa", "apro la cassa", "chiudere cassa", "chiusura cassa", "fondo cassa", "giornata di cassa", "open till", "close till", "cash day", "float", "abrir caja", "cerrar caja", "fondo de caja", "kasse offnen", "kasse schliessen", "wechselgeld", "quadratura", "contanti attesi", "cassa aperta", "cassa chiusa",
    ],
    answer: {
      it: "La giornata di cassa si apre indicando il fondo (i contanti già nel cassetto) e si chiude a fine servizio contando il cassetto: il CRM confronta contanti attesi e contati e ti mostra subito se la cassa quadra. Il badge in alto (verde = aperta, rosso = chiusa) ti porta alla scheda Giornata; se provi a ordinare o incassare a cassa chiusa, ti chiede lui di aprirla.",
      en: "You open the cash day by entering the float (cash already in the drawer) and close it after service by counting the drawer: the CRM compares expected vs counted cash and instantly shows whether the drawer balances. The badge at the top (green = open, red = closed) takes you to the Day tab; if you try to order or charge with the till closed, it asks you to open it.",
      es: "La jornada se abre indicando el fondo (efectivo ya en el cajón) y se cierra al final contando el cajón: el CRM compara efectivo esperado y contado y te muestra al momento si la caja cuadra. La insignia de arriba (verde = abierta, roja = cerrada) te lleva a la pestaña Jornada; si intentas pedir o cobrar con la caja cerrada, te pedirá abrirla.",
      de: "Den Kassentag öffnest du mit dem Wechselgeld (Bargeld in der Schublade) und schließt ihn nach dem Service durch Zählen der Schublade: das CRM vergleicht erwartetes und gezähltes Bargeld und zeigt sofort, ob die Kasse stimmt. Das Badge oben (grün = offen, rot = geschlossen) führt zum Tab Kassentag; versuchst du bei geschlossener Kasse zu bonieren oder zu kassieren, wirst du zum Öffnen aufgefordert.",
    },
    steps: {
      it: ["Apri Cassa → scheda «Giornata»", "Inserisci il fondo cassa e premi «Apri cassa»", "A fine servizio conta i contanti nel cassetto e scrivili in «Contanti contati»", "Controlla il badge (verde = quadrata) e premi «Chiudi cassa»"],
      en: ["Open Till → “Day” tab", "Enter the float and press “Open till”", "After service, count the drawer and type it into “Counted cash”", "Check the badge (green = balanced) and press “Close till”"],
      es: ["Abre Caja → pestaña «Jornada»", "Introduce el fondo y pulsa «Abrir caja»", "Al final del servicio cuenta el cajón y escríbelo en «Efectivo contado»", "Revisa la insignia (verde = cuadrada) y pulsa «Cerrar caja»"],
      de: ["Öffne Kasse → Tab „Kassentag“", "Wechselgeld eingeben und „Kasse öffnen“ drücken", "Nach dem Service die Schublade zählen und bei „Gezähltes Bargeld“ eintragen", "Badge prüfen (grün = stimmt) und „Kasse schließen“ drücken"],
    },
    links: [{ href: "/cassa", label: { it: "Apri la Cassa", en: "Open the Till", es: "Abrir la Caja", de: "Kasse öffnen" } }],
    related: ["cassa-orders", "cassa-pay", "cassa-receipts"],
  },
  {
    id: "cassa-orders",
    title: {
      it: "Cassa: comande, portate e coperti",
      en: "Till: orders, courses and covers",
      es: "Caja: comandas, pases y comensales",
      de: "Kasse: Bons, Gänge und Gedecke",
    },
    keywords: [
      "comanda", "comande", "portata", "portate", "coperti", "inviare comanda", "ordine tavolo", "course", "courses", "covers", "fire order", "kitchen order", "pase", "comensales", "gang", "gange", "bonieren", "storno", "nota piatto", "senza cipolla", "spostare tavolo", "voce libera",
    ],
    answer: {
      it: "Dalla Sala tocchi un tavolo e componi la comanda: scegli la portata (1ª, 2ª, 3ª — ogni portata ha il suo colore) e tocchi i piatti; il numero di coperti si imposta dal pulsante con l'omino in alto. «Comanda» invia (e stampa per reparto), le note riga servono per richieste tipo “senza cipolla”, lo storno annulla una riga già inviata.",
      en: "From the Room you tap a table and build the order: pick the course (1st, 2nd, 3rd — each has its own color) and tap dishes; covers are set from the people button at the top. “Send order” fires it (printing per station), line notes handle requests like “no onion”, and void-line cancels an already-sent line.",
      es: "Desde la Sala tocas una mesa y compones la comanda: eliges el pase (1º, 2º, 3º — cada uno con su color) y tocas los platos; los comensales se ajustan con el botón de personas arriba. «Comanda» la envía (imprimiendo por estación), las notas de línea sirven para “sin cebolla”, y el storno anula una línea ya enviada.",
      de: "Im Saal tippst du auf einen Tisch und stellst den Bon zusammen: Gang wählen (1., 2., 3. — jeder mit eigener Farbe) und Gerichte antippen; Gedecke stellst du über den Personen-Button oben ein. „Bonieren“ schickt den Bon (Druck pro Station), Zeilennotizen für „ohne Zwiebel“, Storno storniert eine bereits bonierte Zeile.",
    },
    links: [{ href: "/cassa", label: { it: "Apri la Cassa", en: "Open the Till", es: "Abrir la Caja", de: "Kasse öffnen" } }],
    related: ["cassa-open-close", "cassa-pay", "menu-variants", "floor"],
  },
  {
    id: "cassa-pay",
    title: {
      it: "Cassa: incasso, sconti, preconto e resto",
      en: "Till: charging, discounts, pre-bill and change",
      es: "Caja: cobro, descuentos, precuenta y cambio",
      de: "Kasse: Kassieren, Rabatte, Vorab-Rechnung und Rückgeld",
    },
    keywords: [
      "incassare", "incasso", "pagare", "pagamento", "sconto", "preconto", "resto", "conto", "charge", "payment", "discount", "pre-bill", "change", "split", "dividere conto", "pagamento misto", "cobrar", "descuento", "precuenta", "cambio", "kassieren", "rabatt", "rechnung", "trinkgeld", "contanti", "carta", "coperto prezzo",
    ],
    answer: {
      it: "Dal conto premi «Incassa»: scegli il metodo (contanti, carta, buoni…), puoi dividere l'importo su più metodi e, per i contanti, il resto viene calcolato da solo. Lo sconto (in % o in €) si applica dal totale del conto; il «Preconto» stampa il conto da portare al tavolo prima del pagamento.",
      en: "From the bill press “Charge”: pick the method (cash, card, vouchers…), split the amount across methods if needed, and for cash the change is computed automatically. Discounts (% or €) apply from the bill total; “Pre-bill” prints the bill to bring to the table before payment.",
      es: "Desde la cuenta pulsa «Cobrar»: eliges el método (efectivo, tarjeta, vales…), puedes dividir el importe entre varios métodos y, con efectivo, el cambio se calcula solo. El descuento (% o €) se aplica desde el total; la «Precuenta» imprime la cuenta para llevar a la mesa antes de cobrar.",
      de: "Auf der Rechnung „Kassieren“ drücken: Methode wählen (bar, Karte, Gutscheine…), den Betrag bei Bedarf auf mehrere Methoden aufteilen, bei bar wird das Rückgeld automatisch berechnet. Rabatt (% oder €) gilt auf die Gesamtsumme; die Vorab-Rechnung druckst du für den Tisch vor der Zahlung.",
    },
    links: [{ href: "/cassa", label: { it: "Apri la Cassa", en: "Open the Till", es: "Abrir la Caja", de: "Kasse öffnen" } }],
    related: ["cassa-receipts", "cassa-open-close"],
  },
  {
    id: "cassa-receipts",
    title: {
      it: "Scontrini: ristampa e annullo",
      en: "Receipts: reprint and void",
      es: "Tickets: reimprimir y anular",
      de: "Bons: Nachdruck und Storno",
    },
    keywords: ["scontrino", "scontrini", "ristampa", "annullare scontrino", "annullo", "receipt", "receipts", "reprint", "void receipt", "ticket", "tickets", "anular ticket", "bon", "bons", "storno bon", "giornale", "journal"],
    answer: {
      it: "Nella scheda Scontrini vedi il giornale del giorno (e dei giorni passati con le frecce). Puoi ristampare qualsiasi scontrino; titolare e manager possono annullarne uno del giorno corrente indicando il motivo — l'annullo resta tracciato nel riepilogo.",
      en: "The Receipts tab shows the day's journal (and past days via the arrows). You can reprint any receipt; owner and managers can void one from the current day by giving a reason — the void stays tracked in the summary.",
      es: "La pestaña Tickets muestra el diario del día (y de días pasados con las flechas). Puedes reimprimir cualquier ticket; propietario y managers pueden anular uno del día actual indicando el motivo — la anulación queda registrada en el resumen.",
      de: "Der Tab Bons zeigt das Tagesjournal (und vergangene Tage über die Pfeile). Jeder Bon lässt sich nachdrucken; Inhaber und Manager können einen Bon des aktuellen Tags mit Begründung stornieren — der Storno bleibt in der Übersicht nachvollziehbar.",
    },
    links: [{ href: "/cassa", label: { it: "Apri la Cassa", en: "Open the Till", es: "Abrir la Caja", de: "Kasse öffnen" } }],
    related: ["cassa-pay", "cassa-open-close"],
  },
  {
    id: "inventory",
    title: {
      it: "Inventario: scorte, carichi da foto e ordini",
      en: "Inventory: stock, photo stock-in and orders",
      es: "Inventario: existencias, cargas por foto y pedidos",
      de: "Inventar: Bestand, Foto-Wareneingang und Bestellungen",
    },
    keywords: [
      "inventario", "magazzino", "scorte", "ingredienti", "carico", "fattura foto", "stock", "inventory", "ingredients", "stock-in", "supplier order", "ordine fornitore", "fornitore", "fornitori", "existencias", "almacen", "proveedor", "lager", "bestand", "lieferant", "sprechi", "shrinkage", "scorta minima", "par level", "sottoscorta",
    ],
    answer: {
      it: "L'Inventario tiene le scorte degli ingredienti quasi da solo: fotografi la fattura del fornitore e il carico viene registrato automaticamente (creando anche gli ingredienti nuovi); le scorte minime si calcolano da sole e quando un ingrediente va sottoscorta puoi generare l'ordine al fornitore da inviare su WhatsApp. C'è anche il pannello sprechi per capire dove si perde merce.",
      en: "Inventory keeps ingredient stock almost by itself: photograph the supplier invoice and the stock-in is recorded automatically (new ingredients are created too); minimum levels are computed automatically and when an ingredient runs low you can generate the supplier order to send on WhatsApp. A shrinkage panel shows where goods get lost.",
      es: "El Inventario lleva las existencias casi solo: fotografías la factura del proveedor y la carga se registra automáticamente (creando también los ingredientes nuevos); los mínimos se calculan solos y cuando un ingrediente baja de stock puedes generar el pedido al proveedor para enviarlo por WhatsApp. El panel de mermas muestra dónde se pierde género.",
      de: "Das Inventar führt den Bestand fast von allein: du fotografierst die Lieferantenrechnung und der Wareneingang wird automatisch erfasst (neue Zutaten werden mit angelegt); Mindestbestände berechnen sich selbst, und bei Unterbestand erzeugst du die Lieferantenbestellung zum Versand per WhatsApp. Das Schwund-Panel zeigt, wo Ware verloren geht.",
    },
    links: [{ href: "/inventory", label: { it: "Apri Inventario", en: "Open Inventory", es: "Abrir Inventario", de: "Inventar öffnen" } }],
    related: ["food-cost", "pl"],
  },
  {
    id: "food-cost",
    title: {
      it: "Food cost: costo piatto e margini",
      en: "Food cost: dish cost and margins",
      es: "Food cost: coste del plato y márgenes",
      de: "Food Cost: Gerichtskosten und Margen",
    },
    keywords: ["food cost", "foodcost", "costo piatto", "ricetta", "ricette", "margine", "margini", "recipe", "recipes", "margin", "dish cost", "coste plato", "receta", "recetas", "margen", "rezept", "wareneinsatz", "prezzo suggerito", "quanto guadagno"],
    answer: {
      it: "Nel Food Cost colleghi a ogni piatto la sua ricetta (ingredienti e quantità): il CRM calcola costo, margine e incidenza, e ti suggerisce il prezzo di vendita giusto. I costi degli ingredienti arrivano dall'Inventario, quindi si aggiornano da soli a ogni carico.",
      en: "In Food Cost you link each dish to its recipe (ingredients and quantities): the CRM computes cost, margin and incidence, and suggests the right selling price. Ingredient costs come from Inventory, so they update automatically with every stock-in.",
      es: "En Food Cost vinculas cada plato a su receta (ingredientes y cantidades): el CRM calcula coste, margen e incidencia, y te sugiere el precio de venta adecuado. Los costes vienen del Inventario, así que se actualizan solos con cada carga.",
      de: "Im Food Cost verknüpfst du jedes Gericht mit seinem Rezept (Zutaten und Mengen): das CRM berechnet Kosten, Marge und Anteil und schlägt den richtigen Verkaufspreis vor. Zutatenkosten kommen aus dem Inventar und aktualisieren sich mit jedem Wareneingang.",
    },
    links: [{ href: "/food-cost", label: { it: "Apri Food Cost", en: "Open Food Cost", es: "Abrir Food Cost", de: "Food Cost öffnen" } }],
    related: ["inventory", "pl", "menu-manage"],
  },
  {
    id: "pl",
    title: {
      it: "Conto economico (P&L)",
      en: "Profit & Loss (P&L)",
      es: "Cuenta de resultados (P&L)",
      de: "Gewinn & Verlust (GuV)",
    },
    keywords: ["conto economico", "profitti", "perdite", "utile", "p&l", "pl", "profit", "loss", "guadagno", "costi fissi", "personale costo", "cuenta de resultados", "beneficio", "guv", "gewinn", "verlust", "kosten", "ricavi", "revenue", "ebitda"],
    answer: {
      it: "Il Conto Economico mette insieme ricavi, food cost, costo del personale e costi fissi e ti mostra quanto guadagni davvero, mese per mese. Ricavi e food cost arrivano da cassa e inventario; personale e costi fissi li imposti tu una volta e restano configurati.",
      en: "The P&L combines revenue, food cost, labor and overhead and shows what you actually earn, month by month. Revenue and food cost flow in from the till and inventory; labor and overhead you set once and they stay configured.",
      es: "La Cuenta de resultados junta ingresos, food cost, personal y costes fijos y te muestra cuánto ganas de verdad, mes a mes. Ingresos y food cost llegan de caja e inventario; personal y costes fijos los configuras una vez y quedan guardados.",
      de: "Die GuV kombiniert Umsatz, Food Cost, Personal und Fixkosten und zeigt, was du wirklich verdienst — Monat für Monat. Umsatz und Food Cost kommen aus Kasse und Inventar; Personal und Fixkosten stellst du einmal ein.",
    },
    links: [{ href: "/pl", label: { it: "Apri Conto Economico", en: "Open P&L", es: "Abrir Cuenta de resultados", de: "GuV öffnen" } }],
    related: ["food-cost", "inventory", "analytics"],
  },
  {
    id: "analytics",
    title: {
      it: "Statistiche e andamento",
      en: "Analytics & trends",
      es: "Estadísticas y tendencias",
      de: "Statistiken & Trends",
    },
    keywords: ["statistiche", "analytics", "andamento", "grafici", "report", "estadisticas", "graficos", "statistiken", "auswertung", "coperti totali", "prenotazioni mese", "trend"],
    answer: {
      it: "In Statistiche vedi l'andamento del locale: prenotazioni, coperti, canali di arrivo, orari di punta e trend nel tempo. Usale per decidere turni, promozioni e menu.",
      en: "Analytics shows how the restaurant is doing: bookings, covers, arrival channels, peak hours and trends over time. Use it to plan shifts, promotions and the menu.",
      es: "En Estadísticas ves cómo va el local: reservas, comensales, canales de llegada, horas punta y tendencias. Úsalas para decidir turnos, promociones y menú.",
      de: "Statistiken zeigen, wie das Lokal läuft: Reservierungen, Gedecke, Kanäle, Stoßzeiten und Trends. Nutze sie für Schichten, Aktionen und die Karte.",
    },
    links: [{ href: "/analytics", label: { it: "Apri Statistiche", en: "Open Analytics", es: "Abrir Estadísticas", de: "Statistiken öffnen" } }],
    related: ["pl", "reservations"],
  },
  {
    id: "conversations",
    title: {
      it: "Chat coi clienti (WhatsApp)",
      en: "Customer chat (WhatsApp)",
      es: "Chat con clientes (WhatsApp)",
      de: "Gäste-Chat (WhatsApp)",
    },
    keywords: ["conversazioni", "chat", "messaggi", "rispondere cliente", "conversations", "messages", "reply", "mensajes", "responder", "nachrichten", "antworten", "bot risponde", "takeover", "intervenire"],
    answer: {
      it: "In Conversazioni vedi tutte le chat WhatsApp coi clienti. Il bot risponde da solo a prenotazioni e domande frequenti; quando vuoi intervenire tu, scrivi direttamente nella chat e riprendi la conversazione — il bot si fa da parte.",
      en: "Conversations shows every WhatsApp chat with your guests. The bot replies on its own to bookings and FAQs; when you want to step in, just type in the chat and take over — the bot steps aside.",
      es: "En Conversaciones ves todos los chats de WhatsApp con clientes. El bot responde solo a reservas y preguntas frecuentes; cuando quieras intervenir, escribe en el chat y toma el control — el bot se aparta.",
      de: "Unter Konversationen siehst du alle WhatsApp-Chats mit Gästen. Der Bot antwortet selbst auf Reservierungen und FAQs; willst du übernehmen, schreib einfach im Chat — der Bot tritt zurück.",
    },
    links: [{ href: "/conversations", label: { it: "Apri Conversazioni", en: "Open Conversations", es: "Abrir Conversaciones", de: "Konversationen öffnen" } }],
    related: ["whatsapp-connect", "knowledge", "pending"],
  },
  {
    id: "whatsapp-connect",
    title: {
      it: "Collegare WhatsApp al CRM",
      en: "Connecting WhatsApp to the CRM",
      es: "Conectar WhatsApp al CRM",
      de: "WhatsApp mit dem CRM verbinden",
    },
    keywords: ["collegare whatsapp", "whatsapp", "numero whatsapp", "connect whatsapp", "conectar whatsapp", "whatsapp verbinden", "meta", "business", "wa", "whatsapp business", "collegamento numero", "qr whatsapp"],
    answer: {
      it: "WhatsApp si collega da Impostazioni → WhatsApp con la procedura guidata di Meta (pochi minuti): accedi col tuo account, scegli o registra il numero del locale e conferma. Puoi continuare a usare WhatsApp anche dal telefono: il bot e l'app convivono sullo stesso numero.",
      en: "WhatsApp connects from Settings → WhatsApp with Meta's guided flow (a few minutes): sign in with your account, pick or register the restaurant number and confirm. You can keep using WhatsApp on your phone too: bot and app coexist on the same number.",
      es: "WhatsApp se conecta desde Ajustes → WhatsApp con el asistente de Meta (pocos minutos): inicia sesión con tu cuenta, elige o registra el número del local y confirma. Puedes seguir usando WhatsApp en el móvil: el bot y la app conviven en el mismo número.",
      de: "WhatsApp verbindest du unter Einstellungen → WhatsApp mit Metas geführtem Ablauf (wenige Minuten): mit deinem Konto anmelden, die Nummer des Lokals wählen oder registrieren und bestätigen. Du kannst WhatsApp weiter am Handy nutzen: Bot und App teilen sich dieselbe Nummer.",
    },
    steps: {
      it: ["Apri Impostazioni → sezione WhatsApp", "Premi il pulsante di collegamento e segui la procedura Meta", "Scegli il numero del locale e conferma", "Fai un messaggio di prova al numero per verificare che il bot risponda"],
      en: ["Open Settings → WhatsApp section", "Press the connect button and follow the Meta flow", "Pick the restaurant number and confirm", "Send a test message to the number to check the bot replies"],
      es: ["Abre Ajustes → sección WhatsApp", "Pulsa el botón de conexión y sigue el asistente de Meta", "Elige el número del local y confirma", "Envía un mensaje de prueba al número para comprobar que el bot responde"],
      de: ["Öffne Einstellungen → Bereich WhatsApp", "Verbinden-Button drücken und dem Meta-Ablauf folgen", "Die Nummer des Lokals wählen und bestätigen", "Testnachricht an die Nummer senden und prüfen, ob der Bot antwortet"],
    },
    links: [{ href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } }],
    related: ["conversations", "knowledge"],
  },
  {
    id: "knowledge",
    title: {
      it: "Informazioni per il bot (Knowledge)",
      en: "Bot knowledge base",
      es: "Información para el bot (Knowledge)",
      de: "Wissensbasis für den Bot",
    },
    keywords: ["knowledge", "informazioni bot", "il bot non sa", "risposte bot", "insegnare al bot", "faq", "domande frequenti", "orari bot", "bot answers", "informacion bot", "bot wissen", "cosa risponde"],
    answer: {
      it: "Nella pagina Info Locale scrivi tutto quello che il bot deve sapere per rispondere ai clienti: orari, parcheggio, menu bimbi, animali, ferie… Più informazioni inserisci, meno domande arrivano a te. Il bot le usa subito, senza riavvii.",
      en: "On the Knowledge page you write everything the bot should know to answer guests: hours, parking, kids menu, pets, holidays… The more you add, the fewer questions reach you. The bot uses it immediately, no restarts.",
      es: "En la página Knowledge escribes todo lo que el bot debe saber para responder: horarios, parking, menú infantil, mascotas, vacaciones… Cuanta más información, menos preguntas te llegan. El bot la usa al instante.",
      de: "Auf der Knowledge-Seite schreibst du alles, was der Bot wissen soll: Öffnungszeiten, Parken, Kindermenü, Haustiere, Ferien… Je mehr Infos, desto weniger Fragen erreichen dich. Der Bot nutzt sie sofort.",
    },
    links: [{ href: "/knowledge", label: { it: "Apri Info Locale", en: "Open Knowledge", es: "Abrir Knowledge", de: "Knowledge öffnen" } }],
    related: ["conversations", "whatsapp-connect"],
  },
  {
    id: "staff",
    title: {
      it: "Team: aggiungere persone e ruoli",
      en: "Team: adding people and roles",
      es: "Equipo: añadir personas y roles",
      de: "Team: Personen und Rollen hinzufügen",
    },
    keywords: ["staff", "team", "utenti", "aggiungere utente", "invitare", "ruolo", "ruoli", "cameriere", "manager", "owner", "invite user", "roles", "equipo", "invitar", "empleado", "mitarbeiter", "rollen", "einladen", "permessi", "permissions"],
    answer: {
      it: "In Staff inviti i collaboratori con la loro email e assegni un ruolo: Titolare (tutto), Manager (gestione operativa, chiusure di cassa), Staff (lavoro quotidiano: prenotazioni, comande). Puoi cambiare ruolo o rimuovere una persona in qualsiasi momento.",
      en: "In Staff you invite team members by email and assign a role: Owner (everything), Manager (operations, till closures), Staff (daily work: bookings, orders). You can change roles or remove someone anytime.",
      es: "En Staff invitas al equipo por email y asignas un rol: Propietario (todo), Manager (operativa, cierres de caja), Staff (trabajo diario: reservas, comandas). Puedes cambiar roles o quitar a alguien cuando quieras.",
      de: "Unter Staff lädst du Mitarbeitende per E-Mail ein und vergibst eine Rolle: Inhaber (alles), Manager (Betrieb, Kassenabschlüsse), Staff (Tagesgeschäft: Reservierungen, Bons). Rollen ändern oder Personen entfernen geht jederzeit.",
    },
    links: [{ href: "/staff", label: { it: "Apri Staff", en: "Open Staff", es: "Abrir Staff", de: "Staff öffnen" } }],
    related: ["settings", "cassa-open-close"],
  },
  {
    id: "settings",
    title: {
      it: "Impostazioni: dati locale, orari e lingua",
      en: "Settings: venue data, hours and language",
      es: "Ajustes: datos del local, horarios e idioma",
      de: "Einstellungen: Lokaldaten, Zeiten und Sprache",
    },
    keywords: ["impostazioni", "settings", "ajustes", "einstellungen", "orari", "orario apertura", "hours", "opening hours", "horarios", "offnungszeiten", "lingua", "language", "idioma", "sprache", "nome locale", "indirizzo", "configurazione"],
    answer: {
      it: "In Impostazioni configuri il locale: nome e contatti, orari di apertura e regole delle prenotazioni, lingua del CRM, WhatsApp, coperto della cassa e abbonamento. Le modifiche valgono subito per bot, menu digitale e prenotazioni.",
      en: "Settings is where you configure the venue: name and contacts, opening hours and booking rules, CRM language, WhatsApp, the till's cover charge and your subscription. Changes apply immediately to the bot, digital menu and bookings.",
      es: "En Ajustes configuras el local: nombre y contactos, horarios y reglas de reserva, idioma del CRM, WhatsApp, el cubierto de la caja y la suscripción. Los cambios aplican al momento en bot, menú digital y reservas.",
      de: "In den Einstellungen konfigurierst du das Lokal: Name und Kontakte, Öffnungszeiten und Reservierungsregeln, CRM-Sprache, WhatsApp, Gedeckpreis der Kasse und das Abo. Änderungen gelten sofort für Bot, digitale Karte und Reservierungen.",
    },
    links: [{ href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } }],
    related: ["whatsapp-connect", "billing", "staff"],
  },
  {
    id: "billing",
    title: {
      it: "Piani, add-on e funzioni bloccate",
      en: "Plans, add-ons and locked features",
      es: "Planes, complementos y funciones bloqueadas",
      de: "Pläne, Add-ons und gesperrte Funktionen",
    },
    keywords: ["abbonamento", "piano", "prezzo", "pagamento abbonamento", "sbloccare", "bloccato", "add-on", "addon", "plan", "subscription", "billing", "upgrade", "locked", "suscripcion", "desbloquear", "abo", "freischalten", "gestionale bloccato", "cassa bloccata", "lucchetto"],
    answer: {
      it: "Alcune sezioni (Cassa, Inventario, Food Cost, Conto Economico) sono un add-on del piano: se le vedi col lucchetto, il tuo piano non le include ancora. L'abbonamento si gestisce da Impostazioni; per attivare un add-on o cambiare piano contatta l'assistenza — l'attivazione è immediata.",
      en: "Some sections (Till, Inventory, Food Cost, P&L) are a plan add-on: if you see them locked, your plan doesn't include them yet. The subscription is managed from Settings; to enable an add-on or change plan contact support — activation is immediate.",
      es: "Algunas secciones (Caja, Inventario, Food Cost, Cuenta de resultados) son un complemento del plan: si las ves con candado, tu plan aún no las incluye. La suscripción se gestiona en Ajustes; para activar un complemento o cambiar de plan contacta con soporte — la activación es inmediata.",
      de: "Einige Bereiche (Kasse, Inventar, Food Cost, GuV) sind ein Plan-Add-on: siehst du ein Schloss, enthält dein Plan sie noch nicht. Das Abo verwaltest du in den Einstellungen; für ein Add-on oder einen Planwechsel kontaktiere den Support — die Aktivierung ist sofort.",
    },
    links: [{ href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } }],
    related: ["settings", "cassa-open-close", "inventory"],
  },
  {
    id: "incidents",
    title: {
      it: "Segnalazioni e problemi",
      en: "Incidents & issues",
      es: "Incidencias y problemas",
      de: "Vorfälle & Probleme",
    },
    keywords: ["segnalazione", "segnalazioni", "incidente", "reclamo", "problema", "incident", "incidents", "issue", "complaint", "incidencia", "queja", "vorfall", "beschwerde", "qualcosa non funziona", "errore sistema"],
    answer: {
      it: "Nella pagina Segnalazioni trovi gli eventi che richiedono la tua attenzione (problemi tecnici, reclami, anomalie). Ogni segnalazione ha uno stato: aprila per vedere i dettagli e chiuderla quando è risolta. Se qualcosa non funziona e non trovi risposta qui, contatta l'assistenza.",
      en: "The Incidents page lists events that need your attention (technical issues, complaints, anomalies). Each incident has a status: open it for details and close it once resolved. If something is broken and you can't find the answer here, contact support.",
      es: "La página Incidencias lista los eventos que requieren tu atención (problemas técnicos, quejas, anomalías). Cada incidencia tiene un estado: ábrela para ver detalles y ciérrala al resolverla. Si algo falla y no encuentras respuesta aquí, contacta con soporte.",
      de: "Die Seite Vorfälle listet Ereignisse, die deine Aufmerksamkeit brauchen (technische Probleme, Beschwerden, Anomalien). Jeder Vorfall hat einen Status: öffnen für Details, schließen wenn gelöst. Wenn etwas kaputt ist und du hier keine Antwort findest, kontaktiere den Support.",
    },
    links: [{ href: "/incidents", label: { it: "Apri Segnalazioni", en: "Open Incidents", es: "Abrir Incidencias", de: "Vorfälle öffnen" } }],
    related: ["assistant-meta"],
  },
  {
    id: "assistant-meta",
    title: {
      it: "Cosa sa fare questo assistente",
      en: "What this assistant can do",
      es: "Qué sabe hacer este asistente",
      de: "Was dieser Assistent kann",
    },
    keywords: ["assistente", "cosa sai fare", "chi sei", "aiuto", "help", "what can you do", "who are you", "asistente", "que sabes hacer", "ayuda", "hilfe", "was kannst du"],
    answer: {
      it: "Sono l'assistente integrato del CRM: ti spiego come funziona ogni sezione e faccio le cose al posto tuo. Prova a scrivermi: «crea una prenotazione a nome Mario domani alle 20:30 per 4», «cancella la prenotazione di Mario», «recap delle prenotazioni», «quanto abbiamo incassato?», «apri la cassa», «chiudi la cassa». Prima di scrivere qualcosa ti chiedo sempre conferma. Funziono in italiano, inglese, spagnolo e tedesco e sono gratuito.",
      en: "I'm the CRM's built-in assistant: I explain how every section works and do things for you. Try: “create a reservation for Mario tomorrow at 20:30 for 4”, “cancel Mario's reservation”, “reservations recap”, “how much did we take today?”, “open the till”, “close the till”. I always ask for confirmation before writing anything. I work in Italian, English, Spanish and German and I'm free.",
      es: "Soy el asistente integrado del CRM: te explico cómo funciona cada sección y hago cosas por ti. Prueba: «crea una reserva para Mario mañana a las 20:30 para 4», «cancela la reserva de Mario», «resumen de reservas», «¿cuánto hemos recaudado?», «abre la caja», «cierra la caja». Siempre pido confirmación antes de escribir nada. Funciono en italiano, inglés, español y alemán y soy gratis.",
      de: "Ich bin der eingebaute CRM-Assistent: Ich erkläre jeden Bereich und erledige Dinge für dich. Probier: „erstelle eine Reservierung für Mario morgen um 20:30 für 4“, „storniere Marios Reservierung“, „Reservierungs-Überblick“, „wie viel Umsatz haben wir?“, „öffne die Kasse“, „schließe die Kasse“. Vor jedem Schreibvorgang frage ich nach Bestätigung. Ich funktioniere auf Italienisch, Englisch, Spanisch und Deutsch und bin kostenlos.",
    },
    related: ["overview", "cassa-open-close", "menu-manage", "whatsapp-connect"],
  },
];

/** Topics offered as chips on the welcome message and after a miss. */
export const SUGGESTED_TOPIC_IDS = [
  "overview",
  "cassa-open-close",
  "menu-manage",
  "reservations",
  "whatsapp-connect",
  "inventory",
];

export function topicById(id: string): KbTopic | undefined {
  return KB.find((t) => t.id === id);
}
