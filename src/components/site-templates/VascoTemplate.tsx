"use client";

import type { CSSProperties } from "react";
import BookingWidget from "@/app/b/[slug]/BookingWidget";
import { EditableImage, EditableText, useBlockValue } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { VASCO_DEFAULTS } from "./defaults";

// "Vasco" — replica of el-vasco-de-vegueta.pages.dev: warm editorial Basque
// tasca-asador. Cream paper with a red dot-grid, ikurriña red/green blocks,
// tilted polaroids that straighten on hover, Fraunces display type and ghost
// watermark numerals. Every text/image renders via Editable* for the visual
// editor; menu, reviews, hours and contact come from live CRM data; booking
// is the real widget.

const C = {
  cream: "#f5efe1",
  creamDeep: "#e8dcc6",
  ink: "#221c18",
  green: "#0d3a20",
  red: "#c82020",
  redDeep: "#8a1a16",
  redSoft: "#e0463a",
  emerald: "#0a8240",
  greenSoft: "#38a96a",
  gold: "#f4b400",
};

const DISPLAY = "'Fraunces', serif";
const BODY = "'Bricolage Grotesque', sans-serif";

const CSS = `
@keyframes va-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.va-marquee-track { display: inline-flex; white-space: nowrap; animation: va-marquee 28s linear infinite; }
.va-paper { background-color: ${C.cream}; background-image: radial-gradient(#c820200b 1px, transparent 1px); background-size: 20px 20px; }
.va-btn { transition: background .3s cubic-bezier(.16,1,.3,1), color .3s cubic-bezier(.16,1,.3,1), transform .3s cubic-bezier(.16,1,.3,1); }
.va-btn:hover { transform: translateY(-2px); }
.va-btn-red:hover { background: ${C.redDeep} !important; }
.va-btn-green:hover { background: #076a33 !important; }
.va-link:hover { text-decoration: underline; text-decoration-color: ${C.red}; text-decoration-thickness: 1.5px; text-underline-offset: 5px; }
.va-tilt { transition: rotate .35s cubic-bezier(.16,1,.3,1), transform .35s cubic-bezier(.16,1,.3,1), box-shadow .35s cubic-bezier(.16,1,.3,1); }
.va-tilt:hover { rotate: 0deg !important; transform: translateY(-5px); box-shadow: 0 26px 52px -22px rgba(34,28,24,0.45) !important; }
`;

const EYEBROW: CSSProperties = { fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.28em" };
const PILL: CSSProperties = {
  borderRadius: 999,
  padding: "0.85rem 1.9rem",
  fontWeight: 700,
  fontSize: "0.78rem",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  display: "inline-block",
};
const CARD_TILTS = ["-1.8deg", "1.4deg", "-2.4deg", "2deg", "-1.2deg", "1.6deg"];
const REVIEW_TILTS = ["-1.6deg", "1.3deg", "-2.2deg", "1.8deg"];

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} style={{ color: C.gold }} className="text-base tracking-wide">
      {"★".repeat(n)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

function Marquee({ id, fallback, border }: { id: string; fallback: string; border: string }) {
  const raw = useBlockValue(id, fallback);
  const items = raw.split("·").map((s) => s.trim()).filter(Boolean);
  const row = (key: string) => (
    <span key={key} className="inline-flex items-center">
      {items.map((it, i) => (
        <span key={i} className="mx-5 inline-flex items-center gap-5 text-base font-bold uppercase" style={{ fontFamily: DISPLAY, letterSpacing: "0.14em" }}>
          {it} <span style={{ color: C.redSoft }}>✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="w-full overflow-hidden py-3" style={{ background: C.green, color: C.cream, borderTop: `3px solid ${border}`, borderBottom: `3px solid ${border}` }}>
      <div className="va-marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

export default function VascoTemplate({ data }: { data: SiteData }) {
  const brand = data.tenantName;
  const ui = data.labels;
  const mapEmbed = data.address ? `https://maps.google.com/maps?q=${encodeURIComponent(data.address)}&output=embed` : "";
  const inkSoft = "rgba(34,28,24,0.72)";
  const creamSoft = "rgba(245,239,225,0.8)";

  return (
    <div style={{ background: C.cream, color: C.ink, fontFamily: BODY }} className="min-h-screen w-full">
      <style>{CSS}</style>

      {/* Sticky nav */}
      <header className="sticky top-0 z-40 backdrop-blur-[10px]" style={{ background: "rgba(245,239,225,0.92)", boxShadow: "0 1px 0 rgba(200,32,32,0.3)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="leading-tight">
            <EditableText id="nav.brand" as="span" fallback={brand} className="block text-lg font-bold uppercase" style={{ fontFamily: DISPLAY, letterSpacing: "0.12em" }} />
            <EditableText id="nav.sub" as="span" className="block" style={{ fontSize: "0.58rem", letterSpacing: "0.32em", opacity: 0.55 }} />
          </a>
          <nav className="hidden items-center gap-7 text-xs font-semibold uppercase md:flex" style={{ letterSpacing: "0.12em" }}>
            <a href="#casa" className="va-link">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="va-link">{ui.fullMenu}</a>
            <a href="#resenas" className="va-link">{ui.reviews}</a>
            <a href="#encontrar" className="va-link">{ui.contact}</a>
          </nav>
          <a href="#reserva" className="va-btn va-btn-red" style={{ ...PILL, padding: "0.6rem 1.4rem", background: C.red, color: "#fff" }}>
            {ui.book}
          </a>
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="va-paper flex w-full flex-col" style={{ minHeight: "100svh" }}>
        <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-14 md:grid-cols-[0.9fr_1.1fr] md:py-16">
          <div>
            <p className="flex items-center gap-3" style={{ ...EYEBROW, color: C.redDeep }}>
              <span className="inline-block h-px w-9 shrink-0" style={{ background: C.red }} />
              <EditableText id="hero.eyebrow" />
            </p>
            <span className="mt-5 inline-flex items-center gap-2 text-xs font-bold" style={{ background: C.emerald, color: C.cream, borderRadius: 999, padding: "0.45rem 1.1rem", rotate: "-3deg" }}>
              <span style={{ color: C.gold }}>★</span>
              <EditableText id="hero.badge" />
            </span>
            <h1 className="mt-5" style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(2.7rem, 7.5vw, 5.2rem)", lineHeight: 0.98, letterSpacing: "-0.018em" }}>
              <EditableText id="hero.title1" as="span" className="block" />
              <EditableText id="hero.title2" as="span" className="block italic" style={{ color: C.red, fontWeight: 700 }} />
            </h1>
            <EditableText id="hero.text" as="p" className="mt-6 max-w-lg leading-relaxed" style={{ color: inkSoft }} />
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <a href="#reserva" className="va-btn va-btn-red" style={{ ...PILL, background: C.red, color: "#fff" }}>
                {ui.book}
              </a>
              <a href={`/m/${data.slug}`} className="va-link text-xs font-bold uppercase" style={{ letterSpacing: "0.16em" }}>
                {ui.viewMenu} →
              </a>
            </div>
          </div>
          <div className="relative md:self-stretch">
            <EditableImage
              id="hero.image"
              alt=""
              className="h-full min-h-[320px] w-full object-cover md:min-h-[440px]"
              style={{ borderRadius: 3, boxShadow: "0 34px 60px -24px rgba(34,28,24,0.5)" }}
            />
          </div>
        </div>
        <Marquee id="hero.marquee" fallback={VASCO_DEFAULTS["hero.marquee"]} border={C.red} />
      </section>

      {/* La casa */}
      <section id="casa" className="va-paper w-full px-5 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
          <EditableImage
            id="casa.image"
            alt=""
            className="va-tilt aspect-[4/5] w-full object-cover"
            style={{ rotate: "-2deg", borderRadius: 3, boxShadow: "0 25px 50px -12px rgba(34,28,24,0.35)" }}
          />
          <div>
            <EditableText id="casa.eyebrow" as="p" style={{ ...EYEBROW, color: C.redDeep }} />
            <EditableText id="casa.title" as="h2" className="mt-3 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY, color: C.red, lineHeight: 1.05 }} />
            <EditableText id="casa.p1" as="p" className="mt-6 leading-relaxed" style={{ color: inkSoft }} />
            <EditableText id="casa.p2" as="p" className="mt-4 leading-relaxed" style={{ color: inkSoft }} />
            <div className="mt-8 border-l-4 p-5" style={{ borderColor: C.emerald, background: C.creamDeep, borderRadius: 3 }}>
              <EditableText id="casa.notelabel" as="p" style={{ ...EYEBROW, color: C.emerald }} />
              <EditableText id="casa.quote" as="blockquote" className="mt-3 text-lg italic leading-relaxed" style={{ fontFamily: DISPLAY }} />
              <EditableText id="casa.caption" as="p" className="mt-3 text-sm font-semibold" style={{ color: inkSoft }} />
            </div>
          </div>
        </div>
      </section>

      {/* La carta (live CRM data) */}
      {data.menuItems.length ? (
        <section id="carta-preview" className="va-paper w-full px-5 py-16 md:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <EditableText id="carta.eyebrow" as="p" style={{ ...EYEBROW, color: C.red }} />
                <EditableText id="carta.title" as="h2" className="mt-3 text-4xl md:text-5xl" style={{ fontFamily: DISPLAY, fontWeight: 900, lineHeight: 1.02 }} />
              </div>
              <EditableText id="carta.text" as="p" className="max-w-sm text-sm leading-relaxed" style={{ color: inkSoft }} />
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {data.menuItems.map((it, i) => (
                <article key={it.id} className="va-tilt relative bg-white p-3 pb-5" style={{ rotate: CARD_TILTS[i % CARD_TILTS.length], borderRadius: 2, boxShadow: "0 18px 34px -18px rgba(34,28,24,0.35)" }}>
                  <span className="absolute -left-2.5 -top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold" style={{ background: C.red, color: "#fff", fontFamily: DISPLAY }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {it.image_url ? (
                    <div className="aspect-[4/5] overflow-hidden" style={{ borderRadius: 2 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : null}
                  <div className="mt-3 px-1">
                    <h3 className="text-xl font-bold" style={{ fontFamily: DISPLAY }}>{it.name}</h3>
                    {it.description ? <p className="mt-1 text-sm leading-snug line-clamp-2" style={{ color: inkSoft }}>{it.description}</p> : null}
                    {it.price != null ? (
                      <span className="mt-3 inline-block rounded-full px-3.5 py-1 text-sm font-bold" style={{ background: C.emerald, color: C.cream, fontFamily: DISPLAY }}>
                        {formatSitePrice(it.price, it.currency)}
                      </span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-12 text-center">
              <a href={`/m/${data.slug}`} className="va-btn" style={{ ...PILL, border: "1px solid rgba(56,169,106,0.6)", color: C.ink }}>
                {ui.fullMenu} →
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {/* La tortilla */}
      <section id="tortilla" className="relative w-full overflow-hidden px-5 py-16 md:py-24" style={{ background: C.green, color: C.cream }}>
        <span aria-hidden className="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 select-none" style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "14rem", lineHeight: 1, color: "rgba(245,239,225,0.08)" }}>
          01
        </span>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
          <div>
            <EditableText id="tortilla.eyebrow" as="p" style={{ ...EYEBROW, color: C.greenSoft }} />
            <h2 className="mt-3 uppercase" style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(2.4rem, 6vw, 4.2rem)", lineHeight: 0.98 }}>
              <EditableText id="tortilla.title1" as="span" className="block" />
              <EditableText id="tortilla.title2" as="span" className="block italic" style={{ color: C.greenSoft, fontWeight: 700 }} />
            </h2>
            <span className="mt-5 inline-block text-xs font-bold" style={{ border: "1px solid rgba(245,239,225,0.45)", borderRadius: 999, padding: "0.45rem 1.1rem", letterSpacing: "0.08em" }}>
              <EditableText id="tortilla.badge" />
            </span>
            <EditableText id="tortilla.text" as="p" className="mt-6 max-w-lg leading-relaxed" style={{ color: creamSoft }} />
            <a href={`/m/${data.slug}`} className="va-btn mt-8" style={{ ...PILL, background: C.greenSoft, color: C.green }}>
              <EditableText id="tortilla.cta" />
            </a>
          </div>
          <div className="relative">
            <EditableImage id="tortilla.image" alt="" className="aspect-[4/3] w-full object-cover" style={{ borderRadius: 3, boxShadow: "0 30px 55px -22px rgba(0,0,0,0.6)" }} />
            <span className="absolute -left-4 -top-5 flex h-20 w-20 items-center justify-center rounded-full text-lg font-bold" style={{ background: C.red, color: C.cream, rotate: "-11deg", fontFamily: DISPLAY, boxShadow: "0 12px 24px -10px rgba(0,0,0,0.5)" }}>
              <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ border: "1.5px dashed rgba(245,239,225,0.7)" }}>
                <EditableText id="tortilla.sticker" />
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* Txakoli */}
      <section id="txakoli" className="w-full px-5 py-16 md:py-24" style={{ background: C.redDeep, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
          <EditableImage id="txakoli.image" alt="" className="va-tilt aspect-[4/3] w-full object-cover" style={{ rotate: "1.5deg", borderRadius: 3, boxShadow: "0 25px 50px -18px rgba(0,0,0,0.5)" }} />
          <div>
            <EditableText id="txakoli.eyebrow" as="p" style={{ ...EYEBROW, color: "rgba(245,239,225,0.65)" }} />
            <EditableText id="txakoli.title" as="h2" className="mt-3 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY, lineHeight: 1.02 }} />
            <EditableText id="txakoli.text" as="p" className="mt-6 max-w-lg leading-relaxed" style={{ color: creamSoft }} />
            <EditableText id="txakoli.toast" as="p" className="mt-7 italic" style={{ fontFamily: DISPLAY, fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)", color: C.gold }} />
          </div>
        </div>
      </section>

      <Marquee id="txakoli.marquee" fallback={VASCO_DEFAULTS["txakoli.marquee"]} border={C.cream} />

      {/* Reserva — real CRM widget */}
      <section id="reserva" className="w-full px-5 py-16 md:py-24" style={{ background: C.green, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[0.85fr_1.15fr]">
          <div>
            <EditableText id="book.eyebrow" as="p" style={{ ...EYEBROW, color: C.greenSoft }} />
            <EditableText id="book.title" as="h2" className="mt-3 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY, lineHeight: 1.02 }} />
            <EditableText id="book.text" as="p" className="mt-5 max-w-md leading-relaxed" style={{ color: creamSoft }} />
            {data.giftCardsEnabled ? (
              <a href={`/g/${data.slug}`} className="mt-6 inline-block text-sm underline underline-offset-4" style={{ color: C.greenSoft }}>
                {ui.giftCta}
              </a>
            ) : null}
          </div>
          <div className="p-6 md:p-8" style={{ background: C.cream, color: C.ink, borderRadius: 3, boxShadow: "0 34px 64px -26px rgba(0,0,0,0.6)" }}>
            <h3 className="text-2xl font-bold" style={{ fontFamily: DISPLAY }}>{data.bookingStrings.title}</h3>
            <BookingWidget slug={data.slug} accent="#c82020" strings={data.bookingStrings} />
          </div>
        </div>
      </section>

      {/* Reseñas (live CRM data) */}
      <section id="resenas" className="va-paper w-full px-5 py-16 md:py-24">
        <div className="mx-auto max-w-6xl text-center">
          <EditableText id="resenas.eyebrow" as="p" style={{ ...EYEBROW, color: C.redDeep }} />
          <EditableText id="resenas.title" as="h2" className="mt-3 text-4xl md:text-5xl" style={{ fontFamily: DISPLAY, fontWeight: 900, color: C.red }} />
          <EditableText id="resenas.text" as="p" className="mx-auto mt-4 max-w-md text-sm leading-relaxed" style={{ color: inkSoft }} />
          {data.reviews.length ? (
            <div className="mt-12 grid gap-7 text-left sm:grid-cols-2 lg:grid-cols-4">
              {data.reviews.slice(0, 4).map((r, i) => (
                <figure key={i} className="va-tilt relative bg-white p-5 pt-9" style={{ rotate: REVIEW_TILTS[i % REVIEW_TILTS.length], borderRadius: 2, boxShadow: "0 16px 30px -16px rgba(34,28,24,0.3)" }}>
                  <span aria-hidden className="pointer-events-none absolute -top-1 left-3 select-none" style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "4.5rem", lineHeight: 1, color: "rgba(200,32,32,0.12)" }}>
                    “
                  </span>
                  <Stars n={r.rating} />
                  <blockquote className="mt-3 italic leading-relaxed" style={{ fontFamily: DISPLAY }}>“{r.comment}”</blockquote>
                  <figcaption className="mt-4 flex items-center gap-2.5 text-sm font-bold">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs" style={{ background: i % 2 ? C.emerald : C.red, color: C.cream }}>
                      {r.author.charAt(0).toUpperCase()}
                    </span>
                    {r.author}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="mt-8" style={{ color: inkSoft }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="va-btn va-btn-green mt-10" style={{ ...PILL, background: C.emerald, color: C.cream }}>
              <EditableText id="resenas.cta" />
            </a>
          ) : null}
        </div>
      </section>

      {/* Encuéntranos (live CRM data) */}
      <section id="encontrar" className="w-full px-5 py-16 md:py-24" style={{ background: C.redDeep, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-2">
          <div>
            <EditableText id="find.eyebrow" as="p" style={{ ...EYEBROW, color: "rgba(245,239,225,0.65)" }} />
            <EditableText id="find.title" as="h2" className="mt-3 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY, lineHeight: 1.02 }} />
            <EditableText id="find.text" as="p" className="mt-4 leading-relaxed" style={{ color: creamSoft }} />
            <dl className="mt-8 text-sm">
              {data.address ? (
                <div className="grid grid-cols-[96px_1fr] gap-4 border-b py-3.5" style={{ borderColor: "rgba(245,239,225,0.2)" }}>
                  <dt className="font-bold uppercase" style={{ letterSpacing: "0.1em" }}>{ui.address}</dt>
                  <dd style={{ color: creamSoft }}>{data.address}</dd>
                </div>
              ) : null}
              {data.hours.length ? (
                <div className="grid grid-cols-[96px_1fr] gap-4 border-b py-3.5" style={{ borderColor: "rgba(245,239,225,0.2)" }}>
                  <dt className="font-bold uppercase" style={{ letterSpacing: "0.1em" }}>{ui.hours}</dt>
                  <dd className="space-y-1" style={{ color: creamSoft }}>
                    {data.hours.map((h) => (
                      <p key={h.day} className="flex justify-between gap-4">
                        <span>{h.day}</span>
                        <span>{h.value}</span>
                      </p>
                    ))}
                  </dd>
                </div>
              ) : null}
              {data.phone ? (
                <div className="grid grid-cols-[96px_1fr] gap-4 py-3.5">
                  <dt className="font-bold uppercase" style={{ letterSpacing: "0.1em" }}>{ui.phone}</dt>
                  <dd>
                    <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="underline underline-offset-4" style={{ color: creamSoft }}>{data.phone}</a>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-8 flex flex-wrap gap-4">
              {data.mapsHref ? (
                <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="va-btn" style={{ ...PILL, background: C.cream, color: C.redDeep }}>
                  {ui.map}
                </a>
              ) : null}
              {data.phone ? (
                <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="va-btn" style={{ ...PILL, border: "1px solid rgba(245,239,225,0.5)", color: C.cream }}>
                  {ui.phone}
                </a>
              ) : null}
            </div>
          </div>
          {mapEmbed ? (
            <div className="relative min-h-[340px]">
              <iframe src={mapEmbed} className="h-full min-h-[340px] w-full rounded-2xl" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="map" />
              <span className="absolute bottom-4 left-4 max-w-[80%] px-4 py-2 text-xs font-semibold" style={{ background: C.creamDeep, color: C.ink, borderRadius: 3, boxShadow: "0 12px 24px -12px rgba(0,0,0,0.5)" }}>
                {data.address}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full px-5 py-14" style={{ background: C.green, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr]">
          <div>
            <EditableText id="footer.brand" as="p" fallback={brand} className="text-2xl font-bold uppercase" style={{ fontFamily: DISPLAY, letterSpacing: "0.12em" }} />
            <EditableText id="footer.tagline" as="p" className="mt-2 text-sm italic" style={{ fontFamily: DISPLAY, color: creamSoft }} />
            <div className="mt-5 text-sm" style={{ color: "rgba(245,239,225,0.65)" }}>
              {data.address ? <p>{data.address}</p> : null}
              {data.phone ? <p className="mt-1">{data.phone}</p> : null}
            </div>
          </div>
          <nav className="flex flex-col gap-2.5 text-xs font-semibold uppercase md:items-end" style={{ letterSpacing: "0.12em" }}>
            <a href="#casa" className="va-link">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="va-link">{ui.fullMenu}</a>
            <a href="#reserva" className="va-link">{ui.book}</a>
            <a href="#encontrar" className="va-link">{ui.contact}</a>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl border-t pt-5 text-xs" style={{ borderColor: "rgba(245,239,225,0.15)", color: "rgba(245,239,225,0.55)" }}>
          © {new Date().getFullYear()} {brand}
        </p>
      </footer>
    </div>
  );
}
