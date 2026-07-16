"use client";

import Link from "next/link";
import {
  Lock,
  BarChart3,
  CalendarClock,
  LayoutGrid,
  Clock,
  Inbox,
  Users,
  MessageCircle,
  BookOpen,
  Star,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

// Shown in place of a core CRM page (analytics, reservations, floor, waitlist,
// pending, guests, conversations, knowledge) when the tenant has NO active plan
// — the "entry package" tenant who lives in /menu + /settings only.
//
// Deliberately different from ManagementLocked (which BLURS a fake skeleton): here
// we render a CRISP, realistic static demo of the section at full opacity, then
// lay a LIGHT translucent veil over it and float a CTA card on top. The owner sees
// exactly what the section would look like full of data — an invitation, not a
// frosted-glass "coming soon". The demo is hardcoded sample data: no live query,
// no interactivity, zero risk of leaking another tenant's rows.
//
// This is a COSMETIC lock. The real protection is the matching API 403 guards +
// RLS (tenant_has_active_plan) — a locked page must never be the only thing
// standing between a no-plan tenant and the data.

export type LockSection =
  | "analytics"
  | "reservations"
  | "floor"
  | "waitlist"
  | "pending"
  | "guests"
  | "conversations"
  | "knowledge"
  | "reviews";

const NAV_KEY: Record<LockSection, keyof Dictionary> = {
  analytics: "nav_analytics",
  reservations: "nav_reservations",
  floor: "nav_floor",
  waitlist: "nav_waitlist",
  pending: "nav_pending",
  guests: "nav_guests",
  conversations: "nav_conversations",
  knowledge: "nav_knowledge_base",
  reviews: "nav_reviews",
};

const SECTION_ICON: Record<LockSection, typeof Lock> = {
  analytics: BarChart3,
  reservations: CalendarClock,
  floor: LayoutGrid,
  waitlist: Clock,
  pending: Inbox,
  guests: Users,
  conversations: MessageCircle,
  knowledge: BookOpen,
  reviews: Star,
};

// ── Shared demo primitives ───────────────────────────────────────────────────
const BRASS = "#c4956a";
const BROWN = "#8b6540";
const INK = "#1c150d";

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border-2 p-4 bg-white/70" style={{ borderColor: BRASS }}>
      <div className="text-xs font-semibold" style={{ color: BROWN }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-black" style={{ color: INK }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs font-semibold" style={{ color: BROWN }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Pill({ children, tone = "brass" }: { children: React.ReactNode; tone?: "brass" | "green" | "amber" }) {
  const bg = tone === "green" ? "#5c6c4b" : tone === "amber" ? "#b3855c" : BRASS;
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ background: bg }}>
      {children}
    </span>
  );
}

// ── Per-section static demos ─────────────────────────────────────────────────
function DemoAnalytics() {
  const bars = [62, 80, 48, 95, 70, 55, 88, 42, 73, 90, 60, 78];
  const dishes: [string, string][] = [
    ["Spaghetti alle vongole", "48"],
    ["Tagliata di manzo", "39"],
    ["Tiramisù", "35"],
    ["Burrata & pomodorini", "31"],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiTile label="Coperti oggi" value="128" sub="+12% vs ieri" />
        <KpiTile label="Prenotazioni" value="42" sub="6 in attesa" />
        <KpiTile label="No-show" value="3,1%" sub="ultimi 30 gg" />
        <KpiTile label="Incasso stimato" value="€ 3.940" sub="oggi" />
      </div>
      <div className="rounded-xl border-2 p-4 bg-white/70 mb-5" style={{ borderColor: BRASS }}>
        <div className="text-sm font-bold mb-3" style={{ color: INK }}>
          Coperti per giorno
        </div>
        <div className="flex items-end gap-1.5 h-32">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: BRASS }} />
          ))}
        </div>
      </div>
      <div className="rounded-xl border-2 p-4 bg-white/70" style={{ borderColor: BRASS }}>
        <div className="text-sm font-bold mb-3" style={{ color: INK }}>
          Piatti più ordinati
        </div>
        <div className="space-y-2">
          {dishes.map(([name, n]) => (
            <div key={name} className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: INK }}>
                {name}
              </span>
              <span className="text-sm font-black" style={{ color: BROWN }}>
                {n}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoReservations() {
  const rows: [string, string, number, "green" | "amber" | "brass", string][] = [
    ["19:00", "Marco Rossi", 4, "green", "Confermata"],
    ["19:30", "Giulia Bianchi", 2, "green", "Confermata"],
    ["20:00", "Famiglia Conti", 6, "amber", "In attesa"],
    ["20:15", "Luca Ferrari", 2, "green", "Confermata"],
    ["20:45", "Sara Greco", 3, "amber", "In attesa"],
    ["21:30", "Davide Moretti", 5, "green", "Confermata"],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-2 max-w-3xl">
      {rows.map(([time, name, party, tone, status], i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-xl border-2 p-3 bg-white/70"
          style={{ borderColor: BRASS }}
        >
          <span className="text-lg font-black w-16" style={{ color: BROWN }}>
            {time}
          </span>
          <span className="flex-1 text-sm font-semibold" style={{ color: INK }}>
            {name}
          </span>
          <span className="text-sm font-bold" style={{ color: INK }}>
            {party} pax
          </span>
          <Pill tone={tone}>{status}</Pill>
        </div>
      ))}
    </div>
  );
}

function DemoFloor() {
  // 12 tables, some seated (filled) some free (outline).
  const tables = [
    { n: 1, seated: true },
    { n: 2, seated: false },
    { n: 3, seated: true },
    { n: 4, seated: true },
    { n: 5, seated: false },
    { n: 6, seated: false },
    { n: 7, seated: true },
    { n: 8, seated: false },
    { n: 9, seated: true },
    { n: 10, seated: true },
    { n: 11, seated: false },
    { n: 12, seated: true },
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 max-w-2xl">
        {tables.map((t) => (
          <div
            key={t.n}
            className="aspect-square rounded-2xl border-2 flex flex-col items-center justify-center"
            style={{
              borderColor: BRASS,
              background: t.seated ? BRASS : "rgba(255,255,255,0.6)",
            }}
          >
            <span className="text-2xl font-black" style={{ color: t.seated ? "#fff" : INK }}>
              {t.n}
            </span>
            <span className="text-xs font-bold" style={{ color: t.seated ? "#fff" : BROWN }}>
              {t.seated ? "Occupato" : "Libero"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoWaitlist() {
  const rows: [string, number, string][] = [
    ["Andrea Russo", 2, "8 min"],
    ["Chiara De Luca", 4, "15 min"],
    ["Paolo Marino", 3, "22 min"],
    ["Elena Costa", 2, "30 min"],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-2 max-w-2xl">
      {rows.map(([name, party, wait], i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border-2 p-3 bg-white/70" style={{ borderColor: BRASS }}>
          <span className="flex-1 text-sm font-semibold" style={{ color: INK }}>
            {name}
          </span>
          <span className="text-sm font-bold" style={{ color: INK }}>
            {party} pax
          </span>
          <span className="text-sm font-semibold w-16" style={{ color: BROWN }}>
            {wait}
          </span>
          <span className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: BRASS }}>
            Avvisa
          </span>
        </div>
      ))}
    </div>
  );
}

function DemoPending() {
  const rows: [string, string, number][] = [
    ["Roberto Esposito", "Sab 21:00", 8],
    ["Martina Gallo", "Dom 13:30", 5],
    ["Stefano Rizzo", "Ven 20:30", 10],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-3 max-w-2xl">
      {rows.map(([name, when, party], i) => (
        <div key={i} className="rounded-xl border-2 p-4 bg-white/70" style={{ borderColor: BRASS }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold" style={{ color: INK }}>
              {name}
            </span>
            <span className="text-sm font-semibold" style={{ color: BROWN }}>
              {when} · {party} pax
            </span>
          </div>
          <div className="flex gap-2">
            <span className="flex-1 text-center rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: "#5c6c4b" }}>
              Conferma
            </span>
            <span className="flex-1 text-center rounded-lg px-3 py-2 text-xs font-bold border-2" style={{ borderColor: BRASS, color: INK }}>
              Rifiuta
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DemoGuests() {
  const rows: [string, number, string, string][] = [
    ["Marco Rossi", 12, "2 set fa", "+39 333 1234567"],
    ["Giulia Bianchi", 8, "1 sett fa", "+39 348 7654321"],
    ["Luca Ferrari", 21, "ieri", "+39 320 5556677"],
    ["Sara Greco", 5, "3 sett fa", "+39 366 1122334"],
    ["Davide Moretti", 14, "oggi", "+39 339 9988776"],
    ["Elena Costa", 3, "1 mese fa", "+39 351 4455667"],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="rounded-xl border-2 overflow-hidden bg-white/70 max-w-3xl" style={{ borderColor: BRASS }}>
        <div className="grid grid-cols-[2fr_1fr_1.2fr_1.6fr] gap-2 px-4 py-3 text-xs font-black" style={{ background: "rgba(196,149,106,0.18)", color: INK }}>
          <span>Cliente</span>
          <span>Visite</span>
          <span>Ultima</span>
          <span>Telefono</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1.2fr_1.6fr] gap-2 px-4 py-3 border-t" style={{ borderColor: "rgba(196,149,106,0.3)" }}>
            <span className="text-sm font-semibold" style={{ color: INK }}>
              {r[0]}
            </span>
            <span className="text-sm font-bold" style={{ color: BROWN }}>
              {r[1]}
            </span>
            <span className="text-sm font-medium" style={{ color: INK }}>
              {r[2]}
            </span>
            <span className="text-sm font-medium" style={{ color: INK }}>
              {r[3]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoConversations() {
  const contacts = ["Marco Rossi", "Giulia Bianchi", "Famiglia Conti", "Luca Ferrari"];
  const bubbles: [boolean, string][] = [
    [true, "Buonasera, avete posto per 4 stasera alle 20:30?"],
    [false, "Buonasera! Sì, abbiamo un tavolo alle 20:30 per 4 persone. Confermo?"],
    [true, "Perfetto, confermo. Grazie!"],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex rounded-xl border-2 overflow-hidden bg-white/70 max-w-3xl h-[26rem]" style={{ borderColor: BRASS }}>
        <div className="w-48 border-r shrink-0" style={{ borderColor: "rgba(196,149,106,0.4)" }}>
          {contacts.map((c, i) => (
            <div key={c} className="px-3 py-3 border-b" style={{ borderColor: "rgba(196,149,106,0.25)", background: i === 0 ? "rgba(196,149,106,0.15)" : "transparent" }}>
              <div className="text-sm font-bold" style={{ color: INK }}>
                {c}
              </div>
              <div className="text-xs font-medium truncate" style={{ color: BROWN }}>
                Ultimo messaggio…
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-4 space-y-3">
            {bubbles.map(([incoming, text], i) => (
              <div key={i} className={`flex ${incoming ? "justify-start" : "justify-end"}`}>
                <div
                  className="max-w-[80%] rounded-2xl px-3.5 py-2 text-sm font-medium"
                  style={{
                    background: incoming ? "rgba(196,149,106,0.18)" : "#5c6c4b",
                    color: incoming ? INK : "#fff",
                  }}
                >
                  {text}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t p-3" style={{ borderColor: "rgba(196,149,106,0.4)" }}>
            <div className="rounded-full border-2 px-4 py-2 text-sm font-medium" style={{ borderColor: BRASS, color: BROWN }}>
              Scrivi un messaggio…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoKnowledge() {
  const faqs: [string, string][] = [
    ["Avete opzioni vegane?", "Sì, ogni sezione del menù ha almeno due piatti vegani, segnalati con un'icona."],
    ["Si può prenotare per gruppi?", "Per tavoli oltre 8 persone gestiamo la richiesta con conferma manuale dello staff."],
    ["Avete parcheggio?", "C'è un parcheggio convenzionato a 50 metri, gratuito per i nostri clienti la sera."],
    ["Accettate animali?", "Gli amici a quattro zampe sono i benvenuti negli spazi all'aperto."],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 grid sm:grid-cols-2 gap-4 max-w-3xl">
      {faqs.map(([q, a], i) => (
        <div key={i} className="rounded-xl border-2 p-4 bg-white/70" style={{ borderColor: BRASS }}>
          <div className="text-sm font-black mb-1.5" style={{ color: INK }}>
            {q}
          </div>
          <div className="text-sm font-medium" style={{ color: BROWN }}>
            {a}
          </div>
        </div>
      ))}
    </div>
  );
}

function DemoFor({ section }: { section: LockSection }) {
  switch (section) {
    case "analytics":
      return <DemoAnalytics />;
    case "reservations":
      return <DemoReservations />;
    case "floor":
      return <DemoFloor />;
    case "waitlist":
      return <DemoWaitlist />;
    case "pending":
      return <DemoPending />;
    case "guests":
      return <DemoGuests />;
    case "conversations":
      return <DemoConversations />;
    case "knowledge":
      return <DemoKnowledge />;
    case "reviews":
      return <DemoReviews />;
  }
}

function DemoReviews() {
  const rows: [string, number, string][] = [
    ["Marco Rossi", 5, "Serata perfetta, torneremo di sicuro!"],
    ["Giulia Bianchi", 4, "Ottimo menù degustazione, servizio attento."],
    ["Luca Ferrari", 5, "La migliore carbonara della città."],
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-3 max-w-2xl">
      {rows.map((r, i) => (
        <div key={i} className="rounded-xl border-2 p-4 bg-white/70" style={{ borderColor: BRASS }}>
          <div className="flex items-center gap-2">
            <span className="inline-flex">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className="w-4 h-4" fill={n <= r[1] ? "#f59e0b" : "transparent"} stroke={n <= r[1] ? "#f59e0b" : BRASS} />
              ))}
            </span>
            <span className="text-sm font-bold" style={{ color: INK }}>{r[0]}</span>
          </div>
          <p className="mt-2 text-sm" style={{ color: BROWN }}>{r[2]}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Crisp static demo of `section` under a light veil, with a centred "unlock with a
 * plan" CTA card. Render this as the WHOLE page body of a core section when
 * hasActivePlan(settings) is false.
 */
export function LockedPreview({ section }: { section: LockSection }) {
  const { t } = useLanguage();
  const Icon = SECTION_ICON[section];
  const title = t(NAV_KEY[section]);

  return (
    <div className="relative w-full min-h-[calc(100dvh-4rem)] overflow-hidden">
      {/* Level 1 — crisp demo content, non-interactive. */}
      <div className="absolute inset-0 overflow-hidden select-none pointer-events-none" aria-hidden="true">
        <DemoFor section={section} />
      </div>

      {/* Level 2 — light translucent veil; content stays legible. */}
      <div
        className="absolute inset-0 backdrop-blur-[1.5px] bg-gradient-to-b from-white/40 via-white/55 to-white/75"
        aria-hidden="true"
      />

      {/* Level 3 — CTA card. */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100dvh-4rem)] p-4">
        <div
          className="w-full max-w-sm rounded-2xl border-2 bg-white/90 backdrop-blur-sm p-6 sm:p-8 text-center shadow-xl"
          style={{ borderColor: BRASS, boxShadow: "0 20px 60px rgba(196,149,106,0.25)" }}
        >
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(196,149,106,0.15)" }}>
            <Lock className="w-8 h-8" style={{ color: BROWN }} />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide text-white mb-3" style={{ background: BRASS }}>
            {t("plan_locked_title")}
          </span>

          <h1 className="text-xl sm:text-2xl font-bold flex items-center justify-center gap-2" style={{ color: INK }}>
            <Icon className="w-5 h-5" style={{ color: BROWN }} /> {title}
          </h1>
          <p className="mt-2 text-sm" style={{ color: INK }}>
            {t("plan_locked_body")}
          </p>

          <Link
            href="/settings?tab=payments"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-bold transition-colors hover:opacity-90"
            style={{ background: BRASS }}
          >
            {t("plan_locked_cta")}
          </Link>
        </div>
      </div>
    </div>
  );
}
