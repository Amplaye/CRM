"use client";

import { useState } from "react";

// Two-step widget: (1) date + people → slot grid from /api/public/availability,
// (2) pick a slot → name/phone → /api/public/book. Success states mirror the
// AI pipeline's outcomes: confirmed, pending (large party), waitlist, deposit
// link. Strings arrive pre-localized from the server page.

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
  kind: "confirmed" | "pending" | "waitlist" | "full" | "error";
  depositUrl?: string | null;
};

const INPUT = "w-full rounded-lg border-2 bg-white px-3 py-2.5 text-sm text-black focus:outline-none";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      } else if (json.status === "closed_day") {
        setSlotsMsg(ui.closedDay);
      } else {
        const free = (json.availability || []).filter((a: { available: boolean }) => a.available);
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
      if (json?.success && json.status === "confirmed") {
        setOutcome({ kind: "confirmed", depositUrl: json.deposit_payment_url });
      } else if (json?.success && json.on_waitlist) {
        setOutcome({ kind: "waitlist" });
      } else if (json?.success && json.status === "full") {
        setOutcome({ kind: "full" });
      } else if (json?.success) {
        // pending_confirmation (large party) or merged duplicate — the venue follows up.
        setOutcome({ kind: "pending", depositUrl: json.deposit_payment_url });
      } else if (json?.error === "invalid_phone") {
        setError(ui.koPhone);
      } else {
        setError(ui.koGeneric);
      }
    } catch {
      setError(ui.koGeneric);
    }
    setBusy(null);
  };

  if (outcome && outcome.kind !== "error") {
    const msg =
      outcome.kind === "confirmed"
        ? ui.okConfirmed
        : outcome.kind === "waitlist"
          ? ui.okWaitlist
          : outcome.kind === "full"
            ? ui.koFull
            : ui.okPending;
    return (
      <div className="mt-6 space-y-4 rounded-xl border-2 bg-white p-6 text-center" style={{ borderColor: accent }}>
        <p className="font-semibold text-black">{msg}</p>
        {outcome.depositUrl ? (
          <div className="space-y-2">
            <p className="text-sm text-black">{ui.okDeposit}</p>
            <a
              href={outcome.depositUrl}
              className="inline-block rounded-xl px-6 py-3 font-bold text-white"
              style={{ background: accent }}
            >
              {ui.depositBtn}
            </a>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            setSlots(null);
            setTime(null);
          }}
          className="text-sm font-semibold text-black underline"
        >
          {ui.newBooking}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4 rounded-xl border-2 bg-white p-5" style={{ borderColor: accent }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-bold text-black">{ui.dateLabel}</label>
          <input
            type="date"
            value={date}
            min={todayYmd()}
            onChange={(e) => setDate(e.target.value)}
            className={INPUT}
            style={{ borderColor: accent }}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold text-black">{ui.peopleLabel}</label>
          <select
            value={people}
            onChange={(e) => setPeople(Number(e.target.value))}
            className={INPUT}
            style={{ borderColor: accent }}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={check}
        disabled={busy !== null || !date}
        className="w-full rounded-xl py-3 text-base font-bold text-white disabled:opacity-40"
        style={{ background: accent }}
      >
        {busy === "check" ? ui.checking : ui.checkBtn}
      </button>

      {slotsMsg ? <p className="text-center text-sm font-semibold text-black">{slotsMsg}</p> : null}

      {slots ? (
        <div>
          <label className="mb-2 block text-sm font-bold text-black">{ui.timeLabel}</label>
          <div className="grid grid-cols-4 gap-2">
            {slots.map((s) => (
              <button
                key={s.time}
                type="button"
                onClick={() => setTime(s.time)}
                className={`h-10 rounded-lg border-2 text-sm font-bold ${time === s.time ? "text-white" : "text-black"}`}
                style={time === s.time ? { background: accent, borderColor: accent } : { borderColor: accent }}
              >
                {s.time}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {time ? (
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ui.nameLabel}
            className={INPUT}
            style={{ borderColor: accent }}
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={ui.phoneLabel}
            className={INPUT}
            style={{ borderColor: accent }}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 300))}
            rows={2}
            placeholder={ui.notesPh}
            className={INPUT}
            style={{ borderColor: accent }}
          />
          <button
            type="button"
            onClick={book}
            disabled={busy !== null || !name.trim() || !phone.trim()}
            className="w-full rounded-xl py-3.5 text-base font-bold text-white disabled:opacity-40"
            style={{ background: accent }}
          >
            {busy === "book" ? ui.booking : `${ui.bookBtn} · ${time}`}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-center text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
