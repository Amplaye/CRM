"use client";

import BookingWidget from "@/app/b/[slug]/BookingWidget";
import { EditableImage, EditableText, useBlockValue } from "@/lib/site/content";
import { formatSitePrice } from "@/lib/site/data";
import type { SiteData } from "@/lib/site/types";
import { PICNIC_DEFAULTS } from "./defaults";

// "Picnic" — replica of picnic-web-tau.vercel.app: cinematic dark Neapolitan
// trattoria. Editorial Playfair italics on near-black, warm rust accent, cream
// interludes, 1px hairlines, CSS marquee (the demo's canvas scroll-film is
// replaced by a static hero frame). Every text/image renders via Editable* so
// the visual editor can rewrite it in place; menu, reviews, hours and contact
// come from live CRM data; booking is the real widget.

const C = {
  black: "#000000",
  dark: "#1a1a1a",
  card: "#0f0f0f",
  cream: "#f7f3ed",
  rust: "#c94a1a",
};
const HAIR_DARK = "rgba(255,255,255,0.06)";
const HAIR_CREAM = "rgba(26,26,26,0.1)";
const CREAM_80 = "rgba(247,243,237,0.8)";
const CREAM_60 = "rgba(247,243,237,0.6)";
const INK_70 = "rgba(26,26,26,0.7)";

const DISPLAY = "'Playfair Display', serif";
const BODY = "'Inter', sans-serif";
const KICKER = "text-xs font-medium uppercase tracking-[0.3em]";

const CSS = `
@keyframes pc-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.pc-marquee-track { display: inline-flex; white-space: nowrap; animation: pc-marquee 40s linear infinite; }
@keyframes pc-rise { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
.pc-rise { animation: pc-rise .9s ease-out both; }
.pc-rise-2 { animation-delay: .18s; }
.pc-rise-3 { animation-delay: .36s; }
.pc-rise-4 { animation-delay: .54s; }
@keyframes pc-drop { 0% { transform: scaleY(0); opacity: 0; } 45% { transform: scaleY(1); opacity: 1; } 100% { transform: scaleY(1) translateY(14px); opacity: 0; } }
.pc-scroll-line { transform-origin: top; animation: pc-drop 2.4s ease-in-out infinite; }
.pc-btn { transition: opacity .25s ease, background .25s ease, border-color .25s ease, transform .15s ease; }
.pc-btn:hover { opacity: .88; }
.pc-btn:active { transform: scale(.95); }
.pc-ghost:hover { opacity: 1; border-color: ${C.cream} !important; background: rgba(247,243,237,.08); }
.pc-link { position: relative; }
.pc-link::after { content: ""; position: absolute; left: 0; bottom: -5px; height: 1px; width: 0; background: ${C.rust}; transition: width .3s ease; }
.pc-link:hover::after { width: 100%; }
.pc-zoom { overflow: hidden; }
.pc-zoom img { transition: transform .7s ease; }
.pc-zoom:hover img, .pc-card:hover .pc-zoom img { transform: scale(1.05); }
.pc-card .pc-line { height: 2px; width: 0; background: ${C.rust}; transition: width .5s ease; }
.pc-card:hover .pc-line { width: 100%; }
.pc-card .pc-dish { transition: color .3s ease; }
.pc-card:hover .pc-dish { color: ${C.rust}; }
.pc-anchor { scroll-margin-top: 5rem; }
`;

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} style={{ color: C.rust }} className="text-base tracking-[0.15em]">
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
        <span key={i} className="mx-5 inline-flex items-center gap-5 text-xs font-medium uppercase tracking-widest">
          {it} <span style={{ color: C.rust }}>✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="w-full overflow-hidden py-3" style={{ background: C.dark, color: CREAM_80, borderTop: `1px solid ${HAIR_DARK}`, borderBottom: `1px solid ${HAIR_DARK}` }}>
      <div className="pc-marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

// About pillars — rust stroke icons (flame / leaf / heart) + editable copy.
const PILLARS: { d: string[]; title: string; text: string }[] = [
  { d: ["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"], title: "about.p1title", text: "about.p1text" },
  { d: ["M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z", "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"], title: "about.p2title", text: "about.p2text" },
  { d: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"], title: "about.p3title", text: "about.p3text" },
];

function PillarIcon({ d }: { d: string[] }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={C.rust} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

export default function PicnicTemplate({ data }: { data: SiteData }) {
  const ui = data.labels;

  return (
    <div style={{ background: C.black, color: C.cream, fontFamily: BODY }} className="min-h-screen w-full">
      <style>{CSS}</style>

      {/* Fixed nav */}
      <header className="fixed inset-x-0 top-0 z-40 border-b backdrop-blur-md" style={{ background: "rgba(0,0,0,0.35)", borderColor: HAIR_DARK }}>
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
          <a href="#inicio" className="leading-none">
            <EditableText id="nav.brand" as="span" className="block text-2xl font-black uppercase tracking-tight" style={{ fontFamily: DISPLAY, color: C.cream }} fallback={data.tenantName} />
            <EditableText id="brand.subtitle" as="span" className="mt-1 block text-[9px] uppercase tracking-[0.25em]" style={{ color: CREAM_60 }} />
          </a>
          <nav className="hidden items-center gap-8 text-sm font-light md:flex" style={{ color: CREAM_80 }}>
            <a href="#nosotros" className="pc-link">{ui.about}</a>
            <a href="#especialidades" className="pc-link">{ui.menu}</a>
            <a href={`/m/${data.slug}`} className="pc-link">{ui.fullMenu}</a>
            <a href="#opiniones" className="pc-link">{ui.reviews}</a>
          </nav>
          <a href="#reservas" className="pc-btn rounded-full px-5 py-2.5 text-sm font-medium" style={{ background: C.rust, color: C.cream }}>
            {ui.book}
          </a>
        </div>
      </header>

      {/* Hero — static frame instead of the demo's scroll-film */}
      <section id="inicio" className="pc-anchor relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden">
        <EditableImage id="hero.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.75) 100%)" }} />
        <div className="relative z-10 px-5 pb-24 pt-24 text-center">
          <EditableText id="hero.kicker" as="p" className="pc-rise text-[11px] uppercase tracking-[0.4em]" style={{ color: CREAM_80 }} />
          <h1 className="pc-rise pc-rise-2 mt-6" style={{ fontFamily: DISPLAY }}>
            <EditableText id="hero.title" as="span" className="block text-5xl font-black leading-none md:text-8xl" style={{ color: C.cream }} />
            <EditableText id="hero.titleItalic" as="span" className="mt-3 block text-4xl font-normal italic md:text-6xl" style={{ color: C.rust }} />
          </h1>
          <div className="pc-rise pc-rise-3 mx-auto mt-8 h-px w-16" style={{ background: C.rust }} />
          <EditableText id="hero.sub" as="p" className="pc-rise pc-rise-3 mt-6 text-sm font-light tracking-widest md:text-base" style={{ color: CREAM_80 }} />
          <div className="pc-rise pc-rise-4 mt-10 flex flex-wrap justify-center gap-4">
            <a href="#reservas" className="pc-btn rounded-full px-8 py-3.5 text-sm font-medium" style={{ background: C.rust, color: C.cream }}>
              {ui.book}
            </a>
            <a href={`/m/${data.slug}`} className="pc-btn pc-ghost rounded-full border px-8 py-3.5 text-sm font-light" style={{ borderColor: "rgba(247,243,237,0.4)", color: C.cream }}>
              {ui.viewMenu}
            </a>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
          <EditableText id="hero.scroll" as="span" className="text-[10px] uppercase tracking-[0.4em]" style={{ color: CREAM_60 }} />
          <span className="pc-scroll-line h-14 w-px" style={{ background: `linear-gradient(to bottom, ${C.rust}, transparent)` }} />
        </div>
      </section>

      <Marquee id="marquee.text" fallback={PICNIC_DEFAULTS["marquee.text"]} />

      {/* About — cream interlude with tilted collage + pillars */}
      <section id="nosotros" className="pc-anchor w-full px-5 py-24 md:py-32" style={{ background: C.cream, color: C.dark }}>
        <div className="mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
          <div className="relative pb-10">
            <div className="absolute -left-4 -top-4 h-40 w-40" style={{ background: "rgba(201,74,26,0.1)" }} />
            <div className="pc-zoom relative -rotate-1 rounded-sm shadow-2xl">
              <EditableImage id="about.image1" alt="" className="aspect-[4/5] w-full rounded-sm object-cover" />
            </div>
            <div className="pc-zoom absolute -bottom-2 -right-2 w-1/2 rotate-2 border-4 shadow-xl md:-right-6" style={{ borderColor: C.cream }}>
              <EditableImage id="about.image2" alt="" className="aspect-[4/3] w-full object-cover" />
            </div>
          </div>
          <div>
            <EditableText id="about.kicker" as="p" className={KICKER} style={{ color: C.rust }} />
            <h2 className="mt-4 text-4xl md:text-5xl" style={{ fontFamily: DISPLAY }}>
              <EditableText id="about.title" as="span" className="block font-bold" />
              <EditableText id="about.titleItalic" as="span" className="block font-normal italic" style={{ color: C.rust }} />
            </h2>
            <EditableText id="about.text" as="p" className="mt-6 font-light leading-relaxed" style={{ color: INK_70 }} />
            <div className="mt-10 space-y-6 border-t pt-8" style={{ borderColor: HAIR_CREAM }}>
              {PILLARS.map((p) => (
                <div key={p.title} className="flex items-start gap-4">
                  <span className="mt-1 shrink-0">
                    <PillarIcon d={p.d} />
                  </span>
                  <div>
                    <EditableText id={p.title} as="p" className="text-lg font-bold" style={{ fontFamily: DISPLAY }} />
                    <EditableText id={p.text} as="p" className="mt-1 text-sm font-light" style={{ color: INK_70 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Specialties — live CRM menu on black */}
      {data.menuItems.length ? (
        <section id="especialidades" className="pc-anchor w-full px-5 py-24 md:py-32" style={{ background: C.black }}>
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <EditableText id="menu.kicker" as="p" className={KICKER} style={{ color: C.rust }} />
              <h2 className="mt-4 text-4xl md:text-5xl" style={{ fontFamily: DISPLAY, color: C.cream }}>
                <EditableText id="menu.title" as="span" className="block font-bold" />
                <EditableText id="menu.titleItalic" as="span" className="block font-normal italic" style={{ color: C.rust }} />
              </h2>
              <EditableText id="menu.text" as="p" className="mt-5 font-light" style={{ color: CREAM_60 }} />
            </div>
            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.menuItems.map((it) => (
                <article key={it.id} className="pc-card overflow-hidden rounded-sm" style={{ background: C.card, border: `1px solid ${HAIR_DARK}` }}>
                  {it.image_url ? (
                    <div className="pc-zoom aspect-[4/3]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : null}
                  <div className="p-6">
                    <h3 className="pc-dish text-xl font-bold" style={{ fontFamily: DISPLAY, color: C.cream }}>{it.name}</h3>
                    {it.description ? (
                      <p className="mt-2 text-sm font-light leading-relaxed line-clamp-2" style={{ color: CREAM_60 }}>{it.description}</p>
                    ) : null}
                    {it.price != null ? (
                      <p className="mt-4 text-2xl font-semibold" style={{ color: C.rust }}>{formatSitePrice(it.price, it.currency)}</p>
                    ) : null}
                  </div>
                  <div className="pc-line" />
                </article>
              ))}
            </div>
            <div className="mt-12 text-center">
              <a href={`/m/${data.slug}`} className="pc-btn pc-ghost inline-block rounded-full border px-8 py-3 text-sm font-light" style={{ borderColor: "rgba(247,243,237,0.4)", color: C.cream }}>
                {ui.fullMenu} →
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {/* Quote — full-bleed street photo, static bg */}
      <section className="relative w-full overflow-hidden py-32 md:py-48">
        <EditableImage id="quote.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} />
        <div className="pointer-events-none absolute left-1/2 top-0 h-16 w-px -translate-x-1/2" style={{ background: "rgba(201,74,26,0.6)" }} />
        <div className="pointer-events-none absolute bottom-0 left-1/2 h-16 w-px -translate-x-1/2" style={{ background: "rgba(201,74,26,0.6)" }} />
        <figure className="relative z-10 mx-auto max-w-4xl px-5 text-center">
          <EditableText
            id="quote.text"
            as="blockquote"
            className="font-black italic leading-tight"
            style={{ fontFamily: DISPLAY, color: C.cream, fontSize: "clamp(2.5rem, 7vw, 5.5rem)" }}
          />
          <figcaption className={`mt-8 ${KICKER}`} style={{ color: CREAM_80 }}>
            — <EditableText id="quote.cite" fallback={data.tenantName} />
          </figcaption>
        </figure>
      </section>

      {/* Reviews — live CRM data on cream */}
      <section id="opiniones" className="pc-anchor w-full px-5 py-24 md:py-32" style={{ background: C.cream, color: C.dark }}>
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <EditableText id="reviews.kicker" as="p" className={KICKER} style={{ color: C.rust }} />
            <EditableText id="reviews.title" as="h2" className="mt-4 text-4xl font-bold md:text-5xl" style={{ fontFamily: DISPLAY }} />
          </div>
          {data.reviews.length ? (
            <div className="mt-12 grid gap-6 text-left sm:grid-cols-2 lg:grid-cols-3">
              {data.reviews.slice(0, 6).map((r, i) => (
                <figure key={i} className="rounded-sm bg-white p-7" style={{ border: `1px solid ${HAIR_CREAM}` }}>
                  <Stars n={r.rating} />
                  <blockquote className="mt-4 italic leading-relaxed" style={{ fontFamily: DISPLAY }}>“{r.comment}”</blockquote>
                  <figcaption className="mt-5 text-xs font-medium uppercase tracking-[0.2em]" style={{ color: INK_70 }}>{r.author}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="mt-8 text-center font-light" style={{ color: INK_70 }}>{ui.reviewsEmpty}</p>
          )}
          {data.reviewUrl ? (
            <div className="mt-12 text-center">
              <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className="pc-btn inline-block rounded-full px-8 py-3 text-sm font-medium" style={{ background: C.rust, color: C.cream }}>
                Google ★ · {ui.reviews}
              </a>
            </div>
          ) : null}
        </div>
      </section>

      {/* Reservas — split: night terrace + real booking widget | rust hours panel */}
      <section id="reservas" className="pc-anchor grid w-full md:grid-cols-2">
        <div className="relative min-h-[500px] overflow-hidden">
          <EditableImage id="reservas.image" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(26,26,26,0.8)" }} />
          <div className="relative z-10 px-5 py-20 md:px-12 md:py-24">
            <EditableText id="reservas.kicker" as="p" className={KICKER} style={{ color: C.rust }} />
            <h2 className="mt-4 text-4xl md:text-5xl" style={{ fontFamily: DISPLAY, color: C.cream }}>
              <EditableText id="reservas.title" as="span" className="font-bold" />{" "}
              <EditableText id="reservas.titleItalic" as="span" className="font-normal italic" style={{ color: C.rust }} />
            </h2>
            <EditableText id="reservas.text" as="p" className="mt-4 max-w-md font-light leading-relaxed" style={{ color: CREAM_80 }} />
            <div className="mt-8 rounded-sm p-6" style={{ background: C.cream, color: C.dark }}>
              <h3 className="text-lg font-bold" style={{ fontFamily: DISPLAY }}>{data.bookingStrings.title}</h3>
              <BookingWidget slug={data.slug} accent={C.rust} strings={data.bookingStrings} />
            </div>
            {data.giftCardsEnabled ? (
              <a href={`/g/${data.slug}`} className="mt-6 inline-block text-sm font-light underline underline-offset-4" style={{ color: CREAM_80 }}>
                {ui.giftCta} →
              </a>
            ) : null}
          </div>
        </div>
        <div className="px-5 py-20 md:px-12 md:py-24" style={{ background: C.rust, color: C.cream }}>
          <p className={KICKER} style={{ color: CREAM_80 }}>{ui.hours}</p>
          {data.hours.length ? (
            <dl className="mt-8">
              {data.hours.map((h) => (
                <div
                  key={h.day}
                  className={`flex items-center justify-between gap-4 border-b py-3 text-sm${h.value === ui.closed ? " opacity-40" : ""}`}
                  style={{ borderColor: "rgba(247,243,237,0.2)" }}
                >
                  <dt className="font-medium">{h.day}</dt>
                  <dd className="font-light">{h.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {data.address || data.phone || data.mapsHref ? (
            <div className="mt-10 rounded-sm p-6" style={{ background: "rgba(247,243,237,0.1)" }}>
              <p className={KICKER}>{ui.contact}</p>
              {data.address ? <p className="mt-4 font-light">{data.address}</p> : null}
              {data.phone ? (
                <a href={`tel:${data.phone.replace(/\s+/g, "")}`} className="mt-2 block font-light underline underline-offset-4">{data.phone}</a>
              ) : null}
              {data.mapsHref ? (
                <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
                  {ui.map} →
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full px-5 pb-8 pt-16" style={{ background: C.black, borderTop: `1px solid ${HAIR_DARK}`, color: C.cream }}>
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-3">
          <div>
            <EditableText id="footer.brand" as="p" className="text-2xl font-black uppercase tracking-tight" style={{ fontFamily: DISPLAY }} fallback={data.tenantName} />
            <EditableText id="brand.subtitle" as="p" className="mt-1 text-[10px] uppercase tracking-[0.25em]" style={{ color: CREAM_60 }} />
            <EditableText id="footer.script" as="p" className="mt-5 text-lg italic" style={{ fontFamily: DISPLAY, color: C.rust }} />
          </div>
          <nav>
            <EditableText id="footer.navTitle" as="p" className={KICKER} style={{ color: CREAM_60 }} />
            <div className="mt-5 flex flex-col items-start gap-2.5 text-sm font-light" style={{ color: CREAM_80 }}>
              <a href="#nosotros" className="pc-link">{ui.about}</a>
              <a href="#especialidades" className="pc-link">{ui.menu}</a>
              <a href={`/m/${data.slug}`} className="pc-link">{ui.fullMenu}</a>
              <a href="#reservas" className="pc-link">{ui.book}</a>
            </div>
          </nav>
          <div>
            <p className={KICKER} style={{ color: CREAM_60 }}>{ui.contact}</p>
            <div className="mt-5 text-sm font-light" style={{ color: CREAM_80 }}>
              {data.address ? <p>{data.address}</p> : null}
              {data.phone ? <p className="mt-1.5">{data.phone}</p> : null}
            </div>
            <a href="#reservas" className="pc-btn mt-6 inline-block rounded-full px-6 py-2.5 text-sm font-medium" style={{ background: C.rust, color: C.cream }}>
              {ui.book}
            </a>
          </div>
        </div>
        <div className="mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs" style={{ borderColor: HAIR_DARK, color: CREAM_60 }}>
          <p>© {new Date().getFullYear()} {data.tenantName}</p>
          <EditableText id="footer.script" as="p" className="italic" style={{ fontFamily: DISPLAY }} />
        </div>
      </footer>
    </div>
  );
}
