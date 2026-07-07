"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, Send, ArrowRight, RotateCcw } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { answerQuery, normalize } from "@/lib/assistant/engine";
import {
  detectAction,
  actionText,
  parseDateWord,
  parseTimeWord,
  parsePartyWord,
  parsePhoneWord,
  parseMoneyWord,
  YES_WORDS,
  ABORT_WORDS,
  SKIP_WORDS,
  type ActionIntent,
} from "@/lib/assistant/actions";
import type { Interpretation } from "@/lib/assistant/nlu";
import {
  UI,
  topicById,
  SUGGESTED_TOPIC_IDS,
  type AssistantLang,
  type KbTopic,
} from "@/lib/assistant/kb";
import { fmtEur, type SessionSummary } from "@/lib/cassa/totals";
import type { CassaSessionRow } from "@/lib/cassa/types";
import {
  createReservationAction,
  updateReservationDetailsAction,
} from "@/app/actions/reservations";
import { safeSession } from "@/lib/safe-storage";

// The floating in-app helper. Questions are answered from the local knowledge
// base (free, offline — see src/lib/assistant); OPERATIONAL commands ("crea una
// prenotazione", "apri la cassa", "quanto abbiamo incassato?") are detected
// locally too and executed against the CRM's own APIs, with a confirmation
// step before anything is written. When the local matcher does NOT understand
// a message (free-form phrasing, several details in one sentence, mid-flow
// corrections), it falls back to /api/assistant/interpret — an LLM that maps
// the message to the same structured intents — so day-to-day traffic stays
// free and the long tail still works.

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "bot"; text?: string; topicId?: string; relatedIds?: string[]; suggest?: boolean };

const STORE_KEY = "crm_assistant_chat_v1";
const MAX_MESSAGES = 60;
const TYPING_MS = 3000; // simulated "typing…" pause before each reply
const QUICK_TYPING_MS = 500; // follow-up replies right after an LLM round
// Local topic matches below this score are "maybe"s: the LLM gets first shot
// and the local guess stays as the offline/no-key safety net.
const STRONG_TOPIC_SCORE = 6;

function loadChat(): ChatMessage[] {
  try {
    const raw = safeSession.get(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------- action flows
interface ResLite {
  id: string;
  time: string;
  date: string;
  party_size: number;
  status: string;
  guest_name: string;
}

type Flow =
  | {
      kind: "create_reservation";
      stage: "name" | "date" | "time" | "party" | "phone" | "confirm";
      slots: { name?: string; phone?: string; date?: string; time?: string; party?: number };
    }
  | { kind: "cancel_reservation"; stage: "pick" | "confirm"; matches: ResLite[]; chosen?: ResLite }
  | { kind: "open_register"; stage: "float" }
  | { kind: "close_register"; stage: "confirm" };

export function AssistantWidget() {
  const { language, t } = useLanguage();
  const lang = language as AssistantLang;
  const ui = UI[lang] || UI.en;
  const router = useRouter();
  const { activeTenant } = useTenant();
  const tenantId = activeTenant?.id;
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Replies are delivered after a short "typing…" pause to feel like a chat
  // with a person; this counts the replies still being "typed".
  const [pending, setPending] = useState(0);
  const flowRef = useRef<Flow | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
    },
    [],
  );

  useEffect(() => {
    setMessages(loadChat());
  }, []);

  useEffect(() => {
    safeSession.set(STORE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, messages, pending]);

  const suggestions = useMemo(
    () => SUGGESTED_TOPIC_IDS.map(topicById).filter(Boolean) as KbTopic[],
    [],
  );

  const push = (...msgs: ChatMessage[]) =>
    setMessages((prev) => [...prev, ...msgs].slice(-MAX_MESSAGES));

  /** Show the typing dots for `delay` ms, then deliver the bot messages. */
  const replyLater = (delay: number, ...msgs: ChatMessage[]) => {
    setPending((p) => p + 1);
    timersRef.current.push(
      setTimeout(() => {
        setPending((p) => Math.max(0, p - 1));
        push(...msgs);
      }, delay),
    );
  };

  // While handling an LLM round the user already waited out the typing dots,
  // so follow-up replies scheduled inside it go out quickly instead of adding
  // another 3s pause.
  const quickRef = useRef(false);
  const typingMs = () => (quickRef.current ? QUICK_TYPING_MS : TYPING_MS);

  const say = (text: string) => replyLater(typingMs(), { role: "bot", text });

  /** Async work behind the typing dots — the reply lands after max(op, 3s). */
  const sayAsync = (op: () => Promise<string>) => {
    setPending((p) => p + 1);
    const started = Date.now();
    const delay = typingMs();
    op()
      .catch((err) =>
        actionText("error", lang, { msg: err instanceof Error ? err.message : String(err) }),
      )
      .then((text) => {
        const wait = Math.max(0, delay - (Date.now() - started));
        timersRef.current.push(
          setTimeout(() => {
            setPending((p) => Math.max(0, p - 1));
            push({ role: "bot", text });
          }, wait),
        );
      });
  };

  /** Wait out the remaining typing time of an LLM round, then run `fn` in
   * quick-typing mode so its own say()/sayAsync() don't re-add the pause. */
  const afterThinking = (started: number, fn: () => void) => {
    const wait = Math.max(0, TYPING_MS - (Date.now() - started));
    timersRef.current.push(
      setTimeout(() => {
        setPending((p) => Math.max(0, p - 1));
        quickRef.current = true;
        try {
          fn();
        } finally {
          quickRef.current = false;
        }
      }, wait),
    );
  };

  // --------------------------------------------------------- LLM fallback
  const pad2 = (n: number) => String(n).padStart(2, "0");

  /** Ask /api/assistant/interpret to make sense of a message the local
   * matcher rejected. Returns null on any failure — callers always have a
   * local fallback, so the assistant keeps working offline/without a key. */
  const interpret = async (message: string, flowCtx?: string): Promise<Interpretation | null> => {
    if (!tenantId) return null;
    try {
      const now = new Date();
      const res = await fetch("/api/assistant/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          message,
          lang,
          today: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
          weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
          history: messages
            .slice(-6)
            .map((m) => ({
              role: m.role,
              text:
                m.role === "user"
                  ? m.text
                  : m.text || (m.topicId ? topicById(m.topicId)?.title[lang] || "" : ""),
            }))
            .filter((h) => h.text),
          flow: flowCtx,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { interpretation?: Interpretation | null };
      return data.interpretation ?? null;
    } catch {
      return null;
    }
  };

  // ------------------------------------------------------------- formatting
  const fmtDate = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(lang, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  const resSummary = (s: { name?: string; date?: string; time?: string; party?: number }) =>
    `👤 ${s.name || "—"} · 📅 ${s.date ? fmtDate(s.date) : "—"} · 🕗 ${s.time || "—"} · ${s.party ?? "—"} pax`;

  const liteSummary = (r: ResLite) =>
    `👤 ${r.guest_name} · 📅 ${fmtDate(r.date)} · 🕗 ${r.time} · ${r.party_size} pax`;

  const summaryBody = (s: Partial<SessionSummary>) => {
    const lines = [
      `${t("cassa_gross")}: ${fmtEur(Number(s.gross) || 0)}`,
      `${t("cassa_receipts")}: ${s.receipts ?? 0} · ${t("cassa_covers")}: ${s.covers ?? 0}`,
    ];
    for (const [m, v] of Object.entries(s.byMethod || {})) {
      lines.push(`• ${t(("cassa_method_" + (m === "meal_voucher" ? "voucher" : m === "bank_transfer" ? "bank" : m)) as Parameters<typeof t>[0])}: ${fmtEur(Number(v) || 0)}`);
    }
    if (s.expectedCash != null) lines.push(`${t("cassa_expected_cash")}: ${fmtEur(Number(s.expectedCash) || 0)}`);
    return lines.join("\n");
  };

  // ------------------------------------------------------------- executors
  const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
    return data as T;
  };

  type SessionInfo = {
    session: CassaSessionRow | null;
    summary: SessionSummary | null;
    last_session: CassaSessionRow | null;
    business_date: string;
  };
  const fetchSession = () => api<SessionInfo>(`/api/cassa/session?tenant_id=${tenantId}`);

  const runCreateReservation = (slots: NonNullable<Extract<Flow, { kind: "create_reservation" }>["slots"]>) =>
    sayAsync(async () => {
      const res = await createReservationAction({
        tenantId: tenantId!,
        guestName: slots.name!,
        guestPhone: slots.phone || "",
        date: slots.date!,
        time: slots.time!,
        partySize: slots.party!,
        source: "staff",
      });
      if (!(res as { success?: boolean }).success) {
        return actionText("error", lang, { msg: (res as { error?: string }).error || "?" });
      }
      return actionText("created", lang, { summary: resSummary(slots) });
    });

  const loadReservations = async (date: string, activeOnly: boolean): Promise<ResLite[]> => {
    const q = supabase
      .from("reservations")
      .select("id, time, date, party_size, status, guests(name)")
      .eq("tenant_id", tenantId!)
      .eq("date", date);
    const { data, error } = activeOnly
      ? await q.in("status", ["pending_confirmation", "confirmed", "seated"])
      : await q.neq("status", "cancelled");
    if (error) throw new Error(error.message);
    return ((data || []) as unknown as Array<Record<string, unknown>>)
      .map((r) => ({
        id: r.id as string,
        time: r.time as string,
        date: r.date as string,
        party_size: Number(r.party_size) || 0,
        status: r.status as string,
        guest_name: ((r.guests as { name?: string } | null)?.name || "—") as string,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));
  };

  const runCancel = (r: ResLite) =>
    sayAsync(async () => {
      const res = await updateReservationDetailsAction({
        tenantId: tenantId!,
        reservationId: r.id,
        data: { status: "cancelled" },
      });
      if (!(res as { success?: boolean }).success) {
        return actionText("error", lang, { msg: (res as { error?: string }).error || "?" });
      }
      return actionText("cancelled", lang, { summary: liteSummary(r) });
    });

  // ------------------------------------------------------------- flow engine
  const startFlow = (intent: ActionIntent) => {
    if (!tenantId) return say(actionText("error", lang, { msg: "no tenant" }));
    switch (intent.kind) {
      case "create_reservation": {
        const slots = {
          name: intent.name,
          phone: intent.phone,
          date: intent.date,
          time: intent.time,
          party: intent.party,
        };
        advanceCreate(slots);
        return;
      }
      case "cancel_reservation": {
        const date = intent.date || new Date().toISOString().slice(0, 10);
        sayAsync(async () => {
          let matches = await loadReservations(date, true);
          if (intent.name) {
            const needle = normalize(intent.name);
            const filtered = matches.filter((m) => normalize(m.guest_name).includes(needle));
            if (filtered.length > 0) matches = filtered;
          }
          if (matches.length === 0) {
            return actionText("cancel_none", lang, {
              name: intent.name ? ` (${intent.name})` : "",
              date: fmtDate(date),
            });
          }
          if (matches.length === 1) {
            flowRef.current = { kind: "cancel_reservation", stage: "confirm", matches, chosen: matches[0] };
            return actionText("confirm_cancel", lang, { summary: liteSummary(matches[0]) });
          }
          flowRef.current = { kind: "cancel_reservation", stage: "pick", matches };
          const list = matches.map((m, i) => `${i + 1}. ${m.time} — ${m.guest_name} ×${m.party_size}`).join("\n");
          return actionText("cancel_pick", lang, { list });
        });
        return;
      }
      case "recap_reservations": {
        sayAsync(async () => {
          const rows = await loadReservations(intent.date, false);
          if (rows.length === 0) return actionText("recap_empty", lang, { date: fmtDate(intent.date) });
          const covers = rows.reduce((s, r) => s + r.party_size, 0);
          const header = actionText("recap_header", lang, {
            date: fmtDate(intent.date),
            n: rows.length,
            covers,
          });
          const lines = rows.map((r) => `• ${r.time} — ${r.guest_name} ×${r.party_size}${r.status !== "confirmed" ? ` (${r.status.replace(/_/g, " ")})` : ""}`);
          return [header, ...lines].join("\n");
        });
        return;
      }
      case "revenue": {
        sayAsync(async () => {
          const info = await fetchSession();
          if (info.session && info.summary) {
            return actionText("revenue_open", lang, { body: summaryBody(info.summary) });
          }
          const last = info.last_session;
          if (last?.totals && Object.keys(last.totals).length > 0) {
            const date = last.closed_at ? fmtDate(last.closed_at.slice(0, 10)) : "—";
            return actionText("revenue_last", lang, { date, body: summaryBody(last.totals as Partial<SessionSummary>) });
          }
          return actionText("revenue_none", lang);
        });
        return;
      }
      case "open_register": {
        if (intent.float != null) {
          openRegister(intent.float);
        } else {
          flowRef.current = { kind: "open_register", stage: "float" };
          say(actionText("ask_float", lang));
        }
        return;
      }
      case "close_register": {
        sayAsync(async () => {
          const info = await fetchSession();
          if (!info.session) return actionText("close_nothing", lang);
          flowRef.current = { kind: "close_register", stage: "confirm" };
          return actionText("confirm_close", lang, {
            body: info.summary ? summaryBody(info.summary) : "",
          });
        });
        return;
      }
    }
  };

  const openRegister = (float: number) =>
    sayAsync(async () => {
      const res = await api<{ existing: boolean; session: CassaSessionRow }>("/api/cassa/session", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, opening_float: float }),
      });
      if (res.existing) return actionText("open_already", lang);
      return actionText("opened", lang, { float: fmtEur(float) });
    });

  const closeRegister = () =>
    sayAsync(async () => {
      const res = await api<{ summary: SessionSummary }>("/api/cassa/session", {
        method: "PATCH",
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      return actionText("closed", lang, { body: summaryBody(res.summary) });
    });

  /** Ask for the next missing reservation slot, or confirm when complete. */
  const advanceCreate = (slots: Extract<Flow, { kind: "create_reservation" }>["slots"]) => {
    const next = !slots.name
      ? "name"
      : !slots.date
        ? "date"
        : !slots.time
          ? "time"
          : slots.party == null
            ? "party"
            : slots.phone == null
              ? "phone"
              : "confirm";
    flowRef.current = { kind: "create_reservation", stage: next, slots };
    if (next === "confirm") {
      say(actionText("confirm_create", lang, { summary: resSummary(slots) }));
    } else {
      say(actionText(("ask_" + next) as "ask_name", lang));
    }
  };

  // ------------------------------------------------- natural-language rescue
  type CreateSlots = Extract<Flow, { kind: "create_reservation" }>["slots"];

  /** Merge the create-reservation fields the LLM extracted into the current
   * slots. New values win (corrections). Returns null when nothing new. */
  const mergeCreateSlots = (slots: CreateSlots, interp: Interpretation | null): CreateSlots | null => {
    if (interp?.type !== "action" || interp.action.kind !== "create_reservation") return null;
    const a = interp.action;
    const merged = { ...slots };
    let changed = false;
    if (a.name && a.name !== merged.name) { merged.name = a.name; changed = true; }
    if (a.date && a.date !== merged.date) { merged.date = a.date; changed = true; }
    if (a.time && a.time !== merged.time) { merged.time = a.time; changed = true; }
    if (a.party != null && a.party !== merged.party) { merged.party = a.party; changed = true; }
    if (a.phone && a.phone !== merged.phone) { merged.phone = a.phone; changed = true; }
    else if (interp.phoneUnknown && merged.phone == null) { merged.phone = ""; changed = true; }
    return changed ? merged : null;
  };

  /** Describe the active flow for the LLM so short replies get read in context. */
  const flowContext = (flow: Flow): string => {
    if (flow.kind === "create_reservation") {
      const s = flow.slots;
      const known = [
        s.name && `name=${s.name}`,
        s.date && `date=${s.date}`,
        s.time && `time=${s.time}`,
        s.party != null && `party=${s.party}`,
        s.phone != null && `phone=${s.phone || "none"}`,
      ]
        .filter(Boolean)
        .join(", ");
      if (flow.stage === "confirm") {
        return `Creating a reservation (${known}). The assistant asked the user to CONFIRM it (yes/no); corrections to the details are also possible.`;
      }
      return `Creating a reservation (known: ${known || "nothing yet"}). The assistant just asked the user for: ${flow.stage}.`;
    }
    if (flow.kind === "cancel_reservation") {
      if (flow.stage === "pick") {
        const list = flow.matches.map((m, i) => `${i + 1}. ${m.time} — ${m.guest_name} ×${m.party_size}`).join("\n");
        return `Cancelling a reservation. The assistant showed this numbered list and asked which one to cancel:\n${list}`;
      }
      return "Cancelling a reservation. The assistant asked the user to CONFIRM (yes/no).";
    }
    if (flow.kind === "open_register") {
      return "Opening the till. The assistant asked for the opening cash float (a number).";
    }
    return "Closing the till/cash day. The assistant asked the user to CONFIRM (yes/no).";
  };

  /** Mid-flow reply the strict parsers rejected ("il numero non ce l'ho,
   * comunque siamo in 6", "quella delle 21", "aspetta, meglio alle 21") →
   * let the LLM read it in flow context; `invalid` is the local re-ask. */
  const rescueFlow = (raw: string, invalid: () => void) => {
    const flow = flowRef.current;
    if (!flow || !tenantId) return invalid();
    setPending((p) => p + 1);
    const started = Date.now();
    interpret(raw, flowContext(flow)).then((interp) => {
      afterThinking(started, () => {
        // The flow may have been cleared/replaced while the LLM was thinking.
        if (flowRef.current !== flow) return;

        if (flow.kind === "create_reservation") {
          if (flow.stage === "confirm" && interp?.type === "yes") {
            flowRef.current = null;
            return runCreateReservation(flow.slots);
          }
          if (flow.stage === "confirm" && interp?.type === "no") {
            flowRef.current = null;
            return say(actionText("aborted", lang));
          }
          const merged = mergeCreateSlots(flow.slots, interp);
          if (merged) return advanceCreate(merged);
          return invalid();
        }

        if (flow.kind === "cancel_reservation") {
          if (
            flow.stage === "pick" &&
            interp?.type === "pick" &&
            interp.index >= 1 &&
            interp.index <= flow.matches.length
          ) {
            const chosen = flow.matches[interp.index - 1];
            flowRef.current = { ...flow, stage: "confirm", matches: flow.matches, chosen };
            return say(actionText("confirm_cancel", lang, { summary: liteSummary(chosen) }));
          }
          if (flow.stage === "confirm" && interp?.type === "yes" && flow.chosen) {
            flowRef.current = null;
            return runCancel(flow.chosen);
          }
          if (flow.stage === "confirm" && interp?.type === "no") {
            flowRef.current = null;
            return say(actionText("aborted", lang));
          }
          return invalid();
        }

        if (flow.kind === "open_register") {
          if (interp?.type === "action" && interp.action.kind === "open_register" && interp.action.float != null) {
            flowRef.current = null;
            return openRegister(interp.action.float);
          }
          return invalid();
        }

        // close_register — confirm stage
        if (interp?.type === "yes") {
          flowRef.current = null;
          return closeRegister();
        }
        if (interp?.type === "no") {
          flowRef.current = null;
          return say(actionText("aborted", lang));
        }
        return invalid();
      });
    });
  };

  /** Route a user message into the active multi-step flow. Returns true if consumed. */
  const handleFlowInput = (raw: string): boolean => {
    const flow = flowRef.current;
    if (!flow) return false;
    const q = normalize(raw);
    if (ABORT_WORDS.test(q)) {
      flowRef.current = null;
      say(actionText("aborted", lang));
      return true;
    }

    if (flow.kind === "create_reservation") {
      const slots = { ...flow.slots };
      switch (flow.stage) {
        case "name": {
          const name = raw.trim().slice(0, 40);
          if (!name) { say(actionText("ask_name", lang)); return true; }
          // A reply with dates/times/numbers or a long phrase is not a bare
          // name ("si chiama Mario e siamo in 4") — read it in context.
          const wordy = raw.trim().split(/\s+/).length > 3;
          if (/\d/.test(raw) || wordy || parseDateWord(raw, new Date()) || parseTimeWord(raw) || parsePartyWord(raw)) {
            rescueFlow(raw, () => say(actionText("ask_name", lang)));
            return true;
          }
          slots.name = name;
          break;
        }
        case "date": {
          const d = parseDateWord(raw, new Date());
          if (!d) { rescueFlow(raw, () => say(actionText("invalid_date", lang))); return true; }
          slots.date = d;
          break;
        }
        case "time": {
          const tm = parseTimeWord(raw);
          if (!tm) { rescueFlow(raw, () => say(actionText("invalid_time", lang))); return true; }
          slots.time = tm;
          break;
        }
        case "party": {
          const p = parsePartyWord(raw) ?? (Number.parseInt(q, 10) || null);
          if (!p || p < 1 || p > 99) { rescueFlow(raw, () => say(actionText("invalid_number", lang))); return true; }
          slots.party = p;
          break;
        }
        case "phone": {
          if (SKIP_WORDS.test(q)) slots.phone = "";
          else {
            const ph = parsePhoneWord(raw);
            if (!ph) { rescueFlow(raw, () => say(actionText("ask_phone", lang))); return true; }
            slots.phone = ph;
          }
          break;
        }
        case "confirm": {
          if (YES_WORDS.test(q)) {
            flowRef.current = null;
            runCreateReservation(slots);
          } else {
            // Not a plain yes/no — maybe a correction ("aspetta, alle 21").
            rescueFlow(raw, () => say(actionText("confirm_create", lang, { summary: resSummary(slots) })));
          }
          return true;
        }
      }
      advanceCreate(slots);
      return true;
    }

    if (flow.kind === "cancel_reservation") {
      if (flow.stage === "pick") {
        const n = Number.parseInt(q, 10);
        const chosen = Number.isFinite(n) && n >= 1 && n <= flow.matches.length ? flow.matches[n - 1] : null;
        if (!chosen) {
          // "quella delle 21", "the one under Mario" → LLM maps it to a number.
          const list = flow.matches.map((m, i) => `${i + 1}. ${m.time} — ${m.guest_name} ×${m.party_size}`).join("\n");
          rescueFlow(raw, () => say(actionText("cancel_pick", lang, { list })));
          return true;
        }
        flowRef.current = { ...flow, stage: "confirm", chosen };
        say(actionText("confirm_cancel", lang, { summary: liteSummary(chosen) }));
        return true;
      }
      if (YES_WORDS.test(q) && flow.chosen) {
        flowRef.current = null;
        runCancel(flow.chosen);
      } else {
        rescueFlow(raw, () =>
          say(actionText("confirm_cancel", lang, { summary: flow.chosen ? liteSummary(flow.chosen) : "" })),
        );
      }
      return true;
    }

    if (flow.kind === "open_register") {
      const v = parseMoneyWord(raw);
      if (v == null) { rescueFlow(raw, () => say(actionText("invalid_number", lang))); return true; }
      flowRef.current = null;
      openRegister(v);
      return true;
    }

    if (flow.kind === "close_register") {
      if (YES_WORDS.test(q)) {
        flowRef.current = null;
        closeRegister();
      } else {
        rescueFlow(raw, () => {
          flowRef.current = null;
          say(actionText("aborted", lang));
        });
      }
      return true;
    }

    return false;
  };

  // ------------------------------------------------------------------- ask
  /** Free-standing message the local matcher didn't (confidently) understand:
   * let the LLM interpret it; `localFallback` is the old canned behaviour. */
  const askRemote = (text: string, localFallback: () => void) => {
    setPending((p) => p + 1);
    const started = Date.now();
    interpret(text).then((interp) => {
      afterThinking(started, () => {
        if (interp?.type === "action") return startFlow(interp.action);
        if (interp?.type === "topic") {
          const topic = topicById(interp.topicId);
          if (topic) return push({ role: "bot", topicId: topic.id, relatedIds: topic.related || [] });
        }
        if (interp?.type === "answer") return push({ role: "bot", text: interp.text });
        localFallback();
      });
    });
  };

  const ask = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    push({ role: "user", text });
    setInput("");

    if (handleFlowInput(text)) return;

    const intent = tenantId ? detectAction(text, new Date()) : null;
    if (intent) {
      startFlow(intent);
      return;
    }

    const reply = answerQuery(text, lang);
    // Confident local hits stay local (free, offline). Weak topic matches and
    // outright misses go to the LLM, with the local guess as safety net.
    if (reply.kind === "topic" && reply.topic && (reply.score ?? 0) >= STRONG_TOPIC_SCORE) {
      replyLater(TYPING_MS, {
        role: "bot",
        topicId: reply.topic.id,
        relatedIds: reply.related.map((r) => r.id),
      });
      return;
    }
    if (reply.kind === "smalltalk") {
      replyLater(TYPING_MS, { role: "bot", text: reply.text });
      return;
    }
    if (!tenantId) {
      // No tenant context (shouldn't happen in the dashboard) → old behaviour.
      if (reply.kind === "topic" && reply.topic) {
        replyLater(TYPING_MS, { role: "bot", topicId: reply.topic.id, relatedIds: reply.related.map((r) => r.id) });
      } else {
        replyLater(TYPING_MS, { role: "bot", text: reply.text, suggest: reply.kind === "fallback" });
      }
      return;
    }
    askRemote(text, () => {
      if (reply.kind === "topic" && reply.topic) {
        push({ role: "bot", topicId: reply.topic.id, relatedIds: reply.related.map((r) => r.id) });
      } else {
        push({ role: "bot", text: reply.text, suggest: reply.kind === "fallback" });
      }
    });
  };

  const askTopic = (topic: KbTopic) => {
    push({ role: "user", text: topic.title[lang] });
    replyLater(1200, { role: "bot", topicId: topic.id, relatedIds: topic.related || [] });
  };

  const chip = (topic: KbTopic, key: string) => (
    <button
      key={key}
      onClick={() => askTopic(topic)}
      className="px-2.5 h-8 rounded-full border-2 text-xs font-bold text-black cursor-pointer hover:bg-[#c4956a]/10 max-w-full truncate"
      style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.7)" }}
    >
      {topic.title[lang]}
    </button>
  );

  const topicBubble = (topic: KbTopic, relatedIds: string[] | undefined, key: number) => {
    const related = (relatedIds || []).map(topicById).filter(Boolean) as KbTopic[];
    return (
      <div key={key} className="max-w-[92%] rounded-2xl rounded-bl-md border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}>
        <p className="text-sm font-bold text-black">{topic.title[lang]}</p>
        <p className="text-sm text-black whitespace-pre-line">{topic.answer[lang]}</p>
        {topic.steps?.[lang] && (
          <ol className="text-sm text-black list-decimal pl-5 space-y-0.5">
            {topic.steps[lang].map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {(topic.links || []).map((l, i) => (
          <button
            key={i}
            onClick={() => {
              setOpen(false);
              router.push(l.href);
            }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-bold text-white cursor-pointer mr-1.5"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {l.label[lang]} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ))}
        {related.length > 0 && (
          <div className="pt-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-black mb-1">{ui.relatedLabel}</p>
            <div className="flex flex-wrap gap-1.5">{related.map((r) => chip(r, `${key}-${r.id}`))}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={ui.openLabel}
          title={ui.title}
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full flex items-center justify-center text-white cursor-pointer shadow-lg transition-transform hover:scale-105"
          style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {/* panel */}
      {open && (
        <div
          className="fixed z-40 inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-[400px] sm:max-h-[80dvh] flex flex-col rounded-none sm:rounded-2xl border-0 sm:border-2 shadow-2xl overflow-hidden"
          style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
        >
          <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
            <Sparkles className="w-5 h-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold leading-tight">{ui.title}</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]);
                  flowRef.current = null;
                }}
                className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer"
                title={ui.clear}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-[280px]">
            {/* welcome + suggestions */}
            <div className="max-w-[92%] rounded-2xl rounded-bl-md border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}>
              <p className="text-sm text-black">{ui.welcome}</p>
              <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => chip(s, `w-${s.id}`))}</div>
            </div>

            {messages.map((m, idx) => {
              if (m.role === "user") {
                return (
                  <div key={idx} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
                      {m.text}
                    </div>
                  </div>
                );
              }
              const topic = m.topicId ? topicById(m.topicId) : undefined;
              if (topic) return topicBubble(topic, m.relatedIds, idx);
              return (
                <div key={idx} className="max-w-[92%] rounded-2xl rounded-bl-md border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}>
                  <p className="text-sm text-black whitespace-pre-line">{m.text}</p>
                  {m.suggest && (
                    <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => chip(s, `${idx}-${s.id}`))}</div>
                  )}
                </div>
              );
            })}

            {pending > 0 && (
              <div
                className="w-fit rounded-2xl rounded-bl-md border-2 px-4 py-3 flex items-center gap-1"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: "#c4956a", animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 p-3 border-t-2"
            style={{ borderColor: "#c4956a" }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ui.placeholder}
              className="flex-1 h-11 px-3 rounded-xl border-2 text-base text-black bg-white"
              style={{ borderColor: "#c4956a" }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white disabled:opacity-40 cursor-pointer shrink-0"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
