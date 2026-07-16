"use client";

// Gift-card design editor — the owner composes the cards the public /g/<slug>
// page sells. Same self-serve spirit as the menu/website branding: it writes to
// `tenants.settings.gift_designs`, no code, no deploy.
//
// Persistence follows the website-dashboard idiom: spread the FULL settings so
// no unrelated key is dropped, then refresh the tenant so the preview and the
// public page read the same source of truth.

import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Palette, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { uploadSitePhoto } from "@/lib/site/upload-site-photo";
import {
  isValidGiftDesign,
  newGiftDesign,
  MAX_GIFT_DESIGNS,
  type GiftDesign,
  type GiftDesignStyle,
} from "@/lib/gift-cards/designs";
import { GIFT_MAX_CENTS, GIFT_MIN_CENTS } from "@/lib/gift-cards/format";
import { GiftCardPreview } from "./GiftCardPreview";

const CARD = { borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" } as const;
const INPUT =
  "w-full rounded-lg border-2 bg-white px-3 py-2 text-sm text-black focus:outline-none";
const INPUT_BORDER = { borderColor: "#e2d5bf" } as const;

const STYLES: Array<{ key: GiftDesignStyle; labelKey: string }> = [
  { key: "solid", labelKey: "gift_design_style_solid" },
  { key: "gradient", labelKey: "gift_design_style_gradient" },
  { key: "image", labelKey: "gift_design_style_image" },
];

export function GiftDesignEditor({ canEdit }: { canEdit: boolean }) {
  const { t } = useLanguage();
  const { activeTenant, refreshActiveTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const tk = (k: string) => t(k as never) as string;

  const accent =
    activeTenant?.settings?.site_branding?.brand_color ||
    activeTenant?.settings?.menu_branding?.brand_color ||
    "#c4956a";

  const [designs, setDesigns] = useState<GiftDesign[]>([]);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const raw = activeTenant?.settings?.gift_designs;
    setDesigns(Array.isArray(raw) ? (raw as GiftDesign[]) : []);
  }, [activeTenant?.settings?.gift_designs]);

  const dirty = useMemo(() => {
    const saved = JSON.stringify(activeTenant?.settings?.gift_designs ?? []);
    return saved !== JSON.stringify(designs);
  }, [activeTenant?.settings?.gift_designs, designs]);

  const invalidCount = designs.filter((d) => !isValidGiftDesign(d)).length;

  const patch = (id: string, over: Partial<GiftDesign>) =>
    setDesigns((ds) => ds.map((d) => (d.id === id ? { ...d, ...over } : d)));

  const save = async () => {
    if (!activeTenant || !canEdit) return;
    // Only publishable cards are persisted: a half-typed card must never reach
    // the public page, and dropping it here keeps the stored array trustworthy
    // for every reader (checkout included).
    const clean = designs.filter(isValidGiftDesign);
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ settings: { ...activeTenant.settings, gift_designs: clean } })
      .eq("id", activeTenant.id);
    setSaving(false);
    if (error) {
      setFlash(`${tk("gift_design_save_error")}: ${error.message}`);
      return;
    }
    setDesigns(clean);
    await refreshActiveTenant();
    setFlash(tk("gift_design_saved"));
    setTimeout(() => setFlash(null), 2000);
  };

  const pickImage = async (d: GiftDesign, file: File | null) => {
    if (!activeTenant || !file || !file.type.startsWith("image/")) return;
    setUploadingId(d.id);
    try {
      const url = await uploadSitePhoto(supabase, activeTenant.id, file, `gift-${d.id}.webp`);
      patch(d.id, { image_url: url, style: "image" });
    } catch (e) {
      setFlash(`${tk("gift_design_save_error")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingId(null);
      const input = fileRefs.current[d.id];
      if (input) input.value = "";
    }
  };

  if (!canEdit) return null;

  return (
    <div className="rounded-xl border-2 p-4 sm:p-6 space-y-4" style={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-black flex items-center gap-2">
            <Palette className="w-5 h-5" /> {tk("gift_design_title")}
          </h2>
          <p className="text-sm text-black mt-1">{tk("gift_design_desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDesigns((ds) => [...ds, newGiftDesign(accent)])}
            disabled={designs.length >= MAX_GIFT_DESIGNS}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-bold text-black bg-white cursor-pointer disabled:opacity-40"
            style={{ borderColor: "#c4956a" }}
          >
            <Plus className="w-4 h-4" /> {tk("gift_design_add")}
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
          >
            {saving ? "…" : tk("gift_design_save")}
          </button>
        </div>
      </div>

      {flash && <p className="text-sm font-bold text-black">{flash}</p>}
      {invalidCount > 0 && (
        <p className="text-sm font-bold text-red-700">{tk("gift_design_incomplete")}</p>
      )}

      {designs.length === 0 ? (
        <p className="text-sm text-black">{tk("gift_design_empty")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {designs.map((d) => (
            <div key={d.id} className="rounded-xl border-2 bg-white p-3 space-y-3" style={INPUT_BORDER}>
              <GiftCardPreview design={d} />

              <input
                value={d.title}
                onChange={(e) => patch(d.id, { title: e.target.value.slice(0, 40) })}
                placeholder={tk("gift_design_title_ph")}
                className={INPUT}
                style={INPUT_BORDER}
              />
              <input
                value={d.subtitle ?? ""}
                onChange={(e) => patch(d.id, { subtitle: e.target.value.slice(0, 80) })}
                placeholder={tk("gift_design_subtitle_ph")}
                className={INPUT}
                style={INPUT_BORDER}
              />

              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-black shrink-0">{tk("gift_design_amount")}</label>
                <input
                  inputMode="numeric"
                  value={d.amount_cents ? String(d.amount_cents / 100) : ""}
                  onChange={(e) => {
                    const euros = Number(e.target.value.replace(",", "."));
                    patch(d.id, {
                      amount_cents: Number.isFinite(euros) ? Math.round(euros * 100) : 0,
                    });
                  }}
                  className={`${INPUT} w-28`}
                  style={INPUT_BORDER}
                />
                <span className="text-sm font-bold text-black">€</span>
                <span className="text-xs text-black">
                  {GIFT_MIN_CENTS / 100}–{GIFT_MAX_CENTS / 100}
                </span>
              </div>

              {/* Background style */}
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => patch(d.id, { style: s.key })}
                    className={`rounded-lg border-2 px-2.5 py-1 text-xs font-bold cursor-pointer ${
                      d.style === s.key ? "text-white" : "text-black"
                    }`}
                    style={
                      d.style === s.key
                        ? { background: "#c4956a", borderColor: "#c4956a" }
                        : { borderColor: "#e2d5bf" }
                    }
                  >
                    {tk(s.labelKey)}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-bold text-black">
                  {d.style === "gradient" ? tk("gift_design_color_from") : tk("gift_design_color")}
                  <input
                    type="color"
                    value={d.color}
                    onChange={(e) => patch(d.id, { color: e.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                </label>
                {d.style === "gradient" && (
                  <label className="flex items-center gap-1.5 text-xs font-bold text-black">
                    {tk("gift_design_color_to")}
                    <input
                      type="color"
                      value={d.color2 || d.color}
                      onChange={(e) => patch(d.id, { color2: e.target.value })}
                      className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-xs font-bold text-black">
                  {tk("gift_design_text_color")}
                  <input
                    type="color"
                    value={d.text_color || "#ffffff"}
                    onChange={(e) => patch(d.id, { text_color: e.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                </label>
              </div>

              {d.style === "image" && (
                <div>
                  <input
                    ref={(el) => {
                      fileRefs.current[d.id] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void pickImage(d, e.target.files?.[0] ?? null)}
                  />
                  <button
                    onClick={() => fileRefs.current[d.id]?.click()}
                    disabled={uploadingId === d.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-bold text-black cursor-pointer disabled:opacity-40"
                    style={INPUT_BORDER}
                  >
                    <ImageIcon className="w-4 h-4" />
                    {uploadingId === d.id
                      ? tk("gift_design_uploading")
                      : d.image_url
                        ? tk("gift_design_image_change")
                        : tk("gift_design_image_add")}
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => patch(d.id, { enabled: d.enabled === false })}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-black cursor-pointer"
                >
                  {d.enabled === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {d.enabled === false ? tk("gift_design_hidden") : tk("gift_design_visible")}
                </button>
                <button
                  onClick={() => setDesigns((ds) => ds.filter((x) => x.id !== d.id))}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> {tk("gift_design_delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
