// The assistant's hands: local intent detection for OPERATIONAL commands
// ("crea una prenotazione", "quanto abbiamo incassato?", "apri la cassa"…).
// Pure and testable like engine.ts — no network here; the widget executes the
// detected intent against the CRM's own APIs/server actions.

import { normalize } from "./engine";
import type { AssistantLang, L10n } from "./kb";

export type ActionIntent =
  | {
      kind: "create_reservation";
      name?: string;
      phone?: string;
      date?: string; // YYYY-MM-DD
      time?: string; // HH:mm
      party?: number;
    }
  | { kind: "cancel_reservation"; name?: string; date?: string }
  | { kind: "recap_reservations"; date: string }
  | { kind: "revenue" }
  | { kind: "open_register"; float?: number }
  | { kind: "close_register" };

const pad = (n: number) => String(n).padStart(2, "0");

/** Lowercase + accent-strip but KEEP :, /, ., + — the full normalize() eats
 * the separators that times ("20:30"), dates ("12/08") and phones need. */
function soft(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "oggi/domani/dopodomani/12/08" → YYYY-MM-DD (relative to `now`). */
export function parseDateWord(input: string, now: Date): string | null {
  const q = soft(input);
  const shift = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return ymd(d);
  };
  if (/\b(dopodomani|day after tomorrow|pasado manana|ubermorgen)\b/.test(q)) return shift(2);
  if (/\b(domani|tomorrow|manana|morgen)\b/.test(q)) return shift(1);
  if (/\b(oggi|today|hoy|heute|stasera|tonight|esta noche|heute abend)\b/.test(q)) return shift(0);
  if (/\b(ieri|yesterday|ayer|gestern)\b/.test(q)) return shift(-1);
  const iso = q.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  // DD/MM or DD-MM (optionally /YYYY) — DMY like every local writes it.
  const dm = q.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}))?\b/);
  if (dm) {
    const dd = Number(dm[1]);
    const mm = Number(dm[2]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const yr = dm[3] ? Number(dm[3]) : now.getFullYear();
      const candidate = `${yr}-${pad(mm)}-${pad(dd)}`;
      // No year given and the date already passed → they mean next year.
      if (!dm[3] && candidate < ymd(now)) return `${yr + 1}-${pad(mm)}-${pad(dd)}`;
      return candidate;
    }
  }
  return null;
}

/** "20:30", "alle 20", "at 8pm", "a las 21" → HH:mm. */
export function parseTimeWord(input: string): string | null {
  const q = soft(input);
  const hm = q.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (hm) return `${pad(Number(hm[1]))}:${hm[2]}`;
  const at = q.match(/\b(?:alle|alle ore|ore|at|a las|a la|um)\s+([01]?\d|2[0-3])\b(?!\s*(?:persone|people|personas|personen|pax|coperti))/);
  if (at) {
    let h = Number(at[1]);
    if (/\b(?:pm|di sera|de la tarde|abends)\b/.test(q) && h < 12) h += 12;
    // Bare small hours in a restaurant mean the evening ("alle 8" → 20:00).
    if (h >= 1 && h <= 11 && !/\b(?:am|di mattina|de la manana|morgens|a pranzo|lunch)\b/.test(q)) h += 12;
    return `${pad(h)}:00`;
  }
  return null;
}

/** "per 4", "4 persone/pax/coperti" → covers. */
export function parsePartyWord(input: string): number | null {
  const q = soft(input);
  const withUnit = q.match(/\b(\d{1,2})\s*(?:persone|persona|people|person|personas|personen|pax|coperti|gedecke)\b/);
  if (withUnit) return Number(withUnit[1]);
  const perN = q.match(/\b(?:per|for|para|fur)\s+(\d{1,2})\b(?!\s*[:.]\d)/);
  if (perN) return Number(perN[1]);
  return null;
}

/** "a nome (di) Mario", "per Mario" → guest name (from the RAW text, to keep case). */
export function parseNameWord(raw: string): string | null {
  const m =
    raw.match(/\ba nome(?: di)?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{1,30}?)(?=\s*(?:,|\.|per\b|alle\b|domani\b|oggi\b|il\b|at\b|for\b|$))/i) ||
    raw.match(/\b(?:per|di|for|para|fur|für)\s+(?:il\s+signor[ae]?\s+|sig\.?\s+)?([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ']+)?)\b/);
  if (!m) return null;
  const name = m[1].trim();
  // Weed out captures that are actually keywords ("per Domani", "per Oggi"…).
  if (/^(oggi|domani|dopodomani|stasera|today|tomorrow|tonight|hoy|manana|mañana|heute|morgen)$/i.test(name)) return null;
  return name;
}

export function parsePhoneWord(input: string): string | null {
  const m = soft(input).match(/(\+?\d[\d ]{5,16}\d)/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

export function parseMoneyWord(input: string): number | null {
  const q = soft(input);
  const m = q.match(/\b(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?\b/);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

// ------------------------------------------------------------- detection
const HOWTO = /\b(come|come si|how|how do|cómo|como|wie|posso|can i|puedo|kann ich|si fa|si puo)\b/;

export function detectAction(raw: string, now: Date): ActionIntent | null {
  const q = normalize(raw);
  if (!q) return null;

  const isQuestion = HOWTO.test(q);
  const mentionsReservation = /\b(prenotazion\w*|reservation\w*|booking\w*|reserv\w*|reservierung\w*)\b/.test(q);

  // ---- register open/close (imperative only — "come apro la cassa" stays a KB question)
  if (!isQuestion && /\b(apri|apriamo|open|abre|abrir|offne|öffne)\b/.test(q) && /\b(cassa|till|caja|kasse|giornata|register)\b/.test(q)) {
    return {
      kind: "open_register",
      float: parseMoneyWord(raw.replace(/\b(cassa|till|caja|kasse|giornata|register)\b/gi, "")) ?? undefined,
    };
  }
  if (!isQuestion && /\b(chiudi|chiudiamo|close|cierra|cerrar|schliesse|schliess)\b/.test(q) && /\b(cassa|till|caja|kasse|giornata|register)\b/.test(q)) {
    return { kind: "close_register" };
  }

  // ---- revenue / day recap
  if (
    /\b(incass\w*|revenue|takings|recaudacion|umsatz|einnahmen|quanto abbiamo fatto|how much did we make)\b/.test(q) ||
    (/\b(recap|riepilogo|resumen|summary|zusammenfassung|report)\b/.test(q) && /\b(giornata|cassa|day|dia|caja|tag|kasse|vendite|sales|ventas)\b/.test(q))
  ) {
    return { kind: "revenue" };
  }

  // ---- reservations recap / list
  if (
    mentionsReservation &&
    /\b(recap|riepilogo|lista|elenco|mostra|vedi|fammi vedere|quante|quanti|list|show|how many|summary|resumen|cuantas|muestra|zeige|wie viele|liste)\b/.test(q)
  ) {
    return { kind: "recap_reservations", date: parseDateWord(raw, now) || ymd(now) };
  }

  // ---- cancel reservation
  if (
    !isQuestion &&
    mentionsReservation &&
    /\b(cancella|annulla|elimina|rimuovi|togli|cancel|delete|remove|cancela|anula|elimina|storniere|losche|lösche)\b/.test(q)
  ) {
    return {
      kind: "cancel_reservation",
      name: parseNameWord(raw) ?? undefined,
      date: parseDateWord(raw, now) ?? undefined,
    };
  }

  // ---- create reservation
  if (
    !isQuestion &&
    ((mentionsReservation && /\b(crea|nuova|nuovo|aggiungi|inserisci|fai|fammi|metti|create|new|add|book|make|crea|anade|añade|haz|nueva|erstelle|neue|lege|buche)\b/.test(q)) ||
      /\b(prenota|prenotami|book a table|reserva una mesa|reserviere)\b/.test(q))
  ) {
    return {
      kind: "create_reservation",
      name: parseNameWord(raw) ?? undefined,
      phone: parsePhoneWord(raw) ?? undefined,
      date: parseDateWord(raw, now) ?? undefined,
      time: parseTimeWord(raw) ?? undefined,
      party: parsePartyWord(raw) ?? undefined,
    };
  }

  return null;
}

// ------------------------------------------------------------- reply texts
export const ACTION_TEXT: Record<string, L10n> = {
  ask_name: {
    it: "A che nome è la prenotazione?",
    en: "What name is the reservation under?",
    es: "¿A nombre de quién es la reserva?",
    de: "Auf welchen Namen geht die Reservierung?",
  },
  ask_phone: {
    it: "Numero di telefono del cliente? (scrivi «salta» se non ce l'hai)",
    en: "Guest's phone number? (type “skip” if you don't have it)",
    es: "¿Teléfono del cliente? (escribe «saltar» si no lo tienes)",
    de: "Telefonnummer des Gasts? (schreib „überspringen“, wenn keine da ist)",
  },
  ask_date: {
    it: "Per che giorno? (es. «oggi», «domani» o 12/08)",
    en: "For which day? (e.g. “today”, “tomorrow” or 12/08)",
    es: "¿Para qué día? (ej. «hoy», «mañana» o 12/08)",
    de: "Für welchen Tag? (z. B. „heute“, „morgen“ oder 12.08)",
  },
  ask_time: {
    it: "A che ora? (es. 20:30)",
    en: "At what time? (e.g. 20:30)",
    es: "¿A qué hora? (ej. 20:30)",
    de: "Um wie viel Uhr? (z. B. 20:30)",
  },
  ask_party: {
    it: "Per quante persone?",
    en: "For how many people?",
    es: "¿Para cuántas personas?",
    de: "Für wie viele Personen?",
  },
  confirm_create: {
    it: "Confermo la prenotazione?\n{summary}\nScrivi «sì» per confermare o «annulla».",
    en: "Shall I confirm this reservation?\n{summary}\nType “yes” to confirm or “cancel”.",
    es: "¿Confirmo la reserva?\n{summary}\nEscribe «sí» para confirmar o «cancela».",
    de: "Reservierung bestätigen?\n{summary}\nSchreib „ja“ zum Bestätigen oder „abbrechen“.",
  },
  created: {
    it: "✅ Fatto! Prenotazione creata:\n{summary}",
    en: "✅ Done! Reservation created:\n{summary}",
    es: "✅ ¡Hecho! Reserva creada:\n{summary}",
    de: "✅ Erledigt! Reservierung angelegt:\n{summary}",
  },
  cancel_none: {
    it: "Non ho trovato prenotazioni attive{name} per il {date}.",
    en: "I found no active reservations{name} on {date}.",
    es: "No encontré reservas activas{name} para el {date}.",
    de: "Keine aktiven Reservierungen{name} am {date} gefunden.",
  },
  cancel_pick: {
    it: "Ho trovato più di una prenotazione. Quale cancello? Rispondi col numero:\n{list}",
    en: "I found more than one reservation. Which one should I cancel? Reply with the number:\n{list}",
    es: "Encontré más de una reserva. ¿Cuál cancelo? Responde con el número:\n{list}",
    de: "Mehrere Reservierungen gefunden. Welche soll ich stornieren? Antworte mit der Nummer:\n{list}",
  },
  confirm_cancel: {
    it: "Cancello questa prenotazione?\n{summary}\nScrivi «sì» per confermare o «annulla».",
    en: "Cancel this reservation?\n{summary}\nType “yes” to confirm or “cancel”.",
    es: "¿Cancelo esta reserva?\n{summary}\nEscribe «sí» para confirmar o «cancela».",
    de: "Diese Reservierung stornieren?\n{summary}\nSchreib „ja“ zum Bestätigen oder „abbrechen“.",
  },
  cancelled: {
    it: "✅ Prenotazione cancellata:\n{summary}",
    en: "✅ Reservation cancelled:\n{summary}",
    es: "✅ Reserva cancelada:\n{summary}",
    de: "✅ Reservierung storniert:\n{summary}",
  },
  recap_empty: {
    it: "Nessuna prenotazione per il {date}.",
    en: "No reservations on {date}.",
    es: "Sin reservas para el {date}.",
    de: "Keine Reservierungen am {date}.",
  },
  recap_header: {
    it: "📋 Prenotazioni del {date} — {n} prenotazioni, {covers} coperti:",
    en: "📋 Reservations for {date} — {n} bookings, {covers} covers:",
    es: "📋 Reservas del {date} — {n} reservas, {covers} comensales:",
    de: "📋 Reservierungen am {date} — {n} Reservierungen, {covers} Gedecke:",
  },
  revenue_open: {
    it: "💰 Incasso di oggi (cassa aperta):\n{body}",
    en: "💰 Today's takings (till open):\n{body}",
    es: "💰 Recaudación de hoy (caja abierta):\n{body}",
    de: "💰 Heutiger Umsatz (Kasse offen):\n{body}",
  },
  revenue_last: {
    it: "💰 La cassa è chiusa. Ultima giornata ({date}):\n{body}",
    en: "💰 The till is closed. Last day ({date}):\n{body}",
    es: "💰 La caja está cerrada. Última jornada ({date}):\n{body}",
    de: "💰 Die Kasse ist geschlossen. Letzter Tag ({date}):\n{body}",
  },
  revenue_none: {
    it: "La cassa è chiusa e non trovo giornate precedenti.",
    en: "The till is closed and I can't find previous days.",
    es: "La caja está cerrada y no encuentro jornadas anteriores.",
    de: "Die Kasse ist geschlossen und ich finde keine früheren Tage.",
  },
  open_already: {
    it: "La cassa è già aperta. ✅",
    en: "The till is already open. ✅",
    es: "La caja ya está abierta. ✅",
    de: "Die Kasse ist bereits offen. ✅",
  },
  ask_float: {
    it: "Con che fondo cassa apro? (i contanti già nel cassetto, es. 100)",
    en: "What float should I open with? (cash already in the drawer, e.g. 100)",
    es: "¿Con qué fondo abro? (efectivo ya en el cajón, ej. 100)",
    de: "Mit welchem Wechselgeld öffne ich? (Bargeld in der Lade, z. B. 100)",
  },
  opened: {
    it: "✅ Cassa aperta con fondo {float}. Buon servizio!",
    en: "✅ Till opened with a {float} float. Have a great service!",
    es: "✅ Caja abierta con fondo de {float}. ¡Buen servicio!",
    de: "✅ Kasse mit {float} Wechselgeld geöffnet. Guten Service!",
  },
  close_nothing: {
    it: "La cassa è già chiusa.",
    en: "The till is already closed.",
    es: "La caja ya está cerrada.",
    de: "Die Kasse ist bereits geschlossen.",
  },
  confirm_close: {
    it: "Chiudo la giornata di cassa?\n{body}\nScrivi «sì» per confermare o «annulla». (Il conteggio del cassetto lo puoi fare dalla scheda Giornata.)",
    en: "Close the cash day?\n{body}\nType “yes” to confirm or “cancel”. (You can count the drawer from the Day tab.)",
    es: "¿Cierro la jornada de caja?\n{body}\nEscribe «sí» para confirmar o «cancela». (El recuento del cajón puedes hacerlo en la pestaña Jornada.)",
    de: "Kassentag schließen?\n{body}\nSchreib „ja“ zum Bestätigen oder „abbrechen“. (Die Lade kannst du im Tab Kassentag zählen.)",
  },
  closed: {
    it: "✅ Giornata chiusa.\n{body}",
    en: "✅ Day closed.\n{body}",
    es: "✅ Jornada cerrada.\n{body}",
    de: "✅ Kassentag geschlossen.\n{body}",
  },
  aborted: {
    it: "Ok, annullato. 👍",
    en: "Ok, aborted. 👍",
    es: "Vale, anulado. 👍",
    de: "Ok, abgebrochen. 👍",
  },
  invalid_number: {
    it: "Non ho capito il numero — riprova (es. 100) o scrivi «annulla».",
    en: "I didn't get the number — try again (e.g. 100) or type “cancel”.",
    es: "No entendí el número — inténtalo de nuevo (ej. 100) o escribe «cancela».",
    de: "Zahl nicht verstanden — versuch's nochmal (z. B. 100) oder schreib „abbrechen“.",
  },
  invalid_date: {
    it: "Non ho capito la data — prova con «oggi», «domani» o 12/08 (o scrivi «annulla»).",
    en: "I didn't get the date — try “today”, “tomorrow” or 12/08 (or type “cancel”).",
    es: "No entendí la fecha — prueba con «hoy», «mañana» o 12/08 (o escribe «cancela»).",
    de: "Datum nicht verstanden — versuch „heute“, „morgen“ oder 12.08 (oder „abbrechen“).",
  },
  invalid_time: {
    it: "Non ho capito l'ora — prova con 20:30 (o scrivi «annulla»).",
    en: "I didn't get the time — try 20:30 (or type “cancel”).",
    es: "No entendí la hora — prueba con 20:30 (o escribe «cancela»).",
    de: "Uhrzeit nicht verstanden — versuch 20:30 (oder „abbrechen“).",
  },
  error: {
    it: "❌ Non ci sono riuscito: {msg}",
    en: "❌ I couldn't do it: {msg}",
    es: "❌ No lo he conseguido: {msg}",
    de: "❌ Das hat nicht geklappt: {msg}",
  },
};

export function actionText(key: keyof typeof ACTION_TEXT, lang: AssistantLang, vars: Record<string, string | number> = {}): string {
  let s = ACTION_TEXT[key][lang] || ACTION_TEXT[key].en;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const YES_WORDS = /^(si|sì|s|yes|y|ok|okay|va bene|conferma|confermo|certo|ja|sí|dale|vale|claro)\b/;
export const ABORT_WORDS = /^(no|annulla|cancella tutto|cancel|stop|lascia stare|niente|abbrechen|cancela|anula|nein)\b/;
export const SKIP_WORDS = /^(salta|skip|no|nessuno|non ce l ho|non lo so|saltar|uberspringen|überspringen|weiter|-)\b/;
