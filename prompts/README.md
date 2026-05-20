# `prompts/` — Picnic Chatbot LLM prompts (versioned)

These files extract the system prompts used by the live `[Picnic] Chatbot WhatsApp` workflow's OpenAI calls. They live here so that:

- Diffs are **readable** (Markdown, not embedded inside a 750 KB JSON).
- Sofía (collaboratrice) can edit them directly and propose PRs.
- Each prompt change has a Git history independent of the n8n workflow.

**Source of truth** (until the refactor lands): the live n8n workflow `[Picnic] Chatbot WhatsApp` (id `166QnQsGHqXDpBxa`). Last sync: 2026-05-20.

## Inventory

| File | Section | Role | Model |
|---|---|---|---|
| `parser.es.md` | Section 1/3 — Parser | Extract `{intent, personas, fecha, hora, zona, nombre, notas, confirmacion}` from inbound user message | `gpt-5.1`, `reasoning_effort: low`, `response_format: json_object` |
| `formatter-instruction.es.md` | Section 2/3 — Formatter (instruction-driven) | Render the controller's `nextInstruction` into a single conversational turn in the customer's language | `gpt-5.1`, `reasoning_effort: low` |
| `formatter-tools.es.md` | Section 3/3 — Formatter (tools-driven) | Long-form system prompt used when the bot calls function-calling tools (`book_reservation`, `modify_reservation`, etc.) | `gpt-5.1` |
| `tools.json` | — | OpenAI function-calling schema for `check_availability`, `book_reservation`, `modify_reservation`, `add_waitlist` | — |

## Placeholders

Template variables in the prompts use `{{NAME}}` (Mustache-style). Runtime substitution happens in the controller. Variables defined:

| Placeholder | Meaning | Example |
|---|---|---|
| `{{TODAY}}` | ISO date today in `Atlantic/Canary` | `2026-05-20` |
| `{{DAY_NAME}}` | Localized name of today | `martes` |
| `{{TIME}}` | HH:MM local time | `11:42` |
| `{{TOMORROW}}` | ISO date tomorrow | `2026-05-21` |
| `{{DAY_AFTER_TOMORROW}}` | ISO date day-after-tomorrow | `2026-05-22` |
| `{{CALENDAR_BLOCK}}` | Multi-line block: next 14-30 days with `lunes 2026-05-20 | almuerzo 12:30-15:30 · cena 19:30-22:30` | (renders dynamically) |
| `{{SCHEDULE_INFO}}` | Weekly opening hours summary | `lunes cerrado · martes-domingo 12:30-15:30 / 19:30-22:30` |
| `{{SLOTS_INFO}}` | Pre-computed availability hint for today/tomorrow | `Hoy quedan 12 plazas a las 21:00 …` |
| `{{EXISTING_RESERVATIONS}}` | Block listing the customer's active reservations | `Sábado 2026-05-24 21:00 (4 personas, terraza, María)` |
| `{{KB_CONTENT}}` | Knowledge-base content for `info` intent | menu / address / parking text |
| `{{SENDER_PHONE}}` | E.164 phone of inbound message | `+34612345678` |
| `{{LANG}}` | Customer's sticky language (es/it/en/de) | `it` |
| `{{NEXT_INSTRUCTION}}` | Controller-built mandatory instruction for this turn | `Pregunta personas` |
| `{{CUSTOMER_FIELDS_JSON}}` | JSON dump of session.fields for formatter context | `{"personas":4,"fecha":"…","hora":null,…}` |
| `{{USER_MESSAGE}}` | The raw inbound message (parser only) | `"hola, quiero reservar para 4 el sábado a las 21"` |

## Why Spanish only

The parser prompt is **written in Spanish but parses messages in 4 languages** (ES/IT/EN/DE). The output JSON is language-agnostic (intent, dates, numbers). The formatter prompts mirror this: instruction in Spanish, output in the customer's `{{LANG}}`. This avoids 4× prompt duplication and matches gpt-5.1 behavior.

The only **language-specific** strings are inside the fixed phrases the formatter must use (e.g. apology recovery, offtopic message, mascotas acknowledgment) — those are managed in `src/lib/i18n/dictionaries/` (not here).

## How to refresh from production

```bash
# After editing in n8n UI, re-sync from live:
N8N_API_KEY=… node scripts/sync-prompts-from-n8n.mjs  # (TODO: build this)
```

Until that script exists, the live workflow remains the canonical version.
