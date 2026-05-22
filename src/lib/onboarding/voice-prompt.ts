// Server-side voice prompt template.
//
// SaaS principle: the voice agent's behaviour is the AGENCY's template, not
// something each client writes. The restaurateur never sees or edits this — it
// is filled in from their structured data (name, language, opening hours) at
// provisioning time and stored as the special "VOICE PROMPT" KB article, which
// sync-kb-vapi uses as the body of the Vapi assistant's system prompt (with the
// published KB articles concatenated after it).

import type { Lang } from "./kb-generator";

export type OpeningSlot = { open: string; close: string };
export type OpeningHours = Record<string, OpeningSlot[]>; // keys "0".."6", Sunday=0

interface PromptStrings {
  identity: (name: string) => string;
  schedule: string;
  tasksHeader: string;
  rulesHeader: string;
  book: string;
  modify: string;
  info: string;
  outOfHours: string;
  noInvent: string;
  confirm: string;
  endCall: string;
  closed: string;
  days: [string, string, string, string, string, string, string]; // index 0=Sun..6=Sat
}

const STR: Record<Lang, PromptStrings> = {
  es: {
    identity: (n) => `Eres el agente vocal de ${n}. Responde breve y cálido, máximo 2 frases por turno.`,
    schedule: "Horario",
    tasksHeader: "# Tareas",
    rulesHeader: "# Reglas",
    book: "- Reservar mesa: pide personas, fecha, hora, nombre. Llama check_availability primero, luego book_reservation.",
    modify: "- Modificar / cancelar: pide referencia (fecha+hora) y usa modify_reservation / cancel_reservation.",
    info: "- Información del restaurante (menú, horarios, dirección): usa la base de conocimiento adjunta.",
    outOfHours: "- Si fuera de horario o sin disponibilidad: el backend propone alternativas, transmítelas literalmente.",
    noInvent: "- Nunca inventes menú, precios u horarios — siempre consulta la KB.",
    confirm: "- Confirma SIEMPRE antes de llamar el tool de reserva.",
    endCall: "- Si el cliente cancela la conversación: end_call con saludo cortés.",
    closed: "cerrado",
    days: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
  },
  it: {
    identity: (n) => `Sei l'agente vocale di ${n}. Rispondi breve e cordiale, massimo 2 frasi per turno.`,
    schedule: "Orario",
    tasksHeader: "# Compiti",
    rulesHeader: "# Regole",
    book: "- Prenotare un tavolo: chiedi persone, data, ora, nome. Chiama prima check_availability, poi book_reservation.",
    modify: "- Modificare / annullare: chiedi il riferimento (data+ora) e usa modify_reservation / cancel_reservation.",
    info: "- Informazioni sul ristorante (menu, orari, indirizzo): usa la base di conoscenza allegata.",
    outOfHours: "- Se fuori orario o senza disponibilità: il backend propone alternative, riportale alla lettera.",
    noInvent: "- Non inventare mai menu, prezzi od orari — consulta sempre la KB.",
    confirm: "- Conferma SEMPRE prima di chiamare il tool di prenotazione.",
    endCall: "- Se il cliente chiude la conversazione: end_call con un saluto cortese.",
    closed: "chiuso",
    days: ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"],
  },
  en: {
    identity: (n) => `You are the voice agent of ${n}. Reply briefly and warmly, at most 2 sentences per turn.`,
    schedule: "Opening hours",
    tasksHeader: "# Tasks",
    rulesHeader: "# Rules",
    book: "- Book a table: ask for party size, date, time, name. Call check_availability first, then book_reservation.",
    modify: "- Modify / cancel: ask for the reference (date+time) and use modify_reservation / cancel_reservation.",
    info: "- Restaurant info (menu, hours, address): use the attached knowledge base.",
    outOfHours: "- If outside hours or no availability: the backend proposes alternatives, relay them verbatim.",
    noInvent: "- Never invent menu, prices or hours — always check the KB.",
    confirm: "- ALWAYS confirm before calling the booking tool.",
    endCall: "- If the guest ends the conversation: end_call with a polite goodbye.",
    closed: "closed",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  de: {
    identity: (n) => `Du bist der Sprachagent von ${n}. Antworte kurz und herzlich, maximal 2 Sätze pro Zug.`,
    schedule: "Öffnungszeiten",
    tasksHeader: "# Aufgaben",
    rulesHeader: "# Regeln",
    book: "- Tisch reservieren: frage nach Personenzahl, Datum, Uhrzeit, Name. Rufe zuerst check_availability, dann book_reservation.",
    modify: "- Ändern / stornieren: frage nach der Referenz (Datum+Uhrzeit) und nutze modify_reservation / cancel_reservation.",
    info: "- Restaurant-Infos (Menü, Zeiten, Adresse): nutze die angehängte Wissensdatenbank.",
    outOfHours: "- Außerhalb der Zeiten oder ohne Verfügbarkeit: das Backend schlägt Alternativen vor, gib sie wörtlich weiter.",
    noInvent: "- Erfinde niemals Menü, Preise oder Zeiten — prüfe immer die KB.",
    confirm: "- Bestätige IMMER, bevor du das Buchungs-Tool aufrufst.",
    endCall: "- Wenn der Gast das Gespräch beendet: end_call mit höflichem Gruß.",
    closed: "geschlossen",
    days: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
  },
};

/** Compact one-line-per-day schedule, e.g. "Lun: 12:30-15:30, 19:30-22:30". */
function formatSchedule(hours: OpeningHours, s: PromptStrings): string {
  const order = ["1", "2", "3", "4", "5", "6", "0"]; // Mon..Sun for human reading
  const lines = order.map((d) => {
    const slots = hours[d] || [];
    const idx = Number(d); // 0=Sun..6=Sat
    const label = s.days[idx];
    if (slots.length === 0) return `${label}: ${s.closed}`;
    return `${label}: ${slots.map((sl) => `${sl.open}-${sl.close}`).join(", ")}`;
  });
  return lines.join("\n");
}

export interface VoicePromptInput {
  restaurant_name: string;
  language: Lang;
  opening_hours: OpeningHours;
}

/** Build the full voice prompt body (no FECHA header — added at sync time). */
export function buildVoicePrompt(input: VoicePromptInput): string {
  const s = STR[input.language] || STR.es;
  return [
    `# ${input.language === "es" ? "Identidad" : input.language === "it" ? "Identità" : input.language === "de" ? "Identität" : "Identity"}`,
    s.identity(input.restaurant_name),
    "",
    `## ${s.schedule}`,
    formatSchedule(input.opening_hours, s),
    "",
    s.tasksHeader,
    s.book,
    s.modify,
    s.info,
    s.outOfHours,
    "",
    s.rulesHeader,
    s.noInvent,
    s.confirm,
    s.endCall,
  ].join("\n");
}
