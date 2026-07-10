"use client";

import { useState } from "react";

// Two-step widget: (1) date + people → slot grid from /api/public/availability,
// (2) pick a slot → name/phone → /api/public/book. Outcomes mirror the AI
// pipeline: confirmed / pending (large-party escalation) / waitlist / full /
// error. Strings arrive pre-localized from the server. Rendered both inside the
// FloatingBookingWidget panel and standalone on /b/<slug>.

export interface BookingStrings {
  dateLabel: string;
  peopleLabel: string;
  timeLabel: string;
  checkBtn: string;
  checking: string;
  closedDay: string;
  noSlots: string;
  nameLabel: string;
  phoneLabel: string;
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
  koPhone: string;
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

export default function BookingWidget({
  slug,
  accent,
  strings: ui,
}: {
  slug: string;
  accent: string;
  strings: BookingStrings;
}) {
  const [date, setDate] = useState(todayYmd());
  const [people, setPeople] = useState(2);
  const [slots, setSlots] = useState<{ time: string; available: boolean }[] | null>(null);
  const [slotsMsg, setSlotsMsg] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"check" | "book" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step index drives the progress dots and the slide animation key.
  const step = outcome ? 3 : time ? 2 : slots ? 1 : 0;

  const vars = { ["--bw-accent" as string]: accent } as React.CSSProperties;

  const check = async () => {
    setBusy("check");
    setError(null);
    setSlots(null);
    setSlotsMsg(null);
    setTime(null);
    try {
      const res = await fetch("/api/public/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, date, party_size: people }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ui.koGeneric);
      } else if (json.status === "closed_day" || json.status === "closed") {
        setSlotsMsg(ui.closedDay);
      } else {
        // Drop slots already in the past when booking for today — the server
        // rejects them with `past_time`, so never offer them.
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
    if (!time || !name.trim() || !phone.trim()) return;
    setBusy("book");
    setError(null);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, date, time, party_size: people, name, phone, notes }),
      });
      const json = await res.json().catch(() => ({}));

      // The public /book route returns HTTP 400 { error: "invalid_phone" } for a
      // malformed number, and on success { success, status, on_waitlist,
      // deposit_payment_url }. status can be: confirmed | escalated (large party
      // → venue confirms) | full. Anything else success:true → treat as pending.
      if (res.status === 400 && json?.error === "invalid_phone") {
        setError(ui.koPhone);
      } else if (json?.success && json.status === "confirmed") {
        setOutcome({ kind: "confirmed", depositUrl: json.deposit_payment_url });
      } else if (json?.success && (json.on_waitlist || json.status === "waitlist")) {
        setOutcome({ kind: "waitlist" });
      } else if (json?.success && json.status === "full") {
        setOutcome({ kind: "full" });
      } else if (json?.success) {
        setOutcome({ kind: "pending", depositUrl: json.deposit_payment_url });
      } else if (json?.error === "invalid_phone" || json?.reason === "invalid_phone") {
        setError(ui.koPhone);
      } else if (json?.reason === "past_time") {
        // Slot lapsed between listing and submit — refresh availability.
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
    setNotes("");
    setError(null);
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
              onChange={(e) => setDate(e.target.value)}
              className="bw2-input"
            />
          </label>
          <label className="bw2-group">
            <span className="bw2-label">{ui.peopleLabel}</span>
            <div className="bw2-stepper">
              <button type="button" onClick={() => setPeople((n) => Math.max(1, n - 1))} className="bw2-step-btn" aria-label="-">
                −
              </button>
              <span className="bw2-step-val">{people}</span>
              <button type="button" onClick={() => setPeople((n) => Math.min(20, n + 1))} className="bw2-step-btn" aria-label="+">
                +
              </button>
            </div>
          </label>
        </div>

        <button type="button" onClick={check} disabled={busy !== null || !date} className="bw2-btn bw2-btn-primary">
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

        {/* Step 2 — guest details */}
        {time ? (
          <div className="bw2-slide-in space-y-3 pt-1">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={ui.nameLabel} className="bw2-input" />
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={ui.phoneLabel} className="bw2-input" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 300))}
              rows={2}
              placeholder={ui.notesPh}
              className="bw2-input resize-none"
            />
            <button type="button" onClick={book} disabled={busy !== null || !name.trim() || !phone.trim()} className="bw2-btn bw2-btn-primary">
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
