"use client";

// Visual editor for the demo-site templates (Website → "Modifica il sito").
// Renders the SAME template component as the public /s/<slug> page, but with
// editMode on: click any text to rewrite it in place, click any photo to
// replace it (upload → branding bucket). Only diffs vs the template defaults
// are persisted, in tenants.settings.site_content[template], so template
// copy updates keep flowing to untouched blocks. The booking widget stays
// live on purpose — the owner can test the real availability flow from here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, Save } from "lucide-react";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { SiteContentProvider } from "@/lib/site/content";
import { buildSiteData, type RawMenuItemRow, type RawReviewRow } from "@/lib/site/data";
import { uploadSitePhoto, siteBlockFileName } from "@/lib/site/upload-site-photo";
import { SITE_TEMPLATE_DEFS, isDemoTemplate } from "@/components/site-templates/registry";
import FloatingBookingWidget from "@/components/site-templates/FloatingBookingWidget";

export default function WebsiteEditorPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { activeTenant: tenant, refreshActiveTenant, activeRole, globalRole } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const canEdit = activeRole === "owner" || activeRole === "manager" || globalRole === "platform_admin";

  const settings = (tenant?.settings || {}) as TenantSettings;
  const template = settings.site_branding?.template;
  const demo = isDemoTemplate(template) ? template : null;
  const def = demo ? SITE_TEMPLATE_DEFS[demo] : null;

  const planActive = hasActivePlan(tenant?.settings);
  const enabled = getFeatures(tenant?.settings).website_enabled;

  const [menuRows, setMenuRows] = useState<RawMenuItemRow[]>([]);
  const [reviewRows, setReviewRows] = useState<RawReviewRow[]>([]);
  const [content, setContent] = useState<Record<string, string> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const pendingImageId = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // No template selected / module off → back to the Website dashboard.
  useEffect(() => {
    if (tenant && (!demo || !planActive || !enabled)) router.replace("/website");
  }, [tenant, demo, planActive, enabled, router]);

  // Initial content = template defaults ⊕ saved overrides.
  useEffect(() => {
    if (!demo || !def) return;
    const overrides = (settings.site_content?.[demo] || {}) as Record<string, string>;
    setContent({ ...def.defaults, ...overrides });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, tenant?.id]);

  // Live data for the preview (same rows the public page reads).
  useEffect(() => {
    if (!tenant || !demo) return;
    let alive = true;
    (async () => {
      const [menuRes, reviewsRes] = await Promise.all([
        supabase
          .from("menu_items")
          .select("id,name,description,price,currency,image_url,sort_order")
          .eq("tenant_id", tenant.id)
          .eq("available", true)
          .order("sort_order", { ascending: true })
          .limit(24),
        supabase
          .from("reviews")
          .select("rating,comment,created_at,guests(name)")
          .eq("tenant_id", tenant.id)
          .neq("status", "hidden")
          .gte("rating", 4)
          .neq("comment", "")
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      if (!alive) return;
      setMenuRows((menuRes.data || []) as RawMenuItemRow[]);
      setReviewRows(((reviewsRes.data || []) as unknown) as RawReviewRow[]);
    })();
    return () => {
      alive = false;
    };
  }, [tenant, demo, supabase]);

  // Warn on tab close with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const onEditText = useCallback((id: string, value: string) => {
    setContent((cur) => (cur ? { ...cur, [id]: value } : cur));
    setDirty(true);
  }, []);

  const onEditImage = useCallback((id: string) => {
    pendingImageId.current = id;
    fileInputRef.current?.click();
  }, []);

  const handleImagePick = async (file: File | null) => {
    const id = pendingImageId.current;
    pendingImageId.current = null;
    if (!tenant || !demo || !id || !file || !file.type.startsWith("image/")) return;
    setUploadingImg(true);
    try {
      const url = await uploadSitePhoto(supabase, tenant.id, file, siteBlockFileName(demo, id));
      setContent((cur) => (cur ? { ...cur, [id]: url } : cur));
      setDirty(true);
    } catch (e) {
      alert(`Upload error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const save = async () => {
    if (!tenant || !demo || !def || !content || !canEdit) return;
    // Persist only the diff vs defaults; a block reverted to the default text
    // drops out of the override map entirely.
    const overrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(content)) {
      if (def.defaults[k] !== v) overrides[k] = v;
    }
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        settings: {
          ...tenant.settings,
          site_content: { ...(settings.site_content || {}), [demo]: overrides },
        },
      })
      .eq("id", tenant.id);
    setSaving(false);
    if (error) {
      alert(`Error: ${error.message}`);
      return;
    }
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    await refreshActiveTenant();
  };

  const exit = () => {
    if (dirty && !confirm(t("website_editor_confirm_exit"))) return;
    router.push("/website");
  };

  if (!tenant || !demo || !def || !content) return null;

  const data = buildSiteData({
    tenantName: tenant.name,
    slug: tenant.slug,
    settings,
    menuRows,
    reviewRows,
    giftCardsEnabled: getFeatures(settings).gift_cards_enabled,
  });

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-neutral-900">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={def.fontsHref} />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-neutral-900 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={exit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("website_editor_exit")}
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">
              {t("website_editor_title")} — {def.label}
            </p>
            <p className="hidden truncate text-xs text-white/60 sm:block">{t("website_editor_click_hint")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {uploadingImg ? <span className="text-xs text-white/70">{t("website_uploading")}</span> : null}
          {savedFlash ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <Check className="h-4 w-4" />
              {t("website_editor_saved")}
            </span>
          ) : dirty ? (
            <span className="text-xs font-semibold text-amber-400">{t("website_editor_unsaved")}</span>
          ) : null}
          <a
            href={`/s/${tenant.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-white sm:inline-flex"
          >
            <ExternalLink className="h-4 w-4" />
            {t("website_open_site")}
          </a>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty || !canEdit}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
          >
            <Save className="h-4 w-4" />
            {saving ? t("website_editor_saving") : t("website_editor_save")}
          </button>
        </div>
      </div>

      {/* Live template preview, editable in place */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SiteContentProvider value={{ content, editMode: canEdit, onEditText, onEditImage }}>
          <def.component data={data} />
        </SiteContentProvider>
        <FloatingBookingWidget slug={tenant.slug} accent={def.accent} strings={data.bookingStrings} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleImagePick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
