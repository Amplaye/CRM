// Picnic dialog engine — shared TypeScript types.
// Mirrors the runtime state today held inside the n8n Code nodes
// `Picnic_Chatbot_WhatsApp.json`. See REFACTOR_DIAGNOSIS.md §4.3.

export type Lang = 'es' | 'it' | 'en' | 'de';

export type Channel = 'whatsapp' | 'voice';

/**
 * The parser-LLM output. Mirrors the JSON schema in
 * `prompts/parser.es.md` exactly. Any change to the prompt's output
 * shape MUST also change this type and the corresponding tests.
 */
export interface ParserOutput {
  intent:
    | 'book'
    | 'modify'
    | 'cancel'
    | 'waitlist'
    | 'info'
    | 'offtopic'
    | 'confirm_yes'
    | 'confirm_no'
    | null;
  personas: number | null;
  delta_personas: number | null;
  fecha: string | null; // YYYY-MM-DD
  hora: string | null; // HH:MM (24h)
  zona: 'interior' | 'exterior' | null;
  nombre: string | null;
  notas: string | null;
  confirmacion: 'yes' | 'no' | null;
  /** Set when the parser fetch failed; non-null = controller fallback path */
  _parseError?: string;
}

/**
 * Collected booking fields for the current conversation. Filled progressively
 * across turns by the controller (one new field per turn in the strict flow,
 * many at once when the customer answers in compound).
 */
export interface SessionFields {
  personas: number | null;
  fecha: string | null;
  hora: string | null;
  zona: 'interior' | 'exterior' | null;
  nombre: string | null;
  notas: string | null;
  notas_asked: boolean;
  availability_checked: boolean;
}

/**
 * What the bot is waiting on from the user. `null` = ready to handle whatever
 * comes next. Specific pending states trigger different parser/controller
 * shortcuts.
 */
export type PendingState =
  | null
  | 'notas_ask'
  | 'awaiting_disambig'
  | 'awaiting_force_new'
  | 'editing_pending'
  | 'awaiting_proposed_alt';

/** Topic the controller asked about last turn (drives FIX B38, B8b, etc.). */
export type LastInstructionTopic =
  | null
  | 'personas'
  | 'fecha'
  | 'hora'
  | 'zona'
  | 'nombre'
  | 'notas'
  | 'confirm'
  | 'awaiting_confirmo'
  | 'modify_topic'
  | 'disambig';

/**
 * Per-phone session state. Persisted in `public.bot_sessions.session_data`.
 * The `phone` lives in the table PK, not here.
 */
export interface DialogSession {
  /** Sticky language — flips only on STRONG full-word marker (FIX 2026-05-08) */
  lang: Lang;
  /** Active intent of the conversation; sometimes locked (BOOK-STICKY) */
  intent:
    | 'book'
    | 'modify'
    | 'cancel'
    | 'waitlist'
    | 'info'
    | 'offtopic'
    | null;
  fields: SessionFields;
  pending: PendingState;

  /** Counter-offers the bot proposed and is awaiting a yes/no on */
  proposedZone: 'interior' | 'exterior' | null;
  proposedDate: string | null;
  proposedHora: string | null;

  awaitingDisambig: boolean;
  editingPending: boolean;
  /** FIX B40 — lock to modify intent until a fresh "voglio prenotare" starter */
  lockedToModify: boolean;

  /** Used by disambiguation gate to remember which reservation the user picked */
  lastModifyTarget: {
    fecha: string | null;
    hora: string | null;
    personas: number | null;
  } | null;
  /** Stashed payload for retry after disambiguation resolves */
  lastModifyAttempt: Record<string, unknown> | null;

  lastInstructionTopic: LastInstructionTopic;
  /** FIX B21 — facts captured outside `notas` (e.g. pet, celiac) for later use */
  shadowNotes: string[];

  /** Multi-topic modify list, e.g. ['hora','notas'] (FIX 2026-05-12) */
  pendingModifyTopics: Array<'personas' | 'fecha' | 'hora' | 'zona' | 'notas'>;

  /** Info overlay flag: customer asked info DURING booking (FIX info-during-book) */
  _infoOverlay: boolean;

  /** Unix ms — used for TTL eviction by the session store */
  lastUpdate: number;
}

/** Bot pause cooldown state — orthogonal to dialog, lives on `guests` row */
export interface BotPauseInfo {
  paused: boolean;
  ageMs: number;
  source: 'staff_takeover' | 'staff_message' | null;
}

/**
 * Input to a single turn of the dialog engine.
 * Provided by the n8n webhook caller.
 */
export interface DialogTurnInput {
  tenant_id: string;
  conversation_id: string | null;
  channel: Channel;
  phone: string; // E.164
  message: string;
  message_sid?: string; // Twilio MessageSid for dedup
  history: Array<{ role: 'user' | 'assistant' | 'system' | 'staff'; content: string }>;
  // Snapshots from upstream lookup
  guest_name?: string;
  pause_info?: BotPauseInfo;
  existing_reservations?: Array<{
    id: string;
    fecha: string;
    hora: string;
    personas: number;
    zona: 'interior' | 'exterior' | null;
    nombre: string;
  }>;
}

/**
 * Output of a single turn. The caller (n8n) routes downstream nodes off these:
 * `text` → outbound WhatsApp; `action` → POST to /api/ai/{book,modify,cancel,waitlist}.
 */
export interface DialogTurnOutput {
  /** Outbound message to send to the customer (already in their language) */
  text: string | null;
  /** Pre-built recap card variant (only set after a successful action) */
  recap?: {
    fecha: string;
    hora: string;
    personas: number;
    nombre: string;
    zona: 'interior' | 'exterior' | null;
    notas: string | null;
    kind: 'booking' | 'modification' | 'cancellation' | 'waitlist';
  };
  /** Action the caller should perform downstream */
  action: null | {
    kind: 'book' | 'modify' | 'cancel' | 'waitlist' | 'check_availability';
    payload: Record<string, unknown>;
  };
  /** Whether to suppress writing this assistant turn to conversations.transcript (FIX B35) */
  suppressTranscript?: boolean;
  /** Debug hook — surfaces only when AI_DEBUG=1 */
  debug?: {
    parsed?: ParserOutput;
    session?: DialogSession;
    guard_hit?: string;
  };
}

/** Restaurant config keys read from `tenants.settings.bot_config` */
export interface BotConfig {
  closing_offset_minutes: number; // default 45
  booking_horizon_days: number; // default 14
  large_group_threshold: number; // default 13
  session_ttl_hours: number; // default 2
  bot_pause_cooldown_secs: number; // default 60
  fallback_phone: string; // restaurant phone for apology recovery
  responsible_phone?: string; // E.164 for staff notifications
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  closing_offset_minutes: 45,
  booking_horizon_days: 14,
  large_group_threshold: 13,
  session_ttl_hours: 2,
  bot_pause_cooldown_secs: 60,
  fallback_phone: '+34 828 712 623',
};

/** Empty session factory — used when a phone is seen for the first time */
export function emptySession(lang: Lang = 'es'): DialogSession {
  return {
    lang,
    intent: null,
    fields: {
      personas: null,
      fecha: null,
      hora: null,
      zona: null,
      nombre: null,
      notas: null,
      notas_asked: false,
      availability_checked: false,
    },
    pending: null,
    proposedZone: null,
    proposedDate: null,
    proposedHora: null,
    awaitingDisambig: false,
    editingPending: false,
    lockedToModify: false,
    lastModifyTarget: null,
    lastModifyAttempt: null,
    lastInstructionTopic: null,
    shadowNotes: [],
    pendingModifyTopics: [],
    _infoOverlay: false,
    lastUpdate: Date.now(),
  };
}
