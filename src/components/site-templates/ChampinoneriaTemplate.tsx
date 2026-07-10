"use client";

import type { CSSProperties } from "react";
import BookingWidget from "@/app/b/[slug]/BookingWidget";
import { EditableImage, EditableText, useBlockValue } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { CHAMPINONERIA_DEFAULTS } from "./defaults";

// "La Champiñonería" — replica of la-champinoneria.pages.dev: warm earthy
// French-bistró editorial. Cream dot-grid paper, dark cacao panels, Cormorant
// italic script, brass accents and a recurring mushroom motif. Every text and
// image renders via Editable* so the visual editor can rewrite it in place;
// menu, reviews, hours and contact come from live CRM data; booking is real.

const C = {
  cream: "#f5eee0",
  taupe: "#ede4d3",
  dark: "#2a1d12",
  ink: "#2e2218",
  inkSoft: "#7a6a56",
  brass: "#a6724b",
  brassSoft: "#c9a77c",
  gold: "#b08d57",
  oxblood: "#241810",
};

const DISPLAY = "'Cormorant', serif";
const BODY = "'Inter', sans-serif";
const SCRIPT: CSSProperties = { fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.04 };
const EYEBROW: CSSProperties = { fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.28em", fontSize: "0.72rem" };

const CSS = `
@keyframes ch-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.ch-marquee-track { display: inline-flex; white-space: nowrap; animation: ch-marquee 30s linear infinite; }
@keyframes ch-bob { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-14px) rotate(6deg); } }
.ch-bob { animation: ch-bob 7s ease-in-out infinite; }
.ch-dots { background-image: radial-gradient(#8a6a4f0f 1px, transparent 1px); background-size: 20px 20px; }
.ch-pill { transition: background .4s cubic-bezier(.16,1,.3,1), color .4s cubic-bezier(.16,1,.3,1), border-color .4s cubic-bezier(.16,1,.3,1); }
.ch-pill-ink { border: 1px solid rgba(46,34,24,0.26); background: transparent; color: ${C.ink}; }
.ch-pill-ink:hover { background: ${C.ink}; color: ${C.cream}; border-color: ${C.ink}; }
.ch-pill-solid { border: 1px solid ${C.ink}; background: ${C.ink}; color: ${C.cream}; }
.ch-pill-solid:hover { background: ${C.oxblood}; border-color: ${C.oxblood}; }
.ch-pill-cream { border: 1px solid ${C.cream}; background: ${C.cream}; color: ${C.ink}; }
.ch-pill-cream:hover { background: #e6dbc2; border-color: #e6dbc2; }
.ch-pill-cream-o { border: 1px solid rgba(245,238,224,0.45); background: transparent; color: ${C.cream}; }
.ch-pill-cream-o:hover { background: ${C.cream}; color: ${C.ink}; border-color: ${C.cream}; }
.ch-frame { background: ${C.cream}; border: 1px solid rgba(46,34,24,0.12); border-radius: 4px; box-shadow: inset 0 1px 0 #ffffff80, 0 30px 60px -40px #211d178c; }
.ch-frame-photo { border: 6px solid ${C.cream}; box-shadow: 0 40px 80px -48px #211d17b3; }
.ch-card { transition: transform .35s cubic-bezier(.16,1,.3,1); }
.ch-card:hover { transform: translateY(-6px); }
.ch-card img { transition: transform .5s ease; }
.ch-card:hover img { transform: scale(1.03); }
.ch-glow { position: absolute; width: 340px; height: 340px; border-radius: 999px; background: rgba(166,114,75,0.4); filter: blur(80px); pointer-events: none; }
`;

function Mushroom({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      <path d="M3 11.5C3 6.8 7 3.5 12 3.5s9 3.3 9 8c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2Z" />
      <path d="M9.5 13.5c-.4 2.5-.4 4.6.1 6.4.3 1 1.1 1.6 2.4 1.6s2.1-.6 2.4-1.6c.5-1.8.5-3.9.1-6.4" />
    </svg>
  );
}

function Eyebrow({ id, color, center }: { id: string; color: string; center?: boolean }) {
  return (
    <p className={`flex items-center gap-2.5 ${center ? "justify-center" : ""}`} style={{ ...EYEBROW, color }}>
      <Mushroom className="h-4 w-4 shrink-0" />
      <EditableText id={id} />
    </p>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} style={{ color: C.gold }} className="text-base tracking-[0.18em]">
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
        <span key={i} className="mx-7 inline-flex items-center gap-7 uppercase" style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: "clamp(1.4rem, 3vw, 2.6rem)", letterSpacing: "0.04em" }}>
          {it} <Mushroom className="h-[0.65em] w-[0.65em] shrink-0" style={{ color: C.brassSoft }} />
        </span>
      ))}
    </span>
  );
  return (
    <div className="w-full overflow-hidden border-y py-5" style={{ borderColor: "rgba(245,238,224,0.15)", color: C.cream }}>
      <div className="ch-marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

export default function ChampinoneriaTemplate({ data }: { data: SiteData }) {
  const brand = data.tenantName;
  const ui = data.labels;
  const tel = data.phone ? `tel:${data.phone.replace(/\s+/g, "")}` : "";
  const mapEmbed = data.address ? `https://www.google.com/maps?q=${encodeURIComponent(data.address)}&output=embed` : "";

  const pillBase: CSSProperties = {
    borderRadius: 999,
    padding: "0.85rem 1.9rem",
    fontSize: "0.82rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    display: "inline-block",
  };
  const display = (size: string): CSSProperties => ({ fontFamily: DISPLAY, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.04, fontSize: size });

  return (
    <div id="top" className="ch-dots min-h-screen w-full" style={{ background: C.cream, color: C.ink, fontFamily: BODY }}>
      <style>{CSS}</style>

      {/* Sticky nav */}
      <header className="sticky top-0 z-40 border-b backdrop-blur-md" style={{ background: "rgba(243,239,229,0.85)", borderColor: "rgba(46,34,24,0.1)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="leading-none">
            <EditableText id="nav.brand" as="span" fallback={brand} className="block text-2xl" style={SCRIPT} />
            <EditableText id="nav.tagline" as="span" className="mt-1 block" style={{ ...EYEBROW, fontSize: "0.58rem", color: C.inkSoft }} />
          </a>
          <nav className="hidden items-center gap-7 text-xs font-semibold uppercase md:flex" style={{ letterSpacing: "0.16em" }}>
            <a href="#casa" className="hover:opacity-60">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="hover:opacity-60">{ui.fullMenu}</a>
            <a href="#resenas" className="hover:opacity-60">{ui.reviews}</a>
            <a href="#encontrar" className="hover:opacity-60">{ui.contact}</a>
          </nav>
          <a href="#reserva" className="ch-pill ch-pill-ink" style={{ ...pillBase, padding: "0.6rem 1.4rem" }}>
            {ui.book}
          </a>
        </div>
      </header>

      {/* Hero — full-bleed 100svh */}
      <section className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden">
        <EditableImage id="hero.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(20,17,13,0.42), rgba(20,17,13,0.12) 38%, rgba(20,17,13,0.55))" }} />
        <Mushroom className="ch-bob absolute left-[7%] top-[16%] h-20 w-20 md:h-28 md:w-28" style={{ color: "rgba(245,238,224,0.12)" }} />
        <Mushroom className="ch-bob absolute bottom-[20%] right-[6%] h-14 w-14 md:h-20 md:w-20" style={{ color: "rgba(245,238,224,0.12)", animationDelay: "-3.5s" }} />
        <div className="relative z-10 px-5 py-28 text-center" style={{ color: C.cream }}>
          <EditableText id="hero.title" as="h1" fallback={brand} style={{ ...SCRIPT, fontSize: "clamp(3rem, 12vw, 9.5rem)" }} />
          <EditableText id="hero.text" as="p" className="mx-auto mt-6 max-w-2xl text-base leading-relaxed md:text-lg" style={{ color: "rgba(245,238,224,0.85)" }} />
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a href="#reserva" className="ch-pill ch-pill-cream" style={pillBase}>{ui.book}</a>
            <a href={`/m/${data.slug}`} className="ch-pill ch-pill-cream-o" style={pillBase}>{ui.viewMenu}</a>
          </div>
        </div>
        <div className="absolute bottom-9 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
          <span className="h-px w-24" style={{ background: "rgba(245,238,224,0.55)" }} />
          <span className="h-px w-14" style={{ background: "rgba(245,238,224,0.35)" }} />
          <span className="h-px w-7" style={{ background: "rgba(245,238,224,0.2)" }} />
        </div>
      </section>

      {/* Nota de la casa */}
      <section className="w-full px-5 py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow id="nota.eyebrow" color={C.brass} center />
          <EditableText id="nota.quote" as="blockquote" className="mt-6 text-2xl md:text-4xl" style={{ ...SCRIPT, lineHeight: 1.2 }} />
          <EditableText id="nota.caption" as="p" className="mt-6" style={{ ...EYEBROW, fontSize: "0.62rem", color: C.inkSoft }} />
        </div>
      </section>

      {/* La casa */}
      <section id="casa" className="w-full px-5 py-20 md:py-28" style={{ background: C.dark, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Eyebrow id="casa.eyebrow" color={C.brassSoft} />
            <EditableText id="casa.title" as="h2" className="mt-4" style={display("clamp(2.2rem, 5vw, 3.6rem)")} />
            <EditableText id="casa.p1" as="p" className="mt-6 leading-relaxed" style={{ color: "rgba(245,238,224,0.8)" }} />
            <EditableText id="casa.p2" as="p" className="mt-4 leading-relaxed" style={{ color: "rgba(245,238,224,0.7)" }} />
          </div>
          <EditableImage id="casa.image" alt="" className="ch-frame-photo aspect-[4/5] w-full rotate-1 object-cover" />
        </div>
      </section>

      {/* Carta preview (live CRM data) */}
      {data.menuItems.length ? (
        <section id="carta-preview" className="w-full px-5 py-20 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow id="carta.eyebrow" color={C.brass} center />
              <EditableText id="carta.title" as="h2" className="mt-4" style={display("clamp(2.2rem, 5vw, 3.6rem)")} />
              <EditableText id="carta.text" as="p" className="mt-4 leading-relaxed" style={{ color: C.inkSoft }} />
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.menuItems.map((it) => (
                <div key={it.id} className="ch-frame ch-card overflow-hidden p-4">
                  {it.image_url ? (
                    <div className="ch-frame-photo aspect-[4/3] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3 pt-4">
                    <h3 className="text-2xl" style={{ fontFamily: DISPLAY, fontWeight: 500, lineHeight: 1.1 }}>{it.name}</h3>
                    {it.price != null ? (
                      <span className="shrink-0 text-xl" style={{ fontFamily: DISPLAY, fontWeight: 500, color: C.brass }}>
                        {formatSitePrice(it.price, it.currency)}
                      </span>
                    ) : null}
                  </div>
                  {it.description ? <p className="mt-2 text-sm leading-snug line-clamp-2" style={{ color: C.inkSoft }}>{it.description}</p> : null}
                </div>
              ))}
            </div>
            <div className="mt-12 text-center">
              <a href={`/m/${data.slug}`} className="ch-pill ch-pill-solid" style={pillBase}>{ui.fullMenu}</a>
            </div>
          </div>
        </section>
      ) : null}

      {/* Marquee band + de la sartén a la mesa */}
      <section id="mesa" className="w-full py-14 md:py-20" style={{ background: C.dark, color: C.cream }}>
        <Marquee id="marquee.text" fallback={CHAMPINONERIA_DEFAULTS["marquee.text"]} />
        <div className="mx-auto mt-14 grid max-w-6xl items-center gap-12 px-5 md:grid-cols-2 md:mt-20">
          <div>
            <Eyebrow id="mesa.eyebrow" color={C.brassSoft} />
            <EditableText id="mesa.title" as="h2" className="mt-4" style={{ ...SCRIPT, fontSize: "clamp(2.4rem, 5.5vw, 4rem)" }} />
          </div>
          <EditableImage id="mesa.image" alt="" className="ch-frame-photo aspect-[16/10] w-full -rotate-1 object-cover" />
        </div>
      </section>

      {/* Reserva — real CRM widget */}
      <section id="reserva" className="relative w-full overflow-hidden border-t px-5 py-20 md:py-28" style={{ background: C.dark, color: C.cream, borderColor: "rgba(245,238,224,0.12)" }}>
        <div className="ch-glow left-[-90px] top-[-70px]" />
        <div className="ch-glow bottom-[-110px] right-[-70px]" />
        <div className="relative mx-auto max-w-2xl text-center">
          <Eyebrow id="reserva.eyebrow" color={C.brassSoft} center />
          <EditableText id="reserva.title" as="h2" className="mt-4" style={{ ...SCRIPT, fontSize: "clamp(2.6rem, 6vw, 4.4rem)" }} />
          <EditableText id="reserva.text" as="p" className="mt-4 leading-relaxed" style={{ color: "rgba(245,238,224,0.7)" }} />
          <div className="ch-frame mt-10 p-6 text-left md:p-8" style={{ color: C.ink }}>
            <h3 className="text-2xl" style={{ fontFamily: DISPLAY, fontWeight: 500 }}>{data.bookingStrings.title}</h3>
            <BookingWidget slug={data.slug} accent="#2e2218" strings={data.bookingStrings} />
          </div>
          {data.giftCardsEnabled ? (
            <a href={`/g/${data.slug}`} className="mt-7 inline-block text-sm underline underline-offset-4 hover:opacity-80" style={{ color: "rgba(245,238,224,0.7)" }}>
              {ui.giftCta}
            </a>
          ) : null}
        </div>
      </section>

      {/* Reseñas (live CRM data) */}
      <section id="resenas" className="ch-dots w-full px-5 py-20 md:py-28" style={{ background: C.taupe }}>
        <div className="mx-auto max-w-6xl text-center">
          <Eyebrow id="resenas.eyebrow" color={C.brass} center />
          <EditableText id="resenas.title" as="h2" className="mt-4" style={display("clamp(2.2rem, 5vw, 3.6rem)")} />
          <EditableText id="resenas.text" as="p" className="mx-auto mt-4 max-w-xl leading-relaxed" style={{ color: C.inkSoft }} />
          {data.reviews.length ? (
            <>
              <p className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold" style={{ color: C.inkSoft }}>
                <Stars n={Math.round(data.avgRating)} /> {data.avgRating.toFixed(1)} / 5
              </p>
              <div className="mt-10 grid gap-6 text-left sm:grid-cols-2 lg:grid-cols-4">
                {data.reviews.slice(0, 4).map((r, i) => (
                  <figure key={i} className="ch-frame p-6">
                    <Stars n={r.rating} />
                    <blockquote className="mt-3 text-xl" style={{ ...SCRIPT, lineHeight: 1.25 }}>«{r.comment}»</blockquote>
                    <hr className="my-4 border-0" style={{ height: 1, background: "rgba(46,34,24,0.12)" }} />
                    <figcaption className="flex items-center gap-3 text-sm font-semibold">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: C.ink, color: C.cream, fontFamily: DISPLAY }}>
                        {r.author.charAt(0).toUpperCase()}
                      </span>
                      {r.author}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-8" style={{ color: C.inkSoft }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <div className="mx-auto mt-12 max-w-md rounded-2xl bg-white p-7" style={{ border: "1px solid rgba(46,34,24,0.08)", boxShadow: "0 30px 60px -40px #211d178c" }}>
              <EditableText id="resenas.ctaText" as="p" className="text-sm leading-relaxed" style={{ color: C.inkSoft }} />
              <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="ch-pill ch-pill-solid mt-4" style={pillBase}>
                <EditableText id="resenas.cta" />
              </a>
            </div>
          ) : null}
        </div>
      </section>

      {/* Encuéntranos (live CRM data) */}
      <section id="encontrar" className="w-full px-5 py-20 md:py-28" style={{ background: C.dark, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-2">
          <div>
            <Eyebrow id="encontrar.eyebrow" color={C.brassSoft} />
            <EditableText id="encontrar.title" as="h2" className="mt-4" style={{ ...SCRIPT, fontSize: "clamp(2.4rem, 5.5vw, 4rem)" }} />
            <EditableText id="encontrar.text" as="p" className="mt-4 leading-relaxed" style={{ color: "rgba(245,238,224,0.7)" }} />
            <dl className="mt-8 space-y-5 text-sm">
              {data.address ? (
                <div>
                  <dt style={{ ...EYEBROW, fontSize: "0.62rem", color: C.brassSoft }}>{ui.address}</dt>
                  <dd className="mt-1.5" style={{ color: "rgba(245,238,224,0.85)" }}>{data.address}</dd>
                </div>
              ) : null}
              {data.hours.length ? (
                <div>
                  <dt style={{ ...EYEBROW, fontSize: "0.62rem", color: C.brassSoft }}>{ui.hours}</dt>
                  <dd className="mt-1.5 max-w-sm space-y-1">
                    {data.hours.map((h) => (
                      <div key={h.day} className="flex items-baseline justify-between gap-6">
                        <span style={{ color: "rgba(245,238,224,0.85)" }}>{h.day}</span>
                        <span style={{ color: "rgba(245,238,224,0.55)" }}>{h.value}</span>
                      </div>
                    ))}
                  </dd>
                </div>
              ) : null}
              {data.phone ? (
                <div>
                  <dt style={{ ...EYEBROW, fontSize: "0.62rem", color: C.brassSoft }}>{ui.phone}</dt>
                  <dd className="mt-1.5">
                    <a href={tel} className="underline underline-offset-4" style={{ color: "rgba(245,238,224,0.85)" }}>{data.phone}</a>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-9 flex flex-wrap gap-4">
              {data.mapsHref ? (
                <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="ch-pill ch-pill-cream" style={pillBase}>{ui.map}</a>
              ) : null}
              {data.phone ? (
                <a href={tel} className="ch-pill ch-pill-cream-o" style={pillBase}>{ui.phone}</a>
              ) : null}
            </div>
          </div>
          {mapEmbed ? (
            <iframe
              src={mapEmbed}
              className="min-h-[320px] w-full rounded-2xl"
              style={{ border: "1px solid rgba(245,238,224,0.15)" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="map"
            />
          ) : null}
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t px-5 py-14" style={{ background: C.dark, color: C.cream, borderColor: "rgba(245,238,224,0.12)" }}>
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr]">
          <div>
            <EditableText id="footer.brand" as="p" fallback={brand} className="text-3xl" style={SCRIPT} />
            <EditableText id="footer.tagline" as="p" className="mt-2" style={{ ...EYEBROW, fontSize: "0.62rem", color: C.brassSoft }} />
            <EditableText id="footer.line" as="p" className="mt-4 text-sm" style={{ color: "rgba(245,238,224,0.7)" }} />
            <div className="mt-4 text-sm" style={{ color: "rgba(245,238,224,0.55)" }}>
              {data.address ? <p>{data.address}</p> : null}
              {data.phone ? <p className="mt-1">{data.phone}</p> : null}
            </div>
          </div>
          <nav className="flex flex-col gap-2.5 text-xs font-semibold uppercase md:items-end" style={{ letterSpacing: "0.16em" }}>
            <a href="#casa" className="hover:opacity-70">{ui.about}</a>
            <a href={`/m/${data.slug}`} className="hover:opacity-70">{ui.fullMenu}</a>
            <a href="#reserva" className="hover:opacity-70">{ui.book}</a>
            <a href="#encontrar" className="hover:opacity-70">{ui.contact}</a>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl border-t pt-5 text-xs" style={{ borderColor: "rgba(245,238,224,0.12)", color: "rgba(245,238,224,0.55)" }}>
          © {new Date().getFullYear()} {brand}
        </p>
      </footer>
    </div>
  );
}
