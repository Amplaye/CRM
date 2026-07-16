"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

// Compact brand-styled month grid shared by the cassa calendars: the cash-day
// history in SessionView and the journal day picker in ReceiptsView. Pure
// presentational — data (markers) and selection live in the parent.

export interface MonthCalendarProps {
  /** Visible month as "YYYY-MM". */
  month: string;
  onMonth: (month: string) => void;
  /** Selected day as "YYYY-MM-DD" (or null). */
  value: string | null;
  onSelect: (date: string) => void;
  /** Dot color per day ("YYYY-MM-DD" → css color). */
  markers?: Record<string, string>;
  /** Days after this ("YYYY-MM-DD") are disabled (e.g. the business date). */
  maxDate?: string;
  locale?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function MonthCalendar({
  month,
  onMonth,
  value,
  onSelect,
  markers = {},
  maxDate,
  locale,
}: MonthCalendarProps) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Monday-first offset of the 1st of the month (getDay: 0 = Sunday).
  const lead = (first.getDay() + 6) % 7;

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, i + 1) // 2024-01-01 is a Monday
      .toLocaleDateString(locale, { weekday: "short" })
      .slice(0, 2),
  );
  const monthLabel = first.toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="select-none">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => onMonth(shiftMonth(month, -1))}
          className="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-black hover:bg-[#c4956a]/10 cursor-pointer"
          style={{ borderColor: "#c4956a" }}
          aria-label="previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="flex-1 text-center text-sm font-bold text-black capitalize">{monthLabel}</p>
        <button
          onClick={() => onMonth(shiftMonth(month, 1))}
          disabled={!!maxDate && shiftMonth(month, 1) > monthOf(maxDate)}
          className="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-black hover:bg-[#c4956a]/10 disabled:opacity-30 cursor-pointer"
          style={{ borderColor: "#c4956a" }}
          aria-label="next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w, i) => (
          <span key={i} className="text-[10px] font-bold uppercase text-black opacity-60 capitalize">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${month}-${pad(i + 1)}`;
          const disabled = !!maxDate && date > maxDate;
          const selected = value === date;
          const marker = markers[date];
          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              disabled={disabled}
              className={`h-10 rounded-lg text-sm font-bold flex flex-col items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-default ${
                selected ? "text-white" : "text-black hover:bg-[#c4956a]/10"
              }`}
              style={selected ? { background: "#c4956a" } : undefined}
            >
              <span className="leading-none">{i + 1}</span>
              <span
                className="w-1.5 h-1.5 rounded-full mt-1"
                style={{ background: marker ? (selected ? "#fff" : marker) : "transparent" }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
