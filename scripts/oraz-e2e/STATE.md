# Oraz E2E test — running state (checkpoint for /compact)

## Goal
User wants E2E tests of EVERY CRM bot function (Sofía WhatsApp bot, tenant Oraz
`93eebe9c-8af5-4ca5-a315-3376ef4976e5`). **5 rounds per function, loop until 100% on every function.**
"Non deve essere una lotteria." Explain in Italian, be specific.

## Harness (DONE, works)
`scripts/oraz-e2e/` — drives the LIVE n8n bot via webhook + reads reply from execution log.
- `harness.mjs`: sendTurn (POST to `n8n.srv1468837.hstgr.cloud/webhook/oraz-93ee-whatsapp`, poll exec by MessageSid, read `Process AI Response.cleanResponse`; fallback `extractOutgoingWhatsApp` for skip-path). `seedReservation` (DB), `supaReq`, cleanup.
- `scenarios.mjs`: 12 functions. cancel/modify now assert via DB status (reply is fire-and-forget Meta, unreadable).
- `run.mjs`: N rounds/function, pass-rate matrix, `--only`, `--cleanup`, `--rounds`.
- Run: `node scripts/oraz-e2e/run.mjs --rounds 5 --json scripts/oraz-e2e/results.json`
- Live workflow pulled to `N8N/picnic/live_oraz.TRUE.json` (the local `live_oraz.json` was STALE/pre-optimization — always use TRUE). Backup: `live_oraz.PRE_E2E_FIX_*.json`.
- n8n creds + Supabase service key auto-loaded from `.env.local` + workflow.

## Baseline (12×5): menu 20%, modify 60%, cancel 0% real bugs; hours/closed/out-of-hours were FALSE NEGATIVES in tests.

## Bot FIXES already DEPLOYED LIVE (workflow id zXEYdw8Zbs5seCci, all verified present):
1. DB `bot_config.restaurant_name="Oraz"` (was null→fallback "BALI REST"). ✓ menu now lists real sushi.
2. OpenAI node fallback `'BALI REST'`→`'Oraz'`.
3. Send node: no-empty-reply guard (localized fallback instead of silent bail).
4. Prompt: modify MUST call tool (never narrate); speak when no active reservation.
5. Prompt: HOURS always in 24h DIGITS (user: "deve scrivere i numeri degli orari, non a parole"). ✓ hours 100%.
6. Prompt: get_menu-FIRST for cuisine/dish Qs, no memory claims.

## REMAINING REAL ISSUE — KB data contradiction (THE root cause, NEEDS USER DECISION, ask by voice):
KB article "Posizione e come arrivare" literally says **"Oraz - Pasta fresca fatta in casa"** but menu_items = **239 items, 146 sushi/Japanese, 0 pasta**. Menu is the truth (sushi bar in Las Palmas, Calle Pascal 16).

**CONFIRMED 2026-06-02 16:50: prompt fix #6 is NOT enough.** Re-tested menu 3×:
- "¿tenéis sushi?" → ✅ now lists real sushi.
- "¿qué tipo de comida es?" → ❌ STILL "Oraz – pasta fresca, cocina italiana" (reads it straight from KB).
- "que platos hay?" → ❌ just dumps the /m/oraz URL.
→ The bot trusts the KB line over the prompt. **MUST FIX THE KB DATA.** The "Oraz - Pasta fresca fatta in casa" string is in the `knowledge_articles` "Posizione..." content (Italian; check if other-lang articles exist too). Also the `/m/oraz` URL dump for "que platos hay?" suggests it'd rather link than list — acceptable, but the cuisine line is wrong.

**NEXT SESSION FIRST STEP (ask by voice in Italian):** "Oraz è un sushi/giapponese, vero? La scheda dice 'pasta fresca' ma il menù è 239 piatti tutti sushi. Confermi che è sushi così correggo la descrizione?" Then PATCH the KB article content replacing the pasta line with the real concept (sushi/Japanese, Las Palmas). DB CRM = `azhlnybiqlkbhbboyvud`, service key embedded in workflow Send node. After KB fix, re-run menu scenario, then full 12×5.

## Verified 100% after fixes (1-round): modify, cancel (DB-truth), hours, closed_day, out_of_hours.
## Still to do: re-run FULL 12×5 until all green; fix KB cuisine; FINAL cleanup of test data (34699* phones).
## Cleanup ran once: removed 75 guests/4 res/72 conv/324 msgs. Must run again at end: `node scripts/oraz-e2e/run.mjs --cleanup`.
