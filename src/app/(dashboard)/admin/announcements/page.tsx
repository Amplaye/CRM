"use client";

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Sparkles, RefreshCw, Plus, Trash2, Eye, EyeOff, MousePointerClick, Users } from "lucide-react";
import { pickText, type L10nText } from "@/lib/announcements/select";

const LANGS = ["it", "en", "es", "de"] as const;
type Lang = (typeof LANGS)[number];

interface Row {
  id: string;
  slug: string;
  title: L10nText;
  body: L10nText;
  cta_label: L10nText;
  cta_href: string | null;
  audience: "owner_manager" | "all";
  published: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  seen: number;
  clicked: number;
}

const emptyL10n = (): Record<Lang, string> => ({ it: "", en: "", es: "", de: "" });

export default function AnnouncementsPage() {
  const { globalRole } = useTenant();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("it");

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState(emptyL10n());
  const [body, setBody] = useState(emptyL10n());
  const [ctaLabel, setCtaLabel] = useState(emptyL10n());
  const [ctaHref, setCtaHref] = useState("");
  const [audience, setAudience] = useState<"owner_manager" | "all">("owner_manager");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      const data = await res.json();
      setRows(data?.announcements || []);
    } catch { /* the empty list is the error state */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, body, cta_label: ctaLabel, cta_href: ctaHref, audience }),
      });
      const data = await res.json();
      if (!data?.ok) { setErr(data?.error || "failed"); return; }
      setSlug(""); setTitle(emptyL10n()); setBody(emptyL10n()); setCtaLabel(emptyL10n()); setCtaHref("");
      await load();
    } catch { setErr("network"); }
    finally { setBusy(false); }
  };

  const patch = async (id: string, changes: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      await load();
    } catch { /* refetch shows the truth */ }
    finally { setBusy(false); }
  };

  const remove = async (row: Row) => {
    if (!confirm(`Delete "${pickText(row.title, "en") || row.slug}"? Its reach stats go with it.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/announcements/${row.id}`, { method: "DELETE" });
      await load();
    } catch { /* refetch shows the truth */ }
    finally { setBusy(false); }
  };

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };
  const inputStyle = "w-full text-sm border-2 rounded-lg px-3 py-2 text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]";
  const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Announcements</h1>
        </div>
        <button onClick={load} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <p className="text-sm text-black">
        A published announcement shows once, as a centred modal, to every eligible user across every
        tenant. Write it as a draft, review it, then publish — publishing is what makes it appear.
      </p>

      {/* Composer */}
      <div className="rounded-xl border-2 p-4 space-y-3" style={cardStyle}>
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-[#c4956a]" />
          <h2 className="font-bold text-black">New announcement</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-black">Slug (internal id)</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="social-2026-07"
              className={inputStyle} style={inputBorder} />
          </div>
          <div>
            <label className="text-xs font-semibold text-black">CTA link (in-app path)</label>
            <input value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} placeholder="/social"
              className={inputStyle} style={inputBorder} />
          </div>
        </div>

        {/* Language tabs — the copy is stored per language, not translated at runtime. */}
        <div className="flex gap-1">
          {LANGS.map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-colors ${
                lang === l ? "text-white" : "text-black hover:bg-[#c4956a]/10"
              }`}
              style={lang === l ? { background: "linear-gradient(135deg, #d4a574, #c4956a)" } : {}}>
              {l}
              {title[l].trim() && body[l].trim() ? " ✓" : ""}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <input value={title[lang]} onChange={(e) => setTitle({ ...title, [lang]: e.target.value })}
            placeholder={`Title (${lang})`} className={inputStyle} style={inputBorder} />
          <textarea value={body[lang]} onChange={(e) => setBody({ ...body, [lang]: e.target.value })}
            placeholder={`Body (${lang}) — what it does and why they should care`} rows={3}
            className={inputStyle} style={inputBorder} />
          <input value={ctaLabel[lang]} onChange={(e) => setCtaLabel({ ...ctaLabel, [lang]: e.target.value })}
            placeholder={`Button label (${lang}) — optional, defaults to "Discover it"`}
            className={inputStyle} style={inputBorder} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-black">Audience</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value as "owner_manager" | "all")}
            className="text-sm border-2 rounded-lg px-3 py-2 text-black" style={inputBorder}>
            <option value="owner_manager">Owners &amp; managers</option>
            <option value="all">Everyone (waiters included)</option>
          </select>
          <button onClick={create} disabled={busy || !slug.trim()}
            className="ml-auto h-10 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-40 inline-flex items-center gap-2"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
            <Plus className="w-4 h-4" /> Create draft
          </button>
        </div>

        {err && (
          <p className="text-sm font-medium text-red-600">
            {err === "slug_format" ? "Slug must be 3–61 lowercase letters, digits or dashes."
              : err === "slug_taken" ? "That slug already exists."
              : err === "text_required" ? "Give it a title and a body in at least one language."
              : err === "cta_href_must_be_internal" ? "The CTA link must be an in-app path starting with /."
              : err}
          </p>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        {rows.length === 0 && !loading && (
          <p className="text-sm text-black">No announcements yet.</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border-2 p-4 space-y-2" style={cardStyle}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold text-white ${row.published ? "bg-emerald-600" : "bg-black/40"}`}>
                    {row.published ? "Live" : "Draft"}
                  </span>
                  <span className="font-bold text-black truncate">{pickText(row.title, "en") || row.slug}</span>
                  <code className="text-xs text-black/60">{row.slug}</code>
                </div>
                <p className="text-sm text-black mt-1">{pickText(row.body, "en")}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-black">
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {row.seen} seen
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MousePointerClick className="w-3.5 h-3.5" /> {row.clicked} clicked
                  </span>
                  <span>{row.audience === "all" ? "Everyone" : "Owners & managers"}</span>
                  {row.cta_href && <code className="text-black/60">{row.cta_href}</code>}
                  <span className="text-black/60">
                    {LANGS.filter((l) => pickText(row.title, l) && pickText(row.body, l)).join(" · ")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => patch(row.id, { published: !row.published })} disabled={busy}
                  title={row.published ? "Unpublish" : "Publish"}
                  className="p-2 rounded-lg hover:bg-[#c4956a]/10 transition-colors disabled:opacity-40">
                  {row.published ? <EyeOff className="w-4 h-4 text-black" /> : <Eye className="w-4 h-4 text-black" />}
                </button>
                <button onClick={() => remove(row)} disabled={busy} title="Delete"
                  className="p-2 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
