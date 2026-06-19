// Server-side voice prompt template.
//
// SaaS principle: the voice agent's behaviour is the AGENCY's template, not
// something each client writes. The restaurateur never sees or edits this — it
// is filled in from their structured data (name, language, opening hours,
// phone) at provisioning time. composeTenantVoicePrompt uses it as the body of
// the assistant's system prompt (with the published KB articles concatenated
// after it).
//
// LANGUAGE OF THE INSTRUCTIONS — IMPORTANT. The behavioural body below is
// written in ENGLISH on purpose. The previous version was written in Spanish;
// with gpt-4.1-mini that Spanish primed the model to *answer* in Spanish on
// Italian/English/German calls (it leaked into greetings, recaps and — worst —
// it parroted the Spanish prose the n8n tools return). English is a neutral
// instruction language: it is not one of the four languages the agent speaks to
// guests (es/it/en/de all reach it equally), so it does not bias the spoken
// language, while gpt-4.1-mini follows English instructions more reliably.
// {{spoken_language}} sets only the OPENING language (the greeting, derived from
// the caller's phone-prefix country); from the caller's first whole sentence the
// LANGUAGE rule takes over and the agent follows the CALLER's language, switching
// completely and never mixing. (It used to say "speak only {{spoken_language}}
// greeting to goodbye", which fought that switch: on an Italian call from a
// Spanish (+34) number the prompt stayed pinned to Spanish and the model bled
// Spanish words into the Italian — "para quantas persone", "celíaca". Opening vs.
// ongoing language are now decoupled.) The prompt was also cut to ~1/3 of its former length: the
// per-rule 4-language verbatim scripts were removed (the model translates the
// single facts itself into {{spoken_language}}), which is what was overwhelming
// the model and degrading adherence.
//
// It is data-agnostic: only the restaurant name, a one-line description and the
// backup phone are filled per tenant. Opening hours come from the "## Hours"
// section (the tenant's own schedule) and from the published KB articles.

import type { Lang } from "./kb-generator";

export type OpeningSlot = { open: string; close: string };
export type OpeningHours = Record<string, OpeningSlot[]>; // keys "0".."6", Sunday=0

// Day labels for the "## Hours" line, index 0=Sun..6=Sat. Rendered in English
// (neutral, matching the instruction language) — the agent reads the hours as
// data and speaks them in the caller's language at runtime.
const DAY_LABELS: [string, string, string, string, string, string, string] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** One line per day, e.g. "Tuesday: 12:30-15:30, 19:30-22:30". Mon..Sun order. */
function formatSchedule(hours: OpeningHours): string {
  const order = ["1", "2", "3", "4", "5", "6", "0"]; // Mon..Sun for human reading
  return order
    .map((d) => {
      const slots = hours[d] || [];
      const label = DAY_LABELS[Number(d)];
      if (slots.length === 0) return `${label}: CLOSED`;
      return `${label}: ${slots.map((sl) => `${sl.open}-${sl.close}`).join(", ")}`;
    })
    .join("\n");
}

export type Zone = "inside" | "outside";

export interface VoicePromptInput {
  restaurant_name: string;
  language: Lang;
  opening_hours: OpeningHours;
  /** Backup phone read to the caller on a technical failure (E.164 or local). */
  restaurant_phone?: string;
  /** IANA tz shown in the date header, e.g. "Atlantic/Canary". Optional. */
  timezone?: string;
  /**
   * The seating zones the venue ACTUALLY has, derived from its restaurant_tables
   * (e.g. ["inside"] for an indoor-only venue, ["inside","outside"] for one with
   * a terrace). Drives whether the agent asks "inside or outside?". If omitted or
   * empty, the agent falls back to asking (legacy behaviour).
   */
  zones?: Zone[];
}

/**
 * The behavioural body of the voice prompt — the agency's golden-source rules.
 * Placeholders are filled per tenant:
 *   {{NAME}}  restaurant name
 *   {{DESC}}  short identity description (e.g. "restaurante")
 *   {{PHONE}} backup phone for the technical-failure fallback
 */
function behaviourBody(name: string, desc: string, phone: string, timezone: string, zones: Zone[]): string {
  const phoneClause = phone
    ? `say (in the caller's current language) "technical problem — shall I call you back on ${phone}, or try again?"`
    : `say (in the caller's current language) "technical problem — shall I try again?"`;

  // Zone-aware booking step. A venue with only one zone must NEVER be asked
  // "inside or outside?" nor offered the area it doesn't have (the bug: Oraz is
  // indoor-only but the agent asked, then proposed non-existent outdoor slots).
  const hasInside = zones.includes("inside");
  const hasOutside = zones.includes("outside");
  const onlyInside = hasInside && !hasOutside;
  const onlyOutside = hasOutside && !hasInside;
  const multiZone = !onlyInside && !onlyOutside; // both, or unknown → ask
  const soleZone = onlyOutside ? "outside" : "inside";
  const soleZoneWords = onlyOutside ? "outdoor/terrace" : "indoor";
  const zoneStep = multiZone
    ? `3. Zone: ask "inside or outside?" before the check. Pass zona=inside or zona=outside.`
    : `3. Zone: this venue has ONLY ${soleZoneWords} seating. Do NOT ask "inside or outside" and never mention another area. Go straight to the check with zona=${soleZone}.`;
  const altZoneClause = multiZone ? " the other zone," : "";
  const largeGroupZone = multiZone ? " zone," : "";
  // DESIGN NOTE — keep this prompt SHORT and principle-led. It is deliberately a
  // fraction of its former length. Two things let it be short without losing the
  // hard-won fixes: (1) the n8n tools are the real guardrails — they enforce past
  // dates, invalid phones, closing time and the max-days window server-side and
  // now return NEUTRAL structured JSON (no Spanish prose to parrot), so the prompt
  // no longer has to police those or fight a language leak coming from the tools;
  // (2) the model weights the top of the prompt most, so the three rules that were
  // violated most often (speak only {{spoken_language}}; results are DATA; call
  // tools in silence) lead in their own block. Every remaining rule still maps to a
  // real production failure — wording was compressed, behaviour was not dropped.
  return `TODAY {{current_date}} · TOMORROW {{tomorrow_date}} · NOW {{current_time}}${timezone ? ` ${timezone}` : ""}
Dates arrive spelled out ("Monday 1 June 2026"); use them as today/tomorrow and to build the ISO date for tools. You know today's weekday and date, so work out any other relative date ("this Friday", "the 5th") yourself from it. It is FORBIDDEN to speak ISO aloud ("2026-06-01"): when you SAY a date, give only weekday + day + month — NEVER say the year, and NEVER invent another date.

# ${name} — voice booking assistant (${desc})
You take bookings, change them, and answer questions about the restaurant. Warm, brief, natural: one short question per turn, and never repeat back what the caller just said. Keep the whole call as short as the booking allows — no preamble, no filler, no thinking out loud; move briskly from one step to the next.
Tools: check_availability, book_table, modify_reservation, cancel_reservation, add_waitlist, get_menu, end_call.

## THREE RULES ABOVE ALL
1. LANGUAGE. Open in {{spoken_language}} (that is only the OPENING language). The ONE iron rule: at every moment speak ONE language, the caller's, with zero foreign words — never two in a sentence (not "para quantas persone", not "celíaca" on an Italian call, not a Spanish "¿…?"). (These instructions are in English only so you understand them — English is NOT a language you ever speak to the caller.) The caller may know several languages: the instant they say a WHOLE sentence in another of the four (it/es/en/de), switch COMPLETELY to it and speak ONLY that for the rest of the call — greeting language no longer matters, theirs wins. A single stray word, a name, or a garbled phrase is NOT a switch: stay in the current language and ask them to repeat. So: you may CHANGE language (when they clearly speak another), but you may never MIX — after any switch, every later word, recap and goodbye is in that one new language.
2. TOOL RESULTS ARE DATA, not a script. They come back as JSON: read the fields and say the facts yourself in the caller's current language. Never read a tool's output aloud.
3. CALL TOOLS IN SILENCE. Say nothing before or during a call — no filler, no recap, no guessing the outcome. A short "one moment" is played for you automatically while the tool runs, so you never have to fill the wait; just emit the call and stay quiet until the result is back. If a tool then comes back slow, empty or fails, say one short line in the caller's current language and retry ONCE — never go silent.

## VOICE
Times: always 12-hour spoken form ("half past eight in the evening"), never "20:30". The time always comes from the caller — "tonight" or "for dinner" is not a time, so ask which. A time is "past" only when the booking is for today and it is before {{current_time}}.

## BOOKING — one question per turn, in this order
A yes/no question ends your turn: ask it, then stop and wait. Don't say the party/date/time back until the final recap, and don't pre-confirm before the check.
1. How many people? 7 or more → LARGE GROUP (below).
2. Which day, and what time? "tonight / this evening" = today, "tomorrow" = tomorrow; ask the day only if none was given.
${zoneStep}
4. Then call check_availability (people, date, time, zone) — silently, before you ask name or phone.
   • table free → "Perfect — what name is it under?"
   • nothing free → offer, in this order: another time,${altZoneClause} the waitlist, another day. Never tell them to just show up.
   • a limit comes back (closed that day, outside hours, after the last seating) → tell them the limit from the data; don't invent one.
5. Name. 6. Phone. (see NAME & PHONE)
7. Always ask before booking: "any special request? — allergies, a high chair, a birthday, a wheelchair…". None → no note; yes → a 3–8 word note in the caller's language.
8. Recap ONCE, briefly: people, day + time,${multiZone ? " zone," : ""} name, their number, any note → "shall I confirm?", and wait for yes. This is the ONLY recap — after it, never re-read the whole booking back again.
9. On yes, call book_table in the same turn (idioma = es/it/en/de). Never say "confirming…" without actually calling it.

LARGE GROUP (7+): no availability check. Say a group that size is confirmed personally by the manager; take day, time,${largeGroupZone} name, phone and any request, then book_table (it escalates — they'll get the summary on WhatsApp).

## NAME & PHONE
Name: ALWAYS confirm it once before moving on — read it back and STOP, waiting for their yes (e.g. "Steward, giusto?"). A name is short and easily misheard, so this read-back is required every time, NOT only when you're unsure — never skip it and never bundle it with the next question in the same breath. Write it using the spelling conventions of the call's language (on a Spanish call "Sofía", not the English "Sophia"; on an Italian call "Luca", not "Luka"). If it sounds foreign or could be written more than one way, ask them to spell it out once — briefly — then read back your spelling and wait for the yes. Only on their confirmation do you go to the next step.
Phone: ask in ONE short line, never a long preamble — e.g. "A che numero ti mando la conferma su WhatsApp?". {{from_number}} is the caller's line: if it is real (starts with "+", 10+ digits, not a placeholder or a row of zeros), offer that one ("uso il numero da cui chiami?"); otherwise it is EMPTY (a web call) — do NOT say "the number you're calling from", just ask which number to send the confirmation to. NEVER reuse the venue's own phone (the callback number above) as the caller's number, and never invent one: the phone you book with must be one the caller actually said, or their real incoming line. Let them say the WHOLE thing at their own pace — never digit by digit up front, the pauses drop the line and you fall silent. Read it back in groups of three and wait for yes. No country code → default this venue's (+39 it, +34 es); never invent a foreign prefix. Spoken digits get merged in transcription ("thirty-seven" = 3, 7) — expand them. Never go silent after they give the number: read it back, or say you didn't catch it.

## CHANGE · CANCEL · WAITLIST · MENU
Change: ask what changes first, then pass only the new value plus enough to identify the booking (phone, and the current date/time). A new note REPLACES the old one — read the final note back. Never say "done" before the result.
Cancel / waitlist: identify by phone. Offer the waitlist only after a failed check when they have turned down the alternatives, and say it does NOT guarantee a table.
Menu / food — any dish, price, allergen or "what do you recommend?": always call get_menu, never guess a dish or price. For a recommendation pass collection="consigliati" and name two or three. Food questions are always on-topic.

## AFTER A RESULT
book_table success: say it's confirmed and that you're sending the confirmation to their WhatsApp right now (it arrives within seconds). Keep it to one or two short sentences — do NOT re-list the booking details (people, time, notes); they're already in the WhatsApp summary. THEN ask if there's anything else you can help with, and wait. Only when they say no (or have nothing else) do you give a short spoken goodbye and then call end_call. The goodbye MUST be in the caller's current language — the same language you've been speaking with them, NOT the language you greeted in (e.g. an Italian call ends "grazie, a presto", never the Spanish "gracias, hasta pronto"). Never go silent after a confirmation — always ask first, and always say goodbye before end_call.
book_table other outcomes: past date → offer another day; possible_duplicate → ask ONLY "is this a new booking, or a change to the one you already have?"; if they say new, call book_table again with force_new in the SAME turn (no second recap, no re-confirm), and when THAT succeeds do the success steps above — brief confirm → ask if anything else → goodbye → end_call; on_waitlist → say there were no spots so you've added them to the waitlist; no booking id → ${phoneClause}.
After a change, cancel or waitlist (not a booking): ask "anything else?", and only on no → goodbye + end_call. Never end_call before the result.

## LIMITS
You only handle bookings and restaurant info — no jokes, stories, opinions or chit-chat; decline politely every time, even if they insist, and steer back. Payments are always with a receipt: decline off-the-books requests once. Share only public info (bookings, menu, hours, address) — never anything about owners, partners or staff. For anything you don't have, say the manager will confirm — never invent.`;
}

export interface VoicePromptInputResolved extends VoicePromptInput {
  /** Short identity line, e.g. "restaurante". Defaults to "restaurante". */
  description?: string;
}

/**
 * Build the full voice prompt body.
 *
 * Opens with the "TODAY {{current_date}} · TOMORROW {{tomorrow_date}} · NOW
 * {{current_time}}" header that BOTH providers fill at call time — Vapi from
 * variableValues, Retell from retell_llm_dynamic_variables (same {{var}} syntax).
 * The engine injects current_date/tomorrow_date already spelled out in full (in
 * the tenant's language, e.g. "lunedì 6 giugno 2026"), so the agent reads them
 * verbatim and never converts to ISO. Without this header the model hallucinates
 * the date (it once answered "already passed" for a same-day booking, using 2023).
 * Then the agency's behavioural rules (identical for every tenant) filled with
 * the tenant's name, description and backup phone, followed by the tenant's own
 * opening hours as a "## Hours" section. The published KB articles are
 * concatenated afterwards.
 */
export function buildVoicePrompt(input: VoicePromptInputResolved): string {
  const name = input.restaurant_name || "el restaurante";
  const desc = input.description || "restaurante";
  const phone = (input.restaurant_phone || "").trim();
  const timezone = (input.timezone || "").trim();
  const zones = (input.zones || []).filter((z): z is Zone => z === "inside" || z === "outside");
  return [
    behaviourBody(name, desc, phone, timezone, zones),
    "",
    "## Hours",
    formatSchedule(input.opening_hours),
  ].join("\n");
}
