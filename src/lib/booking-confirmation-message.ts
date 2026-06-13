import { formatDateFull } from "@/lib/format-date";
import { cleanGuestNotes } from "@/lib/reservation-notes";

export { cleanGuestNotes };

type Lang = 'es' | 'it' | 'en' | 'de';

const TEMPLATES: Record<Lang, {
  title: string; date: string; time: string; people: string; zone: string;
  name: string; tablesLbl: string; notesLbl: string; interior: string; exterior: string; footer: string;
}> = {
  // Footers MIRROR the WhatsApp chat bot's cancelOnlyInstructions (n8n
  // getPicnicTemplates) so a guest gets the SAME modify/cancel keywords whether
  // they booked by chat or by voice. The keyword matters: the chat bot listens
  // for *MODIFICA* / *ANNULLA*, so the old "scrivi *MODIFICARE*" sent the guest
  // a word the bot would not recognise.
  es: { title: '✅ *Reserva confirmada*', date: 'Fecha', time: 'Hora', people: 'Personas', zone: 'Zona', name: 'Nombre', tablesLbl: 'Mesas', notesLbl: 'Notas', interior: 'Interior', exterior: 'Exterior', footer: 'Para modificar responde *MODIFICAR*\nPara cancelar tu solicitud responde *CANCELAR*.' },
  it: { title: '✅ *Prenotazione confermata*', date: 'Data', time: 'Ora', people: 'Persone', zone: 'Zona', name: 'Nome', tablesLbl: 'Tavoli', notesLbl: 'Note', interior: 'Interno', exterior: 'Esterno', footer: 'Per modificare rispondi *MODIFICA*\nPer annullare la richiesta rispondi *ANNULLA*.' },
  en: { title: '✅ *Booking confirmed*', date: 'Date', time: 'Time', people: 'People', zone: 'Area', name: 'Name', tablesLbl: 'Tables', notesLbl: 'Notes', interior: 'Indoor', exterior: 'Outdoor', footer: 'To modify reply *MODIFY*\nTo cancel your request reply *CANCEL*.' },
  de: { title: '✅ *Reservierung bestätigt*', date: 'Datum', time: 'Uhrzeit', people: 'Personen', zone: 'Bereich', name: 'Name', tablesLbl: 'Tische', notesLbl: 'Notizen', interior: 'Innenbereich', exterior: 'Außenbereich', footer: 'Zum Ändern antworte *ÄNDERN*\nZum Stornieren der Anfrage antworte *STORNIEREN*.' },
};

function pickLang(maybe: unknown): Lang {
  return (['es', 'it', 'en', 'de'] as const).includes(maybe as Lang) ? (maybe as Lang) : 'es';
}

export function buildBookingConfirmationMessage(params: {
  date: string;
  time: string;
  partySize: number;
  guestName?: string | null;
  zone?: 'inside' | 'outside' | null;
  tableNames?: string;
  notes?: string | null;
  language?: string | null;
}): string {
  const T = TEMPLATES[pickLang(params.language)];
  const lang = pickLang(params.language);
  const zoneLine = params.zone
    ? `\n📍 ${T.zone}: ${params.zone === 'inside' ? T.interior : T.exterior}`
    : '';
  const tablesLine = params.tableNames ? `\n🪑 ${T.tablesLbl}: ${params.tableNames}` : '';
  const cleanNotes = cleanGuestNotes(params.notes);
  const notesLine = cleanNotes ? `\n📝 ${T.notesLbl}: ${cleanNotes}` : '';
  return `${T.title}\n📅 ${T.date}: ${formatDateFull(params.date, lang)}\n⏰ ${T.time}: ${params.time}\n👥 ${T.people}: ${params.partySize}${zoneLine}\n📝 ${T.name}: ${params.guestName || ''}${tablesLine}${notesLine}\n\n${T.footer}`;
}

export function buildOwnerNewBookingMessage(params: {
  date: string;
  time: string;
  partySize: number;
  guestName?: string | null;
  guestPhone?: string | null;
  zone?: 'inside' | 'outside' | null;
  tableNames?: string;
  notes?: string | null;
}): string {
  const zoneLine = params.zone ? `\n📍 ${params.zone === 'inside' ? 'Interior' : 'Exterior'}` : '';
  const tablesLine = params.tableNames ? `\n🪑 ${params.tableNames}` : '';
  const notesLine = params.notes && params.notes.trim() ? `\n🗒️ ${params.notes.trim()}` : '';
  return `📅 NUEVA RESERVA (manual)\n\n${params.guestName || ''}\n${formatDateFull(params.date, 'es')} ${params.time}\n${params.partySize} personas${tablesLine}${zoneLine}${notesLine}\nTel: ${params.guestPhone || '—'}`;
}
