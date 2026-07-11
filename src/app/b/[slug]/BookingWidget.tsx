"use client";

import { useState } from "react";

// Multi-step widget: (1) date + people → (2) room, only when the venue has more
// than one → (3) slot grid from /api/public/availability (already trimmed to
// bookable times — nothing past the last-reservation cut-off) → (4)
// name/phone/email(+notes) → /api/public/book. Every field except notes is
// required and validated (real email + phone) before the button enables.
// Outcomes mirror the AI pipeline: confirmed / pending / waitlist / full /
// error. Strings arrive pre-localized from the server. Rendered both inside the
// FloatingBookingWidget panel and standalone on /b/<slug>.

export interface BookingStrings {
  dateLabel: string;
  peopleLabel: string;
  roomLabel: string;
  roomHint: string;
  timeLabel: string;
  checkBtn: string;
  checking: string;
  closedDay: string;
  noSlots: string;
  nameLabel: string;
  phoneLabel: string;
  emailLabel: string;
  notesLabel: string;
  notesPh: string;
  bookBtn: string;
  booking: string;
  okConfirmed: string;
  okPending: string;
  okWaitlist: string;
  okDeposit: string;
  depositBtn: string;
  koFull: string;
  koRoomFull: string;
  koPhone: string;
  koEmail: string;
  koGeneric: string;
  newBooking: string;
}

type Outcome = {
  kind: "confirmed" | "pending" | "waitlist" | "full";
  depositUrl?: string | null;
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "HH:MM" now, local — used to drop already-passed slots when booking today. */
function nowHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Same pragmatic rules as the server (booking-validation.ts) so the button only
// enables on input the API will accept — no round-trip to discover "invalid".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function emailOk(v: string): boolean {
  const t = v.trim();
  return t.length > 0 && t.length <= 254 && EMAIL_RE.test(t);
}
// E.164-ish: strip spaces/()-/dots; then optional '+' and 7–15 digits, 1st non-zero.
function phoneOk(v: string): boolean {
  const t = v.replace(/[\s().-]/g, "");
  return /^\+?[1-9]\d{6,14}$/.test(t);
}

export default function BookingWidget({
  slug,
  accent,
  rooms = [],
  strings: ui,
}: {
  slug: string;
  accent: string;
  /** Distinct room names; the room step shows only when 2+. */
  rooms?: string[];
  strings: BookingStrings;
}) {
  const hasRooms = rooms.length > 1;

  const [date, setDate] = useState(todayYmd());
  const [people, setPeople] = useState(2);
  const [room, setRoom] = useState<string>("");
  const [slots, setSlots] = useState<{ time: string; available: boolean }[] | null>(null);
  const [slotsMsg, setSlotsMsg] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"check" | "book" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A room must be chosen before checking availability when the venue has rooms.
  const roomReady = !hasRooms || room !== "";
  const detailsReady = name.trim() !== "" && phoneOk(phone) && emailOk(email);

  // Step index drives the progress dots and the slide animation key.
  const step = outcome ? 3 : time ? 2 : slots ? 1 : 0;

  const vars = { ["--bw-accent" as string]: accent } as React.CSSProperties;

  const check = async () => {
    if (!roomReady) return;
    setBusy("check");
    setError(null);
    setSlots(null);
    setSlotsMsg(null);
    setTime(null);
    try {
      const res = await fetch("/api/public/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, date, party_size: people, ...(hasRooms ? { room } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ui.koGeneric);
      } else if (json.status === "closed_day" || json.status === "closed") {
        setSlotsMsg(ui.closedDay);
      } else {
        // Server already dropped past-cut-off slots; still drop times earlier
        // than "now" when booking today (server rejects them with past_time).
        const cutoff = date === todayYmd() ? nowHm() : "00:00";
        const free = (json.availability || []).filter(
          (a: { available: boolean; time: string }) => a.available && a.time > cutoff,
        );
        if (free.length === 0) setSlotsMsg(ui.noSlots);
        else setSlots(free);
      }
    } catch {
      setError(ui.koGeneric);
    }
    setBusy(null);
  };

  const book = async () => {
    if (!time || !detailsReady) return;
    setBusy("book");
    setError(null);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          date,
          time,
          party_size: people,
          name,
          phone,
          email,
          notes,
          ...(hasRooms ? { room } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));

      // The public /book route returns HTTP 400 { error } for a malformed
      // phone/email, and on success { success, status, on_waitlist,
      // deposit_payment_url }. status can be: confirmed | escalated (large party
      // → venue confirms) | full (or room full). Anything else success:true →
      // treat as pending.
      if (res.status === 400 && json?.error === "invalid_phone") {
        setError(ui.koPhone);
      } else if (res.status === 400 && json?.error === "invalid_email") {
        setError(ui.koEmail);
      } else if (json?.success && json.status === "confirmed") {
        setOutcome({ kind: "confirmed", depositUrl: json.deposit_payment_url });
      } else if (json?.success && (json.on_waitlist || json.status === "waitlist")) {
        setOutcome({ kind: "waitlist" });
      } else if (json?.success && json.status === "full") {
        // Distinguish "this room is full" (guest picked a room) from shift-full.
        if (json.zone_requested_available === false) {
          setError(ui.koRoomFull);
          setTime(null);
          setSlots(null);
        } else {
          setOutcome({ kind: "full" });
        }
      } else if (json?.success) {
        setOutcome({ kind: "pending", depositUrl: json.deposit_payment_url });
      } else if (json?.error === "invalid_phone" || json?.reason === "invalid_phone") {
        setError(ui.koPhone);
      } else if (json?.reason === "past_time" || json?.reason === "after_last_reservation") {
        // Slot lapsed or was past the cut-off — refresh availability.
        setError(ui.koGeneric);
        setTime(null);
        setSlots(null);
      } else {
        setError(ui.koGeneric);
      }
    } catch {
      setError(ui.koGeneric);
    }
    setBusy(null);
  };

  const reset = () => {
    setOutcome(null);
    setSlots(null);
    setSlotsMsg(null);
    setTime(null);
    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setError(null);
  };

  // Changing the room/date/people invalidates any shown slots.
  const invalidateSlots = () => {
    setSlots(null);
    setSlotsMsg(null);
    setTime(null);
  };

  // ——— Success / outcome screen ———
  if (outcome) {
    const good = outcome.kind === "confirmed";
    const msg =
      outcome.kind === "confirmed"
        ? ui.okConfirmed
        : outcome.kind === "waitlist"
          ? ui.okWaitlist
          : outcome.kind === "full"
            ? ui.koFull
            : ui.okPending;
    return (
      <div className="bw2" style={vars}>
        <div key="done" className="bw2-screen bw2-fade-in flex flex-col items-center py-4 text-center">
          <div className={`bw2-badge ${good ? "bw2-badge-ok" : "bw2-badge-wait"}`}>
            {good ? (
              <svg className="bw2-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : outcome.kind === "full" ? (
              <svg className="bw2-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            ) : (
              <svg className="bw2-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
          </div>
          <p className="mt-5 max-w-xs text-[15px] font-semibold leading-snug text-black">{msg}</p>

          {outcome.depositUrl ? (
            <div className="mt-5 w-full space-y-2">
              <p className="text-xs font-medium text-black/70">{ui.okDeposit}</p>
              <a href={outcome.depositUrl} className="bw2-btn bw2-btn-primary">
                {ui.depositBtn}
              </a>
            </div>
          ) : null}

          <button type="button" onClick={reset} className="bw2-btn bw2-btn-ghost mt-4">
            {ui.newBooking}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bw2" style={vars}>
      {/* Progress rail */}
      <div className="bw2-rail" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`bw2-dot ${step > i ? "bw2-dot-done" : step === i ? "bw2-dot-active" : ""}`} />
        ))}
      </div>

      {/* Step 0 — date + people */}
      <div key={`s-${step}`} className="bw2-screen bw2-fade-in space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="bw2-group">
            <span className="bw2-label">{ui.dateLabel}</span>
            <input
              type="date"
              value={date}
              min={todayYmd()}
              onChange={(e) => {
                setDate(e.target.value);
                invalidateSlots();
              }}
              className="bw2-input"
            />
          </label>
          <label className="bw2-group">
            <span className="bw2-label">{ui.peopleLabel}</span>
            <div className="bw2-stepper">
              <button type="button" onClick={() => { setPeople((n) => Math.max(1, n - 1)); invalidateSlots(); }} className="bw2-step-btn" aria-label="-">
                −
              </button>
              <span className="bw2-step-val">{people}</span>
              <button type="button" onClick={() => { setPeople((n) => Math.min(20, n + 1)); invalidateSlots(); }} className="bw2-step-btn" aria-label="+">
                +
              </button>
            </div>
          </label>
        </div>

        {/* Room step — only when the venue has more than one room */}
        {hasRooms ? (
          <div className="bw2-group">
            <span className="bw2-label">{ui.roomLabel}</span>
            <div className="grid grid-cols-2 gap-2">
              {rooms.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setRoom(r); invalidateSlots(); }}
                  className={`bw2-chip ${room === r ? "bw2-chip-on" : ""}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {!room ? <p className="bw2-hint mt-1">{ui.roomHint}</p> : null}
          </div>
        ) : null}

        <button type="button" onClick={check} disabled={busy !== null || !date || !roomReady} className="bw2-btn bw2-btn-primary">
          {busy === "check" ? (
            <span className="inline-flex items-center gap-2">
              <span className="bw2-spinner" /> {ui.checking}
            </span>
          ) : (
            ui.checkBtn
          )}
        </button>

        {slotsMsg ? <p className="bw2-note">{slotsMsg}</p> : null}

        {/* Step 1 — slot grid */}
        {slots ? (
          <div className="bw2-slide-in">
            <span className="bw2-label mb-2 block">{ui.timeLabel}</span>
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s, i) => (
                <button
                  key={s.time}
                  type="button"
                  onClick={() => setTime(s.time)}
                  className={`bw2-chip ${time === s.time ? "bw2-chip-on" : ""}`}
                  style={{ animationDelay: `${Math.min(i, 16) * 26}ms` }}
                >
                  {s.time}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Step 2 — guest details (all required except notes) */}
        {time ? (
          <div className="bw2-slide-in space-y-3 pt-1">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={ui.nameLabel} className="bw2-input" autoComplete="name" />
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={ui.phoneLabel} className="bw2-input" autoComplete="tel" inputMode="tel" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={ui.emailLabel} className="bw2-input" autoComplete="email" inputMode="email" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 300))}
              rows={2}
              placeholder={ui.notesPh}
              className="bw2-input resize-none"
            />
            <button type="button" onClick={book} disabled={busy !== null || !detailsReady} className="bw2-btn bw2-btn-primary">
              {busy === "book" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="bw2-spinner" /> {ui.booking}
                </span>
              ) : (
                `${ui.bookBtn} · ${time}`
              )}
            </button>
          </div>
        ) : null}

        {error ? <p className="bw2-error">{error}</p> : null}
      </div>
    </div>
  );
}
