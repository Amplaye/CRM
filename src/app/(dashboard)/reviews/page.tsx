"use client";

import { LockedPreview } from "@/components/billing/LockedPreview";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { getFeatures } from "@/lib/types/tenant-settings";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Star, Sparkles, EyeOff, Eye, MessageSquareReply } from "lucide-react";
import Link from "next/link";

interface ReviewRow {
  id: string;
  rating: number;
  comment: string;
  status: "new" | "replied" | "hidden";
  reply: string | null;
  reply_at: string | null;
  created_at: string;
  guests: { name: string | null } | null;
}

function Stars({ n, size = 4 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`w-${size} h-${size}`} fill={i <= n ? "#f59e0b" : "transparent"} stroke={i <= n ? "#f59e0b" : "#c4956a"} />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const planActive = hasActivePlan(activeTenant?.settings);
  const enabled = getFeatures(activeTenant?.settings).reviews_enabled;

  useEffect(() => {
    if (!activeTenant || !enabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("reviews")
        .select("id, rating, comment, status, reply, reply_at, created_at, guests(name)")
        .eq("tenant_id", activeTenant.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled) { setRows((data || []) as unknown as ReviewRow[]); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeTenant, enabled, supabase]);

  const visible = rows.filter((r) => r.status !== "hidden");
  const avg = visible.length ? visible.reduce((s, r) => s + r.rating, 0) / visible.length : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => visible.filter((r) => r.rating === n).length);

  if (!planActive) {
    return <LockedPreview section="reviews" />;
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black">{t("reviews_title")}</h1>
        <p className="text-sm text-black mt-1">{t("reviews_desc")}</p>
      </div>

      {!enabled ? (
        <div className="rounded-xl border-2 p-6 max-w-xl" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}>
          <p className="text-sm text-black">{t("reviews_disabled_hint")}</p>
          <Link href="/settings?tab=features" className="mt-3 inline-block text-sm font-semibold text-white rounded-lg px-4 py-2" style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}>
            {t("reviews_disabled_cta")}
          </Link>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex flex-wrap gap-4">
            <div className="rounded-xl border-2 p-5 min-w-40 text-center" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}>
              <p className="text-4xl font-bold text-black">{avg ? avg.toFixed(1) : "—"}</p>
              <div className="mt-1 flex justify-center"><Stars n={Math.round(avg)} /></div>
              <p className="mt-1 text-xs text-black font-medium">{visible.length} {t("reviews_count_label")}</p>
            </div>
            <div className="rounded-xl border-2 p-5 flex-1 min-w-60" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}>
              {[5, 4, 3, 2, 1].map((n, i) => (
                <div key={n} className="flex items-center gap-2 text-xs text-black">
                  <span className="w-3 font-bold">{n}</span>
                  <Star className="w-3 h-3" fill="#f59e0b" stroke="#f59e0b" />
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.2)" }}>
                    <div className="h-full rounded-full" style={{ width: `${visible.length ? (dist[i] / visible.length) * 100 : 0}%`, background: "#f59e0b" }} />
                  </div>
                  <span className="w-6 text-right">{dist[i]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* List */}
          {loading ? (
            <p className="text-sm text-black">…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-black italic">{t("reviews_none")}</p>
          ) : (
            <div className="space-y-4 max-w-3xl">
              {rows.map((r) => (
                <ReviewCard key={r.id} review={r} tenantId={activeTenant!.id}
                  onChanged={(patch) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, ...patch } : x))} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewCard({ review, tenantId, onChanged }: {
  review: ReviewRow;
  tenantId: string;
  onChanged: (patch: Partial<ReviewRow>) => void;
}) {
  const { t } = useLanguage();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState(review.reply || "");
  const [busy, setBusy] = useState<"ai" | "save" | "hide" | null>(null);

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, review_id: review.id, ...body }),
    });
    return res.ok ? res.json() : null;
  };

  const suggest = async () => {
    setBusy("ai");
    const json = await post("/api/reviews/suggest-reply", {});
    if (json?.suggestion) { setDraft(json.suggestion); setReplying(true); }
    setBusy(null);
  };

  const save = async () => {
    setBusy("save");
    const json = await post("/api/reviews/reply", { reply: draft });
    if (json?.success) { onChanged({ reply: draft || null, status: draft ? "replied" : "new" }); setReplying(false); }
    setBusy(null);
  };

  const toggleHidden = async () => {
    setBusy("hide");
    const next = review.status === "hidden" ? "new" : "hidden";
    const json = await post("/api/reviews/reply", { status: next });
    if (json?.success) onChanged({ status: next });
    setBusy(null);
  };

  const date = new Date(review.created_at).toLocaleDateString();

  return (
    <div className={`rounded-xl border-2 p-4 ${review.status === "hidden" ? "opacity-50" : ""}`} style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars n={review.rating} />
          <span className="text-sm font-bold text-black">{review.guests?.name || "—"}</span>
          <span className="text-xs text-black">{date}</span>
        </div>
        <button onClick={toggleHidden} disabled={busy === "hide"} title={review.status === "hidden" ? t("reviews_show") : t("reviews_hide")}
          className="p-1.5 text-black hover:text-red-600">
          {review.status === "hidden" ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>
      {review.comment && <p className="mt-2 text-sm text-black">{review.comment}</p>}

      {review.reply && !replying ? (
        <div className="mt-3 rounded-lg p-3 text-sm text-black" style={{ background: "rgba(196,149,106,0.15)" }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-1">{t("reviews_replied")}</p>
          {review.reply}
          <button onClick={() => setReplying(true)} className="block mt-2 text-xs font-semibold underline">{t("reviews_reply_edit")}</button>
        </div>
      ) : replying ? (
        <div className="mt-3 space-y-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={2000}
            className="block w-full rounded-lg border-2 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "#fff" }} />
          <div className="flex gap-2">
            <button onClick={save} disabled={busy === "save"} className="text-sm font-semibold text-white rounded-lg px-4 py-2 disabled:opacity-50" style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}>
              {busy === "save" ? "…" : t("reviews_reply_save")}
            </button>
            <button onClick={suggest} disabled={busy === "ai"} className="inline-flex items-center gap-1.5 text-sm font-semibold text-black rounded-lg px-4 py-2 border-2 disabled:opacity-50" style={{ borderColor: "#c4956a" }}>
              <Sparkles className="w-4 h-4" /> {busy === "ai" ? "…" : t("reviews_reply_ai")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button onClick={() => setReplying(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-black rounded-lg px-4 py-2 border-2" style={{ borderColor: "#c4956a" }}>
            <MessageSquareReply className="w-4 h-4" /> {t("reviews_reply_label")}
          </button>
          <button onClick={suggest} disabled={busy === "ai"} className="inline-flex items-center gap-1.5 text-sm font-semibold text-black rounded-lg px-4 py-2 border-2 disabled:opacity-50" style={{ borderColor: "#c4956a" }}>
            <Sparkles className="w-4 h-4" /> {busy === "ai" ? "…" : t("reviews_reply_ai")}
          </button>
        </div>
      )}
    </div>
  );
}
