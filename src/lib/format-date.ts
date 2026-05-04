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
