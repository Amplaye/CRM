// Pure data module — NO "use client": the /s/[slug] SERVER page imports the
// default copy and font URLs from here. (Importing them from the client
// template modules hands the server opaque client-reference proxies, whose
// spread is {} — every editable block would silently fall back to empty.)
// The template components import their own constants from here too.

export const SUERTE_FONTS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..700&family=Space+Grotesk:wght@400..700&family=Caveat:wght@500..700&display=swap";

export const SUERTE_DEFAULTS: Record<string, string> = {
  "marquee.text": "Abierto ahora · Cocina fresca del día · La suerte está servida · Pasta hecha en casa · Buon appetito",
  "hero.badge": "Trattoria · Pizzería · Triana",
  "hero.title": "La suerte está servida",
  "hero.script": "la fortuna è servita",
  "hero.text":
    "Pizza de horno y pasta de la casa en el corazón del barrio. Corta, honesta y con cariño — la trattoria de barrio de toda la vida.",
  "hero.sticker": "Buon appetito!",
  "hero.image": "https://la-suerte-17.pages.dev/img/hero.jpg",
  "story.eyebrow": "Hola, somos la casa",
  "story.quote": "“No tenemos una carta de mil platos. Tenemos los que cocinaría para mi familia.”",
  "story.p1":
    "Abrimos porque creíamos en una idea sencilla: masa que reposa de verdad, salsa de tomate que sabe a tomate, y una mesa donde la gente del barrio se siente en casa.",
  "story.p2":
    "Aquí no hay humo ni postureo. Hay horno encendido, pasta colgada secándose y un sitio al que querrás volver el martes por la noche sin pensarlo.",
  "story.sign": "Con cariño,",
  "story.image": "https://la-suerte-17.pages.dev/img/owner.jpg",
  "food.eyebrow": "Lo que cocinamos",
  "food.title": "Pocas cosas, bien hechas",
  "food.text":
    "Masa de fermentación lenta, pasta fresca y recetas de siempre. Carta corta a propósito: para hacerlo todo bien.",
  "special.badge": "Imprescindible",
  "special.eyebrow": "La casa recomienda",
  "special.title": "Nuestra especialidad",
  "special.text":
    "El plato que más nos piden y del que más orgullosos estamos. Receta de siempre, ingredientes de verdad y ese punto de horno que solo da el tiempo. Si es tu primera vez, pídelo.",
  "special.image": "https://la-suerte-17.pages.dev/img/special.jpg",
  "book.eyebrow": "Pide o resérvate sitio",
  "book.title": "Tu mesa te está esperando",
  "book.text": "Reserva en 20 segundos y te esperamos con la mesa lista.",
  "reviews.eyebrow": "Lo que dicen",
  "reviews.title": "La gente del barrio habla",
  "visit.eyebrow": "Visítanos",
  "visit.title": "Aquí nos encuentras",
  "marquee2.text": "Mangia! · Buon appetito · Grazie · La fortuna è servita",
  "footer.tagline": "La trattoria de barrio que querías cerca.",
  "footer.script": "La suerte está servida",
};

export const DOLCEVITA_FONTS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&family=DM+Sans:ital,wght@0,400..700;1,400..700&display=swap";

export const DOLCEVITA_DEFAULTS: Record<string, string> = {
  "marquee.text":
    "Buonasera · Trattoria familiar · Pasta fresca de la nonna · Postres legendarios · Vinos italianos · Cena para dos · Ti aspettiamo",
  "hero.eyebrow": "Estás invitado a",
  "hero.line2": "",
  "hero.seal": "dal 1999",
  "hero.script": "La vida, despacio y con vino.",
  "hero.tag": "La mesa romántica nº1 del barrio",
  "hero.text":
    "Veinticinco años encendiendo velas en una calle peatonal del barrio. Pasta fresca, vino italiano y postres que se recuerdan. Esta noche, la mesa es para dos.",
  "stats.1.n": "+25",
  "stats.1.label": "años encendiendo velas",
  "stats.2.n": "100%",
  "stats.2.label": "pasta fresca casera",
  "stats.3.n": "4.4★",
  "stats.3.label": "reseñas",
  "cocina.eyebrow": "a tavola",
  "cocina.title": "La cocina de casa",
  "cocina.text": "Pasta fresca cada mañana, recetas que cruzaron el mar con la familia.",
  "occasions.script": "con amore ♥",
  "occasions.title": "Reserva tu noche",
  "occasions.text": "La mesa romántica del barrio. Dinos qué celebras y nosotros encendemos las velas.",
  "occasions.image": "https://la-dolce-vita-a2g.pages.dev/img/local-noche.jpg",
  "occasions.sticker": "buonasera ♥",
  "occasions.1.title": "Cena para dos",
  "occasions.1.text": "Mesa a la luz de la vela, pasta fresca y vino italiano. La cita perfecta.",
  "occasions.2.title": "Aniversarios",
  "occasions.2.text": "Lo celebramos contigo: postre con vela y un brindis de la casa.",
  "occasions.3.title": "La pedida",
  "occasions.3.text": "Cuéntanoslo en secreto. Preparamos el momento que recordarán siempre.",
  "familia.image": "https://la-dolce-vita-a2g.pages.dev/img/owner.jpg",
  "familia.sticker": "la famiglia",
  "familia.eyebrow": "la famiglia",
  "familia.title": "La mesa larga del domingo",
  "familia.p1":
    "Llegamos al barrio hace veinticinco años con una maleta, una receta de la nonna y la idea testaruda de que una buena cena no se tiene prisa. Levantamos la trattoria bajo arcos que nos recuerdan a Florencia, amasamos la pasta cada mañana y encendemos las velas antes de que entre el primer invitado.",
  "familia.p2":
    "No servimos clientes: recibimos a gente que celebra algo, aunque ese algo sea simplemente estar juntos una noche más. Esa es, para nosotros, la dolce vita.",
  "familia.quote": "“Aquí no servimos clientes. Recibimos invitados.”",
  "familia.caption": "La famiglia",
  "book.eyebrow": "tavolo per due",
  "book.title": "Reserva tu noche",
  "book.text": "Dinos si celebras algo: encenderemos la vela correcta.",
  "book.script": "ti aspettiamo",
  "reviews.eyebrow": "♥ le parole",
  "reviews.title": "Lo que se llevan a casa",
  "visit.eyebrow": "ti aspettiamo",
  "visit.title": "Encuéntranos",
  "marquee2.text": "Buonasera · La dolce vita · Grazie mille · Pasta fresca · Vino italiano · A presto",
  "footer.script": "“La dolce vita se cena despacio.”",
};

export const CHAMPINONERIA_FONTS =
  "https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300..700;1,300..700&family=Inter:wght@400..700&display=swap";

export const CHAMPINONERIA_DEFAULTS: Record<string, string> = {
  "nav.tagline": "Vegueta · bistró de setas",
  "hero.image": "https://la-champinoneria.pages.dev/images/mesa-setas.jpg",
  "hero.text":
    "Un bistró de barrio obsesionado con la seta: más de quince preparaciones, cocina casera y producto fresco en una casa antigua de paredes rojas, junto al mercado de Vegueta. Un hidden gem que solo conocen los que saben.",
  "nota.eyebrow": "Una nota de la casa",
  "nota.quote":
    "«Nos enamoramos del champiñón y nunca se nos pasó. Si te sientas aquí, queremos que descubras todo lo que una seta puede llegar a ser.»",
  "nota.caption": "La cocina de la casa",
  "casa.eyebrow": "La casa · La maison",
  "casa.title": "Un bistró valiente, obsesionado con la seta",
  "casa.p1":
    "En una casa antigua de Vegueta, de paredes rojas y madera de cerezo, este bistró lleva años haciendo algo que nadie más se atreve: poner el champiñón y la seta en el centro de todo. Más de quince preparaciones, cocina casera y raciones generosas a precio honesto.",
  "casa.p2":
    "Aquí no hay artificio. Hay setas con gambas, croquetas de verdura que llaman «las mejores», champiñones rellenos, revueltos generosos y un Polvito uruguayo que se ha hecho leyenda. Producto fresco y manos de casa, sin prisa.",
  "casa.image": "https://la-champinoneria.pages.dev/images/fachada.jpg",
  "carta.eyebrow": "Platos firma",
  "carta.title": "La casa, plato a plato",
  "carta.text": "Una selección de lo que mejor nos define. El resto, en la carta.",
  "marquee.text": "Setas con gambas · Champiñones rellenos · Revuelto gigante · A la crema · Bon appétit",
  "mesa.eyebrow": "De la sartén a la mesa",
  "mesa.title": "Quince maneras de querer a una seta",
  "mesa.image": "https://la-champinoneria.pages.dev/images/quince-setas.jpg",
  "reserva.eyebrow": "La mesa",
  "reserva.title": "Reserva tu mesa",
  "reserva.text": "Cuéntanos cuándo y cuántos sois y te confirmamos enseguida.",
  "resenas.eyebrow": "Lo que dicen",
  "resenas.title": "La mesa habla",
  "resenas.text": "Palabras de quienes ya se han sentado a nuestra mesa.",
  "resenas.ctaText": "¿Has comido en la casa? Cuéntalo y ayuda a los que aún no la conocen.",
  "resenas.cta": "Escribir reseña",
  "encontrar.eyebrow": "Encuéntranos",
  "encontrar.title": "En el corazón de Vegueta",
  "encontrar.text": "Junto al mercado y la Casa de Colón.",
  "footer.tagline": "Vegueta · bistró de setas",
  "footer.line": "El templo del champiñón en Vegueta",
};

export const PICNIC_FONTS =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Inter:wght@300..600&display=swap";

export const PICNIC_DEFAULTS: Record<string, string> = {
  "brand.subtitle": "Trattoria Napoletana",
  "hero.image": "https://picnic-web-tau.vercel.app/assets/frames/frame_0400.webp",
  "hero.kicker": "Trattoria Napoletana · Las Palmas de Gran Canaria",
  "hero.title": "Benvenuto",
  "hero.titleItalic": "a Napoli",
  "hero.sub": "en el corazón de Las Palmas",
  "hero.scroll": "Scroll",
  "marquee.text": "4.6 · 200+ reseñas · Pizza Napoletana · Las Palmas de Gran Canaria",
  "about.kicker": "Nuestra historia",
  "about.title": "Una trattoria napolitana",
  "about.titleItalic": "con alma",
  "about.text":
    "Nuestra trattoria nació del amor por Nápoles y por la buena mesa. Cada pizza que sale de nuestro horno de leña es un pedazo de Italia en el corazón de Las Palmas. A dos pasos de Triana, te esperamos como si fueras de casa.",
  "about.image1": "https://picnic-web-tau.vercel.app/assets/interior-warm.jpg",
  "about.image2": "https://picnic-web-tau.vercel.app/assets/ingredientes.jpg",
  "about.p1title": "Horno de leña",
  "about.p1text": "Masa napolitana de 48h de fermentación lenta",
  "about.p2title": "Ingredientes frescos",
  "about.p2text": "Importados directamente de Italia con cariño",
  "about.p3title": "Con alma",
  "about.p3text": "Cada plato hecho con amor y mucho orégano",
  "menu.kicker": "Especialidades",
  "menu.title": "Cada plato,",
  "menu.titleItalic": "un pedazo de Nápoles",
  "menu.text": "Elaborados con ingredientes frescos y mucho cariño",
  "quote.image": "https://picnic-web-tau.vercel.app/assets/italian-street.jpg",
  "quote.text": "“Siempre hay una pizza esperándote.”",
  "reviews.kicker": "Opiniones",
  "reviews.title": "Lo que dicen",
  "reservas.image": "https://picnic-web-tau.vercel.app/assets/terrace-night.jpg",
  "reservas.kicker": "Reservas",
  "reservas.title": "¿Tienes",
  "reservas.titleItalic": "hambre?",
  "reservas.text": "Reserva online y te esperamos con la masa ya estirada.",
  "footer.navTitle": "Navegación",
  "footer.script": "Hecho con amor y mucho orégano.",
};

export const PEREZBEERS_FONTS =
  "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,900;1,400;1,500;1,600;1,700;1,900&family=Inter:wght@400..600&display=swap";

export const PEREZBEERS_DEFAULTS: Record<string, string> = {
  "nav.subtitle": "Vegueta · LPGC",
  "hero.eyebrow": "Vegueta · Las Palmas · desde 2006",
  "hero.line2": "&",
  "hero.line3": "Beers",
  "hero.bgword": "Beers",
  "hero.sub": "la casa de siempre, renovada",
  "hero.tagline": "“El primer brindis del casco antiguo.”",
  "hero.text":
    "Una catedral de la cerveza en la piedra del casco antiguo. Lo primero que ves al cruzar a Vegueta: +150 referencias, cocina canaria-alemana y la terraza más buscada junto a la Catedral.",
  "hero.img1": "https://perez-and-beers.pages.dev/_astro/ubicacion-esquina.CtoEv1-v_H9fRE.webp",
  "hero.img2": "https://perez-and-beers.pages.dev/_astro/barra-iv.BZFPq17f_Zf5IS1.webp",
  "hero.img3": "https://perez-and-beers.pages.dev/_astro/interior-bar-real.eq1eSWr5_vW6MW.webp",
  "hero.sticker1": "Vegueta",
  "hero.sticker2": "Desde 2006",
  "marquee.text": "Cerveza de barril · +150 referencias · Picoteo canario · Junto a la Catedral · Vegueta desde 2006",
  "secreto.eyebrow": "La puerta de Vegueta",
  "secreto.title": "Lo primero que ves al cruzar a Vegueta",
  "secreto.p1":
    "A cien metros de la Catedral de Santa Ana, donde empieza la piedra volcánica del casco antiguo, estamos nosotros: la primera parada al entrar en Vegueta. Desde 2006 servimos cerveza como se merece —en su copa, a su temperatura— y picoteo que cruza Canarias con Centroeuropa.",
  "secreto.p2": "Estamos a medio camino de convertirnos en algo nuevo. El nombre cambia; el sitio de siempre, no.",
  "secreto.stat1": "2006",
  "secreto.stat1Label": "VEGUETA",
  "secreto.stat2": "100 m",
  "secreto.stat2Label": "CATEDRAL SANTA ANA",
  "secreto.image": "https://perez-and-beers.pages.dev/_astro/storefront-front.DiXH7J0-_1Ag8WQ.webp",
  "cervezas.eyebrow": "La bóveda",
  "cervezas.number": "150",
  "cervezas.label": "cervezas en carta",
  "cervezas.title": "Más de 150 cervezas, tratadas como joyas",
  "cervezas.text":
    "Nacionales e internacionales, con debilidad confesa por las belgas y orgullo por las artesanas canarias. Cada una en su vaso correcto, a su temperatura justa.",
  "cervezas.chip1": "Belgas de barril",
  "cervezas.chip2": "Artesanas canarias",
  "cervezas.chip3": "IPA & tostadas",
  "cervezas.chip4": "Sin alcohol",
  "cocina.eyebrow": "La cocina",
  "cocina.title": "Canarias y Alemania, en la misma mesa",
  "cocina.text":
    "Fusión de verdad, no de postal. Mojos que pican y codillos que reconfortan, para acompañar la cerveza o para quedarse a cenar.",
  "jueves.image": "https://perez-and-beers.pages.dev/_astro/hero-bar.DxLxDex-_3JNoh.webp",
  "jueves.eyebrow": "El ritual",
  "jueves.title": "Jueves de pinchos de Vegueta",
  "jueves.text":
    "Cada jueves el barrio entero baja a Vegueta. Nosotros respondemos con pinchos, cerveza fría y música en vivo. Es nuestro día y el del casco antiguo.",
  "jueves.item1": "Pinchos toda la tarde-noche",
  "jueves.item2": "Música en vivo",
  "jueves.item3": "El plan de Vegueta de toda la vida",
  "reserva.eyebrow": "Tu mesa",
  "reserva.title": "Reserva en menos de 30 segundos",
  "reserva.text":
    "Dinos cuándo y cuántos sois. Si tienes una alergia, escríbela: la tendremos en cuenta antes de que llegues.",
  "reviews.eyebrow": "Lo que dicen",
  "reviews.title": "El brindis de la clientela",
  "encuentranos.eyebrow": "Encuéntranos",
  "encuentranos.title": "Junto a la Catedral, en el corazón de Vegueta",
  "encuentranos.image": "https://perez-and-beers.pages.dev/_astro/storefront-night.IhxRd4yP_2d6kYG.webp",
  "encuentranos.note": "Casco antiguo peatonal.",
  "footer.tagline": "“El primer brindis del casco antiguo.”",
};

export const VASCO_FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@300..800&family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&display=swap";

export const VASCO_DEFAULTS: Record<string, string> = {
  "nav.sub": "DE VEGUETA",
  "hero.eyebrow": "Asador · Tasca vasca · Vegueta",
  "hero.badge": "Tortilla campeona · Concurso de Vegueta",
  "hero.title1": "Euskadi en el",
  "hero.title2": "corazón de Vegueta",
  "hero.text":
    "Una tasca-asador vasca de clásicos honestos: producto, brasa y tradición en una casa de piedra junto a la Catedral. No es una barra de pintxos — es la cocina de casa, bien hecha.",
  "hero.image": "https://el-vasco-de-vegueta.pages.dev/images/terraza.jpg",
  "hero.marquee": "La casa de Vegueta · Euskadi en Vegueta · Euskal sukaldaritza · Tortilla campeona · Concurso de Vegueta",
  "casa.eyebrow": "La casa · Etxea",
  "casa.title": "Un pedacito de Euskadi, cruzando el Atlántico",
  "casa.p1":
    "Arantxa dejó su Euskadi natal con una idea sencilla y terca: cocinar para Vegueta como se cocina en casa, sin atajos. Una casa de piedra del casco histórico, una brasa encendida y la carta de siempre.",
  "casa.p2":
    "Aquí no encontrarás una barra de pintxos. Encontrarás txuleta en su punto, bacalao al pil-pil ligado con paciencia, marmitako de los de cuchara y una tarta de queso que no necesita presentación. Producto y tradición, contados con calma.",
  "casa.notelabel": "Una nota de la dueña",
  "casa.quote":
    "“Me traje la cocina de mi madre y la mesa larga de los domingos. Si te sientas a comer aquí, quiero que te vayas como si volvieras de Euskadi: lleno y contento.”",
  "casa.caption": "Arantxa del Valle — Al frente de la cocina",
  "casa.image": "https://el-vasco-de-vegueta.pages.dev/images/arantxa.jpg",
  "carta.eyebrow": "La carta de la casa",
  "carta.title": "Clásicos vascos, bien hechos",
  "carta.text": "Platos que cuentan quiénes somos. Producto de temporada, brasa y respeto por la receta. Lo demás, en la carta.",
  "tortilla.eyebrow": "El gancho de la casa",
  "tortilla.title1": "La tortilla",
  "tortilla.title2": "campeona",
  "tortilla.badge": "Ganadora · Concurso de Tortilla de Vegueta",
  "tortilla.text":
    "Papa asada al romero, boletus, foie y jamón de pata negra. Cuajada en su punto justo, jugosa por dentro. Ganó el concurso de Vegueta y desde entonces no falta en la mesa. Pídela; es la mejor manera de empezar a entendernos.",
  "tortilla.cta": "Está en la carta",
  "tortilla.sticker": "Nº1",
  "tortilla.image": "https://el-vasco-de-vegueta.pages.dev/images/dishes/tortilla-campeona.jpg",
  "txakoli.eyebrow": "Para beber",
  "txakoli.title": "Txakoli & sidra",
  "txakoli.text":
    "El txakoli se escancia desde lo alto para despertarlo; la sidra, igual. Es gesto y es cultura: el chorro largo, la chispa, el brindis. Acompaña la brasa y los pescados como nada.",
  "txakoli.toast": "Topa! · On egin",
  "txakoli.image": "https://el-vasco-de-vegueta.pages.dev/images/dishes/quesos.jpg",
  "txakoli.marquee": "Topa! · On egin · Txakoli · Sagardoa · Eskerrik asko",
  "book.eyebrow": "Reserva tu mesa",
  "book.title": "La mesa está puesta",
  "book.text": "Cuéntanos cuándo venís y te confirmamos enseguida.",
  "resenas.eyebrow": "Lo que dicen",
  "resenas.title": "La mesa habla",
  "resenas.text": "Opiniones reales de quienes ya se han sentado.",
  "resenas.cta": "Escribir reseña",
  "find.eyebrow": "Encuéntranos",
  "find.title": "En el casco de Vegueta",
  "find.text": "Junto a la Catedral de Santa Ana y la Casa de Colón.",
  "footer.tagline": "Euskadi en el corazón de Vegueta",
};

export const MONTESDEOCA_FONTS =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=EB+Garamond:ital,wght@0,400..600;1,400..600&display=swap";

const DEMO = "https://casa-montesdeoca.pages.dev/images";

export const MONTESDEOCA_DEFAULTS: Record<string, string> = {
  "nav.casa": "La Casa", "nav.patio": "El Patio", "nav.cocina": "La Cocina",
  "hero.kicker": "Restaurante · Vegueta · Las Palmas de Gran Canaria",
  "hero.subtitle": "Vegueta · Desde el Siglo XVI", "hero.scroll": "Descubrir",
  "hero.image": `${DEMO}/hero-patio-desktop-16x9.jpg`,
  "casa1.kicker": "La Casa · Siglo XVI", "casa1.num": "XVI",
  "casa1.title": "Una casa de comerciante que huyó de la Inquisición",
  "casa1.text": "La levantó un mercader que huyó de la Inquisición. Sus muros de cantería están entre los más antiguos que todavía se habitan en Vegueta.",
  "casa1.image": `${DEMO}/umbral-puerta-colonial-16x9.jpg`,
  "casa2.kicker": "La Casa · El Descubrimiento", "casa2.num": "1492",
  "casa2.title": "Colón rezó aquí antes de partir",
  "casa2.text": "Cristóbal Colón pasó por estas salas en vísperas de su primer viaje a las Américas, cuando Las Palmas era el último puerto del mundo conocido.",
  "casa2.image": `${DEMO}/salon-interior-epoca-16x9.jpg`,
  "casa3.kicker": "La Casa · Hoy", "casa3.num": "∞",
  "casa3.title": "La mesa favorita de la realeza española",
  "casa3.text": "Hoy, cinco siglos después, esa misma historia se sirve en cada plato: la cocina canaria más auténtica en el marco más singular de las islas.",
  "casa3.image": `${DEMO}/galeria-mesa-vela-lino-4x5.jpg`,
  "patio.kicker": "El Patio", "patio.quote": "“El patio más bello de las islas”",
  "patio.text": "Bajo las buganvillas que descienden en cascada, el tiempo se detiene. Cada rincón del patio conserva la memoria viva de Vegueta, donde el siglo XVI y el presente comparten mesa.",
  "patio.image": `${DEMO}/rincon-patio-vegetacion-4x5.jpg`,
  "cocina.kicker": "La Cocina", "cocina.title": "Canarias en su esencia más pura",
  "bodega.kicker": "La Bodega", "bodega.title": "La Bodega",
  "bodega.tagline": "Pequeños bodegueros canarios · Alma y territorio",
  "bodega.image": `${DEMO}/bodega-vino-canario-4x5.jpg`, "bodega.caption": "Selección del sommelier",
  "bodega1.type": "Blanco", "bodega1.name": "Tajinaste Tradicional Blanco",
  "bodega1.detail": "Listán Blanco · Valle de La Orotava, Tenerife", "bodega1.price": "28€",
  "bodega2.type": "Tinto", "bodega2.name": "Bentayga Tinto",
  "bodega2.detail": "Listán Negro, Tintilla · Gran Canaria", "bodega2.price": "30€",
  "bodega3.type": "Blanco", "bodega3.name": "El Grifo Malvasía Seco",
  "bodega3.detail": "Malvasía Volcánica · Lanzarote", "bodega3.price": "32€",
  "galeria.kicker": "Galería", "galeria.title": "Imágenes",
  "gal1.image": `${DEMO}/hero-patio-desktop-16x9.jpg`, "gal1.caption": "El patio al anochecer",
  "gal2.image": `${DEMO}/galeria-mesa-vela-lino-4x5.jpg`, "gal2.caption": "La mesa servida",
  "gal3.image": `${DEMO}/plato-02-pulpo-4x5.jpg`, "gal3.caption": "Pulpo con su escaldón",
  "gal4.image": `${DEMO}/detalle-balcones-madera-4x5.jpg`, "gal4.caption": "Balcón canario tallado",
  "gal5.image": `${DEMO}/salon-interior-epoca-16x9.jpg`, "gal5.caption": "Salón de cantería",
  "gal6.image": `${DEMO}/rincon-patio-vegetacion-4x5.jpg`, "gal6.caption": "El rincón del patio",
  "reservar.title": "Solicitar Mesa",
  "reservar.text": "Nos pondremos en contacto para confirmar su reserva en breve.",
  "reservar.image": `${DEMO}/galeria-mesa-vela-lino-4x5.jpg`,
  "reviews.kicker": "Opiniones", "reviews.title": "Lo que se dice de esta casa",
  "visit.kicker": "Visítenos", "visit.title": "Encuéntranos",
};
