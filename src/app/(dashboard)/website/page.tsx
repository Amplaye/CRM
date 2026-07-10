"use client";

// Website builder (Fase 4) — the owner assembles the public micro-site
// /s/<slug> from here: hero photo + tagline, about text, gallery, accent
// colour, display font, and which sections appear (with their order). A form
// with toggles and arrows, deliberately NO drag-and-drop. Persists straight to
// tenants.settings.site_branding under RLS (owner), same optimistic pattern as
// the menu-branding panel.

import { hasActivePlan } from "@/lib/billing/entitlements";
import {
  getFeatures,
  SITE_SECTIONS,
  type SiteSectionKey,
  type SiteTemplateKey,
  type TenantSettings,
} from "@/lib/types/tenant-settings";
import { SITE_TEMPLATE_DEFS, isDemoTemplate } from "@/components/site-templates/registry";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { uploadSitePhoto } from "@/lib/site/upload-site-photo";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Globe, Trash2, Upload } from "lucide-react";
import Link from "next/link";

const CARD = { borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" } as const;
const INPUT =
  "w-full rounded-lg border-2 px-3 py-2 text-sm text-black bg-white focus:outline-none";
const INPUT_STYLE = { borderColor: "#c4956a" } as const;

type SiteBranding = NonNullable<TenantSettings["site_branding"]>;
type SiteFont = NonNullable<SiteBranding["font"]>;

const BRAND_SWATCHES = ["#b07a32", "#7e5226", "#a8421f", "#8a5f28", "#5c6c4b", "#7c4a52", "#2f5d62"];
const MAX_GALLERY = 8;

export default function WebsitePage() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant, activeRole, globalRole } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const canEdit = activeRole === "owner" || activeRole === "manager" || globalRole === "platform_admin";

  const planActive = hasActivePlan(tenant?.settings);
  const enabled = getFeatures(tenant?.settings).website_enabled;

  const saved = (tenant?.settings?.site_branding || {}) as SiteBranding;
  const [template, setTemplate] = useState<SiteTemplateKey>(saved.template ?? "classic");
  const [tagline, setTagline] = useState(saved.tagline ?? "");
  const [aboutText, setAboutText] = useState(saved.about_text ?? "");
  const [brandColor, setBrandColor] = useState(saved.brand_color ?? "");
  const [font, setFont] = useState<SiteFont>(saved.font ?? "fraunces");
  const [heroUrl, setHeroUrl] = useState(saved.hero_url ?? "");
  const [gallery, setGallery] = useState<string[]>(saved.gallery ?? []);
  const [sections, setSections] = useState<SiteSectionKey[]>(
    saved.sections?.length ? saved.sections : [...SITE_SECTIONS],
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"hero" | "gallery" | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const b = (tenant?.settings?.site_branding || {}) as SiteBranding;
    setTemplate(b.template ?? "classic");
    setTagline(b.tagline ?? "");
    setAboutText(b.about_text ?? "");
    setBrandColor(b.brand_color ?? "");
    setFont(b.font ?? "fraunces");
    setHeroUrl(b.hero_url ?? "");
    setGallery(b.gallery ?? []);
    setSections(b.sections?.length ? b.sections : [...SITE_SECTIONS]);
  }, [tenant?.settings?.site_branding]);

  // Persist a partial change. Multi-tenant invariant: spread the FULL existing
  // settings so no other key is dropped; rebuild site_branding whole so cleared
  // fields become undefined instead of lingering.
  const save = async (patch: Partial<SiteBranding>) => {
    if (!tenant || !canEdit) return;
    const cur = (tenant.settings?.site_branding || {}) as SiteBranding;
    const next: SiteBranding = { ...cur, ...patch };
    for (const k of Object.keys(next) as (keyof SiteBranding)[]) {
      if (next[k] === "" || next[k] === null) delete next[k];
    }
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ settings: { ...tenant.settings, site_branding: next } })
      .eq("id", tenant.id);
    setSaving(false);
    if (error) {
      alert(`Error: ${error.message}`);
      return;
    }
    await refreshActiveTenant();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleHeroPick = async (file: File | null) => {
    if (!tenant || !canEdit || !file || !file.type.startsWith("image/")) return;
    setUploading("hero");
    try {
      const url = await uploadSitePhoto(supabase, tenant.id, file, "site-hero.webp");
      setHeroUrl(url);
      await save({ hero_url: url });
    } catch (e) {
      alert(`Upload error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(null);
      if (heroInputRef.current) heroInputRef.current.value = "";
    }
  };

  const handleGalleryPick = async (files: FileList | null) => {
    if (!tenant || !canEdit || !files?.length) return;
    setUploading("gallery");
    try {
      const next = [...gallery];
      for (const file of Array.from(files).slice(0, MAX_GALLERY - gallery.length)) {
        if (!file.type.startsWith("image/")) continue;
        // Unique name per slot so photos never clobber each other.
        const name = `site-gallery-${next.length}-${file.size}.webp`;
        next.push(await uploadSitePhoto(supabase, tenant.id, file, name));
      }
      setGallery(next);
      await save({ gallery: next });
    } catch (e) {
      alert(`Upload error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(null);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  };

  const removeGalleryPhoto = async (idx: number) => {
    const next = gallery.filter((_, i) => i !== idx);
    setGallery(next);
    await save({ gallery: next });
  };

  const toggleSection = (k: SiteSectionKey) => {
    const next = sections.includes(k)
      ? sections.filter((s) => s !== k)
      : // Re-enable in canonical position relative to the current order.
        [...sections, k].sort(
          (a, b) => SITE_SECTIONS.indexOf(a) - SITE_SECTIONS.indexOf(b),
        );
    setSections(next);
    void save({ sections: next });
  };

  const moveSection = (k: SiteSectionKey, dir: -1 | 1) => {
    const i = sections.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
    void save({ sections: next });
  };

  const selectTemplate = (k: SiteTemplateKey) => {
    if (!canEdit) return;
    setTemplate(k);
    void save({ template: k });
  };

  if (!planActive || !enabled) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-2xl font-bold text-black">{t("website_title")}</h1>
        <div className="mt-4 rounded-xl border-2 p-6 max-w-xl" style={CARD}>
          <p className="text-sm text-black">{t("website_disabled_hint")}</p>
          <Link
            href="/settings?tab=features"
            className="mt-3 inline-block text-sm font-semibold text-white rounded-lg px-4 py-2"
            style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
          >
            {t("reviews_disabled_cta")}
          </Link>
        </div>
      </div>
    );
  }

  const siteUrl = tenant ? `/s/${tenant.slug}` : "#";
  const SECTION_LABEL: Record<SiteSectionKey, string> = {
    about: t("website_section_about"),
    menu: t("website_section_menu"),
    gallery: t("website_section_gallery"),
    reviews: t("website_section_reviews"),
    hours: t("website_section_hours"),
    contact: t("website_section_contact"),
  };

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Globe className="w-6 h-6" />
            {t("website_title")}
          </h1>
          <p className="text-sm text-black mt-1">{t("website_desc")}</p>
        </div>
        <a
          href={siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
        >
          <ExternalLink className="w-4 h-4" />
          {t("website_open_site")}
        </a>
      </div>

      {savedFlash ? (
        <p className="text-sm font-semibold text-black">{t("website_saved")}</p>
      ) : null}

      {/* Template picker — classic (form-driven) + the demo-site replicas
          (edited inline in the visual editor). */}
      <div className="rounded-xl border-2 p-5 max-w-3xl space-y-4" style={CARD}>
        <h2 className="font-bold text-black">{t("website_templates_title")}</h2>
        <p className="text-sm text-black">{t("website_templates_hint")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => selectTemplate("classic")}
            className="rounded-lg border-2 bg-white p-3 text-left"
            style={{ borderColor: template === "classic" ? "#1c150d" : "#c4956a" }}
          >
            <span className="flex items-center gap-1.5">
              {["#fcf6ed", "#c4956a", "#2b2018"].map((c) => (
                <span key={c} className="h-4 w-4 rounded-full border" style={{ background: c, borderColor: "rgba(0,0,0,0.15)" }} />
              ))}
            </span>
            <span className="mt-2 block text-sm font-bold text-black">{t("website_template_classic")}</span>
            <span className="block text-xs text-black opacity-70">{t("website_template_classic_desc")}</span>
          </button>
          {(Object.entries(SITE_TEMPLATE_DEFS) as [Exclude<SiteTemplateKey, "classic">, (typeof SITE_TEMPLATE_DEFS)[Exclude<SiteTemplateKey, "classic">]][]).map(
            ([k, d]) => (
              <button
                key={k}
                type="button"
                onClick={() => selectTemplate(k)}
                className="rounded-lg border-2 bg-white p-3 text-left"
                style={{ borderColor: template === k ? "#1c150d" : "#c4956a" }}
              >
                <span className="flex items-center gap-1.5">
                  {d.swatches.map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full border" style={{ background: c, borderColor: "rgba(0,0,0,0.15)" }} />
                  ))}
                </span>
                <span className="mt-2 block text-sm font-bold text-black">{d.label}</span>
                <span className="block text-xs text-black opacity-70">{d.vibe}</span>
              </button>
            ),
          )}
        </div>
        {isDemoTemplate(template) ? (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/website/editor"
              className="inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
            >
              {t("website_editor_open")}
            </Link>
            <p className="min-w-[220px] flex-1 text-sm text-black">{t("website_editor_hint")}</p>
          </div>
        ) : null}
      </div>

      {template === "classic" ? (
      <>
      {/* Hero */}
      <div className="rounded-xl border-2 p-5 max-w-2xl space-y-4" style={CARD}>
        <h2 className="font-bold text-black">{t("website_hero_title")}</h2>
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroUrl} alt="" className="h-40 w-full rounded-lg object-cover" />
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={heroInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleHeroPick(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={uploading === "hero" || !canEdit}
            onClick={() => heroInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-semibold text-black bg-white disabled:opacity-50"
            style={INPUT_STYLE}
          >
            <Upload className="w-4 h-4" />
            {uploading === "hero"
              ? t("website_uploading")
              : heroUrl
                ? t("website_hero_change")
                : t("website_hero_upload")}
          </button>
        </div>
        <div>
          <label className="block text-sm font-bold text-black mb-1">{t("website_tagline_label")}</label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            onBlur={() => void save({ tagline })}
            placeholder={t("website_tagline_ph")}
            className={INPUT}
            style={INPUT_STYLE}
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* About */}
      <div className="rounded-xl border-2 p-5 max-w-2xl space-y-3" style={CARD}>
        <h2 className="font-bold text-black">{t("website_about_title")}</h2>
        <textarea
          value={aboutText}
          onChange={(e) => setAboutText(e.target.value)}
          onBlur={() => void save({ about_text: aboutText })}
          rows={5}
          placeholder={t("website_about_ph")}
          className={INPUT}
          style={INPUT_STYLE}
          disabled={!canEdit}
        />
      </div>

      {/* Style */}
      <div className="rounded-xl border-2 p-5 max-w-2xl space-y-4" style={CARD}>
        <h2 className="font-bold text-black">{t("website_style_title")}</h2>
        <div>
          <label className="block text-sm font-bold text-black mb-2">{t("menu_branding_color")}</label>
          <div className="flex flex-wrap items-center gap-2">
            {BRAND_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  setBrandColor(c);
                  void save({ brand_color: c });
                }}
                className="h-8 w-8 rounded-full border-2"
                style={{
                  background: c,
                  borderColor: brandColor === c ? "#1c150d" : "transparent",
                }}
              />
            ))}
            {brandColor ? (
              <button
                type="button"
                onClick={() => {
                  setBrandColor("");
                  void save({ brand_color: "" });
                }}
                className="text-sm font-semibold text-black underline"
              >
                {t("menu_branding_color_reset")}
              </button>
            ) : null}
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold text-black mb-1">{t("menu_branding_font")}</label>
          <select
            value={font}
            onChange={(e) => {
              const f = e.target.value as SiteFont;
              setFont(f);
              void save({ font: f });
            }}
            className={INPUT}
            style={INPUT_STYLE}
            disabled={!canEdit}
          >
            <option value="fraunces">Fraunces</option>
            <option value="playfair">Playfair Display</option>
            <option value="cormorant">Cormorant</option>
          </select>
        </div>
      </div>

      {/* Gallery */}
      <div className="rounded-xl border-2 p-5 max-w-2xl space-y-4" style={CARD}>
        <h2 className="font-bold text-black">{t("website_gallery_title")}</h2>
        {gallery.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {gallery.map((url, i) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <button
                  type="button"
                  aria-label={t("website_gallery_remove")}
                  onClick={() => void removeGalleryPhoto(i)}
                  className="absolute right-1 top-1 rounded-full bg-white p-1.5"
                >
                  <Trash2 className="w-4 h-4 text-black" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void handleGalleryPick(e.target.files)}
        />
        <button
          type="button"
          disabled={uploading === "gallery" || gallery.length >= MAX_GALLERY || !canEdit}
          onClick={() => galleryInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-semibold text-black bg-white disabled:opacity-50"
          style={INPUT_STYLE}
        >
          <Upload className="w-4 h-4" />
          {uploading === "gallery" ? t("website_uploading") : t("website_gallery_add")}
        </button>
      </div>

      {/* Sections on/off + order */}
      <div className="rounded-xl border-2 p-5 max-w-2xl space-y-3" style={CARD}>
        <h2 className="font-bold text-black">{t("website_sections_title")}</h2>
        <p className="text-sm text-black">{t("website_sections_hint")}</p>
        <ul className="space-y-2">
          {/* Enabled sections first, in their order; disabled ones after. */}
          {[...sections, ...SITE_SECTIONS.filter((k) => !sections.includes(k))].map((k) => {
            const isOn = sections.includes(k);
            return (
              <li
                key={k}
                className="flex items-center justify-between rounded-lg border-2 bg-white px-4 py-2"
                style={INPUT_STYLE}
              >
                <label className="flex items-center gap-3 text-sm font-semibold text-black">
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggleSection(k)}
                    disabled={!canEdit}
                    className="h-4 w-4"
                  />
                  {SECTION_LABEL[k]}
                </label>
                {isOn ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="up"
                      onClick={() => moveSection(k, -1)}
                      className="rounded p-1 disabled:opacity-30"
                      disabled={sections.indexOf(k) === 0 || !canEdit}
                    >
                      <ArrowUp className="w-4 h-4 text-black" />
                    </button>
                    <button
                      type="button"
                      aria-label="down"
                      onClick={() => moveSection(k, 1)}
                      className="rounded p-1 disabled:opacity-30"
                      disabled={sections.indexOf(k) === sections.length - 1 || !canEdit}
                    >
                      <ArrowDown className="w-4 h-4 text-black" />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      </>
      ) : null}

      {saving ? <p className="text-sm text-black">{t("website_saving")}</p> : null}
    </div>
  );
}
