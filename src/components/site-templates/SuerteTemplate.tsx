"use client";

import type { CSSProperties } from "react";
import BookingWidget from "@/app/b/[slug]/BookingWidget";
import { EditableImage, EditableText, useBlockValue } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { SUERTE_DEFAULTS } from "./defaults";

// "La Suerte" — replica of la-suerte-17.pages.dev: warm Italian neighborhood
// trattoria, cream paper + hand-drawn neobrutalism (thick ink borders, hard
// offset shadows, marquees, wobbly rotations). Every text/image renders via
// Editable* so the visual editor can rewrite it in place; menu, reviews,
// hours and contact come from live CRM data; booking is the real widget.

const C = {
  cream: "#f4ecdd",
  creamDeep: "#ece0c9",
  charcoal: "#2a2420",
  soft: "#4a4038",
  tomato: "#c0432b",
  mustard: "#d69a3c",
  basil: "#2f5a3a",
  tile: "#2e6e8e",
  tileDeep: "#235775",
};

const DISPLAY = "'Fraunces', serif";
const BODY = "'Space Grotesk', sans-serif";
const SCRIPT = "'Caveat', cursive";

const CSS = `
@keyframes su-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.su-marquee-track { display: inline-flex; white-space: nowrap; animation: su-marquee 26s linear infinite; }
.su-btn { transition: box-shadow .2s ease, transform .2s ease, background .2s ease, color .2s ease; }
.su-btn:hover { box-shadow: 1px 1px 0 ${C.charcoal} !important; transform: translate(2px, 2px); }
.su-outline-btn:hover { background: ${C.charcoal} !important; color: ${C.cream} !important; }
.su-card { transition: transform .25s ease; }
.su-card:hover { transform: translateY(-4px) rotate(-1deg); }
.su-card img { transition: transform .5s ease; }
.su-card:hover img { transform: scale(1.05); }
`;

function Stars({ n, color = C.mustard }: { n: number; color?: string }) {
  return (
    <span aria-label={`${n}/5`} style={{ color }} className="text-lg tracking-wide">
      {"★".repeat(n)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

function Marquee({ id, fallback, bg = C.tileDeep }: { id: string; fallback: string; bg?: string }) {
  const raw = useBlockValue(id, fallback);
  const items = raw.split("·").map((s) => s.trim()).filter(Boolean);
  const row = (key: string) => (
    <span key={key} className="inline-flex items-center">
      {items.map((it, i) => (
        <span key={i} className="mx-4 inline-flex items-center gap-4 text-sm font-semibold uppercase tracking-wide">
          {it} <span style={{ color: C.mustard }}>✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="w-full overflow-hidden border-y-2 py-2.5" style={{ background: bg, color: C.cream, borderColor: "rgba(42,36,32,0.15)" }}>
      <div className="su-marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

export default function SuerteTemplate({ data }: { data: SiteData }) {
  const brand = data.tenantName;
  const ui = data.labels;
  const mapEmbed = data.address ? `https://www.google.com/maps?q=${encodeURIComponent(data.address)}&output=embed` : "";

  const pill = (bg: string, fg: string, shadow: string): CSSProperties => ({
    background: bg,
    color: fg,
    boxShadow: `3px 3px 0 ${shadow}`,
    borderRadius: 999,
    padding: "0.7rem 1.5rem",
    fontWeight: 700,
    display: "inline-block",
  });

  return (
    <div style={{ background: C.cream, color: C.charcoal, fontFamily: BODY }} className="min-h-screen w-full">
      <style>{CSS}</style>

      {/* Marquee + sticky nav */}
      <Marquee id="marquee.text" fallback={SUERTE_DEFAULTS["marquee.text"]} />
      <header className="sticky top-0 z-40 border-b backdrop-blur-md" style={{ background: "rgba(244,236,221,0.85)", borderColor: "rgba(42,36,32,0.1)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="flex items-center gap-2 text-2xl font-bold" style={{ fontFamily: DISPLAY, color: C.tomato }}>
            {brand}
          </a>
          <nav className="hidden items-center gap-6 text-sm font-semibold md:flex">
            <a href="#story" className="hover:opacity-70">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="hover:opacity-70">{ui.fullMenu}</a>
            <a href="#reviews" className="hover:opacity-70">{ui.reviews}</a>
            <a href="#visit" className="hover:opacity-70">{ui.contact}</a>
          </nav>
          <a href="#reserva" className="su-btn text-sm" style={pill(C.tomato, C.cream, C.charcoal)}>
            {ui.book}
          </a>
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="w-full px-5 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ borderColor: "rgba(42,36,32,0.15)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: C.basil }} />
              <EditableText id="hero.badge" />
            </span>
            <EditableText
              id="hero.title"
              as="h1"
              className="mt-5 font-bold"
              style={{ fontFamily: DISPLAY, fontSize: "clamp(2.8rem, 9vw, 5.6rem)", lineHeight: 0.92 }}
            />
            <EditableText id="hero.script" as="p" className="mt-4 text-3xl md:text-4xl" style={{ fontFamily: SCRIPT, color: C.tomato }} />
            <EditableText id="hero.text" as="p" className="mt-5 max-w-xl text-base leading-relaxed" style={{ color: C.soft }} />
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="#reserva" className="su-btn" style={{ ...pill(C.tomato, C.cream, C.charcoal), boxShadow: `4px 4px 0 ${C.charcoal}` }}>
                {ui.book}
              </a>
              <a
                href={`/m/${data.slug}`}
                className="su-btn su-outline-btn"
                style={{ borderRadius: 999, padding: "0.7rem 1.5rem", fontWeight: 700, border: `2px solid ${C.charcoal}` }}
              >
                {ui.viewMenu}
              </a>
            </div>
          </div>
          <div className="relative">
            <EditableImage
              id="hero.image"
              alt=""
              className="aspect-[4/5] w-full rotate-1 object-cover"
              style={{ borderRadius: "1.4rem 0.7rem 1.6rem 0.6rem", border: `4px solid ${C.charcoal}`, boxShadow: `8px 8px 0 ${C.tile}` }}
            />
            <span className="absolute -left-3 top-4 -rotate-[8deg] rounded-full px-4 py-1.5 text-sm font-bold" style={{ background: C.mustard, color: C.charcoal, boxShadow: `3px 3px 0 ${C.charcoal}` }}>
              <EditableText id="hero.sticker" />
            </span>
          </div>
        </div>
      </section>

      {/* Story */}
      <section id="story" className="w-full px-5 py-16 md:py-24">
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[0.8fr_1.2fr]">
          <EditableImage
            id="story.image"
            alt=""
            className="aspect-square w-full -rotate-2 object-cover"
            style={{ border: `4px solid ${C.charcoal}`, borderRadius: "1.1rem 0.5rem 1.2rem 0.5rem", boxShadow: `6px 6px 0 ${C.mustard}` }}
          />
          <div>
            <EditableText id="story.eyebrow" as="p" className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.tomato }} />
            <EditableText
              id="story.quote"
              as="blockquote"
              className="mt-3 border-l-4 pl-5 text-2xl md:text-3xl"
              style={{ fontFamily: DISPLAY, borderColor: C.mustard }}
            />
            <EditableText id="story.p1" as="p" className="mt-5 leading-relaxed" style={{ color: C.soft }} />
            <EditableText id="story.p2" as="p" className="mt-3 leading-relaxed" style={{ color: C.soft }} />
            <EditableText id="story.sign" as="p" className="mt-5 text-2xl" style={{ fontFamily: SCRIPT, color: C.tomato }} />
          </div>
        </div>
      </section>

      {/* Menu (live CRM data) */}
      {data.menuItems.length ? (
        <section id="food" className="w-full px-5 py-16 md:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-xl">
                <EditableText id="food.eyebrow" as="p" className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.tomato }} />
                <EditableText id="food.title" as="h2" className="mt-2 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY }} />
                <EditableText id="food.text" as="p" className="mt-3 leading-relaxed" style={{ color: C.soft }} />
              </div>
              <a href={`/m/${data.slug}`} className="su-btn su-outline-btn" style={{ borderRadius: 999, padding: "0.6rem 1.4rem", fontWeight: 700, border: `2px solid ${C.charcoal}` }}>
                {ui.fullMenu} →
              </a>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-5 md:grid-cols-3">
              {data.menuItems.map((it) => (
                <div key={it.id} className="su-card overflow-hidden bg-white" style={{ border: `2px solid ${C.charcoal}`, borderRadius: "1.1rem 0.5rem 1.2rem 0.5rem", boxShadow: `4px 4px 0 ${C.charcoal}` }}>
                  {it.image_url ? (
                    <div className="aspect-[5/4] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : null}
                  <div className="flex items-start justify-between gap-2 p-4">
                    <div>
                      <p className="font-bold" style={{ fontFamily: DISPLAY }}>{it.name}</p>
                      {it.description ? <p className="mt-1 text-xs leading-snug line-clamp-2" style={{ color: C.soft }}>{it.description}</p> : null}
                    </div>
                    {it.price != null ? (
                      <span className="shrink-0 rounded-full px-3 py-1 text-sm font-bold" style={{ background: C.charcoal, color: C.cream }}>
                        {formatSitePrice(it.price, it.currency)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Special */}
      <section id="special" className="w-full px-5 py-16 md:py-24">
        <div
          className="relative mx-auto max-w-5xl overflow-hidden p-8 md:p-12"
          style={{ background: C.basil, color: C.cream, border: `4px solid ${C.charcoal}`, borderRadius: "1.6rem 0.7rem 1.6rem 0.7rem", boxShadow: `8px 8px 0 ${C.mustard}` }}
        >
          <div className="grid items-center gap-8 md:grid-cols-[1.3fr_0.7fr]">
            <div>
              <span className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide" style={{ background: C.tomato, color: C.cream }}>
                <EditableText id="special.badge" />
              </span>
              <EditableText id="special.eyebrow" as="p" className="mt-4 text-sm font-semibold uppercase tracking-wide" style={{ color: C.mustard }} />
              <EditableText id="special.title" as="h2" className="mt-2 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY }} />
              <EditableText id="special.text" as="p" className="mt-4 leading-relaxed" style={{ color: "rgba(244,236,221,0.85)" }} />
              <a href="#reserva" className="su-btn mt-6" style={{ ...pill(C.cream, C.charcoal, C.charcoal), boxShadow: `4px 4px 0 ${C.charcoal}` }}>
                {ui.book} →
              </a>
            </div>
            <EditableImage
              id="special.image"
              alt=""
              className="aspect-square w-full rotate-2 object-cover"
              style={{ border: `4px solid ${C.cream}`, borderRadius: "1.1rem 0.5rem 1.2rem 0.5rem", boxShadow: `5px 5px 0 ${C.charcoal}` }}
            />
          </div>
        </div>
      </section>

      {/* Booking — real CRM widget */}
      <section id="reserva" className="w-full px-5 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-2">
          <div>
            <EditableText id="book.eyebrow" as="p" className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.tomato }} />
            <EditableText id="book.title" as="h2" className="mt-2 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY }} />
            <EditableText id="book.text" as="p" className="mt-4 max-w-md leading-relaxed" style={{ color: C.soft }} />
            {data.giftCardsEnabled ? (
              <a href={`/g/${data.slug}`} className="su-btn su-outline-btn mt-6" style={{ borderRadius: 999, padding: "0.6rem 1.4rem", fontWeight: 700, border: `2px solid ${C.charcoal}`, display: "inline-block" }}>
                🎁 {ui.giftCta}
              </a>
            ) : null}
          </div>
          <div className="p-6 md:p-8" style={{ background: C.creamDeep, border: `2px solid ${C.charcoal}`, borderRadius: "1.4rem 0.7rem 1.6rem 0.6rem", boxShadow: `5px 5px 0 ${C.tile}` }}>
            <h3 className="text-xl font-bold" style={{ fontFamily: DISPLAY }}>{data.bookingStrings.title}</h3>
            <BookingWidget slug={data.slug} accent={C.tomato} strings={data.bookingStrings} />
          </div>
        </div>
      </section>

      {/* Reviews (live CRM data) */}
      <section id="reviews" className="w-full px-5 py-16 md:py-24">
        <div className="mx-auto max-w-6xl text-center">
          <EditableText id="reviews.eyebrow" as="p" className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.tomato }} />
          <EditableText id="reviews.title" as="h2" className="mt-2 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY }} />
          {data.reviews.length ? (
            <div className="mt-10 grid gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
              {data.reviews.slice(0, 4).map((r, i) => (
                <figure key={i} className="bg-white p-5" style={{ border: `2px solid ${C.charcoal}`, borderRadius: "1.1rem 0.5rem 1.2rem 0.5rem", boxShadow: `4px 4px 0 ${C.tile}` }}>
                  <Stars n={r.rating} />
                  <blockquote className="mt-2 text-sm leading-relaxed" style={{ color: C.soft }}>“{r.comment}”</blockquote>
                  <figcaption className="mt-3 flex items-center gap-2 text-sm font-bold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs" style={{ background: C.basil, color: C.cream }}>★</span>
                    {r.author}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="mt-6" style={{ color: C.soft }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="mt-8 inline-block rounded-full border-2 border-dashed px-5 py-2 text-sm font-semibold" style={{ borderColor: C.charcoal }}>
              Google ★ — {ui.reviews}
            </a>
          ) : null}
        </div>
      </section>

      {/* Visit: hours + contact + map (live CRM data) */}
      <section id="visit" className="w-full px-5 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 p-8 md:grid-cols-2 md:p-12" style={{ background: "#fff", border: `4px solid ${C.charcoal}`, borderRadius: "1.6rem 0.7rem 1.6rem 0.7rem", boxShadow: `8px 8px 0 ${C.basil}` }}>
          <div>
            <EditableText id="visit.eyebrow" as="p" className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.tomato }} />
            <EditableText id="visit.title" as="h2" className="mt-2 text-4xl font-bold" style={{ fontFamily: DISPLAY }} />
            {data.address ? (
              <p className="mt-5 font-semibold">
                {ui.address}: <span className="font-normal" style={{ color: C.soft }}>{data.address}</span>
              </p>
            ) : null}
            {data.phone ? (
              <p className="mt-2 font-semibold">
                {ui.phone}: <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="font-normal underline" style={{ color: C.soft }}>{data.phone}</a>
              </p>
            ) : null}
            {data.hours.length ? (
              <dl className="mt-6 divide-y-2" style={{ borderColor: "rgba(42,36,32,0.1)" }}>
                {data.hours.map((h) => (
                  <div key={h.day} className="flex items-center justify-between py-2 text-sm" style={{ borderColor: "rgba(42,36,32,0.1)" }}>
                    <dt className="font-bold">{h.day}</dt>
                    <dd style={{ color: C.soft }}>{h.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {data.mapsHref ? (
              <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="su-btn mt-6" style={pill(C.tile, C.cream, C.charcoal)}>
                {ui.map} →
              </a>
            ) : null}
          </div>
          {mapEmbed ? (
            <iframe
              src={mapEmbed}
              className="min-h-[280px] w-full"
              style={{ border: `2px solid ${C.charcoal}`, borderRadius: "1.1rem 0.5rem 1.2rem 0.5rem" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="map"
            />
          ) : null}
        </div>
      </section>

      <Marquee id="marquee2.text" fallback={SUERTE_DEFAULTS["marquee2.text"]} />

      {/* Footer */}
      <footer className="w-full px-5 py-12" style={{ background: C.charcoal, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-2xl font-bold" style={{ fontFamily: DISPLAY, color: C.tomato }}>{brand}</p>
            <EditableText id="footer.tagline" as="p" className="mt-2 text-sm" style={{ color: "rgba(244,236,221,0.7)" }} />
            <EditableText id="footer.script" as="p" className="mt-3 text-2xl" style={{ fontFamily: SCRIPT, color: C.mustard }} />
          </div>
          <nav className="flex flex-col gap-2 text-sm">
            <a href="#story" className="hover:underline">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="hover:underline">{ui.fullMenu}</a>
            <a href="#reserva" className="hover:underline">{ui.book}</a>
            <a href="#visit" className="hover:underline">{ui.contact}</a>
          </nav>
          <div className="text-sm" style={{ color: "rgba(244,236,221,0.7)" }}>
            {data.address ? <p>{data.address}</p> : null}
            {data.phone ? <p className="mt-1">{data.phone}</p> : null}
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl border-t pt-4 text-xs" style={{ borderColor: "rgba(244,236,221,0.15)", color: "rgba(244,236,221,0.5)" }}>
          © {new Date().getFullYear()} {brand}
        </p>
      </footer>
    </div>
  );
}
