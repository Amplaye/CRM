import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { Fraunces, Manrope, Playfair_Display, Cormorant_Garamond } from "next/font/google";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures, SITE_SECTIONS, type SiteSectionKey, type TenantSettings } from "@/lib/types/tenant-settings";
import type { OpeningHours } from "@/lib/restaurant-rules";
import { resolveSiteLocale } from "@/lib/site/booking-strings";
import { SITE_STRINGS } from "@/lib/site/labels";
import { buildSiteData, firstName, formatSitePrice, type RawMenuItemRow, type RawReviewRow } from "@/lib/site/data";
import { SiteContentProvider } from "@/lib/site/content";
import { SITE_TEMPLATE_DEFS, isDemoTemplate } from "@/components/site-templates/registry";
import FloatingBookingWidget from "@/components/site-templates/FloatingBookingWidget";

// Public template micro-site (Fase 4 — website builder). Same contract as the
// hosted menu /m/<slug>: service-role read, no auth, no cookies, branding from
// tenants.settings.
//
// Two rendering paths:
// - "classic" (default): the original design, assembled with the Website
//   dashboard form fields (sections on/off + order, hero/gallery, texts).
// - demo-site templates (site_branding.template): full-bleed replicas of the
//   agency demo sites, rendered from live CRM data + the owner's inline edits
//   (settings.site_content[template]), each embedding the real booking widget.
//
// The classic font trio and the --accent cascade are the exact /m/[slug]
// idiom: all three display serifs bind the SAME --font-display variable, so
// one class swap re-skins every heading, and only the chosen font's CSS ships.
// Demo templates load their own Google Fonts via <link> instead (their font
// pairs are template-specific and not known at build time).
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});
const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});
const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const DISPLAY_FONTS = { fraunces, playfair, cormorant } as const;

type Params = { slug: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings: TenantSettings;
};

type MenuItemRow = RawMenuItemRow & { sort_order: number };
type ReviewRow = RawReviewRow & { created_at: string };

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} className="text-base tracking-wide" style={{ color: "var(--accent, #c4956a)" }}>
      {"★".repeat(n)}
      <span className="opacity-25">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default async function PublicSitePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();

  const { data: tenant } = (await sb
    .from("tenants")
    .select("id,name,slug,status,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: TenantRow | null };

  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) notFound();
  const features = getFeatures(tenant.settings);
  if (!features.website_enabled) notFound();

  const settings = tenant.settings || {};
  const locale = resolveSiteLocale(settings.crm_locale);
  const ui = SITE_STRINGS[locale];
  const site = settings.site_branding || {};

  // ——— Demo-site template path ———
  const template = site.template;
  if (isDemoTemplate(template)) {
    const def = SITE_TEMPLATE_DEFS[template];
    const [menuRes, reviewsRes] = await Promise.all([
      sb
        .from("menu_items")
        .select("id,name,description,price,currency,image_url,sort_order")
        .eq("tenant_id", tenant.id)
        .eq("available", true)
        .order("sort_order", { ascending: true })
        .limit(24),
      sb
        .from("reviews")
        .select("rating,comment,created_at,guests(name)")
        .eq("tenant_id", tenant.id)
        .neq("status", "hidden")
        .gte("rating", 4)
        .neq("comment", "")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    const data = buildSiteData({
      tenantName: tenant.name,
      slug: tenant.slug,
      settings,
      menuRows: (menuRes.data || []) as MenuItemRow[],
      reviewRows: (reviewsRes.data || []) as unknown as ReviewRow[],
      giftCardsEnabled: features.gift_cards_enabled,
    });
    const overrides = (settings.site_content?.[template] || {}) as Record<string, string>;
    const content = { ...def.defaults, ...overrides };
    const Template = def.component;
    return (
      <>
        <PublicSiteScrollReset />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={def.fontsHref} />
        <SiteContentProvider value={{ content, editMode: false }}>
          <Template data={data} />
        </SiteContentProvider>
        <FloatingBookingWidget slug={tenant.slug} accent={def.accent} strings={data.bookingStrings} />
      </>
    );
  }

  // ——— Classic path (original design) ———
  // Enabled sections in the owner's order; unset → everything, canonical order.
  const sections: SiteSectionKey[] =
    Array.isArray(site.sections) && site.sections.length
      ? site.sections.filter((s): s is SiteSectionKey => (SITE_SECTIONS as readonly string[]).includes(s))
      : [...SITE_SECTIONS];
  const on = (k: SiteSectionKey) => sections.includes(k);

  // One roundtrip per enabled data section. The menu teaser prefers dishes with
  // a photo (they sell better); reviews show only public, non-hidden 4–5★.
  const [menuRes, reviewsRes] = await Promise.all([
    on("menu")
      ? sb
          .from("menu_items")
          .select("id,name,description,price,currency,image_url,sort_order")
          .eq("tenant_id", tenant.id)
          .eq("available", true)
          .order("sort_order", { ascending: true })
          .limit(24)
      : Promise.resolve({ data: null }),
    on("reviews")
      ? sb
          .from("reviews")
          .select("rating,comment,created_at,guests(name)")
          .eq("tenant_id", tenant.id)
          .neq("status", "hidden")
          .gte("rating", 4)
          .neq("comment", "")
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null }),
  ]);
  const menuRows = (menuRes.data || []) as MenuItemRow[];
  const withPhoto = menuRows.filter((r) => r.image_url);
  const menuItems = (withPhoto.length >= 3 ? withPhoto : menuRows).slice(0, 6);
  const reviews = (reviewsRes.data || []) as unknown as ReviewRow[];

  const venue = (settings.venue || {}) as { address?: string; city?: string; maps_short?: string };
  const phone = typeof settings.restaurant_phone === "string" ? settings.restaurant_phone.trim() : "";
  const hours = (settings.opening_hours || {}) as OpeningHours;
  const hasHours = Object.values(hours).some((slots) => Array.isArray(slots) && slots.length > 0);
  const gallery = Array.isArray(site.gallery) ? site.gallery.filter(Boolean) : [];

  const accent = site.brand_color || settings.menu_branding?.brand_color;
  const displayFont = DISPLAY_FONTS[site.font ?? settings.menu_branding?.font ?? "fraunces"] ?? fraunces;
  const wrapStyle = accent ? ({ ["--accent" as string]: accent } as CSSProperties) : undefined;

  const mapsHref =
    venue.maps_short ||
    (venue.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.address, venue.city].filter(Boolean).join(", "))}`
      : "");

  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  // Days rendered Monday-first; opening_hours keys are "0".."6" with Sunday = 0.
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];

  const sectionRenderers: Record<SiteSectionKey, () => React.ReactNode> = {
    about: () =>
      site.about_text ? (
        <section key="about" id="about" className="mx-auto max-w-3xl px-6 py-14 text-center">
          <h2 className="mb-5 text-3xl font-semibold text-black" style={{ fontFamily: "var(--font-display)" }}>
            {ui.about}
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-black">{site.about_text}</p>
        </section>
      ) : null,

    menu: () =>
      menuItems.length ? (
        <section key="menu" id="menu" className="px-6 py-14" style={{ background: "#fcf6ed" }}>
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-8 text-center text-3xl font-semibold text-black" style={{ fontFamily: "var(--font-display)" }}>
              {ui.menu}
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {menuItems.map((it) => (
                <div key={it.id} className="overflow-hidden rounded-2xl border-2 bg-white" style={{ borderColor: "var(--accent, #c4956a)" }}>
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_url} alt={it.name} className="h-44 w-full object-cover" loading="lazy" />
                  ) : null}
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold text-black">{it.name}</p>
                      {it.description ? <p className="mt-1 text-sm text-black opacity-80 line-clamp-2">{it.description}</p> : null}
                    </div>
                    {it.price != null ? (
                      <p className="shrink-0 font-semibold text-black">{formatSitePrice(it.price, it.currency || "EUR")}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 text-center">
              <a
                href={`/m/${tenant.slug}`}
                className="inline-block rounded-xl border-2 px-6 py-3 font-semibold text-black"
                style={{ borderColor: "var(--accent, #c4956a)" }}
              >
                {ui.fullMenu}
              </a>
            </div>
          </div>
        </section>
      ) : null,

    gallery: () =>
      gallery.length ? (
        <section key="gallery" id="gallery" className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="mb-8 text-center text-3xl font-semibold text-black" style={{ fontFamily: "var(--font-display)" }}>
            {ui.gallery}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt="" className="aspect-square w-full rounded-2xl object-cover" loading="lazy" />
            ))}
          </div>
        </section>
      ) : null,

    reviews: () => (
      <section key="reviews" id="reviews" className="px-6 py-14" style={{ background: "#fcf6ed" }}>
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-2 text-center text-3xl font-semibold text-black" style={{ fontFamily: "var(--font-display)" }}>
            {ui.reviews}
          </h2>
          {reviews.length ? (
            <>
              <p className="mb-8 text-center">
                <Stars n={Math.round(avg)} /> <span className="font-semibold text-black">{avg.toFixed(1)}</span>
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                {reviews.map((r, i) => (
                  <figure key={i} className="rounded-2xl border-2 bg-white p-5" style={{ borderColor: "var(--accent, #c4956a)" }}>
                    <Stars n={r.rating} />
                    <blockquote className="mt-2 text-sm leading-relaxed text-black">“{r.comment}”</blockquote>
                    <figcaption className="mt-3 text-sm font-semibold text-black">{firstName(r.guests?.name ?? null)}</figcaption>
                  </figure>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-black">{ui.reviewsEmpty}</p>
          )}
        </div>
      </section>
    ),

    hours: () =>
      hasHours ? (
        <section key="hours" id="hours" className="mx-auto max-w-2xl px-6 py-14">
          <h2 className="mb-8 text-center text-3xl font-semibold text-black" style={{ fontFamily: "var(--font-display)" }}>
            {ui.hours}
          </h2>
          <dl className="divide-y-2 rounded-2xl border-2" style={{ borderColor: "var(--accent, #c4956a)" }}>
            {dayOrder.map((d, i) => {
              const slots = hours[String(d)] || [];
              return (
                <div key={d} className="flex items-center justify-between px-5 py-3" style={{ borderColor: "var(--accent, #c4956a)" }}>
                  <dt className="font-semibold text-black">{ui.days[i]}</dt>
                  <dd className="text-black">
                    {slots.length ? slots.map((s) => `${s.open}–${s.close}`).join(" · ") : ui.closed}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ) : null,

    contact: () =>
      venue.address || phone ? (
        <section key="contact" id="contact" className="px-6 py-14" style={{ background: "#fcf6ed" }}>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-6 text-3xl font-semibold text-black" style={{ fontFamily: "var(--font-display)" }}>
              {ui.contact}
            </h2>
            {venue.address ? (
              <p className="text-black">
                <span className="font-semibold">{ui.address}:</span> {[venue.address, venue.city].filter(Boolean).join(", ")}
              </p>
            ) : null}
            {phone ? (
              <p className="mt-2 text-black">
                <span className="font-semibold">{ui.phone}:</span>{" "}
                <a href={`tel:${phone.replace(/\s+/g, "")}`} className="underline">
                  {phone}
                </a>
              </p>
            ) : null}
            {mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-block rounded-xl border-2 px-6 py-3 font-semibold text-black"
                style={{ borderColor: "var(--accent, #c4956a)" }}
              >
                {ui.map}
              </a>
            ) : null}
          </div>
        </section>
      ) : null,
  };

  return (
    <>
    <PublicSiteScrollReset />
    <div className={`${displayFont.variable} ${manrope.variable} min-h-screen bg-white`} style={{ ...wrapStyle, fontFamily: "var(--font-body)" }}>
      {/* Hero — always on */}
      <header className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-6 py-20 text-center">
        {site.hero_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={site.hero_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/45" />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #2b2018, #4a352a)" }} />
        )}
        <div className="relative">
          <h1 className="text-5xl font-semibold text-white sm:text-6xl" style={{ fontFamily: "var(--font-display)" }}>
            {tenant.name}
          </h1>
          {site.tagline ? <p className="mt-4 text-lg text-white/90">{site.tagline}</p> : null}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`/b/${tenant.slug}`}
              className="rounded-xl px-7 py-3.5 font-semibold text-white"
              style={{ background: "var(--accent, #c4956a)" }}
            >
              {ui.book}
            </a>
            <a href={`/m/${tenant.slug}`} className="rounded-xl border-2 border-white px-7 py-3.5 font-semibold text-white">
              {ui.viewMenu}
            </a>
            {features.gift_cards_enabled ? (
              <a href={`/g/${tenant.slug}`} className="rounded-xl border-2 border-white px-7 py-3.5 font-semibold text-white">
                {ui.giftCta}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {sections.map((k) => sectionRenderers[k]())}

      <footer className="px-6 py-10 text-center text-sm text-black" style={{ background: "#fcf6ed" }}>
        <p className="font-semibold">{tenant.name}</p>
        {venue.address ? <p className="mt-1">{[venue.address, venue.city].filter(Boolean).join(", ")}</p> : null}
      </footer>
    </div>
    </>
  );
}

// The CRM app-shell pins html/body scroll (overscroll-behavior:none + a
// non-scalable viewport) to kill rubber-band bounce inside the dashboard. On
// the public micro-site that same rule makes some browsers (e.g. Brave on a
// Mac trackpad) treat the whole document as non-scrollable — the wheel/gesture
// does nothing while the scrollbar still drags. These pages are a normal
// document, so we restore native scrolling for them.
function PublicSiteScrollReset() {
  return (
    <style>{`html,body{overscroll-behavior:auto;overflow-x:visible;touch-action:auto;height:auto;}`}</style>
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();
  const { data } = (await sb
    .from("tenants")
    .select("name,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: { name: string; settings: TenantSettings } | null };
  const site = data?.settings?.site_branding;
  const title = data?.name || "Restaurant";
  const description = site?.tagline || site?.about_text?.slice(0, 160) || title;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(site?.hero_url ? { images: [{ url: site.hero_url }] } : {}),
    },
  };
}
