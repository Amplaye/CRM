"use client";

// Social section — connect Instagram/Facebook, compose AI-drafted posts
// (image / carousel / reel rendered in the browser with Remotion), and manage
// the human-approval queue. Nothing publishes without the owner approving; the
// hourly social-publish cron does the actual Graph publishing.
//
// Aesthetic follows the CRM: bronze accent #c4956a, text-black (never grey),
// cursor-pointer + focus rings on interactive elements.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Share2, Sparkles, Image as ImageIcon, Layers, Film, Trash2, Check, Clock, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { getFeatures } from "@/lib/types/tenant-settings";
import { hasActivePlan } from "@/lib/billing/entitlements";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { ConnectCard } from "@/components/social/ConnectCard";
import { SocialPostPreview } from "@/components/social/SocialPostPreview";
import { renderAndUpload, isVideoRenderSupported } from "@/components/social/render";
import type { SocialSlide } from "@/components/social/remotion/types";

type PostType = "image" | "carousel" | "reels";
type PostStatus = "draft" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "canceled";

interface MenuItemRow {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  image_url: string | null;
}
interface SocialAccountRow {
  platform: "instagram" | "facebook";
  account_name: string | null;
  status: "connected" | "expired" | "revoked";
}
interface SocialPostRow {
  id: string;
  status: PostStatus;
  media_type: PostType;
  caption: string;
  media_urls: string[];
  targets: string[];
  scheduled_at: string | null;
  error: string | null;
}

const fmtPrice = (n: number | null, currency: string) =>
  n == null ? "" : new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR" }).format(n);

// CRM design tokens — warm cream card on a bronze border, bronze accents. Matches
// marketing/website so the Social section reads as one system, not a white patch.
const ACCENT = "#c4956a";
const CARD = { borderColor: ACCENT, background: "rgba(252,246,237,0.85)" } as const;
const INPUT_STYLE = { borderColor: ACCENT, background: "rgba(252,246,237,0.6)" } as const;
const PRIMARY = { background: "linear-gradient(135deg, #c4956a, #a0764e)" } as const;
const INNER = { borderColor: "rgba(196,149,106,0.5)", background: "rgba(252,246,237,0.5)" } as const;

export default function SocialPage() {
  const { t } = useLanguage();
  const tt = (k: string) => t(k as keyof Dictionary);
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const enabled = getFeatures(activeTenant?.settings).social_enabled;
  const planActive = hasActivePlan(activeTenant?.settings);

  const [menu, setMenu] = useState<MenuItemRow[]>([]);
  const [accounts, setAccounts] = useState<SocialAccountRow[]>([]);
  const [posts, setPosts] = useState<SocialPostRow[]>([]);

  // Composer state
  const [postType, setPostType] = useState<PostType>("image");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [targets, setTargets] = useState<Array<"instagram" | "facebook">>(["instagram", "facebook"]);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = accounts.some((a) => a.status === "connected");
  const connectedName = accounts.find((a) => a.status === "connected")?.account_name || null;
  const connectedStatus = accounts.find((a) => a.account_name)?.status ?? null;
  const brandColor =
    (activeTenant?.settings as { menu_branding?: { brand_color?: string } } | undefined)?.menu_branding?.brand_color ||
    "#c4956a";
  const logoUrl = (activeTenant?.settings as { menu_branding?: { logo_url?: string } } | undefined)?.menu_branding?.logo_url;

  const loadAll = useCallback(async () => {
    if (!activeTenant?.id) return;
    const [m, a, p] = await Promise.all([
      supabase.from("menu_items").select("id, name, price, currency, image_url").eq("tenant_id", activeTenant.id).order("sort_order"),
      supabase.from("social_accounts").select("platform, account_name, status").eq("tenant_id", activeTenant.id),
      supabase
        .from("social_posts")
        .select("id, status, media_type, caption, media_urls, targets, scheduled_at, error")
        .eq("tenant_id", activeTenant.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setMenu((m.data as MenuItemRow[]) || []);
    setAccounts((a.data as SocialAccountRow[]) || []);
    setPosts((p.data as SocialPostRow[]) || []);
  }, [activeTenant?.id, supabase]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Realtime: the queue updates when the cron publishes.
  useEffect(() => {
    if (!activeTenant?.id) return;
    const ch = supabase
      .channel(`social_posts_${activeTenant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "social_posts", filter: `tenant_id=eq.${activeTenant.id}` },
        () => loadAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeTenant?.id, supabase, loadAll]);

  const selectedSlides: SocialSlide[] = useMemo(
    () =>
      selectedIds
        .map((id) => menu.find((m) => m.id === id))
        .filter(Boolean)
        .map((m) => ({ name: m!.name, price: fmtPrice(m!.price, m!.currency), photoUrl: m!.image_url || undefined })),
    [selectedIds, menu],
  );

  const reelSupported = typeof window === "undefined" ? true : isVideoRenderSupported();

  async function generateCaption() {
    if (!activeTenant?.id) return;
    setGenBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/social/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: activeTenant.id, post_type: postType, dishes: selectedSlides.map((s) => s.name) }),
      });
      const data = await r.json();
      if (data?.success) {
        setCaption(data.caption || "");
        setHashtags(data.hashtags || []);
      } else {
        setMsg({ ok: false, text: data?.error || "compose_failed" });
      }
    } catch {
      setMsg({ ok: false, text: "compose_failed" });
    } finally {
      setGenBusy(false);
    }
  }

  async function createMedia() {
    if (!activeTenant?.id || !selectedSlides.length) return;
    setRenderBusy("rendering");
    setMsg(null);
    try {
      const urls = await renderAndUpload({
        tenantId: activeTenant.id,
        postType,
        props: { restaurantName: activeTenant.name || "", brandColor, logoUrl, slides: selectedSlides },
        onProgress: (label) => setRenderBusy(label),
      });
      setMediaUrls(urls);
    } catch (e) {
      const err = e instanceof Error ? e.message : "render_failed";
      setMsg({ ok: false, text: err === "reel_unsupported_browser" ? tt("social_reel_browser_note") : err });
    } finally {
      setRenderBusy(null);
    }
  }

  const fullCaption = useMemo(
    () => (hashtags.length ? `${caption}\n\n${hashtags.map((h) => `#${h}`).join(" ")}` : caption),
    [caption, hashtags],
  );

  async function savePost(approve: boolean) {
    if (!activeTenant?.id) return;
    setSaveBusy(true);
    setMsg(null);
    try {
      const status: PostStatus = approve ? (scheduledAt ? "scheduled" : "approved") : "draft";
      const { error } = await supabase.from("social_posts").insert({
        tenant_id: activeTenant.id,
        status,
        media_type: postType,
        caption: fullCaption,
        media_urls: mediaUrls,
        targets,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      if (error) throw new Error(error.message);
      // reset composer
      setSelectedIds([]);
      setCaption("");
      setHashtags([]);
      setMediaUrls([]);
      setScheduledAt("");
      setMsg({ ok: true, text: tt(approve ? "social_approve_schedule" : "social_save_draft") });
      loadAll();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "save_failed" });
    } finally {
      setSaveBusy(false);
    }
  }

  async function approveExisting(id: string) {
    await supabase.from("social_posts").update({ status: "approved" }).eq("id", id);
    loadAll();
  }
  async function deletePost(id: string) {
    await supabase.from("social_posts").delete().eq("id", id);
    loadAll();
  }

  if (!enabled || !planActive) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-black">
          <Share2 className="h-6 w-6" />
          {tt("social_title")}
        </h1>
        <div className="mt-4 max-w-xl rounded-xl border-2 p-6" style={CARD}>
          <p className="text-sm text-black">{tt("settings_feature_social_hint")}</p>
          <Link
            href="/settings?tab=features"
            className="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={PRIMARY}
          >
            {tt("nav_settings")}
          </Link>
        </div>
      </div>
    );
  }

  const previewTarget = targets[0] || "instagram";

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-black">
          <Share2 className="h-6 w-6" />
          {tt("social_title")}
        </h1>
        <p className="mt-1 text-sm text-black">{tt("social_subtitle")}</p>
      </div>

      <ConnectCard
        tenantId={activeTenant!.id}
        connectedAccountName={connectedName}
        status={connectedStatus}
        onConnected={loadAll}
        onDisconnect={loadAll}
      />

      {/* Composer */}
      <section className="grid gap-6 rounded-xl border-2 p-5 lg:grid-cols-2" style={CARD}>
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-black">{tt("social_composer_title")}</h2>

          {/* Type */}
          <div className="flex gap-2">
            {([
              { k: "image", icon: ImageIcon, label: tt("social_type_image") },
              { k: "carousel", icon: Layers, label: tt("social_type_carousel") },
              { k: "reels", icon: Film, label: tt("social_type_reel") },
            ] as const).map(({ k, icon: Icon, label }) => (
              <button
                key={k}
                type="button"
                onClick={() => setPostType(k)}
                disabled={k === "reels" && !reelSupported}
                className="flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-xl border-2 px-3 py-2.5 text-sm font-medium text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a] disabled:opacity-40"
                style={postType === k ? { borderColor: ACCENT, background: "rgba(196,149,106,0.18)" } : INPUT_STYLE}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
          {!reelSupported ? <p className="text-xs text-black">{tt("social_reel_browser_note")}</p> : null}

          {/* Dish picker */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-black">{tt("social_pick_dishes")}</p>
            <div className="max-h-44 overflow-y-auto rounded-xl border-2 p-1" style={{ borderColor: "rgba(196,149,106,0.5)" }}>
              {menu.length === 0 ? (
                <p className="p-3 text-sm text-black">—</p>
              ) : (
                menu.map((m) => {
                  const on = selectedIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((s) => (on ? s.filter((x) => x !== m.id) : postType === "image" ? [m.id] : [...s, m.id]))
                      }
                      className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a] ${
                        on ? "bg-[#c4956a]/15" : "hover:bg-[#c4956a]/10"
                      }`}
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="flex items-center gap-2 text-black">
                        {fmtPrice(m.price, m.currency)}
                        {on ? <Check className="h-4 w-4 text-[#c4956a]" /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Generate caption */}
          <button
            type="button"
            onClick={generateCaption}
            disabled={genBusy || !selectedSlides.length}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-semibold text-black hover:bg-[#c4956a]/10 focus:outline-none focus:ring-2 focus:ring-[#c4956a] disabled:opacity-50"
            style={{ borderColor: ACCENT }}
          >
            <Sparkles className="h-4 w-4" /> {genBusy ? "…" : tt("social_generate_caption")}
          </button>

          {/* Caption editor */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-black">{tt("social_caption_label")}</label>
            <textarea
              value={fullCaption}
              onChange={(e) => {
                setCaption(e.target.value);
                setHashtags([]);
              }}
              rows={5}
              className="w-full rounded-xl border-2 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
              style={INPUT_STYLE}
            />
          </div>

          {/* Create media */}
          <button
            type="button"
            onClick={createMedia}
            disabled={!!renderBusy || !selectedSlides.length}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#c4956a] focus:ring-offset-2 disabled:opacity-50"
            style={PRIMARY}
          >
            {renderBusy ? tt("social_rendering") : tt("social_create_media")}
          </button>

          {/* Schedule + targets */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-black">{tt("social_schedule_at")}</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-xl border-2 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
              style={INPUT_STYLE}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-black">{tt("social_targets")}</label>
              <div className="flex gap-2 pt-1">
                {(["instagram", "facebook"] as const).map((tg) => {
                  const on = targets.includes(tg);
                  return (
                    <button
                      key={tg}
                      type="button"
                      onClick={() => setTargets((s) => (on ? s.filter((x) => x !== tg) : [...s, tg]))}
                      className="cursor-pointer rounded-lg border-2 px-3 py-1.5 text-sm font-medium capitalize text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
                      style={on ? { borderColor: ACCENT, background: "rgba(196,149,106,0.18)" } : INPUT_STYLE}
                    >
                      {tg}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {!connected ? <p className="text-sm font-medium text-black">{tt("social_not_connected_hint")}</p> : null}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => savePost(false)}
              disabled={saveBusy || !fullCaption.trim()}
              className="cursor-pointer rounded-xl border-2 px-4 py-2 text-sm font-semibold text-black hover:bg-[#c4956a]/10 focus:outline-none focus:ring-2 focus:ring-[#c4956a] disabled:opacity-50"
              style={{ borderColor: ACCENT }}
            >
              {tt("social_save_draft")}
            </button>
            <button
              type="button"
              onClick={() => savePost(true)}
              disabled={saveBusy || !fullCaption.trim() || !mediaUrls.length || !connected}
              className="cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#c4956a] focus:ring-offset-2 disabled:opacity-50"
              style={PRIMARY}
            >
              {tt("social_approve_schedule")}
            </button>
          </div>
          {msg ? <p className={`text-sm font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p> : null}
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center justify-start gap-2">
          <p className="text-sm font-medium text-black">{tt("social_preview")}</p>
          <SocialPostPreview
            target={previewTarget}
            accountName={connectedName || activeTenant?.name || ""}
            caption={fullCaption}
            mediaUrl={mediaUrls[0]}
            isVideo={postType === "reels"}
            emptyLabel={tt("social_queue_empty")}
          />
        </div>
      </section>

      {/* Approval queue */}
      <section className="rounded-xl border-2 p-5" style={CARD}>
        <h2 className="mb-3 text-lg font-semibold text-black">{tt("social_queue_title")}</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-black">{tt("social_queue_empty")}</p>
        ) : (
          <ul className="space-y-3">
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-4 rounded-xl border-2 p-3" style={INNER}>
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg" style={{ background: "rgba(196,149,106,0.12)" }}>
                  {p.media_urls[0] ? (
                    p.media_type === "reels" ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={p.media_urls[0]} className="h-full w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.media_urls[0]} alt="" className="h-full w-full object-cover" />
                    )
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-black">{p.caption || "—"}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-black">
                    <StatusBadge status={p.status} tt={tt} />
                    {p.scheduled_at ? <span>· {new Date(p.scheduled_at).toLocaleString()}</span> : null}
                    {p.error ? <span className="text-red-600">· {p.error}</span> : null}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  {p.status === "draft" ? (
                    <button
                      type="button"
                      onClick={() => approveExisting(p.id)}
                      className="cursor-pointer rounded-lg border-2 px-3 py-1.5 text-sm font-medium text-black hover:bg-[#c4956a]/10 focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
                      style={{ borderColor: ACCENT }}
                    >
                      {tt("social_action_approve")}
                    </button>
                  ) : null}
                  {p.status !== "published" && p.status !== "publishing" ? (
                    <button
                      type="button"
                      onClick={() => deletePost(p.id)}
                      aria-label={tt("social_action_delete")}
                      className="cursor-pointer rounded-lg border-2 p-1.5 text-black hover:bg-[#c4956a]/10 focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
                      style={{ borderColor: ACCENT }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status, tt }: { status: PostStatus; tt: (k: string) => string }) {
  const map: Record<PostStatus, { label: string; cls: string; Icon: typeof Check }> = {
    draft: { label: tt("social_status_draft"), cls: "bg-stone-100 text-black", Icon: Clock },
    approved: { label: tt("social_status_approved"), cls: "bg-amber-100 text-black", Icon: Check },
    scheduled: { label: tt("social_status_scheduled"), cls: "bg-amber-100 text-black", Icon: Clock },
    publishing: { label: tt("social_status_publishing"), cls: "bg-blue-100 text-black", Icon: Clock },
    published: { label: tt("social_status_published"), cls: "bg-emerald-100 text-black", Icon: Check },
    failed: { label: tt("social_status_failed"), cls: "bg-red-100 text-black", Icon: AlertCircle },
    canceled: { label: tt("social_status_canceled"), cls: "bg-stone-100 text-black", Icon: AlertCircle },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${cls}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
