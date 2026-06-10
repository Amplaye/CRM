"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Save, Trash2, Check, Tags } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// Settings → "Listini & Info". A fully guided, non-technical front-end over the
// `commerciale` knowledge_articles: the owner never has to know what a "KB article"
// is. They pick a template (Cakes / Set menus / Buffet / Dish list / Other), paste
// the text they already send on WhatsApp, and Save — we create/update a published
// `commerciale` article behind the scenes. Its TITLE doubles as the proactive bot
// button label (see the engine guard). Shown only when commercial_info_enabled is ON
// (the tab is gated in settings/page.tsx). Generic: every tenant gets the same flow.
type Card = {
  id?: string;
  title: string;
  content: string;
  display_order: number;
  dirty: boolean;
  saving?: boolean;
  saved?: boolean;
};

export function CommercialInfoTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const { user } = useAuth();
  const supabase = createClient();

  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const initedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    if (initedFor.current === tenant.id) return;
    initedFor.current = tenant.id;
    (async () => {
      const { data } = await supabase
        .from("knowledge_articles")
        .select("id, title, content, display_order")
        .eq("tenant_id", tenant.id)
        .eq("category", "commerciale")
        .order("display_order", { ascending: true });
      setCards(
        (data || []).map((a: any) => ({
          id: a.id,
          title: a.title || "",
          content: a.content || "",
          display_order: a.display_order ?? 0,
          dirty: false,
        }))
      );
      setLoading(false);
    })();
  }, [tenant, supabase]);

  // Re-sync the bot's voice KB after a change (the chat re-reads the KB live on every
  // message; the voice assistant needs an explicit push). Best-effort, like KB page.
  const syncVapiKB = async () => {
    if (!tenant) return;
    try {
      await fetch("/api/sync-kb-vapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
    } catch { /* best-effort */ }
  };

  const presets: { key: keyof Dictionary }[] = [
    { key: "ci_preset_cakes" },
    { key: "ci_preset_menus" },
    { key: "ci_preset_buffet" },
    { key: "ci_preset_dishes" },
    { key: "ci_preset_other" },
  ];

  const addCard = (presetTitle: string) => {
    const maxOrder = cards.reduce((m, c) => Math.max(m, c.display_order), 900);
    // "Other" starts blank so the owner names it themselves.
    const title = presetTitle === t("ci_preset_other") ? "" : presetTitle;
    setCards((prev) => [...prev, { title, content: "", display_order: maxOrder + 1, dirty: true }]);
  };

  const update = (idx: number, patch: Partial<Card>) =>
    setCards((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch, dirty: true, saved: false } : c)));

  const saveCard = async (idx: number) => {
    if (!tenant || !user) return;
    const c = cards[idx];
    if (!c.title.trim() || !c.content.trim()) return;
    setCards((prev) => prev.map((x, i) => (i === idx ? { ...x, saving: true } : x)));
    const base = {
      tenant_id: tenant.id,
      title: c.title.trim(),
      content: c.content,
      category: "commerciale" as const,
      status: "published" as const,
      risk_tags: [] as string[],
      author_id: user.id,
      updated_at: new Date().toISOString(),
      display_order: c.display_order,
    };
    let savedId = c.id;
    if (c.id) {
      await supabase.from("knowledge_articles").update(base).eq("id", c.id);
    } else {
      const { data } = await supabase
        .from("knowledge_articles")
        .insert({ ...base, version: 1, created_at: new Date().toISOString() })
        .select("id")
        .single();
      savedId = (data as any)?.id;
    }
    setCards((prev) => prev.map((x, i) => (i === idx ? { ...x, id: savedId, dirty: false, saving: false, saved: true } : x)));
    setTimeout(() => setCards((prev) => prev.map((x, i) => (i === idx ? { ...x, saved: false } : x))), 2000);
    syncVapiKB();
  };

  const deleteCard = async (idx: number) => {
    const c = cards[idx];
    if (!confirm(t("ci_delete_confirm"))) return;
    if (c.id) await supabase.from("knowledge_articles").delete().eq("id", c.id);
    setCards((prev) => prev.filter((_, i) => i !== idx));
    syncVapiKB();
  };

  const border = "#c4956a";
  const panel = "rgba(252,246,237,0.6)";

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <Tags className="w-5 h-5" style={{ color: border }} />
          {t("ci_title")}
        </h2>
        <p className="mt-1 text-sm text-black/70">{t("ci_desc")}</p>
      </div>

      {/* Add-a-list templates */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border-2" style={{ borderColor: border, background: panel }}>
        <span className="text-sm font-bold text-black mr-1">{t("ci_add_label")}</span>
        {presets.map((p) => {
          const label = t(p.key);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => addCard(label)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-white shadow-sm transition-transform hover:-translate-y-0.5 cursor-pointer"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Plus className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2].map((i) => <div key={i} className="h-40 bg-zinc-200 rounded-xl" />)}
        </div>
      ) : cards.length === 0 ? (
        <div className="p-8 text-center text-sm text-black/70 rounded-xl border-2 border-dashed" style={{ borderColor: border }}>
          {t("ci_empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((c, idx) => (
            <div key={c.id || `new-${idx}`} className="p-4 rounded-xl border-2 space-y-3" style={{ borderColor: border, background: panel }}>
              <div>
                <label className="block text-xs font-bold text-black/70 uppercase tracking-wide mb-1">{t("ci_title_label")}</label>
                <input
                  type="text"
                  value={c.title}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  placeholder={t("ci_title_ph")}
                  maxLength={40}
                  className="w-full border-2 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{ borderColor: border, background: "#fff" }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-black/70 uppercase tracking-wide mb-1">{t("ci_content_label")}</label>
                <textarea
                  value={c.content}
                  onChange={(e) => update(idx, { content: e.target.value })}
                  placeholder={t("ci_content_ph")}
                  rows={7}
                  className="w-full border-2 rounded-lg px-3 py-2 text-sm leading-relaxed font-mono focus:outline-none focus:ring-1 focus:ring-[#c4956a] whitespace-pre-wrap"
                  style={{ borderColor: border, background: "#fff" }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-black/50">{c.id ? t("ci_visible_note") : ""}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => deleteCard(idx)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 border-2 border-red-300 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("ci_delete")}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveCard(idx)}
                    disabled={c.saving || !c.title.trim() || !c.content.trim() || (!c.dirty && !!c.id)}
                    className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-40 cursor-pointer"
                    style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                  >
                    {c.saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {c.saving ? t("ci_saving") : c.saved ? t("ci_saved") : t("ci_save")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
