import { formatDateLong } from "@/lib/format-date";

type Lang = 'es' | 'it' | 'en' | 'de';

const TEMPLATES: Record<Lang, {
  title: string; date: string; time: string; people: string; zone: string;
  name: string; tablesLbl: string; interior: string; exterior: string; footer: string;
}> = {
  es: { title: '✅ *Reserva confirmada*', date: 'Fecha', time: 'Hora', people: 'Personas', zone: 'Zona', name: 'Nombre', tablesLbl: 'Mesas', interior: 'Interior', exterior: 'Exterior', footer: 'Para modificar escribe *MODIFICAR*.\nPara cancelar escribe *CANCELAR*.' },
  it: { title: '✅ *Prenotazione confermata*', date: 'Data', time: 'Ora', people: 'Persone', zone: 'Zona', name: 'Nome', tablesLbl: 'Tavoli', interior: 'Interno', exterior: 'Esterno', footer: 'Per modificare scrivi *MODIFICARE*.\nPer annullare scrivi *ANNULLA*.' },
  en: { title: '✅ *Booking confirmed*', date: 'Date', time: 'Time', people: 'People', zone: 'Area', name: 'Name', tablesLbl: 'Tables', interior: 'Indoor', exterior: 'Outdoor', footer: 'To modify write *MODIFY*.\nTo cancel write *CANCEL*.' },
  de: { title: '✅ *Reservierung bestätigt*', date: 'Datum', time: 'Uhrzeit', people: 'Personen', zone: 'Bereich', name: 'Name', tablesLbl: 'Tische', interior: 'Innenbereich', exterior: 'Außenbereich', footer: 'Zum Ändern schreibe *ÄNDERN*.\nZum Stornieren schreibe *STORNIEREN*.' },
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
  language?: string | null;
}): string {
  const T = TEMPLATES[pickLang(params.language)];
  const lang = pickLang(params.language);
  const zoneLine = params.zone
    ? `\n📍 ${T.zone}: ${params.zone === 'inside' ? T.interior : T.exterior}`
    : '';
  const tablesLine = params.tableNames ? `\n🪑 ${T.tablesLbl}: ${params.tableNames}` : '';
  return `${T.title}\n📅 ${T.date}: ${formatDateLong(params.date, lang)}\n⏰ ${T.time}: ${params.time}\n👥 ${T.people}: ${params.partySize}${zoneLine}\n📝 ${T.name}: ${params.guestName || ''}${tablesLine}\n\n${T.footer}`;
}

export function buildOwnerNewBookingMessage(params: {
  date: string;
  time: string;
  partySize: number;
  guestName?: string | null;
  guestPhone?: string | null;
  zone?: 'inside' | 'outside' | null;
  tableNames?: string;
}): string {
  const zoneLine = params.zone ? `\n📍 ${params.zone === 'inside' ? 'Interior' : 'Exterior'}` : '';
  const tablesLine = params.tableNames ? `\n🪑 ${params.tableNames}` : '';
  return `📅 NUEVA RESERVA (manual)\n\n${params.guestName || ''}\n${params.date} ${params.time}\n${params.partySize} personas${tablesLine}${zoneLine}\nTel: ${params.guestPhone || '—'}`;
}
