// Voicemail / "segreteria" — the shared, single-source logic for the answering
// machine that can take over a call INSTEAD of the reservation agent.
//
// Until now this lived inline in /api/sync-vapi-voicemail/route.ts and worked
// ONLY for tenants with their own dedicated Vapi assistant (it PATCHed that
// assistant's prompt). Tenants on the shared "motore unico" had no way to use
// it — the sync was a documented no-op for them. This module extracts the pure
// pieces so BOTH paths share one implementation:
//   - the legacy per-assistant sync route (imports these helpers), and
//   - the multi-tenant engine (lib/voice/engine.ts), which composes the block
//     into the per-call prompt so voicemail finally works on the shared engine.
//
// When voicemail is ACTIVE it OVERRIDES everything else: the agent reads the
// script and ends the call, it does NOT take reservations.

export interface TimeSlot {
  open: string;
  close: string;
}
export interface VoicemailMessage {
  es: string;
  en: string;
  it: string;
  de: string;
}
export type VoicemailMode = "always" | "scheduled" | "off";
export interface VoicemailConfig {
  enabled: boolean;
  mode?: VoicemailMode;
  schedule: Record<string, TimeSlot[]>;
  forward_phone: string;
  message: VoicemailMessage;
}

/** The four languages the voicemail script + openers exist in. */
export type VmLang = "es" | "it" | "en" | "de";

export const VM_BLOCK_START = "<!-- VOICEMAIL_BLOCK_START -->";
export const VM_BLOCK_END = "<!-- VOICEMAIL_BLOCK_END -->";

/** The three resolved runtime states the voicemail can be in for a given call. */
export type VoicemailState = "active" | "forward" | "normal";

/**
 * Resolve the mode from the config. New configs carry an explicit `mode`;
 * legacy ones only have `enabled` + `schedule`, so we derive it: a manual
 * enable means "always", any configured slot means "scheduled", else "off".
 */
export function resolveMode(vm: VoicemailConfig): VoicemailMode {
  if (vm.mode) return vm.mode;
  if (vm.enabled) return "always";
  const hasSlots = Object.values(vm.schedule || {}).some((slots) => (slots?.length || 0) > 0);
  return hasSlots ? "scheduled" : "off";
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
}

/**
 * Returns true if `now` (in `tz`) falls inside any slot for today's weekday.
 * Slots that wrap past midnight (open > close) are supported. `now` is injected
 * for testability (defaults to the real current time).
 */
export function isInsideSchedule(
  schedule: Record<string, TimeSlot[]>,
  tz: string,
  now: Date = new Date(),
): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const today = dayMap[weekdayShort] ?? 0;
  const yesterday = (today + 6) % 7;
  const nowMin = minutes(`${hh}:${mm}`);

  const todaySlots = schedule[String(today)] || [];
  for (const s of todaySlots) {
    const a = minutes(s.open);
    const b = minutes(s.close);
    if (a <= b) {
      if (nowMin >= a && nowMin < b) return true;
    } else {
      // overnight slot: covers from `a` until midnight today
      if (nowMin >= a) return true;
    }
  }
  // overnight slots from yesterday that bleed into today
  const yslots = schedule[String(yesterday)] || [];
  for (const s of yslots) {
    const a = minutes(s.open);
    const b = minutes(s.close);
    if (a > b && nowMin < b) return true;
  }
  return false;
}

/**
 * The effective runtime state for a call, given the config + venue timezone:
 *  - "active":  read the script and end the call (always, or scheduled & in slot)
 *  - "forward": transfer to the owner (scheduled & OUTSIDE the slot)
 *  - "normal":  behave as the regular reservation agent ("off")
 * `now` injected for testability.
 */
export function resolveVoicemailState(
  vm: VoicemailConfig | undefined,
  tz: string,
  now: Date = new Date(),
): { state: VoicemailState; active: boolean; forward: boolean; mode: VoicemailMode; forwardPhone: string } {
  if (!vm) return { state: "normal", active: false, forward: false, mode: "off", forwardPhone: "" };
  const mode = resolveMode(vm);
  const active =
    mode === "always" ? true : mode === "scheduled" ? isInsideSchedule(vm.schedule || {}, tz, now) : false;
  const forward = !active && mode === "scheduled";
  const state: VoicemailState = active ? "active" : forward ? "forward" : "normal";
  return { state, active, forward, mode, forwardPhone: vm.forward_phone || "" };
}

/**
 * The prompt block that drives voicemail behaviour. It is PREPENDED to the
 * system prompt and explicitly overrides every other rule. `active` is the
 * resolved state; the block itself recomputes forward from the mode so it can be
 * called with just (active, vm) exactly like the legacy route did.
 */
export function buildVoicemailBlock(active: boolean, vm: VoicemailConfig): string {
  const forward = !active && resolveMode(vm) === "scheduled";
  const stateLabel = active
    ? "VOICEMAIL ACTIVE (read script and end)"
    : forward
      ? "FORWARD ACTIVE (transfer to owner)"
      : "NORMAL (take reservations as usual)";

  let rules: string;
  if (active) {
    rules = [
      "  • Voicemail mode is ACTIVE. You are NOT the reservation assistant right now: do NOT take reservations, do NOT call any booking tool, do NOT ask about party size, date or time, do NOT start the booking flow — even if the caller asks.",
      "  • Your opening line already spoke the voicemail message IN FULL. Do NOT repeat it and do NOT add anything else.",
      "  • End the call YOURSELF right after that message — call the end_call tool IMMEDIATELY. Do NOT wait for the caller to say anything; this is an answering-machine message, the caller may stay silent, so you must hang up on your own.",
      "  • The ONLY exception: if the caller speaks BEFORE you hang up, reply with at most one short warm line (e.g. tell them to continue on the WhatsApp you just sent) and then call end_call. Never begin a reservation, never keep the line open.",
    ].join("\n");
  } else if (forward) {
    rules = [
      "  • FORWARD mode is active. The caller must be transferred to the owner immediately.",
      `  • Greet briefly in the caller's language (1 short sentence, e.g. "Un momento, le paso con el responsable").`,
      `  • Then call the transferCall tool with destination ${vm.forward_phone}.`,
      "  • Do NOT take reservations and do NOT call any booking tool. Do NOT engage in conversation.",
    ].join("\n");
  } else {
    rules = [
      "  • NORMAL mode. This block is INACTIVE — ignore voicemail/forward entirely.",
      "  • Behave as the regular reservation agent described below: take reservations,",
      "    modifications and cancellations using the booking tools.",
      "  • Do NOT transfer the call and do NOT read any voicemail script.",
    ].join("\n");
  }

  return [
    VM_BLOCK_START,
    "=====================================================",
    "DYNAMIC VOICEMAIL CONTROL (auto-generated by CRM — do not edit by hand)",
    "=====================================================",
    `Current state: ${stateLabel}`,
    `Owner forwarding phone: ${vm.forward_phone}`,
    "",
    "RULES — ALWAYS OBEY, OVERRIDE EVERYTHING ELSE IN THIS PROMPT:",
    rules,
    "",
    "VOICEMAIL SCRIPTS (read verbatim only when voicemail is ACTIVE):",
    `  [ES]\n  ${vm.message.es}`,
    `  [EN]\n  ${vm.message.en}`,
    `  [IT]\n  ${vm.message.it}`,
    `  [DE]\n  ${vm.message.de}`,
    "=====================================================",
    VM_BLOCK_END,
  ].join("\n");
}

/** Replace an existing voicemail block in-place, or prepend it (so it takes
 * precedence over the rest of the prompt) on first install. */
export function injectBlock(prompt: string, block: string): string {
  if (prompt.includes(VM_BLOCK_START) && prompt.includes(VM_BLOCK_END)) {
    const re = new RegExp(`${VM_BLOCK_START}[\\s\\S]*?${VM_BLOCK_END}`, "m");
    return prompt.replace(re, block);
  }
  return block + "\n\n" + prompt;
}

/**
 * The spoken opener for a voicemail/forward call, in the call's language. For
 * "active" it is a short greeting before the agent reads the script; for
 * "forward" it is a neutral filler while the transfer happens. Returns null for
 * "normal" so the caller keeps its own reservation greeting.
 */
export function voicemailFirstMessage(
  state: VoicemailState,
  name: string,
  lang: VmLang,
  script?: VoicemailMessage,
): string | null {
  const n = name || (lang === "es" ? "el restaurante" : "the restaurant");
  if (state === "active") {
    // Speak the FULL voicemail script as the very first line. This is
    // DETERMINISTIC — it does not depend on the model choosing to "read the
    // script": gpt-4.1 was drifting straight back into the reservation agent
    // after a neutral "Hola, {name}." opener (the caller heard the booking flow
    // instead of the message). Fall back to a bare greeting only if no script.
    const body = (script && script[lang]) || { es: `Hola, ${n}.`, it: `Ciao, ${n}.`, en: `Hi, ${n}.`, de: `Hallo, ${n}.` }[lang];
    // Append a goodbye that matches the engine assistant's endCallPhrases, so
    // Vapi hangs up DETERMINISTICALLY as soon as the opener finishes — without
    // waiting for the model to decide to call end_call (it was leaving the line
    // open after the message, since the caller stays silent on an answering
    // machine). The phrase must be one of endCallPhrases in lib/voice (engine).
    const bye = { es: "Adiós.", it: "Arrivederci.", en: "Goodbye.", de: "Auf Wiedersehen." }[lang];
    return `${body} ${bye}`;
  }
  if (state === "forward") {
    return {
      es: "Un momento, por favor.",
      it: "Un attimo, per favore.",
      en: "One moment, please.",
      de: "Einen Moment, bitte.",
    }[lang];
  }
  return null;
}

/** A Vapi transferCall tool pointing at `phone` — used for the FORWARD state. */
export function transferCallTool(phone: string) {
  return {
    type: "transferCall",
    destinations: [
      {
        type: "number",
        number: phone,
        message: "Le paso con el responsable, un momento.",
        description: "Owner phone for after-hours / forwarding.",
      },
    ],
  };
}
