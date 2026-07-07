// The assistant's LLM fallback: when the free local matcher/parsers don't
// understand a message, the widget POSTs it to /api/assistant/interpret and
// receives one of these structured interpretations back. This module is the
// pure, testable half — validating whatever JSON the model produced so the
// widget never acts on malformed output. No network here.

import { topicById } from "./kb";
import type { ActionIntent } from "./actions";

export type Interpretation =
  | { type: "action"; action: ActionIntent; phoneUnknown?: boolean }
  | { type: "topic"; topicId: string }
  | { type: "answer"; text: string }
  | { type: "yes" }
  | { type: "no" }
  | { type: "pick"; index: number };

const pad = (n: number) => String(n).padStart(2, "0");

function cleanDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return undefined;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${m[1]}-${pad(mm)}-${pad(dd)}`;
}

function cleanTime(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : undefined;
}

function cleanName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, 60);
  return s || undefined;
}

function cleanPhone(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\s.-]/g, "");
  return /^\+?\d{6,15}$/.test(s) ? s : undefined;
}

function cleanParty(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined;
}

function cleanMoney(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 999999 ? Math.round(n * 100) / 100 : undefined;
}

const CREATE_SLOT_KEYS = ["name", "phone", "phone_unknown", "date", "time", "party"];

function parseAction(action: unknown, today: string): Interpretation | null {
  if (!action || typeof action !== "object") return null;
  const a = action as Record<string, unknown>;
  // Mid-flow the model sometimes returns just the new slots and drops the
  // kind ({"phone_unknown":true,"party":6}) — that can only be a create.
  const kind = a.kind ?? (CREATE_SLOT_KEYS.some((k) => a[k] != null) ? "create_reservation" : undefined);
  switch (kind) {
    case "create_reservation": {
      const out: Interpretation = {
        type: "action",
        action: {
          kind: "create_reservation",
          name: cleanName(a.name),
          phone: cleanPhone(a.phone),
          date: cleanDate(a.date),
          time: cleanTime(a.time),
          party: cleanParty(a.party),
        },
      };
      if (a.phone_unknown === true) out.phoneUnknown = true;
      return out;
    }
    case "cancel_reservation":
      return {
        type: "action",
        action: { kind: "cancel_reservation", name: cleanName(a.name), date: cleanDate(a.date) },
      };
    case "recap_reservations":
      return { type: "action", action: { kind: "recap_reservations", date: cleanDate(a.date) || today } };
    case "revenue":
      return { type: "action", action: { kind: "revenue" } };
    case "open_register":
      return { type: "action", action: { kind: "open_register", float: cleanMoney(a.float) } };
    case "close_register":
      return { type: "action", action: { kind: "close_register" } };
    default:
      return null;
  }
}

/** Validate the model's raw output (string or already-parsed object) into a
 * safe Interpretation, or null when it can't be trusted. `today` (YYYY-MM-DD,
 * restaurant-local) fills defaults like a recap with no date. */
export function parseInterpretation(raw: unknown, today: string): Interpretation | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    try {
      obj = JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  switch (o.type) {
    case "yes":
      return { type: "yes" };
    case "no":
      return { type: "no" };
    case "pick": {
      const i = Number(o.index);
      return Number.isInteger(i) && i >= 1 && i <= 99 ? { type: "pick", index: i } : null;
    }
    case "topic": {
      const id = typeof o.id === "string" ? o.id : "";
      return id && topicById(id) ? { type: "topic", topicId: id } : null;
    }
    case "answer": {
      const text = typeof o.text === "string" ? o.text.trim() : "";
      return text ? { type: "answer", text: text.slice(0, 2000) } : null;
    }
    case "action":
      return parseAction(o.action, today);
    default:
      return null;
  }
}
