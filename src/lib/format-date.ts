export function formatDateLong(fechaStr: string, lang: string): string {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return fechaStr || '';
  const [y, m, d] = fechaStr.split('-').map(Number);
  const monthsEs = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const monthsIt = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const monthsEn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthsDe = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const idx = (m - 1) % 12;
  if (lang === 'it') return `${d} ${monthsIt[idx]} ${y}`;
  if (lang === 'en') return `${d} ${monthsEn[idx]} ${y}`;
  if (lang === 'de') return `${d}. ${monthsDe[idx]} ${y}`;
  return `${d} de ${monthsEs[idx]} de ${y}`;
}

// Weekday names in JS getDay() order (0=Sunday..6=Saturday), per language.
const weekdaysEs = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const weekdaysIt = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
const weekdaysEn = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const weekdaysDe = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

// Full localized date WITH weekday, e.g. "mercoledì 3 giugno 2026".
// This is the single format every client- and owner-facing message must use.
// Builds on formatDateLong so month formatting stays in one place.
export function formatDateFull(fechaStr: string, lang: string): string {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return fechaStr || '';
  // Noon avoids any timezone drift when deriving the weekday.
  const wd = new Date(fechaStr + 'T12:00:00').getDay();
  const weekdays = lang === 'it' ? weekdaysIt : lang === 'en' ? weekdaysEn : lang === 'de' ? weekdaysDe : weekdaysEs;
  return `${weekdays[wd]} ${formatDateLong(fechaStr, lang)}`;
}
