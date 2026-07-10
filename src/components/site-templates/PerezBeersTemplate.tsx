"use client";

import type { CSSProperties } from "react";
import BookingWidget from "@/app/b/[slug]/BookingWidget";
import { EditableImage, EditableText, useBlockValue } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { PEREZBEERS_DEFAULTS } from "./defaults";

// "Pérez Beers" — replica of perez-and-beers.pages.dev: moody artisan
// beer-hall, near-black warm basalt + candle-gold + brick-red, oversized
// editorial Poppins, tilted floating photo collage, kinetic marquee.
// Every text/image renders via Editable* so the visual editor rewrites it in
// place; menu, reviews, hours and contact come from live CRM data; booking is
// the real widget. Animations are CSS-only (float, pulse, marquee).

const C = {
  basalt: "#120D0A",
  cream: "#EDE6D8",
  gold: "#DCA03C",
  goldLight: "#F0CD82",
  red: "#C5392C",
  redLight: "#E0574A",
};

const cream = (a: number) => `rgba(237,230,216,${a})`;

const DISPLAY = "'Poppins', sans-serif";
const BODY = "'Inter', sans-serif";

const CSS = `
@keyframes pb-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.pb-marquee-track { display: inline-flex; white-space: nowrap; animation: pb-marquee 22s linear infinite; }
@keyframes pb-float-a { 0%,100% { transform: translateY(0) rotate(4deg); } 50% { transform: translateY(-12px) rotate(4deg); } }
@keyframes pb-float-b { 0%,100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-10px) rotate(-8deg); } }
@keyframes pb-float-c { 0%,100% { transform: translateY(0) rotate(9deg); } 50% { transform: translateY(-14px) rotate(9deg); } }
.pb-float-a { animation: pb-float-a 7s ease-in-out infinite; }
.pb-float-b { animation: pb-float-b 8.5s ease-in-out infinite; }
.pb-float-c { animation: pb-float-c 7.6s ease-in-out infinite; }
@keyframes pb-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.pb-dot { animation: pb-pulse 1.6s ease-in-out infinite; }
.pb-btn-gold { transition: transform .2s ease, box-shadow .2s ease; }
.pb-btn-gold:hover { transform: translateY(-2px); box-shadow: 0 20px 44px -14px rgba(220,160,60,.85); }
.pb-btn-ghost { transition: background .2s ease, border-color .2s ease; }
.pb-btn-ghost:hover { background: rgba(237,230,216,.08); border-color: rgba(237,230,216,.45) !important; }
.pb-stone { border: 1px solid rgba(181,101,29,.10); background: linear-gradient(160deg, rgba(232,163,61,.05), rgba(255,255,255,.015) 40%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,.04); }
.pb-card img { transition: transform .5s ease; }
.pb-card:hover img { transform: scale(1.06); }
.pb-hours-row:hover dt { color: ${C.gold} !important; }
.pb-rule { height: 1px; background: linear-gradient(90deg, transparent, rgba(220,160,60,.7), transparent); }
`;

const eyebrow: CSSProperties = { fontFamily: BODY, fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.28em", color: C.gold };
const h2: CSSProperties = { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.08 };
const btnBase: CSSProperties = { borderRadius: 999, fontWeight: 600, display: "inline-block", padding: "0.8rem 1.7rem", fontSize: "0.95rem" };
const btnGold: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#F0CD82,#DCA03C 55%,#A5782D)", color: C.basalt };
const btnGhost: CSSProperties = { ...btnBase, border: "1px solid rgba(237,230,216,0.25)", color: C.cream };
const btnGhostSm: CSSProperties = { ...btnGhost, padding: "0.55rem 1.2rem", fontSize: "0.85rem" };

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} style={{ color: C.gold }} className="text-lg tracking-wide">
      {"★".repeat(n)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

function Marquee({ id, fallback }: { id: string; fallback: string }) {
  const raw = useBlockValue(id, fallback);
  const items = raw.split("·").map((s) => s.trim()).filter(Boolean);
  const row = (key: string) => (
    <span key={key} className="inline-flex items-center">
      {items.map((it, i) => (
        <span key={i} className="mx-5 inline-flex items-center gap-5 text-xs font-semibold uppercase" style={{ letterSpacing: "0.22em", color: cream(0.8) }}>
          {it} <span style={{ color: C.gold }}>✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="w-full overflow-hidden border-y py-3" style={{ background: "rgba(197,57,44,0.10)", borderColor: "rgba(220,160,60,0.20)" }}>
      <div className="pb-marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

export default function PerezBeersTemplate({ data }: { data: SiteData }) {
  const brand = data.tenantName;
  const ui = data.labels;
  const mapEmbed = data.address ? `https://maps.google.com/maps?q=${encodeURIComponent(data.address)}&output=embed` : "";

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: `radial-gradient(100% 70% at 50% -10%, rgba(224,160,64,0.13), transparent 58%), radial-gradient(90% 60% at 50% 112%, rgba(181,101,29,0.16), transparent 60%) ${C.basalt}`,
        color: C.cream,
        fontFamily: BODY,
      }}
    >
      <style>{CSS}</style>

      {/* Sticky nav */}
      <header className="sticky top-0 z-40 border-b backdrop-blur-md" style={{ background: "rgba(18,13,10,0.8)", borderColor: "rgba(255,255,255,0.1)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="leading-tight">
            <span className="block text-lg font-bold uppercase" style={{ fontFamily: DISPLAY, color: C.redLight, letterSpacing: "0.04em" }}>{brand}</span>
            <EditableText id="nav.subtitle" as="span" className="block text-[10px] uppercase" style={{ letterSpacing: "0.3em", color: cream(0.45) }} />
          </a>
          <nav className="hidden items-center gap-7 text-sm font-medium md:flex" style={{ color: cream(0.75) }}>
            <a href="#secreto" className="hover:opacity-70">{ui.about}</a>
            <a href="#cocina" className="hover:opacity-70">{ui.menu}</a>
            <a href="#encuentranos" className="hover:opacity-70">{ui.contact}</a>
            <a href={`/m/${data.slug}`} className="font-semibold hover:opacity-80" style={{ color: C.gold }}>{ui.fullMenu}</a>
          </nav>
          <a href="#reserva" className="pb-btn-gold" style={{ ...btnGold, padding: "0.55rem 1.3rem", fontSize: "0.85rem" }}>{ui.book}</a>
        </div>
      </header>

      {/* Hero */}
      <section
        id="top"
        className="relative flex w-full flex-col overflow-hidden"
        style={{
          minHeight: "calc(100svh - 4rem)",
          background: "radial-gradient(60% 55% at 15% 12%, rgba(232,163,61,0.30), transparent 62%), radial-gradient(55% 50% at 88% 80%, rgba(197,57,44,0.26), transparent 62%), linear-gradient(160deg,#1C130D,#120D0A 55%,#0D0907)",
        }}
      >
        <div aria-hidden className="absolute inset-x-0 top-10 z-0 overflow-hidden text-center md:top-16">
          <EditableText
            id="hero.bgword"
            as="span"
            className="uppercase"
            style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "20vw", lineHeight: 1, color: "transparent", WebkitTextStroke: `2px ${C.goldLight}`, opacity: 0.06, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}
          />
        </div>
        <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-5 py-16 md:grid-cols-[1.05fr_0.95fr] md:py-20">
          <div>
            <p className="flex items-center gap-2.5" style={eyebrow}>
              <span className="pb-dot h-2 w-2 rounded-full" style={{ background: C.redLight }} />
              <EditableText id="hero.eyebrow" />
            </p>
            <h1 className="mt-6 uppercase" style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: "clamp(2.6rem, 11vw, 6.8rem)", lineHeight: 0.85, letterSpacing: "-0.025em" }}>
              <EditableText id="hero.line1" as="span" className="block" fallback={brand} />
              <EditableText id="hero.line2" as="span" className="block italic" style={{ color: C.gold, fontWeight: 500 }} />
              <EditableText id="hero.line3" as="span" className="block" style={{ color: C.red, filter: "drop-shadow(0 6px 24px rgba(197,57,44,0.5))" }} />
            </h1>
            <EditableText id="hero.sub" as="p" className="mt-5 text-lg italic" style={{ color: cream(0.55) }} />
            <EditableText id="hero.tagline" as="p" className="mt-4 text-xl md:text-2xl" style={{ fontFamily: DISPLAY, fontWeight: 500, color: C.goldLight }} />
            <EditableText id="hero.text" as="p" className="mt-5 max-w-xl leading-relaxed" style={{ color: cream(0.7) }} />
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a href="#reserva" className="pb-btn-gold" style={btnGold}>{ui.book}</a>
              <a href={`/m/${data.slug}`} className="pb-btn-ghost" style={btnGhost}>{ui.viewMenu}</a>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[26rem] md:max-w-none">
            <div className="relative aspect-[10/11] w-full">
              <div className="pb-float-a absolute left-0 top-0 w-[60%]">
                <EditableImage id="hero.img1" alt="" className="aspect-[4/5] w-full rounded-[1.6rem] object-cover ring-1 ring-white/10" />
                <span className="absolute -left-3 top-4 -rotate-6 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest" style={{ background: C.red, color: C.cream }}>
                  <EditableText id="hero.sticker1" />
                </span>
              </div>
              <div className="pb-float-b absolute right-0 top-[6%] w-[46%]">
                <EditableImage id="hero.img2" alt="" className="aspect-square w-full rounded-[1.6rem] object-cover ring-1 ring-white/10" />
              </div>
              <div className="pb-float-c absolute bottom-0 right-[8%] w-[54%]">
                <EditableImage id="hero.img3" alt="" className="aspect-[5/4] w-full rounded-[1.6rem] object-cover ring-1 ring-white/10" />
                <span className="absolute -right-3 top-3 rotate-6 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest" style={{ background: C.gold, color: C.basalt }}>
                  <EditableText id="hero.sticker2" />
                </span>
              </div>
            </div>
          </div>
        </div>
        <Marquee id="marquee.text" fallback={PEREZBEERS_DEFAULTS["marquee.text"]} />
      </section>

      {/* La puerta de Vegueta */}
      <section id="secreto" className="w-full px-5 py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <EditableText id="secreto.eyebrow" as="p" style={eyebrow} />
            <EditableText id="secreto.title" as="h2" className="mt-4 text-4xl md:text-5xl" style={h2} />
            <div className="pb-rule my-7" />
            <EditableText id="secreto.p1" as="p" className="leading-relaxed" style={{ color: cream(0.7) }} />
            <EditableText id="secreto.p2" as="p" className="mt-4 leading-relaxed" style={{ color: "rgba(220,160,60,0.9)" }} />
            <div className="mt-9 flex items-center gap-8">
              <div>
                <EditableText id="secreto.stat1" as="p" className="text-3xl" style={{ fontFamily: DISPLAY, fontWeight: 700, color: C.goldLight }} />
                <EditableText id="secreto.stat1Label" as="p" className="mt-1 text-xs uppercase" style={{ letterSpacing: "0.24em", color: cream(0.45) }} />
              </div>
              <div className="h-12 w-px" style={{ background: cream(0.15) }} />
              <div>
                <EditableText id="secreto.stat2" as="p" className="text-3xl" style={{ fontFamily: DISPLAY, fontWeight: 700, color: C.goldLight }} />
                <EditableText id="secreto.stat2Label" as="p" className="mt-1 text-xs uppercase" style={{ letterSpacing: "0.24em", color: cream(0.45) }} />
              </div>
            </div>
          </div>
          <EditableImage id="secreto.image" alt="" className="aspect-[4/5] w-full rounded-[1.6rem] object-cover ring-1 ring-white/10" />
        </div>
      </section>

      {/* La bóveda */}
      <section id="cervezas" className="w-full border-y px-5 py-20 text-center md:py-28" style={{ background: "rgba(26,20,16,0.4)", borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="mx-auto max-w-3xl">
          <EditableText id="cervezas.eyebrow" as="p" style={eyebrow} />
          <p className="mt-6" style={{ fontFamily: DISPLAY, fontWeight: 700, lineHeight: 1 }}>
            <EditableText id="cervezas.number" as="span" className="text-7xl md:text-8xl" style={{ color: C.gold, letterSpacing: "-0.025em" }} />
            <span className="text-5xl md:text-6xl" style={{ color: C.goldLight }}>+</span>
          </p>
          <EditableText id="cervezas.label" as="p" className="mt-2 text-sm uppercase" style={{ letterSpacing: "0.24em", color: cream(0.55) }} />
          <EditableText id="cervezas.title" as="h2" className="mt-8 text-3xl md:text-4xl" style={h2} />
          <EditableText id="cervezas.text" as="p" className="mx-auto mt-4 max-w-xl leading-relaxed" style={{ color: cream(0.7) }} />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {["cervezas.chip1", "cervezas.chip2", "cervezas.chip3", "cervezas.chip4"].map((id) => (
              <span key={id} className="rounded-full border px-4 py-1.5 text-sm" style={{ borderColor: "rgba(220,160,60,0.3)", background: "rgba(220,160,60,0.05)", color: cream(0.8) }}>
                <EditableText id={id} />
              </span>
            ))}
          </div>
          <a href={`/m/${data.slug}`} className="pb-btn-ghost mt-10" style={btnGhost}>{ui.viewMenu}</a>
        </div>
      </section>

      {/* Cocina (live CRM data) */}
      {data.menuItems.length ? (
        <section id="cocina" className="w-full px-5 py-20 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-xl">
                <EditableText id="cocina.eyebrow" as="p" style={eyebrow} />
                <EditableText id="cocina.title" as="h2" className="mt-4 text-4xl md:text-5xl" style={h2} />
                <EditableText id="cocina.text" as="p" className="mt-4 leading-relaxed" style={{ color: cream(0.7) }} />
              </div>
              <a href={`/m/${data.slug}`} className="text-sm font-semibold hover:underline" style={{ color: C.gold }}>{ui.fullMenu} →</a>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.menuItems.map((it) => (
                <article key={it.id} className="pb-stone pb-card overflow-hidden rounded-2xl p-4">
                  {it.image_url ? (
                    <div className="aspect-[5/4] overflow-hidden rounded-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : null}
                  <div className="mt-4 flex items-start justify-between gap-3 px-1 pb-1">
                    <div>
                      <h3 className="text-xl" style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: "-0.025em" }}>{it.name}</h3>
                      {it.description ? <p className="mt-1 text-sm leading-snug line-clamp-2" style={{ color: cream(0.65) }}>{it.description}</p> : null}
                    </div>
                    {it.price != null ? <span className="shrink-0 font-semibold" style={{ color: C.gold }}>{formatSitePrice(it.price, it.currency)}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Jueves de pinchos — full-bleed photo ritual */}
      <section id="jueves" className="relative w-full overflow-hidden px-5 py-24 md:py-36">
        <EditableImage id="jueves.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "rgba(0,0,0,0.75)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(18,13,10,0.92), rgba(18,13,10,0.25))" }} />
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="max-w-xl">
            <EditableText id="jueves.eyebrow" as="p" style={eyebrow} />
            <EditableText id="jueves.title" as="h2" className="mt-4 text-4xl md:text-5xl" style={h2} />
            <EditableText id="jueves.text" as="p" className="mt-4 leading-relaxed" style={{ color: cream(0.75) }} />
            <ul className="mt-7 space-y-3">
              {["jueves.item1", "jueves.item2", "jueves.item3"].map((id) => (
                <li key={id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: "rgba(220,160,60,0.15)", border: "1px solid rgba(220,160,60,0.35)", color: C.goldLight }}>✦</span>
                  <EditableText id={id} as="span" style={{ color: cream(0.85) }} />
                </li>
              ))}
            </ul>
            <a href="#reserva" className="pb-btn-gold mt-9" style={btnGold}>{ui.book}</a>
          </div>
        </div>
      </section>

      {/* Booking — real CRM widget */}
      <section id="reserva" className="relative w-full overflow-hidden px-5 py-20 md:py-28" style={{ background: "linear-gradient(135deg,#1F1610 0%,#2A1D15 55%,#1C1410 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(50% 60% at 12% 10%, rgba(232,163,61,0.14), transparent 60%), radial-gradient(45% 55% at 90% 88%, rgba(197,57,44,0.14), transparent 60%)" }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
          <div>
            <EditableText id="reserva.eyebrow" as="p" style={eyebrow} />
            <EditableText id="reserva.title" as="h2" className="mt-4 text-4xl md:text-5xl" style={h2} />
            <EditableText id="reserva.text" as="p" className="mt-4 max-w-md leading-relaxed" style={{ color: cream(0.7) }} />
            {data.giftCardsEnabled ? (
              <a href={`/g/${data.slug}`} className="mt-7 inline-flex items-center gap-2 text-sm font-semibold hover:underline" style={{ color: C.goldLight }}>🎁 {ui.giftCta}</a>
            ) : null}
          </div>
          <div className="relative">
            <div aria-hidden className="pointer-events-none absolute -inset-4 rounded-[2.2rem] blur-2xl" style={{ background: "linear-gradient(135deg, rgba(240,205,130,0.35), rgba(197,57,44,0.3))" }} />
            <div className="relative rounded-[1.8rem] p-6 md:p-8" style={{ background: "#FAF6EE", color: C.basalt }}>
              <h3 className="text-xl" style={{ fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "-0.025em" }}>{data.bookingStrings.title}</h3>
              <BookingWidget slug={data.slug} accent="#C5392C" strings={data.bookingStrings} />
            </div>
          </div>
        </div>
      </section>

      {/* Reviews (live CRM data) */}
      <section id="reviews" className="w-full border-y px-5 py-20 md:py-28" style={{ background: "rgba(26,20,16,0.4)", borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="mx-auto max-w-6xl text-center">
          <EditableText id="reviews.eyebrow" as="p" style={eyebrow} />
          <EditableText id="reviews.title" as="h2" className="mt-4 text-4xl md:text-5xl" style={h2} />
          {data.reviews.length ? (
            <div className="mt-12 grid gap-6 text-left sm:grid-cols-2 lg:grid-cols-3">
              {data.reviews.slice(0, 3).map((r, i) => (
                <figure key={i} className="pb-stone rounded-2xl p-6">
                  <Stars n={r.rating} />
                  <blockquote className="mt-3 leading-relaxed" style={{ color: cream(0.8) }}>“{r.comment}”</blockquote>
                  <figcaption className="mt-4 text-sm font-semibold" style={{ color: C.goldLight }}>— {r.author}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="mt-6" style={{ color: cream(0.55) }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="pb-btn-ghost mt-10" style={btnGhost}>Google ★ — {ui.reviews}</a>
          ) : null}
        </div>
      </section>

      {/* Encuéntranos: hours + contact + map (live CRM data) */}
      <section id="encuentranos" className="w-full px-5 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <EditableText id="encuentranos.eyebrow" as="p" style={eyebrow} />
          <EditableText id="encuentranos.title" as="h2" className="mt-4 text-4xl md:text-5xl" style={h2} />
          <EditableImage id="encuentranos.image" alt="" className="mt-10 aspect-[16/7] w-full rounded-2xl border border-white/10 object-cover" />
          <div className="mt-8 grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
            <div className="grid content-start gap-6">
              {data.hours.length ? (
                <div className="pb-stone rounded-2xl p-6">
                  <h3 className="text-lg" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>{ui.hours}</h3>
                  <dl className="mt-4 divide-y" style={{ borderColor: cream(0.08) }}>
                    {data.hours.map((h) => (
                      <div key={h.day} className="pb-hours-row flex items-center justify-between py-2 text-sm" style={{ borderColor: cream(0.08) }}>
                        <dt className="font-semibold" style={{ color: cream(0.85) }}>{h.day}</dt>
                        <dd style={{ color: cream(0.55) }}>{h.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <div className="pb-stone rounded-2xl p-6">
                <h3 className="text-lg" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>{ui.contact}</h3>
                {data.address ? <p className="mt-3 text-sm leading-relaxed" style={{ color: cream(0.75) }}>{data.address}</p> : null}
                <EditableText id="encuentranos.note" as="p" className="mt-1 text-sm" style={{ color: cream(0.45) }} />
                <div className="mt-5 flex flex-wrap gap-3">
                  {data.phone ? <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="pb-btn-ghost" style={btnGhostSm}>{data.phone}</a> : null}
                  {data.mapsHref ? <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="pb-btn-ghost" style={btnGhostSm}>{ui.map}</a> : null}
                </div>
              </div>
            </div>
            {mapEmbed ? (
              <iframe
                src={mapEmbed}
                className="min-h-[420px] w-full rounded-2xl"
                style={{ border: "1px solid rgba(255,255,255,0.1)", filter: "grayscale(0.3) contrast(1.05)" }}
                loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="map"
              />
            ) : null}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t px-5 py-14" style={{ background: C.basalt, borderColor: "rgba(255,255,255,0.1)" }}>
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div>
            <p className="text-xl font-bold uppercase" style={{ fontFamily: DISPLAY, color: C.redLight, letterSpacing: "0.04em" }}>{brand}</p>
            <EditableText id="footer.tagline" as="p" className="mt-2 text-sm italic" style={{ color: cream(0.55) }} />
            {data.phone || data.address ? (
              <p className="mt-3 text-sm" style={{ color: cream(0.45) }}>{[data.phone, data.address].filter(Boolean).join(" · ")}</p>
            ) : null}
          </div>
          <nav className="flex gap-6 text-sm font-semibold">
            <a href={`/m/${data.slug}`} className="hover:underline" style={{ color: C.gold }}>{ui.fullMenu}</a>
            <a href="#reserva" className="hover:underline" style={{ color: cream(0.8) }}>{ui.book}</a>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl border-t pt-5 text-xs" style={{ borderColor: "rgba(255,255,255,0.08)", color: cream(0.4) }}>
          © {new Date().getFullYear()} {brand}
        </p>
      </footer>
    </div>
  );
}
