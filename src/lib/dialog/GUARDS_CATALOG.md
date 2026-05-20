# GUARDS_CATALOG — Picnic Chatbot WhatsApp
> Every defensive guard / FIX present in the live n8n Code nodes (workflow `166QnQsGHqXDpBxa`, snapshot `2026-05-20T07:16Z`).
> Each row = one regression we have already paid for. The refactor MUST keep each behavior intact and prove it with a unit test.

**Total FIX/PATCH markers found**: 117 (in 59 distinct guards across 5 files)

## Inventory

| Marker | Occurrences | Description |
|---|---|---|
| [FIX B2.1](#fix-b2-1) | 1 | Block CANCELAR if 2+ active reservations; ask which one |
| [FIX B2.2](#fix-b2-2) | 2 | Truly ambiguous input fallback (emoji-only, dots, gibberish) |
| [FIX B6.1](#fix-b6-1) | 1 | Extend availability lookahead 11→30 days (so "el 8" doesn't break) |
| [FIX B6.1B](#fix-b6-1b) | 1 | _(no description yet — see code context)_ |
| [FIX B7](#fix-b7) | 1 | Apology recovery — fallback with restaurant phone + apology on resume |
| [FIX B8A](#fix-b8a) | 5 | When prev turn asked personas and parser returned no personas, fallback-extract from raw message |
| [FIX B8B](#fix-b8b) | 1 | Pregunta-instruction → answer must end with "?" — block "Perfecto, gracias" |
| [FIX B9](#fix-b9) | 1 | Review-pending template (Solicitud en revisión) when no capacity |
| [FIX B10](#fix-b10) | 3 | force_new branch retry |
| [FIX B11C](#fix-b11c) | 2 | Helper persists modify success to staticData + bot_sessions |
| [FIX B11A](#fix-b11a) | 1 | delta_personas: parser puts relative change as +/- int, personas=null |
| [FIX B11B](#fix-b11b) | 1 | _(no description yet — see code context)_ |
| [FIX B11D](#fix-b11d) | 1 | _(no description yet — see code context)_ |
| [FIX B12](#fix-b12) | 1 | Large groups (isLarge=true): separate review flow |
| [FIX B13](#fix-b13) | 1 | Unified recap card for ALL successful reservations |
| [FIX B14](#fix-b14) | 1 | Full recap card for waitlist confirm (same UX as booking) |
| [FIX B15](#fix-b15) | 1 | Post-CONFIRMO short ack (replaces B13 full recap) |
| [FIX B18A](#fix-b18a) | 1 | Typo-tolerant CONFIRMO/CONFIRMA/CONFIRMI |
| [FIX B18B](#fix-b18b) | 5 | On possible_duplicate KEEP the pending, flag it |
| [FIX B18C](#fix-b18c) | 1 | notas must be affirmative FACT, never a customer question |
| [FIX B18D](#fix-b18d) | 1 | _(no description yet — see code context)_ |
| [FIX B19B](#fix-b19b) | 1 | Accept anywhere-match of confirm verbs |
| [FIX B19A](#fix-b19a) | 2 | Vague-accept logic for date/hour proposals (e.g. "ok", "vale") |
| [FIX B20A](#fix-b20a) | 1 | Typo/lowercase tolerance for cancel keywords |
| [FIX B20B](#fix-b20b) | 1 | _(no description yet — see code context)_ |
| [FIX B21](#fix-b21) | 2 | CANCELAR with confirmation step |
| [FIX B22](#fix-b22) | 1 | Voice modify mid-call edge case |
| [FIX B25](#fix-b25) | 12 | One-word name fallback (parser sometimes misses name) |
| [FIX B26](#fix-b26) | 2 | Fresh booking starter resets stale session; immediate force_new retry |
| [FIX B27](#fix-b27) | 2 | Skip pending recovery for greeting-only messages |
| [FIX B31](#fix-b31) | 2 | Smalltalk/ack detector — no card re-send after modify |
| [FIX B32](#fix-b32) | 2 | Off-topic guardrail: "no tengo tiempo que perder" in 4 langs |
| [FIX B33](#fix-b33) | 7 | Load session from Supabase bot_sessions (not just staticData) + DB lock |
| [FIX B34](#fix-b34) | 4 | Empty-modify guard: if modify/cancel intent but no active reservation → fallback to book |
| [FIX B35](#fix-b35) | 1 | Don't push empty AI bubbles to CRM (when hasAction=true) |
| [FIX B38](#fix-b38) | 1 | Accept bare 24h hours 13-23 as valid hora |
| [FIX B38B](#fix-b38b) | 1 | Parser context-blind: clear mis-extractions on bare hora topic |
| [FIX B39](#fix-b39) | 3 | Mirror session primer to bot_sessions DB (Fetch History + Book+Notify writes) |
| [FIX B41](#fix-b41) | 1 | Post-recap guard: no re-trigger of book after card sent; audit alreadyIds per conversation_id |
| [FIX #6](#fix-hash6) | 1 | Hora ambigua mapping: only "a las" / "alle" / "at" / "um" trigger AM→PM |
| [FIX #7](#fix-hash7) | 1 | Concurrency-safe commit: peer-merge n8n staticData (race condition) |
| [FIX #8](#fix-hash8) | 1 | MODIFICAR keyword without pending recap → only allowed after recap |
| [FIX #9](#fix-hash9) | 1 | nextInstruction is the ONLY thing to ask/say this turn |
| [FIX 2026-05-07](#fix-2026-05-07) | 5 | _(no description yet — see code context)_ |
| [FIX 2026-05-12](#fix-2026-05-12) | 12 | _(no description yet — see code context)_ |
| [FIX LANG](#fix-lang) | 1 | notas MUST stay in customer's original language (no translation) |
| [PATCH:auto-recovery-guards-v1](#patch:auto-recovery-guards-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:cooldown-60s-v1](#patch:cooldown-60s-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:disambig-local-match-v1](#patch:disambig-local-match-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:disambig-localized-date-v1](#patch:disambig-localized-date-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:disambig-persist-supabase-v1](#patch:disambig-persist-supabase-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:empty-session-init-v1](#patch:empty-session-init-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:modify-recap-notes-v1](#patch:modify-recap-notes-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:modify-without-reservations-auto-clear](#patch:modify-without-reservations-auto-clear) | 1 | _(no description yet — see code context)_ |
| [PATCH:past-date-silent-reset-v1](#patch:past-date-silent-reset-v1) | 2 | _(no description yet — see code context)_ |
| [PATCH:paused-save-v1](#patch:paused-save-v1) | 1 | _(no description yet — see code context)_ |
| [PATCH:post-completion-reset-guard](#patch:post-completion-reset-guard) | 1 | _(no description yet — see code context)_ |
| [PATCH:post-completion-reset-helper](#patch:post-completion-reset-helper) | 1 | _(no description yet — see code context)_ |
| [PATCH:reset-session-post-completion](#patch:reset-session-post-completion) | 3 | _(no description yet — see code context)_ |

## Detail by guard

### FIX B2.1 <a id="fix-b2-1"></a>

**What**: Block CANCELAR if 2+ active reservations; ask which one

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:1164`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B2.1 (2026-04-26) — block CANCELAR if 2+ active reservations; ask which one`

### FIX B2.2 <a id="fix-b2-2"></a>

**What**: Truly ambiguous input fallback (emoji-only, dots, gibberish)

**Locations** (file:line):
- [`openai.js:644`](_extracted/openai.js) — `// FIX B2.2 (2026-04-26) — handle truly ambiguous user input (emoji-only, dots, gibberish)`
- [`openai.js:658`](_extracted/openai.js) — `// (FIX B2.2 fallback, B7 apology recovery, B8 intent override, B10 force_new,`

### FIX B6.1 <a id="fix-b6-1"></a>

**What**: Extend availability lookahead 11→30 days (so "el 8" doesn't break)

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:1536`](_extracted/fetch-history-plus-check-availability.js) — `for (let i = 0; i <= 29; i++) { // FIX B6.1 (2026-04-26): extend 11 -> 30 days so 'el 8 a las 8' (12 days ahead) doesn't break the controller`

### FIX B6.1B <a id="fix-b6-1b"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1229`](_extracted/openai.js) — `// FIX B6.1b (2026-04-26): fecha valid but beyond calendar range (>30 days`

### FIX B7 <a id="fix-b7"></a>

**What**: Apology recovery — fallback with restaurant phone + apology on resume

**Locations** (file:line):
- [`openai.js:1734`](_extracted/openai.js) — `// FIX B7 (2026-04-26): graceful failure + auto-recovery apology.`

### FIX B8A <a id="fix-b8a"></a>

**What**: When prev turn asked personas and parser returned no personas, fallback-extract from raw message

**Locations** (file:line):
- [`openai.js:698`](_extracted/openai.js) — `// FIX B8a (2026-04-26): when the previous controller turn asked personas`
- [`openai.js:1177`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'personas'; // FIX B8a tag`
- [`openai.js:1180`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'fecha'; // FIX B8a tag`
- [`openai.js:1227`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'hora'; // FIX B8a tag`
- [`openai.js:1623`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'personas'; // FIX B8a tag`

### FIX B8B <a id="fix-b8b"></a>

**What**: Pregunta-instruction → answer must end with "?" — block "Perfecto, gracias"

**Locations** (file:line):
- [`openai.js:1708`](_extracted/openai.js) — `INSTRUCCIÓN OBLIGATORIA PARA ESTE TURNO (esta es la ÚNICA cosa que debes preguntar/decir, reformulada en máx 1 frase, sin saltar a otro paso): ${nextInstruction}\nPROHIBIDO preguntar otra cosa o anticiparte al siguien...`

### FIX B9 <a id="fix-b9"></a>

**What**: Review-pending template (Solicitud en revisión) when no capacity

**Locations** (file:line):
- [`book-plus-notify-owner.js:926`](_extracted/book-plus-notify-owner.js) — `es: '⏳ *Solicitud en revisión*\nTu modificación a ' + (data.new_party_size || m.personas || '?') + ' personas ha entrado en solicitud porque no hay plazas suficientes' + (escZoneEs ? ' en ' + escZoneEs : '') + ' para ...`

### FIX B10 <a id="fix-b10"></a>

**What**: force_new branch retry

**Locations** (file:line):
- [`openai.js:1245`](_extracted/openai.js) — `// FIX B10 (2026-04-26): same as other sites`
- [`openai.js:1375`](_extracted/openai.js) — `// FIX B10 (2026-04-26): preserve force_new from pending so retry-after-zone-switch doesn't re-hit possible_duplicate`
- [`openai.js:1405`](_extracted/openai.js) — `// FIX B10 (2026-04-26): same as site 1 — read force_new from pending`

### FIX B11C <a id="fix-b11c"></a>

**What**: Helper persists modify success to staticData + bot_sessions

**Locations** (file:line):
- [`book-plus-notify-owner.js:781`](_extracted/book-plus-notify-owner.js) — `// FIX B11c (2026-04-26): helper that, when a modify succeeds, persists the`
- [`openai.js:1420`](_extracted/openai.js) — `// FIX B11c (2026-04-26): user just modified a reservation; subsequent modify`

### FIX B11A <a id="fix-b11a"></a>

**What**: delta_personas: parser puts relative change as +/- int, personas=null

**Locations** (file:line):
- [`openai.js:587`](_extracted/openai.js) — `REGLA delta_personas (FIX B11a, 2026-04-26): si el cliente menciona un cambio relativo (no un total absoluto), pon el incremento como entero positivo o negativo en delta_personas y deja personas en null.`

### FIX B11B <a id="fix-b11b"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1017`](_extracted/openai.js) — `// FIX B11b (2026-04-26): apply delta_personas relative to a known base`

### FIX B11D <a id="fix-b11d"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1477`](_extracted/openai.js) — `// FIX B11d (2026-04-26): single active reservation -> no disambig needed.`

### FIX B12 <a id="fix-b12"></a>

**What**: Large groups (isLarge=true): separate review flow

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:896`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B12 (2026-04-26): for LARGE groups (pending.isLarge=true), the`

### FIX B13 <a id="fix-b13"></a>

**What**: Unified recap card for ALL successful reservations

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:923`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B13 (2026-04-26): unified recap for ALL reservations. Large groups`

### FIX B14 <a id="fix-b14"></a>

**What**: Full recap card for waitlist confirm (same UX as booking)

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:751`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B14 (2026-04-26): full recap card for waitlist confirm — same UX`

### FIX B15 <a id="fix-b15"></a>

**What**: Post-CONFIRMO short ack (replaces B13 full recap)

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:926`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B15 (2026-04-26): post-CONFIRMO short ack (replaces B13 full recap).`

### FIX B18A <a id="fix-b18a"></a>

**What**: Typo-tolerant CONFIRMO/CONFIRMA/CONFIRMI

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:363`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B18a (2026-04-26): typo-tolerant confirm command. "CONFIRMI" / "CONFIRMA"`

### FIX B18B <a id="fix-b18b"></a>

**What**: On possible_duplicate KEEP the pending, flag it

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:841`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B18b (2026-04-26): on possible_duplicate KEEP the pending and flag`
- [`fetch-history-plus-check-availability.js:873`](_extracted/fetch-history-plus-check-availability.js) — `delete sd.pendingBookings[key]; // FIX B18b cleanup in on_waitlist`
- [`fetch-history-plus-check-availability.js:880`](_extracted/fetch-history-plus-check-availability.js) — `delete sd.pendingBookings[key]; // FIX B18b cleanup in silent_fail`
- [`fetch-history-plus-check-availability.js:889`](_extracted/fetch-history-plus-check-availability.js) — `delete sd.pendingBookings[key]; // FIX B18b cleanup in has_capacity=false`
- [`fetch-history-plus-check-availability.js:893`](_extracted/fetch-history-plus-check-availability.js) — `delete sd.pendingBookings[key]; // FIX B18b cleanup on success`

### FIX B18C <a id="fix-b18c"></a>

**What**: notas must be affirmative FACT, never a customer question

**Locations** (file:line):
- [`openai.js:603`](_extracted/openai.js) — `- Notas: mención espontánea de alergias, cumple, niños, mascota, etc. Si dice "no/nada" o no menciona = null. FIX B18c (2026-04-26): notas debe ser un HECHO afirmativo, NUNCA una pregunta del cliente. Si el cliente pr...`

### FIX B18D <a id="fix-b18d"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1706`](_extracted/openai.js) — `REGLA MASCOTAS (FIX B18d, 2026-04-26): si en el último mensaje del cliente o en notas aparece "mascota/perro/perrito/perrita/cane/cagnolino/dog/puppy/gato/gatto/cat" — DEBES, en la frase que respondes este turno, incl...`

### FIX B19B <a id="fix-b19b"></a>

**What**: Accept anywhere-match of confirm verbs

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:1263`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B19b (2026-04-26): also accept ANYWHERE-match of confirm verbs and`

### FIX B19A <a id="fix-b19a"></a>

**What**: Vague-accept logic for date/hour proposals (e.g. "ok", "vale")

**Locations** (file:line):
- [`openai.js:977`](_extracted/openai.js) — `// FIX B19a (2026-04-26): same vague-accept logic for date/hour proposals.`
- [`openai.js:1203`](_extracted/openai.js) — `// FIX B19a (2026-04-26): compute the next open day so we can save it as`

### FIX B20A <a id="fix-b20a"></a>

**What**: Typo/lowercase tolerance for cancel keywords

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:385`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B20a (2026-04-26): accept lowercase, variants and typos for cancel +`

### FIX B20B <a id="fix-b20b"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1617`](_extracted/openai.js) — `nextInstruction = 'Para cancelar tu reserva responde *CANCELAR*.'; // FIX B20b (2026-04-26): drop the 'en mayúsculas' demand; B20a accepts any case + variants`

### FIX B21 <a id="fix-b21"></a>

**What**: CANCELAR with confirmation step

**Locations** (file:line):
- [`openai.js:998`](_extracted/openai.js) — `// FIX B21 (2026-04-27): shadow-notes detector — capture pet/special-need`
- [`openai.js:1069`](_extracted/openai.js) — `// FIX B21 (2026-04-27): use shadowNotes as the actual notas — the user`

### FIX B22 <a id="fix-b22"></a>

**What**: Voice modify mid-call edge case

**Locations** (file:line):
- [`openai.js:1108`](_extracted/openai.js) — `// FIX B22 (2026-04-27): refuse bookings further than 14 days ahead.`

### FIX B25 <a id="fix-b25"></a>

**What**: One-word name fallback (parser sometimes misses name)

**Locations** (file:line):
- [`openai.js:1039`](_extracted/openai.js) — `// FIX B25 (2026-04-28): one-word name fallback. Parser sometimes misses`
- [`openai.js:1235`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'zona'; // FIX B25 tag-zona`
- [`openai.js:1238`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'nombre'; // FIX B25 tag`
- [`openai.js:1241`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'notas'; // FIX B25 tag-notas`
- [`openai.js:1325`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'zona'; // FIX B25 tag-zona`
- [`openai.js:1326`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'nombre'; // FIX B25 tag`
- [`openai.js:1366`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'nombre'; // FIX B25 tag`
- [`openai.js:1369`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'notas'; // FIX B25 tag-notas`
- [`openai.js:1392`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'nombre'; // FIX B25 tag`
- [`openai.js:1396`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'nombre'; // FIX B25 tag`
- [`openai.js:1399`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'notas'; // FIX B25 tag-notas`
- [`openai.js:1645`](_extracted/openai.js) — `_sess.lastInstructionTopic = 'nombre'; // FIX B25 tag`

### FIX B26 <a id="fix-b26"></a>

**What**: Fresh booking starter resets stale session; immediate force_new retry

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:1319`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B26 (2026-04-28): retry immediately with force_new=true and send the`
- [`openai.js:843`](_extracted/openai.js) — `// FIX B26 (2026-04-28): fresh booking starter resets stale session.`

### FIX B27 <a id="fix-b27"></a>

**What**: Skip pending recovery for greeting-only messages

**Locations** (file:line):
- [`book-plus-notify-owner.js:679`](_extracted/book-plus-notify-owner.js) — `delete sd.pendingBookings[key]; // FIX B27 (2026-04-28): clear pending after large-group CRM success so 'ciao' next turn doesn't trigger pending-recovery + duplicate retry`
- [`openai.js:524`](_extracted/openai.js) — `// FIX B27 (2026-04-28): skip pending recovery for greeting-only messages —`

### FIX B31 <a id="fix-b31"></a>

**What**: Smalltalk/ack detector — no card re-send after modify

**Locations** (file:line):
- [`book-plus-notify-owner.js:800`](_extracted/book-plus-notify-owner.js) — `// FIX B31 (2026-04-30): clear collected fields so the next turn (which is`
- [`openai.js:740`](_extracted/openai.js) — `// FIX B31 (2026-04-30): smalltalk / acknowledgment detector.`

### FIX B32 <a id="fix-b32"></a>

**What**: Off-topic guardrail: "no tengo tiempo que perder" in 4 langs

**Locations** (file:line):
- [`openai.js:605`](_extracted/openai.js) — `- intent "offtopic" si el cliente habla de algo NO relacionado con reservar, el restaurante (menú/carta, dirección, horarios, alergias, parking, métodos de pago, accesibilidad, política de reservas) o su reserva exist...`
- [`openai.js:1124`](_extracted/openai.js) — `// FIX B32 (2026-04-30): off-topic guardrail. Mirror the voice agent rule —`

### FIX B33 <a id="fix-b33"></a>

**What**: Load session from Supabase bot_sessions (not just staticData) + DB lock

**Locations** (file:line):
- [`book-plus-notify-owner.js:845`](_extracted/book-plus-notify-owner.js) — `// reads from Supabase via FIX B33 — actually sees awaitingDisambig+candidates`
- [`book-plus-notify-owner.js:855`](_extracted/book-plus-notify-owner.js) — `// Mirror to Supabase bot_sessions so next turn picks it up (FIX B33).`
- [`openai.js:345`](_extracted/openai.js) — `// FIX B33 (2026-05-06): load session from Supabase bot_sessions table instead`
- [`openai.js:677`](_extracted/openai.js) — `await _dbReleaseLock.call(this, _phoneKey, _sess); // FIX B33: release lock before early return`
- [`openai.js:799`](_extracted/openai.js) — `await _dbReleaseLock.call(this, _phoneKey, _sess); // FIX B33: release lock`
- [`openai.js:1141`](_extracted/openai.js) — `await _dbReleaseLock.call(this, _phoneKey, _sess); // FIX B33: release lock`
- [`openai.js:1792`](_extracted/openai.js) — `// FIX B33 (2026-05-06): persist session to Supabase (strong consistency)`

### FIX B34 <a id="fix-b34"></a>

**What**: Empty-modify guard: if modify/cancel intent but no active reservation → fallback to book

**Locations** (file:line):
- [`openai.js:1823`](_extracted/openai.js) — `// FIX B34 (state-machine, reinforced 2026-05-12): empty-modify guard inline.`
- [`openai.js:1996`](_extracted/openai.js) — `description: 'Modifica una reserva existente del cliente. DISAMBIGUACIÓN OBLIGATORIA: si el cliente tiene varias reservas activas (cliente habitual), DEBES preguntar primero "¿para qué fecha/hora era?" y pasar fecha_a...`
- [`openai.js:2114`](_extracted/openai.js) — `// FIX B34 (2026-05-06, reinforced 2026-05-12): empty-modify guard.`
- [`openai.js:2194`](_extracted/openai.js) — `// FIX B34 (followup): re-apply empty-modify guard. The follow-up LLM call`

### FIX B35 <a id="fix-b35"></a>

**What**: Don't push empty AI bubbles to CRM (when hasAction=true)

**Locations** (file:line):
- [`send-whatsapp-reply.js:66`](_extracted/send-whatsapp-reply.js) — `// FIX B35: non pushare bolle AI vuote nel CRM. Quando hasAction=true`

### FIX B38 <a id="fix-b38"></a>

**What**: Accept bare 24h hours 13-23 as valid hora

**Locations** (file:line):
- [`openai.js:727`](_extracted/openai.js) — `const _h = _bareN === 12 ? 12 : (_bareN >= 1 && _bareN <= 11 ? _bareN + 12 : (_bareN >= 13 && _bareN <= 23 ? _bareN : null)); // FIX B38 (2026-05-12): accept bare 24h hours 13-23`

### FIX B38B <a id="fix-b38b"></a>

**What**: Parser context-blind: clear mis-extractions on bare hora topic

**Locations** (file:line):
- [`openai.js:730`](_extracted/openai.js) — `// FIX B38b (2026-05-12): parser is context-blind and treats bare numbers as personas (rule 580) and sometimes as DÍA del mes (rule 586). When the bot was asking for hora, the bare number is ONLY about time — clear th...`

### FIX B39 <a id="fix-b39"></a>

**What**: Mirror session primer to bot_sessions DB (Fetch History + Book+Notify writes)

**Locations** (file:line):
- [`book-plus-notify-owner.js:807`](_extracted/book-plus-notify-owner.js) — `// FIX B39 (2026-05-12): mirror post-modify session reset to bot_sessions DB (fire-and-forget; enclosing fn is not async).`
- [`fetch-history-plus-check-availability.js:1022`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B39 (2026-05-12): mirror primer to bot_sessions DB so OpenAI's next-turn read finds it.`
- [`fetch-history-plus-check-availability.js:1094`](_extracted/fetch-history-plus-check-availability.js) — `// FIX B39 (2026-05-12): mirror primer to bot_sessions DB so OpenAI's next-turn read finds it.`

### FIX B41 <a id="fix-b41"></a>

**What**: Post-recap guard: no re-trigger of book after card sent; audit alreadyIds per conversation_id

**Locations** (file:line):
- [`openai.js:1145`](_extracted/openai.js) — `// FIX B41 (2026-05-19): Post-recap guard — when the booking recap card has`

### FIX #6 <a id="fix-hash6"></a>

**What**: Hora ambigua mapping: only "a las" / "alle" / "at" / "um" trigger AM→PM

**Locations** (file:line):
- [`openai.js:597`](_extracted/openai.js) — `- Hora ambigua: SOLO si el mensaje contiene "a las"/"las"/"a la"/"sobre las" (ES) o "alle"/"alle ore" (IT) o "at" (EN) o "um"/"um die"/"gegen" (DE) ANTES del número, mapea: "a las 2"/"las 2"/"um 2"=14:00, "3"=15:00, "...`

### FIX #7 <a id="fix-hash7"></a>

**What**: Concurrency-safe commit: peer-merge n8n staticData (race condition)

**Locations** (file:line):
- [`openai.js:1780`](_extracted/openai.js) — `// FIX #7 (2026-04-26): concurrency-safe commit. n8n's `staticData` is a`

### FIX #8 <a id="fix-hash8"></a>

**What**: MODIFICAR keyword without pending recap → only allowed after recap

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:1034`](_extracted/fetch-history-plus-check-availability.js) — `// FIX #8 (2026-04-26): MODIFICAR without a pending recap should only`

### FIX #9 <a id="fix-hash9"></a>

**What**: nextInstruction is the ONLY thing to ask/say this turn

**Locations** (file:line):
- [`openai.js:1708`](_extracted/openai.js) — `INSTRUCCIÓN OBLIGATORIA PARA ESTE TURNO (esta es la ÚNICA cosa que debes preguntar/decir, reformulada en máx 1 frase, sin saltar a otro paso): ${nextInstruction}\nPROHIBIDO preguntar otra cosa o anticiparte al siguien...`

### FIX 2026-05-07 <a id="fix-2026-05-07"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:402`](_extracted/book-plus-notify-owner.js) — `// CLOSING-TIME GUARD (FIX 2026-05-07: Sofía booked 15:30 = lunch close on Thu)`
- [`book-plus-notify-owner.js:517`](_extracted/book-plus-notify-owner.js) — `// CLOSING-TIME GUARD (FIX 2026-05-07)`
- [`book-plus-notify-owner.js:765`](_extracted/book-plus-notify-owner.js) — `// CLOSING-TIME GUARD on modify (FIX 2026-05-07)`
- [`fetch-history-plus-check-availability.js:1519`](_extracted/fetch-history-plus-check-availability.js) — `// FIX 2026-05-07: include lastReservation (close-45m) so the LLM never proposes`
- [`openai.js:1258`](_extracted/openai.js) — `// FIX 2026-05-07: strip '(última reserva HH:MM)' annotations from`

### FIX 2026-05-12 <a id="fix-2026-05-12"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:448`](_extracted/book-plus-notify-owner.js) — `// FIX 2026-05-12: distinguish before-opening from after-closing / between shifts.`
- [`openai.js:872`](_extracted/openai.js) — `// FIX 2026-05-12: skip overlay when bot just asked for notas — the LLM tends`
- [`openai.js:905`](_extracted/openai.js) — `// FIX 2026-05-12: sticky book flow when bot is at notas_ask. The LLM`
- [`openai.js:980`](_extracted/openai.js) — `// FIX 2026-05-12: extend yes-handling to modify intent. Steward asked to`
- [`openai.js:1042`](_extracted/openai.js) — `// FIX 2026-05-12: also accept _extracted.intent === 'offtopic' — LLM`
- [`openai.js:1064`](_extracted/openai.js) — `// FIX 2026-05-12: split into NO-branch and CONTENT-branch. Either way the`
- [`openai.js:1088`](_extracted/openai.js) — `// FIX 2026-05-12: when prior turn refused empty-modify and asked "qué quieres`
- [`openai.js:1273`](_extracted/openai.js) — `// FIX 2026-05-12: enforce CLOSING_OFFSET_CFG (=45 min) as hard last-reservation cap.`
- [`openai.js:1279`](_extracted/openai.js) — `// FIX 2026-05-12: distinguish before-opening from after-last-reservation.`
- [`openai.js:1284`](_extracted/openai.js) — `// FIX 2026-05-12 (between-shifts): "before opening" must mean before the`
- [`openai.js:1430`](_extracted/openai.js) — `// FIX 2026-05-12: defer modify_reservation when the user originally`
- [`openai.js:1485`](_extracted/openai.js) — `// FIX 2026-05-12: defer modify_reservation when the user originally`

### FIX LANG <a id="fix-lang"></a>

**What**: notas MUST stay in customer's original language (no translation)

**Locations** (file:line):
- [`openai.js:603`](_extracted/openai.js) — `- Notas: mención espontánea de alergias, cumple, niños, mascota, etc. Si dice "no/nada" o no menciona = null. FIX B18c (2026-04-26): notas debe ser un HECHO afirmativo, NUNCA una pregunta del cliente. Si el cliente pr...`

### PATCH:auto-recovery-guards-v1 <a id="patch:auto-recovery-guards-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:427`](_extracted/openai.js) — `// PATCH:auto-recovery-guards-v1 (2026-05-06)`

### PATCH:cooldown-60s-v1 <a id="patch:cooldown-60s-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:260`](_extracted/fetch-history-plus-check-availability.js) — `// PATCH:cooldown-60s-v1`

### PATCH:disambig-local-match-v1 <a id="patch:disambig-local-match-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1531`](_extracted/openai.js) — `// PATCH:disambig-local-match-v1 (2026-05-06)`

### PATCH:disambig-localized-date-v1 <a id="patch:disambig-localized-date-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:888`](_extracted/book-plus-notify-owner.js) — `// PATCH:disambig-localized-date-v1 (2026-05-06): show "12 mayo 2026 20:30 (12p)"`

### PATCH:disambig-persist-supabase-v1 <a id="patch:disambig-persist-supabase-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:843`](_extracted/book-plus-notify-owner.js) — `// PATCH:disambig-persist-supabase-v1 (2026-05-06): persist disambig state`

### PATCH:empty-session-init-v1 <a id="patch:empty-session-init-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:414`](_extracted/openai.js) — `// PATCH:empty-session-init-v1 (2026-05-06): treat {} (or any session without fields) as fresh — _dbAcquireLock can return {} when session_data was reset, which used to crash on _sess.fields.personas`

### PATCH:modify-recap-notes-v1 <a id="patch:modify-recap-notes-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:978`](_extracted/book-plus-notify-owner.js) — `// PATCH:modify-recap-notes-v1 (2026-05-06): include current notes`

### PATCH:modify-without-reservations-auto-clear <a id="patch:modify-without-reservations-auto-clear"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:501`](_extracted/openai.js) — `// PATCH:modify-without-reservations-auto-clear (2026-05-05)`

### PATCH:past-date-silent-reset-v1 <a id="patch:past-date-silent-reset-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`openai.js:1182`](_extracted/openai.js) — `// PATCH:past-date-silent-reset-v1 (2026-04-30) — if persisted fecha is`
- [`openai.js:1627`](_extracted/openai.js) — `// PATCH:past-date-silent-reset-v1 (2026-04-30) — same guard as book.`

### PATCH:paused-save-v1 <a id="patch:paused-save-v1"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:268`](_extracted/fetch-history-plus-check-availability.js) — `// PATCH:paused-save-v1`

### PATCH:post-completion-reset-guard <a id="patch:post-completion-reset-guard"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:280`](_extracted/book-plus-notify-owner.js) — `// PATCH:post-completion-reset-guard (2026-05-05)`

### PATCH:post-completion-reset-helper <a id="patch:post-completion-reset-helper"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`book-plus-notify-owner.js:279`](_extracted/book-plus-notify-owner.js) — `// PATCH:post-completion-reset-helper (2026-05-05)`

### PATCH:reset-session-post-completion <a id="patch:reset-session-post-completion"></a>

**What**: _(no description yet — see code context)_

**Locations** (file:line):
- [`fetch-history-plus-check-availability.js:894`](_extracted/fetch-history-plus-check-availability.js) — `// PATCH:reset-session-post-completion (2026-05-05) — wipe state so next msg is fresh`
- [`fetch-history-plus-check-availability.js:1134`](_extracted/fetch-history-plus-check-availability.js) — `// PATCH:reset-session-post-completion (2026-05-05) — wipe state so next msg is fresh`
- [`fetch-history-plus-check-availability.js:1231`](_extracted/fetch-history-plus-check-availability.js) — `// PATCH:reset-session-post-completion (2026-05-05)`

