"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { pickText, type Announcement } from "@/lib/announcements/select";

/**
 * "We shipped something new" modal.
 *
 * Fetches the one announcement this user is eligible for (see
 * /api/announcements — published, in window, right audience, not yet seen),
 * shows it centred, and records the dismissal so it never appears again.
 *
 * Deliberately quiet: no announcement, no network, no error state. If the
 * fetch fails the modal simply never appears — a product announcement is
 * never worth showing an error over.
 */
export function AnnouncementModal() {
  const { activeTenant, activeRole, globalRole, loading } = useTenant();
  const { t, language } = useLanguage();
  const router = useRouter();

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [visible, setVisible] = useState(false);

  // localStorage mirrors the server-side dismissal. It is the fallback for the
  // case where the dismiss POST fails (offline, flaky wifi): without it the
  // modal would come back on every single navigation and become an enemy.
  const seenKey = useCallback((id: string) => `announcement_seen_${id}`, []);

  useEffect(() => {
    if (loading || !activeTenant?.id) return;
    // Waiters are never interrupted by owner_manager announcements; the API
    // enforces this, but skipping the request entirely saves a round-trip on
    // every till device at open.
    if (!activeRole && globalRole !== "platform_admin") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/announcements?tenant_id=${activeTenant.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const next: Announcement | null = data?.announcement || null;
        if (cancelled || !next) return;
        if (localStorage.getItem(seenKey(next.id))) return;
        setAnnouncement(next);
        // Let the page paint first — landing straight into a modal reads as a
        // crash, and the owner hasn't seen what they navigated to yet.
        setTimeout(() => { if (!cancelled) setVisible(true); }, 900);
      } catch {
        /* never surface a failed announcement fetch */
      }
    })();
    return () => { cancelled = true; };
  }, [loading, activeTenant?.id, activeRole, globalRole, seenKey]);

  /**
   * Hide now, persist in the background. The dismissal has to feel instant —
   * and on the CTA path, waiting for the POST would delay the navigation the
   * owner just asked for. The localStorage mirror covers a failed write.
   */
  const close = useCallback(
    (clicked: boolean) => {
      if (!announcement) return;
      const id = announcement.id;
      setVisible(false);
      setAnnouncement(null);
      try { localStorage.setItem(seenKey(id), "1"); } catch { /* private mode */ }
      void fetch("/api/announcements/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announcement_id: id,
          tenant_id: activeTenant?.id || null,
          clicked,
        }),
      }).catch(() => { /* localStorage already stopped the nagging */ });
    },
    [announcement, activeTenant?.id, seenKey]
  );

  // Escape closes, like every other dialog in the app.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, close]);

  if (!announcement || !visible) return null;

  const title = pickText(announcement.title, language);
  const body = pickText(announcement.body, language);
  if (!title || !body) return null;

  const ctaLabel =
    pickText(announcement.cta_label, language) ||
    t("announce_cta_default" as keyof Dictionary);

  const goToFeature = () => {
    const href = announcement.cta_href;
    close(true);
    if (href) router.push(href);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border-2 max-h-[85dvh] overflow-y-auto shadow-2xl"
        style={{
          borderColor: "#c4956a",
          background: "#FCF6ED",
          boxShadow: "0 20px 60px rgba(196,149,106,0.35), 0 8px 24px rgba(196,149,106,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => close(false)}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[#c4956a]/15 transition-colors"
          aria-label={t("announce_dismiss" as keyof Dictionary)}
        >
          <X className="w-4 h-4 text-black" />
        </button>

        <div
          className="flex items-center gap-2 px-5 pt-5 pb-3"
          style={{ background: "linear-gradient(135deg, rgba(212,165,116,0.18), rgba(196,149,106,0.06))" }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t("announce_badge" as keyof Dictionary)}
          </span>
        </div>

        <div className="px-5 pb-5 pt-1 space-y-3">
          <h2 id="announcement-title" className="text-lg font-bold text-black leading-snug">
            {title}
          </h2>
          <p className="text-sm text-black leading-relaxed whitespace-pre-line">{body}</p>

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              onClick={() => close(false)}
              className="flex-1 h-11 rounded-xl border-2 text-sm font-semibold text-black transition-colors hover:bg-[#c4956a]/10"
              style={{ borderColor: "#c4956a" }}
            >
              {t("announce_dismiss" as keyof Dictionary)}
            </button>
            {announcement.cta_href && (
              <button
                onClick={goToFeature}
                className="flex-1 h-11 rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-2 transition hover:brightness-95 active:brightness-90"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                <Sparkles className="w-4 h-4" />
                {ctaLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
