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
      it: "Il CRM riunisce tutto il ristorante: Prenotazioni (con conferme automatiche via WhatsApp), Clienti (con punti fedeltà), Menu digitale, Sala e tavoli, Cassa (POS), Gestionale (Inventario, Food Cost, Conto Economico), Statistiche, Chat coi clienti, Sito web pubblico con prenotazione online, Marketing (campagne), Buoni regalo, Recensioni, Staff (turni) e Impostazioni. Ogni sezione è nel menu laterale a sinistra.",
      en: "The CRM brings the whole restaurant together: Reservations (with automatic WhatsApp confirmations), Guests (with loyalty points), digital Menu, Floor & tables, Till (POS), Management (Inventory, Food Cost, P&L), Analytics, customer Chat, a public Website with online booking, Marketing (campaigns), Gift cards, Reviews, Staff (rota) and Settings. Each section lives in the left sidebar.",
      es: "El CRM reúne todo el restaurante: Reservas (con confirmaciones automáticas por WhatsApp), Clientes (con puntos de fidelidad), Menú digital, Sala y mesas, Caja (POS), Gestión (Inventario, Food Cost, Cuenta de resultados), Estadísticas, Chat con clientes, Sitio web público con reserva online, Marketing (campañas), Tarjetas regalo, Reseñas, Equipo (turnos) y Ajustes. Cada sección está en el menú lateral izquierdo.",
      de: "Das CRM vereint das ganze Restaurant: Reservierungen (mit automatischen WhatsApp-Bestätigungen), Gäste (mit Treuepunkten), digitale Speisekarte, Saal & Tische, Kasse (POS), Verwaltung (Inventar, Food Cost, GuV), Statistiken, Gäste-Chat, eine öffentliche Webseite mit Online-Reservierung, Marketing (Kampagnen), Gutscheine, Bewertungen, Staff (Dienstplan) und Einstellungen. Jeder Bereich ist in der linken Seitenleiste.",
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
      "eliminare piatti", "eliminazione di massa", "elimina tutti", "seleziona piatti", "bulk delete", "delete many", "select dishes", "eliminar varios", "borrar platos", "mehrere loeschen", "auswahl loeschen",
    ],
    answer: {
      it: "Nella pagina Menu gestisci categorie e piatti: nome, prezzo, descrizione, foto, allergeni e disponibilitÃ . Un piatto segnato non disponibile sparisce dal menu digitale e dalla cassa. Puoi anche importare un menu esistente da file o foto. Col pulsante Â«SelezionaÂ» spunti piÃ¹ piatti e li elimini tutti insieme.",
      en: "On the Menu page you manage categories and dishes: name, price, description, photo, allergens and availability. A dish marked unavailable disappears from the digital menu and the till. You can also import an existing menu from a file or photo. With the “Select” button you can tick several dishes and delete them all at once.",
      es: "En la pÃ¡gina MenÃº gestionas categorÃ­as y platos: nombre, precio, descripciÃ³n, foto, alÃ©rgenos y disponibilidad. Un plato marcado como no disponible desaparece del menÃº digital y de la caja. TambiÃ©n puedes importar un menÃº existente desde archivo o foto. Con el botÃ³n Â«SeleccionarÂ» marcas varios platos y los eliminas todos a la vez.",
      de: "Auf der Seite Speisekarte verwaltest du Kategorien und Gerichte: Name, Preis, Beschreibung, Foto, Allergene und VerfÃ¼gbarkeit. Ein als nicht verfÃ¼gbar markiertes Gericht verschwindet aus digitaler Karte und Kasse. Du kannst auch eine bestehende Karte aus Datei oder Foto importieren. Mit „AuswÃ¤hlen“ markierst du mehrere Gerichte und lÃ¶schst sie auf einmal.",
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
      "aprire cassa", "apro la cassa", "chiudere cassa", "chiusura cassa", "fondo cassa", "giornata di cassa", "open till", "close till", "cash day", "float", "abrir caja", "cerrar caja", "abro la caja", "cierro la caja", "fondo de caja", "kasse offnen", "kasse schliessen", "wechselgeld", "quadratura", "contanti attesi", "cassa aperta", "cassa chiusa",
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
    related: ["cassa-receipts", "cassa-open-close", "qr-pay"],
  },
  {
    id: "qr-pay",
    title: {
      it: "Pagamento dal tavolo (QR)",
      en: "Pay at the table (QR)",
      es: "Pago desde la mesa (QR)",
      de: "Am Tisch bezahlen (QR)",
    },
    keywords: [
      "pagamento qr", "pagare dal tavolo", "qr tavolo", "conto dal telefono", "pagamento al tavolo", "stripe ristorante", "chiave stripe", "pay at table", "qr payment", "table payment", "pay by phone", "stripe key", "pago qr", "pagar desde la mesa", "pago en mesa", "clave stripe", "qr zahlung", "am tisch zahlen", "tisch qr bezahlen", "stripe schlüssel", "incasso online", "pagamento online tavolo",
    ],
    answer: {
      it: "Con «Pagamento dal tavolo (QR)» il cliente inquadra lo stesso QR del tavolo, tocca «Conto», vede il conto aggiornato e lo paga con carta dal telefono. L'incasso arriva direttamente sul TUO conto Stripe (non sulla piattaforma): collega la chiave segreta Stripe in Impostazioni → Pagamenti, poi attiva la funzione in Impostazioni → Funzionalità. A pagamento riuscito il conto si chiude da solo in cassa con scontrino e metodo «online»; serve una cassa aperta. Se il conto cambia mentre il cliente paga, ricevi un avviso e sistemi la differenza in cassa.",
      en: "With “Pay at the table (QR)” guests scan the same table QR, tap “Bill”, see the live bill and pay it by card from their phone. The money lands directly in YOUR Stripe account (not the platform's): connect your Stripe secret key in Settings → Payments, then switch the feature on in Settings → Features. On success the bill closes itself at the till with a receipt and method “online”; an open till session is required. If the bill changes while the guest pays, you get an alert and settle the difference at the till.",
      es: "Con «Pago desde la mesa (QR)» el cliente escanea el mismo QR de la mesa, toca «Cuenta», ve la cuenta actualizada y la paga con tarjeta desde el móvil. El cobro llega directamente a TU cuenta de Stripe (no a la plataforma): conecta la clave secreta de Stripe en Ajustes → Pagos y activa la función en Ajustes → Funciones. Al completarse, la cuenta se cierra sola en caja con su ticket y método «online»; hace falta caja abierta. Si la cuenta cambia mientras el cliente paga, recibes un aviso y ajustas la diferencia en caja.",
      de: "Mit „Am Tisch bezahlen (QR)“ scannen Gäste denselben Tisch-QR, tippen auf „Rechnung“, sehen die aktuelle Rechnung und zahlen sie per Karte vom Handy. Das Geld geht direkt auf DEIN Stripe-Konto (nicht auf die Plattform): verbinde deinen geheimen Stripe-Schlüssel unter Einstellungen → Zahlungen und aktiviere die Funktion unter Einstellungen → Funktionen. Bei Erfolg schließt sich die Rechnung an der Kasse von selbst, mit Bon und Methode „online“; eine offene Kassensitzung ist nötig. Ändert sich die Rechnung während der Zahlung, bekommst du eine Meldung und klärst die Differenz an der Kasse.",
    },
    links: [
      { href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } },
      { href: "/floor", label: { it: "Stampa i QR dei tavoli", en: "Print the table QRs", es: "Imprimir los QR de mesa", de: "Tisch-QRs drucken" } },
    ],
    related: ["cassa-pay", "cassa-receipts", "settings"],
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
      it: "Staff: turni, assenze, persone e ruoli",
      en: "Staff: shifts, time off, people and roles",
      es: "Equipo: turnos, ausencias, personas y roles",
      de: "Staff: Schichten, Abwesenheiten, Personen und Rollen",
    },
    keywords: ["staff", "team", "utenti", "aggiungere utente", "invitare", "ruolo", "ruoli", "cameriere", "manager", "owner", "invite user", "roles", "equipo", "invitar", "empleado", "mitarbeiter", "rollen", "einladen", "permessi", "permissions", "turno staff", "turni", "turni settimana", "mettere turni", "orario settimanale", "rota", "shifts", "schedule", "turnos", "dienstplan", "schicht", "assenza", "assenze", "ferie", "malattia", "time off", "vacation", "sick", "ausencia", "vacaciones", "urlaub", "krank", "cambio turno", "swap"],
    answer: {
      it: "In Staff gestisci il team e i turni. Turni: pianifichi la settimana anche in blocco (più persone × più giorni in un click), copi la settimana precedente e pubblichi; i camerieri vedono il piano, chiedono cambi turno e assenze (ferie, malattia, imprevisto) e tu approvi o rifiuti. Persone: inviti con l'email e assegni un ruolo — Titolare (tutto), Manager (gestione operativa, chiusure di cassa), Staff (lavoro quotidiano: prenotazioni, comande). Gli inviti in sospeso restano visibili finché non vengono accettati.",
      en: "In Staff you manage the team and the rota. Shifts: plan the week in bulk (several people × several days in one click), copy last week and publish; waiters see the plan, request shift swaps and time off (vacation, sick, personal) and you approve or decline. People: invite by email and assign a role — Owner (everything), Manager (operations, till closures), Staff (daily work: bookings, orders). Pending invites stay visible until accepted.",
      es: "En Equipo gestionas el personal y los turnos. Turnos: planificas la semana incluso en bloque (varias personas × varios días en un clic), copias la semana anterior y publicas; los camareros ven el plan, piden cambios de turno y ausencias (vacaciones, enfermedad, imprevisto) y tú apruebas o rechazas. Personas: invitas por email y asignas un rol — Propietario (todo), Manager (operativa, cierres de caja), Staff (trabajo diario: reservas, comandas). Las invitaciones pendientes quedan visibles hasta que se aceptan.",
      de: "Unter Staff verwaltest du Team und Dienstplan. Schichten: plane die Woche auch im Block (mehrere Personen × mehrere Tage mit einem Klick), kopiere die Vorwoche und veröffentliche; Kellner sehen den Plan, beantragen Schichttausch und Abwesenheiten (Urlaub, Krankheit, Sonstiges), du genehmigst oder lehnst ab. Personen: per E-Mail einladen und Rolle vergeben — Inhaber (alles), Manager (Betrieb, Kassenabschlüsse), Staff (Tagesgeschäft: Reservierungen, Bons). Offene Einladungen bleiben sichtbar, bis sie angenommen werden.",
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
    id: "gift-cards",
    title: {
      it: "Buoni regalo",
      en: "Gift cards",
      es: "Tarjetas regalo",
      de: "Gutscheine",
    },
    keywords: ["buono regalo", "buoni regalo", "gift card", "gift cards", "voucher", "tarjeta regalo", "tarjetas regalo", "gutschein", "gutscheine", "geschenkkarte", "regalare", "carta regalo", "vale regalo", "saldo buono"],
    answer: {
      it: "I clienti comprano i buoni regalo online, dalla pagina pubblica del tuo locale: pagano con carta e il buono arriva via email con un codice. Nella pagina Buoni regalo vedi tutti i buoni venduti (codice, valore, saldo residuo, acquirente e destinatario) e trovi il link pubblico da condividere. Il buono si usa come pagamento in cassa al momento dell'incasso e il saldo si scala da solo.",
      en: "Guests buy gift cards online from your venue's public page: they pay by card and the voucher arrives by email with a code. The Gift cards page lists every voucher sold (code, value, remaining balance, buyer and recipient) and gives you the public link to share. The voucher is used as a payment method at the till and its balance is deducted automatically.",
      es: "Los clientes compran tarjetas regalo online desde la página pública de tu local: pagan con tarjeta y el vale llega por email con un código. En la página Tarjetas regalo ves todos los vales vendidos (código, valor, saldo restante, comprador y destinatario) y el enlace público para compartir. El vale se usa como pago en la caja y el saldo se descuenta solo.",
      de: "Gäste kaufen Gutscheine online über die öffentliche Seite deines Lokals: sie zahlen per Karte und der Gutschein kommt mit einem Code per E-Mail. Die Seite Gutscheine listet alle verkauften Gutscheine (Code, Wert, Restguthaben, Käufer und Empfänger) und zeigt den öffentlichen Link zum Teilen. Der Gutschein wird an der Kasse als Zahlungsmittel eingelöst, das Guthaben wird automatisch abgezogen.",
    },
    links: [{ href: "/gift-cards", label: { it: "Apri Buoni regalo", en: "Open Gift cards", es: "Abrir Tarjetas regalo", de: "Gutscheine öffnen" } }],
    related: ["cassa-pay", "website", "email-settings"],
  },
  {
    id: "loyalty",
    title: {
      it: "Fedeltà: punti e premi",
      en: "Loyalty: points and rewards",
      es: "Fidelización: puntos y premios",
      de: "Treueprogramm: Punkte und Prämien",
    },
    keywords: ["fedelta", "punti", "punti fedelta", "premio", "premi", "loyalty", "points", "reward", "rewards", "fidelizacion", "fidelidad", "puntos", "premios", "treue", "treuepunkte", "punkte", "pramie", "tessera punti", "raccolta punti"],
    answer: {
      it: "Il programma fedeltà premia i clienti che tornano: a ogni visita accumulano punti e, raggiunta la soglia, scatta il premio che hai scelto tu. Si attiva da Impostazioni → Funzionalità, dove imposti punti per visita, soglia e nome del premio. I punti di ogni cliente li vedi nella sua scheda in Clienti.",
      en: "The loyalty program rewards returning guests: every visit earns points and, once the threshold is reached, the reward you chose kicks in. Enable it from Settings → Features, where you set points per visit, the threshold and the reward name. Each guest's points show on their profile in Guests.",
      es: "El programa de fidelización premia a los clientes que vuelven: cada visita suma puntos y, al llegar al umbral, se activa el premio que tú elegiste. Se activa en Ajustes → Funciones, donde defines puntos por visita, umbral y nombre del premio. Los puntos de cada cliente se ven en su ficha en Clientes.",
      de: "Das Treueprogramm belohnt Stammgäste: jeder Besuch bringt Punkte, und bei Erreichen der Schwelle greift die Prämie, die du festgelegt hast. Aktiviere es unter Einstellungen → Funktionen; dort legst du Punkte pro Besuch, Schwelle und Prämienname fest. Die Punkte jedes Gasts stehen in seinem Profil unter Gäste.",
    },
    links: [
      { href: "/guests", label: { it: "Apri Clienti", en: "Open Guests", es: "Abrir Clientes", de: "Gäste öffnen" } },
      { href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } },
    ],
    related: ["guests", "marketing", "reviews"],
  },
  {
    id: "marketing",
    title: {
      it: "Marketing: campagne email e WhatsApp",
      en: "Marketing: email and WhatsApp campaigns",
      es: "Marketing: campañas de email y WhatsApp",
      de: "Marketing: E-Mail- und WhatsApp-Kampagnen",
    },
    keywords: ["marketing", "campagna", "campagne", "promozione", "promozioni", "newsletter", "campaign", "campaigns", "promotion", "campana", "campanas", "promocion", "kampagne", "kampagnen", "aktion", "invio massivo", "mandare a tutti", "blast", "segmento", "compleanno", "birthday"],
    answer: {
      it: "In Marketing crei campagne email o WhatsApp per i tuoi clienti: scegli a chi mandarle (tutti, chi non torna da un po', compleanni…), scrivi il messaggio e vedi l'anteprima sul telefono prima di inviare, con la stima di quante persone raggiungi. Per ogni campagna vedi poi inviati, falliti e il motivo. Le email partono dalla tua chiave email (Impostazioni → Email); i WhatsApp usano i template approvati da Meta.",
      en: "In Marketing you create email or WhatsApp campaigns for your guests: pick who receives them (everyone, lapsed guests, birthdays…), write the message and preview it on a phone before sending, with an estimate of how many people you reach. For each campaign you then see sent, failed and why. Emails go out through your own email key (Settings → Email); WhatsApp uses Meta-approved templates.",
      es: "En Marketing creas campañas de email o WhatsApp para tus clientes: eliges a quién enviarlas (todos, quienes no vuelven hace tiempo, cumpleaños…), escribes el mensaje y ves la vista previa en un teléfono antes de enviar, con la estimación de cuántas personas alcanzas. De cada campaña ves luego enviados, fallidos y el motivo. Los emails salen con tu propia clave de email (Ajustes → Email); WhatsApp usa plantillas aprobadas por Meta.",
      de: "Im Marketing erstellst du E-Mail- oder WhatsApp-Kampagnen für deine Gäste: wähle die Empfänger (alle, lange nicht dagewesene Gäste, Geburtstage…), schreib die Nachricht und sieh die Vorschau auf einem Telefon vor dem Senden, mit einer Schätzung der Reichweite. Pro Kampagne siehst du danach gesendet, fehlgeschlagen und warum. E-Mails laufen über deinen eigenen E-Mail-Schlüssel (Einstellungen → E-Mail); WhatsApp nutzt von Meta freigegebene Vorlagen.",
    },
    links: [{ href: "/marketing", label: { it: "Apri Marketing", en: "Open Marketing", es: "Abrir Marketing", de: "Marketing öffnen" } }],
    related: ["email-settings", "guests", "loyalty", "credits"],
  },
  {
    id: "social",
    title: {
      it: "Social: post su Instagram e Facebook",
      en: "Social: Instagram and Facebook posts",
      es: "Redes sociales: publicaciones en Instagram y Facebook",
      de: "Social Media: Instagram- und Facebook-Beiträge",
    },
    keywords: ["social", "instagram", "facebook", "post", "posts", "reel", "reels", "carosello", "carousel", "carrusel", "karussell", "pubblicare", "publicar", "veröffentlichen", "publish", "storia", "story", "contenuto", "content", "contenido", "inhalt", "hashtag", "programmare post", "schedule post"],
    answer: {
      it: "Nella sezione Social colleghi Instagram e Facebook con un click e crei post — immagini, caroselli e reel — direttamente dai piatti del tuo menù. L'AI scrive testo e hashtag, tu vedi l'anteprima sul telefono, poi programmi l'orario. Niente viene pubblicato senza la tua approvazione: ogni post finisce in una coda dove approvi, modifichi o elimini. I reel si creano solo su browser Chromium (Chrome, Edge, Brave); immagini e caroselli ovunque.",
      en: "In the Social section you connect Instagram and Facebook in one click and create posts — images, carousels and reels — straight from your menu dishes. The AI writes the caption and hashtags, you preview it on a phone, then schedule the time. Nothing publishes without your approval: every post lands in a queue where you approve, edit or delete it. Reels can only be created on Chromium browsers (Chrome, Edge, Brave); images and carousels work everywhere.",
      es: "En la sección Redes sociales conectas Instagram y Facebook con un clic y creas publicaciones — imágenes, carruseles y reels — directamente desde los platos de tu carta. La IA escribe el texto y los hashtags, ves la vista previa en un teléfono y luego programas la hora. Nada se publica sin tu aprobación: cada publicación entra en una cola donde apruebas, editas o eliminas. Los reels solo se crean en navegadores Chromium (Chrome, Edge, Brave); imágenes y carruseles en cualquiera.",
      de: "Im Bereich Social Media verbindest du Instagram und Facebook mit einem Klick und erstellst Beiträge — Bilder, Karussells und Reels — direkt aus den Gerichten deiner Karte. Die KI schreibt Text und Hashtags, du siehst die Vorschau auf einem Telefon und planst dann die Zeit. Nichts wird ohne deine Freigabe veröffentlicht: jeder Beitrag landet in einer Warteschlange, in der du freigibst, bearbeitest oder löschst. Reels lassen sich nur in Chromium-Browsern (Chrome, Edge, Brave) erstellen; Bilder und Karussells überall.",
    },
    links: [{ href: "/social", label: { it: "Apri Social", en: "Open Social", es: "Abrir Redes", de: "Social öffnen" } }],
    related: ["marketing", "menu-manage", "credits"],
  },
  {
    id: "reviews",
    title: {
      it: "Recensioni dei clienti",
      en: "Guest reviews",
      es: "Reseñas de clientes",
      de: "Gästebewertungen",
    },
    keywords: ["recensione", "recensioni", "review", "reviews", "resena", "resenas", "bewertung", "bewertungen", "stelle", "stars", "estrellas", "sterne", "google recensioni", "feedback cliente", "rispondere recensione", "valutazione"],
    answer: {
      it: "Dopo la visita il bot chiede al cliente com'è andata: le valutazioni (stelle e commento) arrivano nella pagina Recensioni, dove puoi rispondere o nascondere quelle che non vuoi mostrare. Ai clienti soddisfatti viene proposto anche il link per lasciare la recensione su Google (si imposta in Impostazioni).",
      en: "After the visit the bot asks the guest how it went: ratings (stars and comment) land on the Reviews page, where you can reply or hide the ones you don't want shown. Happy guests are also offered the link to leave a Google review (set it up in Settings).",
      es: "Tras la visita el bot pregunta al cliente qué tal fue: las valoraciones (estrellas y comentario) llegan a la página Reseñas, donde puedes responder u ocultar las que no quieras mostrar. A los clientes satisfechos se les ofrece también el enlace para dejar la reseña en Google (se configura en Ajustes).",
      de: "Nach dem Besuch fragt der Bot den Gast, wie es war: Bewertungen (Sterne und Kommentar) landen auf der Seite Bewertungen, wo du antworten oder ausblenden kannst, was nicht gezeigt werden soll. Zufriedenen Gästen wird auch der Link für eine Google-Bewertung angeboten (einstellbar in den Einstellungen).",
    },
    links: [{ href: "/reviews", label: { it: "Apri Recensioni", en: "Open Reviews", es: "Abrir Reseñas", de: "Bewertungen öffnen" } }],
    related: ["conversations", "guests", "website"],
  },
  {
    id: "website",
    title: {
      it: "Sito web del locale",
      en: "Your venue's website",
      es: "Sitio web del local",
      de: "Webseite des Lokals",
    },
    keywords: ["sito", "sito web", "website", "web", "pagina web", "sitio web", "webseite", "homepage", "template sito", "design sito", "editor sito", "modificare sito", "foto sito", "colori sito", "galleria", "gallery"],
    answer: {
      it: "Il tuo locale ha un sito pubblico pronto, senza web agency: dalla pagina Sito web scegli il design tra 8 template, imposti foto di copertina, testi, galleria, colori e font, e decidi quali sezioni mostrare e in che ordine. Con l'editor visuale clicchi direttamente su testi e foto del sito per cambiarli. Il sito include menu, recensioni e il widget per prenotare online.",
      en: "Your venue gets a ready public website, no web agency needed: from the Website page you pick one of 8 template designs, set the cover photo, texts, gallery, colours and font, and choose which sections appear and in what order. With the visual editor you click directly on the site's texts and photos to change them. The site includes the menu, reviews and the online booking widget.",
      es: "Tu local tiene un sitio web público listo, sin agencia: desde la página Sitio web eliges el diseño entre 8 plantillas, defines la foto de portada, textos, galería, colores y tipografía, y decides qué secciones aparecen y en qué orden. Con el editor visual haces clic directamente en los textos y fotos del sitio para cambiarlos. El sitio incluye el menú, las reseñas y el widget de reserva online.",
      de: "Dein Lokal bekommt eine fertige öffentliche Webseite, ohne Agentur: auf der Seite Webseite wählst du eines von 8 Template-Designs, legst Titelbild, Texte, Galerie, Farben und Schrift fest und bestimmst, welche Abschnitte in welcher Reihenfolge erscheinen. Mit dem visuellen Editor klickst du direkt auf Texte und Fotos der Seite, um sie zu ändern. Die Seite enthält Speisekarte, Bewertungen und das Online-Reservierungswidget.",
    },
    links: [{ href: "/website", label: { it: "Apri Sito web", en: "Open Website", es: "Abrir Sitio web", de: "Webseite öffnen" } }],
    related: ["booking-widget", "menu-digital", "reviews"],
  },
  {
    id: "booking-widget",
    title: {
      it: "Prenotazioni online dal sito (widget)",
      en: "Online booking from the website (widget)",
      es: "Reservas online desde el sitio (widget)",
      de: "Online-Reservierung über die Webseite (Widget)",
    },
    keywords: ["widget", "prenotazione online", "prenotare online", "prenota dal sito", "book online", "booking widget", "online booking", "reserva online", "reservar online", "online reservieren", "buchungswidget", "slot", "orari prenotabili", "modulo prenotazione"],
    answer: {
      it: "I clienti prenotano da soli dal tuo sito: il widget (il bottone flottante in basso) propone solo giorni e orari davvero disponibili — rispetta orari di apertura, sale e ultimo orario prenotabile — e chiede nome, telefono ed email. La prenotazione arriva nel CRM: confermata da sola se rientra nelle tue regole, altrimenti finisce in Sospeso e decidi tu.",
      en: "Guests book by themselves from your website: the widget (the floating button at the bottom) only offers days and times that are truly available — it respects opening hours, rooms and the last bookable time — and asks for name, phone and email. The booking lands in the CRM: auto-confirmed if it fits your rules, otherwise it goes to Pending and you decide.",
      es: "Los clientes reservan solos desde tu sitio: el widget (el botón flotante de abajo) solo ofrece días y horas realmente disponibles — respeta horarios de apertura, salas y última hora reservable — y pide nombre, teléfono y email. La reserva llega al CRM: se confirma sola si cumple tus reglas; si no, va a Pendientes y decides tú.",
      de: "Gäste reservieren selbst über deine Webseite: das Widget (der schwebende Button unten) bietet nur wirklich verfügbare Tage und Zeiten an — es respektiert Öffnungszeiten, Räume und die letzte buchbare Uhrzeit — und fragt Name, Telefon und E-Mail ab. Die Reservierung landet im CRM: automatisch bestätigt, wenn sie deinen Regeln entspricht, sonst unter Ausstehend, und du entscheidest.",
    },
    links: [
      { href: "/website", label: { it: "Apri Sito web", en: "Open Website", es: "Abrir Sitio web", de: "Webseite öffnen" } },
      { href: "/reservations", label: { it: "Apri Prenotazioni", en: "Open Reservations", es: "Abrir Reservas", de: "Reservierungen öffnen" } },
    ],
    related: ["website", "reservations", "pending"],
  },
  {
    id: "email-settings",
    title: {
      it: "Email: collegare il tuo mittente",
      en: "Email: connecting your sender",
      es: "Email: conectar tu remitente",
      de: "E-Mail: deinen Absender verbinden",
    },
    keywords: ["email", "mittente", "resend", "chiave email", "email non parte", "email non partono", "email non arriva", "email non arrivano", "invio email", "problema email", "mandare email", "sender", "email key", "emails not sending", "send email", "remitente", "correo", "clave email", "enviar correo", "absender", "e-mail schlussel", "e-mail senden", "dominio verificato", "verified domain", "smtp"],
    answer: {
      it: "Le email del CRM (campagne, buoni regalo, coupon, conferme) partono dal TUO mittente: in Impostazioni → Email colleghi la chiave del tuo account Resend e scegli il nome mittente. L'indirizzo deve stare su un dominio che hai verificato su Resend, altrimenti l'invio viene rifiutato. Senza chiave collegata il CRM non invia nessuna email; alla connessione ricevi un'email di prova per verificare che tutto funzioni.",
      en: "The CRM's emails (campaigns, gift cards, coupons, confirmations) go out from YOUR sender: in Settings → Email you connect your Resend account key and choose the sender name. The address must be on a domain you verified on Resend, otherwise sending is rejected. Without a connected key the CRM sends no emails at all; on connection you get a test email to check everything works.",
      es: "Los emails del CRM (campañas, tarjetas regalo, cupones, confirmaciones) salen desde TU remitente: en Ajustes → Email conectas la clave de tu cuenta de Resend y eliges el nombre del remitente. La dirección debe estar en un dominio verificado en Resend; si no, el envío se rechaza. Sin clave conectada el CRM no envía ningún email; al conectar recibes un email de prueba para comprobar que todo funciona.",
      de: "Die E-Mails des CRM (Kampagnen, Gutscheine, Coupons, Bestätigungen) gehen über DEINEN Absender: unter Einstellungen → E-Mail verbindest du den Schlüssel deines Resend-Kontos und wählst den Absendernamen. Die Adresse muss auf einer bei Resend verifizierten Domain liegen, sonst wird der Versand abgelehnt. Ohne verbundenen Schlüssel versendet das CRM gar keine E-Mails; nach dem Verbinden bekommst du eine Test-E-Mail zur Kontrolle.",
    },
    links: [{ href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } }],
    related: ["marketing", "gift-cards", "settings"],
  },
  {
    id: "credits",
    title: {
      it: "Crediti del bot: saldo e ricariche",
      en: "Bot credits: balance and top-ups",
      es: "Créditos del bot: saldo y recargas",
      de: "Bot-Guthaben: Stand und Aufladen",
    },
    keywords: ["crediti", "credito", "saldo crediti", "ricarica", "ricaricare", "credits", "credit", "top up", "topup", "creditos", "recarga", "guthaben", "aufladen", "crediti finiti", "quanto costa un messaggio", "pacchetto crediti", "wallet"],
    answer: {
      it: "Il bot consuma crediti prepagati: ogni risposta su WhatsApp scala il saldo. In Impostazioni → Crediti vedi quanto ti resta, quanto costa ogni azione, lo storico di quello che hai speso e i pacchetti per ricaricare. Se i crediti finiscono il bot smette di rispondere finché non ricarichi — il CRM e le prenotazioni manuali continuano a funzionare normalmente.",
      en: "The bot runs on prepaid credits: every WhatsApp reply deducts from the balance. In Settings → Credits you see what's left, what each action costs, the history of what you spent and the packs to top up. If credits run out the bot stops replying until you top up — the CRM and manual bookings keep working normally.",
      es: "El bot consume créditos prepagados: cada respuesta por WhatsApp descuenta del saldo. En Ajustes → Créditos ves cuánto te queda, cuánto cuesta cada acción, el historial de lo gastado y los paquetes para recargar. Si los créditos se agotan el bot deja de responder hasta que recargues — el CRM y las reservas manuales siguen funcionando con normalidad.",
      de: "Der Bot läuft auf Prepaid-Guthaben: jede WhatsApp-Antwort zieht vom Stand ab. Unter Einstellungen → Credits siehst du, was übrig ist, was jede Aktion kostet, die Ausgaben-Historie und die Pakete zum Aufladen. Ist das Guthaben leer, antwortet der Bot nicht mehr, bis du auflädst — CRM und manuelle Reservierungen funktionieren normal weiter.",
    },
    links: [{ href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } }],
    related: ["billing", "conversations", "whatsapp-connect"],
  },
  {
    id: "fiscal",
    title: {
      it: "Fiscale (Spagna): VERI*FACTU e resi",
      en: "Fiscal (Spain): VERI*FACTU and refunds",
      es: "Fiscal (España): VERI*FACTU y devoluciones",
      de: "Fiskal (Spanien): VERI*FACTU und Erstattungen",
    },
    keywords: ["verifactu", "veri factu", "fiscale", "fiscal", "aeat", "hacienda", "fattura fiscale", "factura", "qr scontrino", "qr ticket", "reso", "reso parziale", "rimborso", "rimborso parziale", "rimborsare", "devolucion", "reembolso", "devolver", "rectificativa", "refund", "partial refund", "erstattung", "steuer", "finanzamt", "nif"],
    answer: {
      it: "Per i locali in Spagna la cassa emette documenti a norma VERI*FACTU: ogni scontrino entra in un registro immutabile con il QR dell'AEAT stampato sopra, e viene trasmesso automaticamente. Si configura in Impostazioni → Fiscale (serve il NIF di chi emette le fatture). I rimborsi, anche parziali, si fanno dallo scontrino in cassa: viene emesso un documento rettificativo collegato all'originale — mai una cancellazione.",
      en: "For venues in Spain the till issues VERI*FACTU-compliant documents: every receipt enters an immutable registry with the AEAT QR printed on it, and is transmitted automatically. Set it up in Settings → Fiscal (you need the NIF of whoever issues the invoices). Refunds, including partial ones, are done from the receipt at the till: a corrective document linked to the original is issued — never a deletion.",
      es: "Para locales en España la caja emite documentos conformes a VERI*FACTU: cada ticket entra en un registro inmutable con el QR de la AEAT impreso, y se transmite automáticamente. Se configura en Ajustes → Fiscal (hace falta el NIF de quien emite las facturas). Las devoluciones, también parciales, se hacen desde el ticket en la caja: se emite una factura rectificativa vinculada a la original — nunca se borra nada.",
      de: "Für Lokale in Spanien stellt die Kasse VERI*FACTU-konforme Belege aus: jeder Bon kommt in ein unveränderliches Register mit aufgedrucktem AEAT-QR und wird automatisch übermittelt. Einrichtung unter Einstellungen → Fiskal (du brauchst die NIF des Rechnungsausstellers). Erstattungen, auch teilweise, erfolgen vom Bon an der Kasse: es wird ein mit dem Original verknüpftes Korrekturdokument ausgestellt — nie eine Löschung.",
    },
    links: [
      { href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } },
      { href: "/cassa", label: { it: "Apri la Cassa", en: "Open the Till", es: "Abrir la Caja", de: "Kasse öffnen" } },
    ],
    related: ["cassa-receipts", "cassa-pay", "settings"],
  },
  {
    id: "bot-pause",
    title: {
      it: "Mettere in pausa il bot o intervenire tu",
      en: "Pausing the bot or stepping in yourself",
      es: "Pausar el bot o intervenir tú",
      de: "Bot pausieren oder selbst übernehmen",
    },
    keywords: ["pausa bot", "pausare bot", "spegnere bot", "fermare bot", "bot spento", "pause bot", "stop bot", "turn off bot", "pausar bot", "apagar bot", "bot pausieren", "bot ausschalten", "silenzia bot", "bot non deve rispondere", "riattivare bot", "paus", "bot"],
    answer: {
      it: "Hai due modi per zittire il bot. Per una singola chat: rispondi tu al cliente (dal CRM o dal tuo WhatsApp) e il bot si fa da parte in quella conversazione. Per tutto il locale: in Impostazioni → Prenotazioni c'è l'interruttore di pausa — il bot smette di rispondere a tutti e manda ai clienti un messaggio di cortesia che scegli tu (es. con il tuo numero). Riattivi con lo stesso interruttore.",
      en: "You have two ways to silence the bot. For a single chat: reply to the guest yourself (from the CRM or your own WhatsApp) and the bot steps aside in that conversation. For the whole venue: in Settings → Bookings there's the pause switch — the bot stops replying to everyone and sends guests a courtesy message you choose (e.g. with your number). Turn it back on with the same switch.",
      es: "Tienes dos formas de silenciar el bot. Para un solo chat: responde tú al cliente (desde el CRM o desde tu propio WhatsApp) y el bot se aparta en esa conversación. Para todo el local: en Ajustes → Reservas está el interruptor de pausa — el bot deja de responder a todos y envía a los clientes un mensaje de cortesía que eliges tú (ej. con tu número). Lo reactivas con el mismo interruptor.",
      de: "Du kannst den Bot auf zwei Arten stummschalten. Für einen einzelnen Chat: antworte dem Gast selbst (im CRM oder von deinem eigenen WhatsApp) und der Bot zieht sich in dieser Konversation zurück. Für das ganze Lokal: unter Einstellungen → Reservierungen gibt es den Pause-Schalter — der Bot antwortet niemandem mehr und schickt den Gästen eine von dir gewählte Hinweisnachricht (z. B. mit deiner Nummer). Mit demselben Schalter aktivierst du ihn wieder.",
    },
    links: [
      { href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } },
      { href: "/conversations", label: { it: "Apri Conversazioni", en: "Open Conversations", es: "Abrir Conversaciones", de: "Konversationen öffnen" } },
    ],
    related: ["conversations", "whatsapp-connect", "settings"],
  },
  {
    id: "commercial-info",
    title: {
      it: "Listini e info commerciali per il bot",
      en: "Price lists & commercial info for the bot",
      es: "Listas de precios e info comercial para el bot",
      de: "Preislisten & Verkaufsinfos für den Bot",
    },
    keywords: ["listino", "listini", "prezzi torte", "menu fisso", "menu fissi", "buffet", "price list", "set menu", "lista de precios", "menu del dia", "preisliste", "festmenu", "info commerciali", "il bot manda i prezzi", "torte", "catering prezzi"],
    answer: {
      it: "In Impostazioni → Listini & Info carichi i contenuti commerciali che il bot può mandare da solo ai clienti: torte, menù fissi, buffet, liste piatti o altro. Scegli il modello, incolli il testo che già mandi su WhatsApp e salvi: quando un cliente chiede (es. «avete torte di compleanno?») il bot risponde col tuo listino, senza disturbarti.",
      en: "In Settings → Price lists & Info you load the commercial content the bot can send to guests on its own: cakes, set menus, buffet, dish lists or anything else. Pick the template, paste the text you already send on WhatsApp and save: when a guest asks (e.g. “do you do birthday cakes?”) the bot replies with your price list, without bothering you.",
      es: "En Ajustes → Listas & Info cargas el contenido comercial que el bot puede enviar solo a los clientes: tartas, menús cerrados, buffet, listas de platos u otros. Eliges la plantilla, pegas el texto que ya envías por WhatsApp y guardas: cuando un cliente pregunta (ej. «¿hacéis tartas de cumpleaños?») el bot responde con tu lista, sin molestarte.",
      de: "Unter Einstellungen → Preislisten & Info hinterlegst du Verkaufsinhalte, die der Bot selbstständig an Gäste senden darf: Torten, Festmenüs, Buffet, Gerichtelisten oder anderes. Vorlage wählen, den Text einfügen, den du schon per WhatsApp verschickst, speichern: fragt ein Gast (z. B. „macht ihr Geburtstagstorten?“), antwortet der Bot mit deiner Preisliste, ohne dich zu stören.",
    },
    links: [
      { href: "/settings", label: { it: "Apri Impostazioni", en: "Open Settings", es: "Abrir Ajustes", de: "Einstellungen öffnen" } },
      { href: "/knowledge", label: { it: "Apri Info Locale", en: "Open Knowledge", es: "Abrir Knowledge", de: "Knowledge öffnen" } },
    ],
    related: ["knowledge", "conversations", "menu-manage"],
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
