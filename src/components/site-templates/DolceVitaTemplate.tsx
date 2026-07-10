"use client";

import type { CSSProperties } from "react";
import BookingWidget from "@/app/b/[slug]/BookingWidget";
import { EditableImage, EditableMarquee, EditableText, useBlockValue } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { DOLCEVITA_DEFAULTS } from "./defaults";

// "La Dolce Vita" — replica of la-dolce-vita-a2g.pages.dev: romantic candle-lit
// Italian trattoria "invitation". Warm retro paper-craft (deckle tickets, wax
// seal, scalloped dividers, marquee ribbons) in wine/cream/olive with Italian
// script accents. Every text/image renders via Editable* so the visual editor
// can rewrite it in place; menu, reviews, hours and contact come from live CRM
// data; booking is the real widget inside the cream ticket of #reservar.

const C = {
  cream: "#f6eee0",
  cream2: "#fbf6ec",
  wine: "#7c2230",
  wine2: "#5e1822",
  peach: "#e8b197",
  olive: "#4a5226",
  olive2: "#3c4420",
  tomato: "#c0392b",
  tomato2: "#9c2b20",
  terracotta: "#c77b53",
  mustard: "#d9a441",
  blush: "#f1d6c2",
};

const DISPLAY = "'Fraunces', serif";
const BODY = "'DM Sans', sans-serif";
/** Fraunces italic 500 doubles as the template's "handwriting". */
const script: CSSProperties = { fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 500 };
const display: CSSProperties = { fontFamily: DISPLAY, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 0.95 };

const CSS = `
@keyframes dv-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.dv-marquee-track { display: inline-flex; white-space: nowrap; animation: dv-marquee 38s linear infinite; }
@keyframes dv-float { from { transform: translateY(0); } to { transform: translateY(-9px); } }
.dv-float { animation: dv-float 6s ease-in-out infinite alternate; }
.dv-eyebrow { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; }
.dv-btn { display: inline-block; border-radius: 999px; padding: 0.8rem 1.7rem; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; border: 1.5px solid transparent; transition: transform .18s ease, box-shadow .18s ease, background .18s ease, color .18s ease; }
.dv-btn-red { background: ${C.tomato}; color: ${C.cream2}; border-color: ${C.tomato2}; box-shadow: 0 6px 0 -2px ${C.tomato2}; }
.dv-btn-red:hover { transform: translateY(2px); box-shadow: 0 3px 0 -2px ${C.tomato2}; background: ${C.tomato2}; }
.dv-btn-olive { background: ${C.olive}; color: ${C.cream}; border-color: ${C.olive2}; box-shadow: 0 6px 0 -2px ${C.olive2}; }
.dv-btn-olive:hover { transform: translateY(2px); box-shadow: 0 3px 0 -2px ${C.olive2}; background: ${C.olive2}; }
.dv-btn-ghost { background: transparent; color: ${C.olive}; border-color: ${C.olive}; }
.dv-btn-ghost:hover { background: ${C.olive}; color: ${C.cream}; }
.dv-scallop { height: 16px; background-repeat: repeat-x; background-size: 16px 16px; }
.dv-photo img { transition: transform .5s ease; }
.dv-photo:hover img { transform: scale(1.05); }
.dv-tilt-a { transform: rotate(-1.5deg); transition: transform .25s ease; }
.dv-tilt-b { transform: rotate(1.5deg); transition: transform .25s ease; }
.dv-tilt-a:hover, .dv-tilt-b:hover { transform: rotate(0deg); }
`;

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} style={{ color: C.mustard }} className="text-lg tracking-wide">
      {"★".repeat(n)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

/** Scalloped section divider — half-circle bumps of `from` biting into `to`. */
function Scallop({ from, to }: { from: string; to: string }) {
  return (
    <div
      aria-hidden
      className="dv-scallop w-full"
      style={{ backgroundColor: from, backgroundImage: `radial-gradient(circle at 8px -4px, transparent 12px, ${to} 13px)` }}
    />
  );
}

function Marquee({ id, fallback }: { id: string; fallback: string }) {
  const raw = useBlockValue(id, fallback);
  const items = raw.split("·").map((s) => s.trim()).filter(Boolean);
  const row = (key: string) => (
    <span key={key} className="inline-flex items-center">
      {items.map((it, i) => (
        <span key={i} className="mx-5 inline-flex items-center gap-5 text-xs font-semibold uppercase tracking-[0.2em]">
          {it} <span style={{ color: C.mustard }}>✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <EditableMarquee id={id} fallback={fallback} bandStyle={{ background: C.wine, color: C.cream, borderBottom: "1px solid rgba(246,238,224,0.12)" }}>
      <div className="w-full overflow-hidden py-2.5" style={{ background: C.wine, color: C.cream, borderBottom: "1px solid rgba(246,238,224,0.12)" }}>
        <div className="dv-marquee-track">
          {row("a")}
          {row("b")}
        </div>
      </div>
    </EditableMarquee>
  );
}

export default function DolceVitaTemplate({ data }: { data: SiteData }) {
  const brand = data.tenantName;
  const ui = data.labels;
  const mapEmbed = data.address ? `https://maps.google.com/maps?q=${encodeURIComponent(data.address)}&output=embed` : "";

  return (
    <div style={{ background: C.cream, color: C.olive, fontFamily: BODY }} className="min-h-screen w-full">
      <style>{CSS}</style>

      <Marquee id="marquee.text" fallback={DOLCEVITA_DEFAULTS["marquee.text"]} />

      {/* Hero — wine invitation with transparent header floating on top */}
      <section id="top" className="relative w-full overflow-hidden" style={{ background: C.wine }}>
        <div aria-hidden className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 7px)" }} />
        <div aria-hidden className="absolute -left-24 top-24 h-80 w-80 rounded-full" style={{ background: "radial-gradient(circle, rgba(232,177,151,0.55), transparent 70%)", filter: "blur(80px)" }} />
        <div aria-hidden className="absolute -right-20 bottom-8 h-96 w-96 rounded-full" style={{ background: "radial-gradient(circle, rgba(232,177,151,0.55), transparent 70%)", filter: "blur(80px)" }} />
        <span aria-hidden className="dv-float absolute left-[10%] top-36 text-2xl" style={{ color: C.mustard }}>✦</span>
        <span aria-hidden className="dv-float absolute right-[12%] top-48 text-lg" style={{ color: C.peach, animationDelay: "-2s" }}>✦</span>
        <span aria-hidden className="dv-float absolute bottom-16 left-[18%] text-xl" style={{ color: C.peach, animationDelay: "-4s" }}>✦</span>

        <header className="absolute inset-x-0 top-0 z-40">
          <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
            <a href="#top" className="text-2xl" style={{ ...display, color: C.cream }}>{brand}</a>
            <nav className="hidden items-center gap-7 text-xs font-semibold uppercase tracking-[0.18em] md:flex" style={{ color: "rgba(246,238,224,0.85)" }}>
              <a href="#familia" className="hover:opacity-70">{ui.about}</a>
              <a href={`/m/${data.slug}`} className="hover:opacity-70">{ui.fullMenu}</a>
              <a href="#reviews" className="hover:opacity-70">{ui.reviews}</a>
              <a href="#encontrar" className="hover:opacity-70">{ui.contact}</a>
            </nav>
            <a href="#reservar" className="dv-btn dv-btn-red" style={{ padding: "0.55rem 1.25rem" }}>{ui.book}</a>
          </div>
        </header>

        <div className="relative mx-auto flex min-h-[68vh] max-w-6xl items-center justify-center px-5 pb-20 pt-32">
          <div className="relative w-full max-w-2xl rounded-2xl px-6 py-10 text-center md:px-12" style={{ background: C.cream2, boxShadow: "0 24px 60px rgba(46,10,16,0.45)" }}>
            <div className="absolute -right-4 -top-7 flex h-24 w-24 rotate-[8deg] items-center justify-center rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, #e8c06a, #d9a441 55%, #b9862c)", boxShadow: "0 6px 14px rgba(94,24,34,0.35)" }}>
              <EditableText id="hero.seal" className="px-2 text-center text-lg leading-tight" style={{ ...script, color: C.wine }} />
            </div>
            <EditableText id="hero.eyebrow" as="p" className="dv-eyebrow" style={{ color: C.terracotta }} />
            <EditableText id="hero.line1" as="h1" fallback={brand} className="mt-4" style={{ ...display, color: C.wine, fontSize: "clamp(2.6rem, 7vw, 5rem)" }} />
            <EditableText id="hero.line2" as="p" style={{ ...script, color: C.tomato, fontSize: "clamp(3.4rem, 8vw, 6.4rem)", lineHeight: 0.9 }} />
            <div className="mx-auto mt-7 max-w-md border px-6 py-5" style={{ borderColor: "rgba(124,34,48,0.25)" }}>
              <EditableText id="hero.script" as="p" className="text-2xl" style={{ ...script, color: C.olive }} />
              <div aria-hidden className="mx-auto my-3 h-px w-16" style={{ background: "rgba(124,34,48,0.25)" }} />
              <p aria-hidden className="tracking-[0.3em]" style={{ color: C.mustard }}>★★★★★</p>
              <EditableText id="hero.tag" as="p" className="dv-eyebrow mt-2" style={{ color: "rgba(74,82,38,0.65)", letterSpacing: "0.18em" }} />
            </div>
            <EditableText id="hero.text" as="p" className="mx-auto mt-6 max-w-lg italic leading-relaxed" style={{ color: C.olive }} />
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <a href="#reservar" className="dv-btn dv-btn-red">{ui.book}</a>
              <a href={`/m/${data.slug}`} className="dv-btn dv-btn-ghost">{ui.viewMenu}</a>
            </div>
          </div>
        </div>
      </section>
      <Scallop from={C.wine} to={C.cream} />

      {/* Stats */}
      <section className="w-full px-5 py-14" style={{ background: C.cream }}>
        <div className="mx-auto grid max-w-4xl gap-8 text-center sm:grid-cols-3 sm:gap-0">
          <div className="px-6">
            <EditableText id="stats.1.n" as="p" style={{ ...display, color: C.tomato, fontSize: "clamp(2.8rem, 5vw, 3.75rem)" }} />
            <EditableText id="stats.1.label" as="p" className="dv-eyebrow mt-2" style={{ color: "rgba(74,82,38,0.55)" }} />
          </div>
          <div className="px-6 sm:border-l" style={{ borderColor: "rgba(74,82,38,0.12)" }}>
            <EditableText id="stats.2.n" as="p" style={{ ...display, color: C.tomato, fontSize: "clamp(2.8rem, 5vw, 3.75rem)" }} />
            <EditableText id="stats.2.label" as="p" className="dv-eyebrow mt-2" style={{ color: "rgba(74,82,38,0.55)" }} />
          </div>
          <div className="px-6 sm:border-l" style={{ borderColor: "rgba(74,82,38,0.12)" }}>
            {data.reviews.length ? (
              <p style={{ ...display, color: C.tomato, fontSize: "clamp(2.8rem, 5vw, 3.75rem)" }}>{data.avgRating.toFixed(1)}★</p>
            ) : (
              <EditableText id="stats.3.n" as="p" style={{ ...display, color: C.tomato, fontSize: "clamp(2.8rem, 5vw, 3.75rem)" }} />
            )}
            {data.reviews.length ? (
              <p className="dv-eyebrow mt-2" style={{ color: "rgba(74,82,38,0.55)" }}>{ui.reviews}</p>
            ) : (
              <EditableText id="stats.3.label" as="p" className="dv-eyebrow mt-2" style={{ color: "rgba(74,82,38,0.55)" }} />
            )}
          </div>
        </div>
      </section>

      {/* Cocina (live CRM menu) */}
      {data.menuItems.length ? (
        <section id="cocina" className="w-full px-5 py-16 md:py-24" style={{ background: C.cream }}>
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-xl">
                <EditableText id="cocina.eyebrow" as="p" className="dv-eyebrow" style={{ color: C.tomato }} />
                <EditableText id="cocina.title" as="h2" className="mt-3" style={{ ...display, color: C.olive, fontSize: "clamp(2.4rem, 5vw, 4.4rem)" }} />
                <EditableText id="cocina.text" as="p" className="mt-4 leading-relaxed" style={{ color: "rgba(74,82,38,0.8)" }} />
              </div>
              <a href={`/m/${data.slug}`} className="dv-btn dv-btn-ghost">{ui.fullMenu} →</a>
            </div>
            <div className="mt-12 grid grid-cols-2 gap-6 md:grid-cols-3 md:gap-8">
              {data.menuItems.map((it, i) => (
                <div key={it.id} className="dv-photo">
                  {it.image_url ? (
                    <div className="relative rounded-sm p-2" style={{ background: C.cream2, border: "1px solid rgba(74,82,38,0.15)", filter: "drop-shadow(0 5px 9px rgba(94,24,34,0.18))" }}>
                      <div className="aspect-[4/5] overflow-hidden rounded-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                      <span aria-hidden className="absolute left-4 top-4 text-xs font-bold tracking-[0.2em]" style={{ color: C.cream2, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <p className="text-xl md:text-2xl" style={{ ...display, color: C.olive }}>{it.name}</p>
                    {it.price != null ? (
                      <span className="shrink-0 font-semibold" style={{ color: C.tomato }}>{formatSitePrice(it.price, it.currency)}</span>
                    ) : null}
                  </div>
                  {it.description ? <p className="mt-1 text-sm leading-snug line-clamp-2" style={{ color: "rgba(74,82,38,0.7)" }}>{it.description}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      <Scallop from={C.cream} to={C.peach} />

      {/* Occasions */}
      <section className="relative w-full overflow-hidden px-5 py-16 md:py-24" style={{ background: C.peach }}>
        <span aria-hidden className="dv-float absolute left-[6%] top-24 text-5xl" style={{ color: "rgba(192,57,43,0.14)" }}>♥</span>
        <span aria-hidden className="dv-float absolute right-[8%] top-1/3 text-6xl" style={{ color: "rgba(192,57,43,0.12)", animationDelay: "-3s" }}>♥</span>
        <span aria-hidden className="dv-float absolute bottom-20 left-[14%] text-4xl" style={{ color: "rgba(192,57,43,0.15)", animationDelay: "-5s" }}>♥</span>
        <div className="relative mx-auto max-w-5xl text-center">
          <EditableText id="occasions.script" as="p" className="text-3xl" style={{ ...script, color: C.tomato }} />
          <EditableText id="occasions.title" as="h2" className="mt-2" style={{ ...display, color: C.tomato, fontSize: "clamp(2.4rem, 6vw, 4.4rem)" }} />
          <EditableText id="occasions.text" as="p" className="mx-auto mt-4 max-w-xl leading-relaxed" style={{ color: C.olive }} />
          <div className="relative mx-auto mt-12 max-w-3xl -rotate-1">
            <EditableImage id="occasions.image" alt="" className="aspect-[16/10] w-full rounded-md object-cover" style={{ border: `6px solid ${C.cream2}`, boxShadow: "0 18px 40px rgba(94,24,34,0.3)" }} />
            <span className="absolute -right-3 -top-5 rotate-[4deg] rounded-md px-4 py-1.5 text-xl" style={{ ...script, background: C.tomato, color: C.cream2, boxShadow: "0 6px 14px rgba(94,24,34,0.3)" }}>
              <EditableText id="occasions.sticker" />
            </span>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-md sm:grid-cols-3" style={{ background: "rgba(74,82,38,0.2)" }}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="px-6 py-8" style={{ background: C.peach }}>
                <EditableText id={`occasions.${n}.title`} as="h3" className="text-2xl" style={{ ...display, color: C.olive }} />
                <EditableText id={`occasions.${n}.text`} as="p" className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(74,82,38,0.8)" }} />
              </div>
            ))}
          </div>
          <a href="#reservar" className="dv-btn dv-btn-red mt-12">{ui.book}</a>
        </div>
      </section>
      <Scallop from={C.peach} to={C.cream} />

      {/* Familia */}
      <section id="familia" className="w-full px-5 py-16 md:py-24" style={{ background: C.cream }}>
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="relative">
            <EditableImage id="familia.image" alt="" className="aspect-[4/5] w-full rounded-md object-cover" style={{ border: `6px solid ${C.cream2}`, boxShadow: "0 16px 36px rgba(94,24,34,0.22)" }} />
            <span className="absolute -left-3 bottom-8 -rotate-[4deg] rounded-md px-4 py-1.5 text-xl" style={{ ...script, background: C.olive, color: C.cream, boxShadow: "0 6px 14px rgba(60,68,32,0.3)" }}>
              <EditableText id="familia.sticker" />
            </span>
          </div>
          <div>
            <EditableText id="familia.eyebrow" as="p" className="dv-eyebrow" style={{ color: C.tomato }} />
            <EditableText id="familia.title" as="h2" className="mt-3" style={{ ...display, color: C.olive, fontSize: "clamp(2.4rem, 5vw, 4rem)" }} />
            <EditableText id="familia.p1" as="p" className="mt-6 leading-relaxed" style={{ color: "rgba(74,82,38,0.85)" }} />
            <EditableText id="familia.p2" as="p" className="mt-3 leading-relaxed" style={{ color: "rgba(74,82,38,0.85)" }} />
            <EditableText id="familia.quote" as="blockquote" className="mt-7 text-2xl md:text-3xl" style={{ ...script, color: C.tomato, lineHeight: 1.25 }} />
            <EditableText id="familia.caption" as="p" className="dv-eyebrow mt-4" style={{ color: C.terracotta }} />
          </div>
        </div>
      </section>
      <Scallop from={C.cream} to={C.wine} />

      {/* Reservar — real CRM booking widget in a cream ticket */}
      <section id="reservar" className="relative w-full overflow-hidden px-5 py-16 md:py-24" style={{ background: C.wine }}>
        <div aria-hidden className="absolute left-1/2 top-0 h-96 w-[42rem] -translate-x-1/2 rounded-full" style={{ background: "radial-gradient(circle, rgba(232,177,151,0.35), transparent 70%)", filter: "blur(80px)" }} />
        <div className="relative mx-auto max-w-2xl text-center">
          <EditableText id="book.eyebrow" as="p" className="dv-eyebrow" style={{ color: C.peach }} />
          <EditableText id="book.title" as="h2" className="mt-3" style={{ ...display, color: C.cream, fontSize: "clamp(2.4rem, 6vw, 4.4rem)" }} />
          <EditableText id="book.text" as="p" className="mx-auto mt-4 max-w-md leading-relaxed" style={{ color: "rgba(246,238,224,0.7)" }} />
          <div className="mt-10 rounded-2xl p-6 text-left md:p-8" style={{ background: C.cream2, boxShadow: "0 24px 60px rgba(46,10,16,0.5)" }}>
            <h3 className="text-xl" style={{ ...display, color: C.olive }}>{data.bookingStrings.title}</h3>
            <BookingWidget slug={data.slug} accent={C.tomato} strings={data.bookingStrings} />
          </div>
          <EditableText id="book.script" as="p" className="mt-6 text-2xl" style={{ ...script, color: "rgba(246,238,224,0.6)" }} />
          {data.giftCardsEnabled ? (
            <a href={`/g/${data.slug}`} className="mt-3 inline-block text-sm underline underline-offset-4" style={{ color: "rgba(246,238,224,0.75)" }}>
              🎁 {ui.giftCta}
            </a>
          ) : null}
        </div>
      </section>
      <Scallop from={C.wine} to={C.cream2} />

      {/* Reviews (live CRM data) */}
      <section id="reviews" className="w-full px-5 py-16 md:py-24" style={{ background: C.cream2 }}>
        <div className="mx-auto max-w-6xl text-center">
          <EditableText id="reviews.eyebrow" as="p" className="dv-eyebrow" style={{ color: C.tomato }} />
          <EditableText id="reviews.title" as="h2" className="mt-3" style={{ ...display, color: C.olive, fontSize: "clamp(2.4rem, 5vw, 4rem)" }} />
          {data.reviews.length ? (
            <>
              <p className="mt-3 text-sm font-semibold" style={{ color: C.terracotta }}>
                <span style={{ color: C.mustard }}>★</span> {data.avgRating.toFixed(1)} · {ui.reviews}
              </p>
              <div className="mt-10 grid gap-6 text-left sm:grid-cols-2 lg:grid-cols-4">
                {data.reviews.slice(0, 4).map((r, i) => (
                  <figure key={i} className={`rounded-md p-5 ${i % 2 ? "dv-tilt-b" : "dv-tilt-a"}`} style={{ background: C.cream2, border: "1.5px solid rgba(74,82,38,0.3)", boxShadow: "0 10px 24px rgba(94,24,34,0.08)" }}>
                    <Stars n={r.rating} />
                    <blockquote className="mt-2 text-lg leading-snug" style={{ ...script, color: C.olive }}>“{r.comment}”</blockquote>
                    <figcaption className="dv-eyebrow mt-4" style={{ color: C.terracotta, letterSpacing: "0.16em" }}>{r.author}</figcaption>
                  </figure>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-6" style={{ color: "rgba(74,82,38,0.75)" }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="dv-btn dv-btn-ghost mt-10">Google ★</a>
          ) : null}
        </div>
      </section>

      {/* Encontrarnos: contact + hours + map (live CRM data) */}
      <section id="encontrar" className="w-full px-5 py-16 md:py-24" style={{ background: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-2">
          <div>
            <EditableText id="visit.eyebrow" as="p" className="dv-eyebrow" style={{ color: C.tomato }} />
            <EditableText id="visit.title" as="h2" className="mt-3" style={{ ...display, color: C.olive, fontSize: "clamp(2.4rem, 5vw, 4rem)" }} />
            {data.address ? (
              <div className="mt-7">
                <p className="dv-eyebrow" style={{ color: C.terracotta }}>{ui.address}</p>
                <p className="mt-1" style={{ color: C.olive }}>{data.address}</p>
              </div>
            ) : null}
            {data.phone ? (
              <div className="mt-5">
                <p className="dv-eyebrow" style={{ color: C.terracotta }}>{ui.phone}</p>
                <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="mt-1 inline-block underline underline-offset-4" style={{ color: C.olive }}>{data.phone}</a>
              </div>
            ) : null}
            {data.hours.length ? (
              <div className="mt-7">
                <p className="dv-eyebrow" style={{ color: C.terracotta }}>{ui.hours}</p>
                <dl className="mt-2">
                  {data.hours.map((h) => (
                    <div key={h.day} className="flex items-center justify-between border-b py-2 text-sm" style={{ borderColor: "rgba(74,82,38,0.12)" }}>
                      <dt className="font-semibold" style={{ color: C.olive }}>{h.day}</dt>
                      <dd style={{ color: "rgba(74,82,38,0.75)" }}>{h.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            <div className="mt-9 flex flex-wrap gap-4">
              {data.mapsHref ? (
                <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="dv-btn dv-btn-olive">{ui.map}</a>
              ) : null}
              {data.phone ? (
                <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="dv-btn dv-btn-ghost">{ui.phone}</a>
              ) : null}
            </div>
          </div>
          {mapEmbed ? (
            <iframe
              src={mapEmbed}
              className="min-h-[320px] w-full rounded-md"
              style={{ border: "1.5px solid rgba(74,82,38,0.25)", filter: "sepia(.35) saturate(.85)" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="map"
            />
          ) : null}
        </div>
      </section>

      <Marquee id="marquee2.text" fallback={DOLCEVITA_DEFAULTS["marquee2.text"]} />

      {/* Footer */}
      <footer className="w-full px-5 py-12" style={{ background: C.olive, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-2xl" style={{ ...display, color: C.cream }}>{brand}</p>
            <EditableText id="footer.script" as="p" className="mt-3 text-2xl" style={{ ...script, color: C.peach }} />
          </div>
          <nav className="flex flex-col gap-2 text-sm">
            <a href="#familia" className="hover:underline">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="hover:underline">{ui.fullMenu}</a>
            <a href="#reservar" className="hover:underline">{ui.book}</a>
            <a href="#encontrar" className="hover:underline">{ui.contact}</a>
          </nav>
          <div className="text-sm" style={{ color: "rgba(246,238,224,0.75)" }}>
            {data.address ? <p>{data.address}</p> : null}
            {data.phone ? <p className="mt-1">{data.phone}</p> : null}
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl border-t pt-4 text-xs" style={{ borderColor: "rgba(246,238,224,0.15)", color: "rgba(246,238,224,0.6)" }}>
          © {new Date().getFullYear()} {brand}
        </p>
      </footer>
    </div>
  );
}
