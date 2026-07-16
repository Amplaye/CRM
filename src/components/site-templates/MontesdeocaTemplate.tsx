"use client";

import type { CSSProperties } from "react";
import { BookingCta } from "@/components/site-templates/FloatingBookingWidget";
import { dishCardProps } from "@/components/site-templates/SiteMenuOverlay";
import { EditableImage, EditableText } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { MONTESDEOCA_DEFAULTS } from "./defaults";

// "Montesdeoca" — replica of casa-montesdeoca.pages.dev: candlelit 16th-century
// Canarian palace restaurant. Dark editorial slow-luxury: espresso/verde/vino
// grounds, brass hairlines, ghost typography, zero border-radius. Every
// text/image renders via Editable*; menu, reviews, hours and contact come from
// live CRM data; booking is the real widget inside the piedra invitation card.

// The three editable "key" colours read from the palette cascade (--c1/2/3)
// with the built-in hex as fallback, so an unset palette looks unchanged.
const C = {
  espresso: "var(--c1, #1c1712)",
  verde: "var(--c4, #2e3d32)",
  vino: "var(--c5, #5a2a33)",
  piedra: "var(--c3, #efe7d6)",
  laton: "var(--c2, #b08d4f)",
  terracota: "var(--c6, #a8553a)",
};

const DISPLAY = "'Cormorant Garamond', serif";
const BODY = "'EB Garamond', serif";

const CSS = `
@keyframes mo-kenburns { from { transform: scale(1); } to { transform: scale(1.08); } }
.mo-kenburns { animation: mo-kenburns 20s ease-in-out infinite alternate; }
@keyframes mo-petalFall { 0% { transform: translateY(-6vh) rotate(0deg); opacity: 0; } 12% { opacity: .85; } 100% { transform: translateY(82vh) rotate(320deg); opacity: 0; } }
.mo-petal { position: absolute; top: 0; border-radius: 50%; animation: mo-petalFall linear infinite; pointer-events: none; }
@keyframes mo-scrollLine { 0%, 100% { height: 20px; opacity: .25; } 50% { height: 54px; opacity: 1; } }
.mo-scroll-line { display: block; width: 1px; background: ${C.laton}; animation: mo-scrollLine 2.6s ease-in-out infinite; }
.mo-btn { transition: background .35s ease, color .35s ease, border-color .35s ease; }
.mo-btn:hover { background: ${C.laton} !important; color: ${C.espresso} !important; border-color: ${C.laton} !important; }
.mo-navlink { color: rgba(239,231,214,0.7); transition: color .3s ease; }
.mo-navlink:hover { color: ${C.piedra}; }
.mo-flink { color: rgba(239,231,214,0.5); transition: color .3s ease; }
.mo-flink:hover { color: ${C.laton}; }
.mo-gold { color: ${C.laton}; transition: color .3s ease; }
.mo-gold:hover { color: ${C.piedra}; }
.mo-dish-name, .mo-wine-name { transition: color .3s ease; }
.mo-dish:hover .mo-dish-name { color: ${C.laton}; }
.mo-wine:hover .mo-wine-name { color: ${C.laton}; text-decoration: underline; text-underline-offset: 6px; text-decoration-thickness: 1px; }
.mo-frame img { transition: transform 1.2s ease; }
.mo-frame:hover img { transform: scale(1.05); }
.mo-tile img { transition: transform .7s ease; }
.mo-tile:hover img { transform: scale(1.05); }
.mo-tile::after { content: ""; position: absolute; inset: 0; background: rgba(28,23,18,0.3); opacity: 0; transition: opacity .5s ease; pointer-events: none; z-index: 1; }
.mo-tile:hover::after { opacity: 1; }
.mo-cap { transform: translateY(100%); opacity: 0; transition: transform .5s ease, opacity .5s ease; z-index: 2; }
.mo-tile:hover .mo-cap { transform: translateY(0); opacity: 1; }
.mo-root section[id] { scroll-margin-top: 76px; }
`;

const BEATS = ["casa1", "casa2", "casa3"] as const;
const ROMAN = ["I", "II", "III"] as const;
const GALLERY = ["gal1", "gal2", "gal3", "gal4", "gal5", "gal6"] as const;
const PETALS: { left: string; s: number; d: number; delay: number; c: string }[] = [
  { left: "6%", s: 10, d: 8, delay: 0, c: "#c45e8a" },
  { left: "16%", s: 7, d: 11, delay: 2.5, c: "#d4729e" },
  { left: "34%", s: 9, d: 9, delay: 4, c: "#bf4d7f" },
  { left: "52%", s: 6, d: 10, delay: 1.2, c: "#d4729e" },
  { left: "68%", s: 11, d: 7, delay: 3.5, c: "#c45e8a" },
  { left: "81%", s: 8, d: 9.5, delay: 5.5, c: "#bf4d7f" },
  { left: "93%", s: 6, d: 11, delay: 0.7, c: "#d4729e" },
];

const btn = (ghost?: boolean): CSSProperties => ({
  display: "inline-block", padding: "0.85rem 2.2rem", fontSize: "0.8rem", letterSpacing: "0.18em", textTransform: "uppercase",
  border: `1px solid ${ghost ? "rgba(239,231,214,0.3)" : C.laton}`, color: ghost ? C.piedra : C.laton,
});

const hairline = (a: number): string => `1px solid rgba(176,141,79,${a})`;
const ink = (a: number): string => `rgba(239,231,214,${a})`;

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} className="text-base" style={{ color: C.laton, letterSpacing: "0.35em" }}>
      {"★".repeat(n)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

function Rule({ className = "" }: { className?: string }) {
  return <div className={className} style={{ width: 48, height: 1, background: C.laton }} />;
}

function Kicker({ id, className = "", ls = "0.35em" }: { id: string; className?: string; ls?: string }) {
  return <EditableText id={id} as="p" className={`text-xs uppercase ${className}`} style={{ letterSpacing: ls, color: C.laton }} />;
}

function Heading({ k, t, ls, italic, center, titleClass = "text-4xl md:text-5xl" }: { k: string; t: string; ls?: string; italic?: boolean; center?: boolean; titleClass?: string }) {
  return (
    <div className={center ? "text-center" : undefined}>
      <Kicker id={k} ls={ls} />
      <EditableText id={t} as="h2" className={`mt-4 ${italic ? "italic" : ""} ${titleClass}`} style={{ fontFamily: DISPLAY, fontWeight: 300, lineHeight: 1.1, color: C.piedra }} />
      <Rule className={`mt-7 ${center ? "mx-auto" : ""}`} />
    </div>
  );
}

export default function MontesdeocaTemplate({ data }: { data: SiteData }) {
  const brand = data.tenantName;
  const ui = data.labels;
  const monogram = brand.trim().charAt(0).toUpperCase();
  const mapEmbed = data.address ? `https://maps.google.com/maps?q=${encodeURIComponent(data.address)}&output=embed` : "";
  const infoTitle = (txt: string) => <h3 className="text-xs uppercase" style={{ letterSpacing: "0.3em", color: C.laton }}>{txt}</h3>;

  return (
    <div className="mo-root min-h-screen w-full overflow-x-clip" style={{ background: C.espresso, color: C.piedra, fontFamily: BODY }}>
      <style>{CSS}</style>

      {/* Fixed nav */}
      <header className="fixed inset-x-0 top-0 z-50" style={{ background: "rgba(28,23,18,0.95)", backdropFilter: "blur(8px)", borderBottom: hairline(0.15) }}>
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5">
          <a href="#inicio" className="text-lg uppercase" style={{ fontFamily: DISPLAY, letterSpacing: "0.25em", color: C.piedra }}>{brand}</a>
          <nav className="hidden items-center gap-8 text-xs uppercase md:flex" style={{ letterSpacing: "0.22em" }}>
            <a href="#la-casa" className="mo-navlink"><EditableText id="nav.casa" /></a>
            <a href="#el-patio" className="mo-navlink"><EditableText id="nav.patio" /></a>
            {data.menuItems.length ? <a href="#la-cocina" className="mo-navlink"><EditableText id="nav.cocina" /></a> : null}
            <a href={`/m/${data.slug}`} className="mo-navlink">{ui.fullMenu}</a>
            <a href="#reservar" className="mo-navlink">{ui.book}</a>
          </nav>
          <a href="#reservar" className="mo-navlink text-xs uppercase md:hidden" style={{ letterSpacing: "0.22em" }}>{ui.book}</a>
        </div>
      </header>

      {/* Hero — full-bleed 100svh, Ken Burns */}
      <section id="inicio" className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden">
        <EditableImage id="hero.image" alt="" className="mo-kenburns absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(rgba(28,23,18,0.45), rgba(28,23,18,0.65))" }} />
        <div className="relative z-10 px-6 py-28 text-center">
          <Kicker id="hero.kicker" className="text-center" />
          <h1 className="mt-8 uppercase" style={{ fontFamily: DISPLAY, fontWeight: 300, letterSpacing: "0.18em", fontSize: "clamp(3rem, 7vw, 7rem)", lineHeight: 1.08, color: C.piedra }}>
            <EditableText id="hero.title1" as="span" className="block" fallback={data.tenantName.split(" ")[0]} />
            <EditableText id="hero.title2" as="span" className="block" fallback={data.tenantName.split(" ").slice(1).join(" ")} />
          </h1>
          <Rule className="mx-auto mt-8" />
          <EditableText id="hero.subtitle" as="p" className="mt-6 text-sm uppercase" style={{ letterSpacing: "0.3em", color: ink(0.7) }} />
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <a href={`/m/${data.slug}`} className="mo-btn" style={btn()}>{ui.viewMenu}</a>
            <a href="#reservar" className="mo-btn" style={btn(true)}>{ui.book}</a>
          </div>
        </div>
        <div className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
          <EditableText id="hero.scroll" as="span" className="text-[0.65rem] uppercase" style={{ letterSpacing: "0.35em", color: ink(0.6) }} />
          <span className="mo-scroll-line" />
        </div>
      </section>

      {/* La Casa — historia in 3 static beats, ghost numerals */}
      <section id="la-casa" className="w-full px-5 py-24 md:py-32" style={{ background: C.espresso }}>
        <div className="mx-auto max-w-6xl">
          {BEATS.map((b, i) => (
            <div key={b} className={`grid items-center gap-10 md:grid-cols-2 md:gap-16 ${i ? "mt-24 md:mt-32" : ""}`}>
              <EditableImage id={`${b}.image`} alt="" className={`aspect-[4/3] w-full object-cover ${i % 2 ? "md:order-2" : ""}`} />
              <div className="relative">
                <span aria-hidden className="absolute -left-2 -top-24 select-none leading-none" style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: "clamp(6rem, 14vw, 12rem)", color: "rgba(176,141,79,0.12)" }}>
                  <EditableText id={`${b}.num`} />
                </span>
                <div className="relative z-10">
                  <Heading k={`${b}.kicker`} t={`${b}.title`} titleClass="text-3xl md:text-4xl" />
                  <EditableText id={`${b}.text`} as="p" className="mt-7 max-w-md text-lg" style={{ lineHeight: 1.8, color: ink(0.6) }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* El Patio — verde, falling petals */}
      <section id="el-patio" className="relative flex min-h-[80vh] w-full items-center overflow-hidden px-5 py-24 md:py-32" style={{ background: C.verde }}>
        <EditableImage id="patio.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(110deg, rgba(28,23,18,0.82), rgba(28,23,18,0.55) 45%, rgba(46,61,50,0.45))" }} />
        {PETALS.map((p, i) => (
          <span key={i} aria-hidden className="mo-petal" style={{ left: p.left, width: p.s, height: p.s, background: p.c, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }} />
        ))}
        <div className="relative z-10 mx-auto w-full max-w-6xl">
          <div className="max-w-lg">
            <Kicker id="patio.kicker" />
            <EditableText id="patio.quote" as="blockquote" className="mt-6 italic" style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: "clamp(2.2rem, 5vw, 3.6rem)", lineHeight: 1.15, color: C.piedra }} />
            <Rule className="mt-8" />
            <EditableText id="patio.text" as="p" className="mt-7 text-lg" style={{ lineHeight: 1.8, color: ink(0.7) }} />
          </div>
        </div>
      </section>

      {/* La Cocina — live menu as hairline list (hides when empty) */}
      {data.menuItems.length ? (
        <section id="la-cocina" className="w-full px-5 py-24 md:py-32" style={{ background: C.espresso }}>
          <div className="mx-auto max-w-3xl">
            <Heading k="cocina.kicker" t="cocina.title" italic center />
            <div className="mt-14" style={{ borderBottom: hairline(0.18) }}>
              {data.menuItems.map((it, i) => (
                <div key={it.id} {...dishCardProps(it.id)} className="mo-dish flex items-center gap-5 py-6 md:gap-7" style={{ borderTop: hairline(0.18), cursor: "pointer" }}>
                  <span className="text-sm" style={{ fontFamily: DISPLAY, color: C.laton }}>{String(i + 1).padStart(2, "0")}</span>
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_url} alt={it.name} loading="lazy" className="h-16 w-16 shrink-0 rounded-full object-cover" style={{ border: hairline(0.5) }} />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="mo-dish-name text-2xl" style={{ fontFamily: DISPLAY, color: C.piedra }}>{it.name}</p>
                    {it.description ? <p className="mt-1 text-sm line-clamp-2" style={{ color: ink(0.45) }}>{it.description}</p> : null}
                  </div>
                  {it.price != null ? <span className="shrink-0 text-lg" style={{ fontFamily: DISPLAY, color: C.laton }}>{formatSitePrice(it.price, it.currency)}</span> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* La Bodega — vino, framed image + editable wine list */}
      <section id="la-bodega" className="w-full px-5 py-24 md:py-32" style={{ background: C.vino }}>
        <div className="mx-auto max-w-6xl">
          <Heading k="bodega.kicker" t="bodega.title" ls="0.4em" center titleClass="text-5xl md:text-7xl" />
          <EditableText id="bodega.tagline" as="p" className="mt-6 text-center text-lg italic" style={{ fontFamily: DISPLAY, color: ink(0.7) }} />
          <div className="mt-16 grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-14">
            <div className="mo-frame p-[10px]" style={{ border: hairline(0.25) }}>
              <div className="relative overflow-hidden">
                <EditableImage id="bodega.image" alt="" className="aspect-[4/5] w-full object-cover" />
                <div className="absolute bottom-4 left-4 px-4 py-2" style={{ backdropFilter: "blur(6px)", background: "rgba(28,23,18,0.55)", border: hairline(0.35) }}>
                  <EditableText id="bodega.caption" as="p" className="text-[0.65rem] uppercase" style={{ letterSpacing: "0.25em", color: C.piedra }} />
                </div>
              </div>
            </div>
            <div>
              <div style={{ borderBottom: hairline(0.25) }}>
                {ROMAN.map((r, n) => (
                  <div key={r} className="mo-wine flex items-baseline justify-between gap-6 py-7" style={{ borderTop: hairline(0.25) }}>
                    <div className="flex items-baseline gap-5">
                      <span className="w-7 shrink-0 text-sm" style={{ fontFamily: DISPLAY, color: ink(0.4) }}>{r}</span>
                      <div>
                        <EditableText id={`bodega${n + 1}.type`} as="span" className="inline-block px-2 py-0.5 text-[0.6rem] uppercase" style={{ letterSpacing: "0.3em", color: C.laton, border: hairline(0.4) }} />
                        <EditableText id={`bodega${n + 1}.name`} as="p" className="mo-wine-name mt-2 text-2xl" style={{ fontFamily: DISPLAY, color: C.piedra }} />
                        <EditableText id={`bodega${n + 1}.detail`} as="p" className="mt-1 text-sm italic" style={{ color: ink(0.55) }} />
                      </div>
                    </div>
                    <EditableText id={`bodega${n + 1}.price`} as="span" className="shrink-0 text-lg" style={{ fontFamily: DISPLAY, color: C.laton }} />
                  </div>
                ))}
              </div>
              <a href={`/m/${data.slug}`} className="mo-gold mt-8 inline-block text-sm uppercase underline underline-offset-8" style={{ letterSpacing: "0.2em" }}>{ui.fullMenu} →</a>
            </div>
          </div>
        </div>
      </section>

      {/* Galería — editable tiles, captions slide up */}
      <section id="galeria" className="w-full px-5 py-24 md:py-32" style={{ background: C.espresso }}>
        <div className="mx-auto max-w-6xl">
          <Heading k="galeria.kicker" t="galeria.title" />
          <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" style={{ gridAutoRows: "280px" }}>
            {GALLERY.map((g, i) => (
              <figure key={g} className={`mo-tile relative overflow-hidden ${i === 0 ? "sm:col-span-2" : ""}`}>
                <EditableImage id={`${g}.image`} alt="" className="h-full w-full object-cover" />
                <figcaption className="mo-cap absolute inset-x-0 bottom-0 px-5 pb-4 pt-10" style={{ background: "linear-gradient(transparent, rgba(28,23,18,0.9))" }}>
                  <EditableText id={`${g}.caption`} className="text-[0.65rem] uppercase" style={{ letterSpacing: "0.25em", color: C.piedra }} />
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Reservar — piedra invitation card + wax seal + real widget */}
      <section id="reservar" className="relative w-full overflow-hidden px-5 py-24 md:py-32" style={{ background: C.espresso }}>
        <EditableImage id="reservar.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "rgba(28,23,18,0.85)" }} />
        <div className="relative z-10 mx-auto max-w-xl pt-9">
          <div className="relative px-7 pb-9 pt-14 text-center md:px-12" style={{ background: C.piedra, borderRadius: 2, boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(176,141,79,0.5)" }}>
            <div className="absolute -top-9 left-1/2 flex h-[72px] w-[72px] -translate-x-1/2 items-center justify-center rounded-full" style={{ background: C.vino, boxShadow: "0 12px 28px rgba(0,0,0,0.5)" }}>
              <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full" style={{ border: "1px solid rgba(239,231,214,0.4)" }}>
                <span className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-2xl" style={{ border: "1px solid rgba(239,231,214,0.2)", fontFamily: DISPLAY, color: C.piedra }}>{monogram}</span>
              </span>
            </div>
            <EditableText id="reservar.title" as="h2" className="text-3xl md:text-4xl" style={{ fontFamily: DISPLAY, fontWeight: 400, color: C.espresso }} />
            <EditableText id="reservar.text" as="p" className="mx-auto mt-3 max-w-sm text-sm" style={{ lineHeight: 1.7, color: "rgb(28,23,18)" }} />
            <div className="mt-6">
              <BookingCta className="mo-btn" style={btn(false)}>{data.bookingStrings.title}</BookingCta>
            </div>
          </div>
          {data.giftCardsEnabled ? (
            <p className="mt-9 text-center">
              <a href={`/g/${data.slug}`} className="mo-gold text-xs uppercase" style={{ letterSpacing: "0.25em" }}>{ui.giftCta} →</a>
            </p>
          ) : null}
        </div>
      </section>

      {/* Opiniones — live reviews as centered quotes */}
      <section id="opiniones" className="w-full px-5 py-24 md:py-32" style={{ background: C.espresso, borderTop: hairline(0.12) }}>
        <div className="mx-auto max-w-3xl text-center">
          <Heading k="reviews.kicker" t="reviews.title" center />
          {data.reviews.length ? (
            <div className="mt-10">
              {data.reviews.slice(0, 3).map((r, i) => (
                <figure key={i} className="py-10" style={i ? { borderTop: hairline(0.18) } : undefined}>
                  <Stars n={r.rating} />
                  <blockquote className="mt-5 text-xl italic md:text-2xl" style={{ fontFamily: DISPLAY, fontWeight: 300, lineHeight: 1.6, color: C.piedra }}>“{r.comment}”</blockquote>
                  <figcaption className="mt-5 text-xs uppercase" style={{ letterSpacing: "0.3em", color: ink(0.45) }}>{r.author}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="mt-8" style={{ color: ink(0.55) }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="mo-btn mt-8" style={btn()}>Google ★ · {ui.reviews}</a>
          ) : null}
        </div>
      </section>

      {/* Encuéntranos — verde, live hours/contact + map */}
      <section id="encuentranos" className="w-full px-5 py-24 md:py-32" style={{ background: C.verde }}>
        <div className="mx-auto max-w-6xl">
          <Heading k="visit.kicker" t="visit.title" />
          <div className="mt-12 grid lg:grid-cols-[5fr_7fr]" style={{ border: hairline(0.2), background: "rgba(28,23,18,0.18)" }}>
            <div className="p-8 md:p-12">
              {data.address ? (
                <div>
                  {infoTitle(ui.address)}
                  <p className="mt-3 text-lg" style={{ fontFamily: DISPLAY, color: C.piedra }}>{data.address}</p>
                </div>
              ) : null}
              {data.hours.length ? (
                <div className="mt-10">
                  {infoTitle(ui.hours)}
                  <dl className="mt-3">
                    {data.hours.map((h) => (
                      <div key={h.day} className="flex items-baseline justify-between gap-6 py-1.5 text-sm" style={{ borderBottom: hairline(0.12) }}>
                        <dt style={{ color: ink(0.8) }}>{h.day}</dt>
                        <dd className="text-right" style={{ color: ink(0.5) }}>{h.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              {data.phone ? (
                <div className="mt-10">
                  {infoTitle(ui.contact)}
                  <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="mo-gold mt-3 inline-block text-lg" style={{ fontFamily: DISPLAY }}>{data.phone}</a>
                </div>
              ) : null}
            </div>
            <div className="relative min-h-[320px]">
              {mapEmbed ? (
                <iframe src={mapEmbed} title="map" loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="absolute inset-0 h-full w-full" style={{ border: 0 }} />
              ) : null}
              {data.mapsHref ? (
                <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="mo-btn absolute bottom-5 left-5 px-5 py-2.5 text-[0.7rem] uppercase" style={{ letterSpacing: "0.2em", color: C.piedra, border: hairline(0.45), background: "rgba(28,23,18,0.6)", backdropFilter: "blur(6px)" }}>{ui.map} →</a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Footer — ghost wordmark */}
      <footer className="w-full overflow-hidden px-5 pb-10 pt-20 text-center" style={{ background: C.espresso, borderTop: hairline(0.15) }}>
        <p aria-hidden className="select-none whitespace-nowrap uppercase leading-none" style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: "clamp(2.5rem, 8vw, 7rem)", letterSpacing: "0.3em", color: "rgba(239,231,214,0.08)" }}>{brand}</p>
        <div className="mx-auto mt-10" style={{ width: 40, height: 1, background: "rgba(176,141,79,0.3)" }} />
        <nav className="mt-8 flex flex-wrap items-center justify-center gap-8 text-xs uppercase" style={{ letterSpacing: "0.25em" }}>
          <a href={`/m/${data.slug}`} className="mo-flink">{ui.fullMenu}</a>
          <a href="#reservar" className="mo-flink">{ui.book}</a>
        </nav>
        <p className="mt-9 text-xs" style={{ color: ink(0.35) }}>© {new Date().getFullYear()} {brand}{data.address ? ` · ${data.address}` : ""}</p>
      </footer>
    </div>
  );
}
