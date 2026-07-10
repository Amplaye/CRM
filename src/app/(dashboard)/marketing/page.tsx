"use client";

import { hasActivePlan } from "@/lib/billing/entitlements";
import { getFeatures } from "@/lib/types/tenant-settings";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Megaphone, Sparkles, Send, Mail, MessageCircle, Users as UsersIcon } from "lucide-react";
import Link from "next/link";
import type { SegmentDef } from "@/lib/guests/segmentation";

interface CampaignListRow {
  id: string;
  name: string;
  channel: string;
  status: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

const INPUT = "block w-full rounded-lg border-2 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]";
const INPUT_STYLE = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" } as const;
const CARD = { borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" } as const;

type SegKind = SegmentDef["kind"];

export default function MarketingPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const enabled = getFeatures(activeTenant?.settings).marketing_enabled;
  const planActive = hasActivePlan(activeTenant?.settings);

  const [campaigns, setCampaigns] = useState<CampaignListRow[]>([]);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [segKind, setSegKind] = useState<SegKind>("lapsed");
  const [segDays, setSegDays] = useState("90");
  const [segTag, setSegTag] = useState("");
  const [segMonth, setSegMonth] = useState(String(new Date().getMonth() + 1));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [brief, setBrief] = useState("");
  const [preview, setPreview] = useState<{ total: number; with_email: number; with_phone: number; opted_out: number } | null>(null);
  const [busy, setBusy] = useState<"ai" | "preview" | "send" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const segment: SegmentDef = useMemo(() => {
    switch (segKind) {
      case "lapsed": return { kind: "lapsed", days: Number(segDays) || 90 };
      case "vip": return { kind: "vip" };
      case "birthday": return { kind: "birthday", month: Number(segMonth) || 1 };
      case "tag": return { kind: "tag", tag: segTag.trim().toLowerCase() };
      case "no_show_risk": return { kind: "no_show_risk" };
      default: return { kind: "all" };
    }
  }, [segKind, segDays, segTag, segMonth]);

  const loadCampaigns = async () => {
    if (!activeTenant) return;
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, channel, status, recipient_count, sent_count, failed_count, created_at")
      .eq("tenant_id", activeTenant.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setCampaigns((data || []) as CampaignListRow[]);
  };
  useEffect(() => { void loadCampaigns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeTenant?.id]);

  const post = async (path: string, payload: Record<string, unknown>, method = "POST") => {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: activeTenant?.id, ...payload }),
    });
    return res.json().catch(() => null);
  };

  const doPreview = async () => {
    setBusy("preview");
    const json = await post("/api/marketing/send", { segment }, "PUT");
    if (json?.success) setPreview(json);
    setBusy(null);
  };

  const doGenerate = async () => {
    if (!brief.trim()) return;
    setBusy("ai");
    const json = await post("/api/marketing/generate", { brief, channel });
    if (json?.success) {
      setBody(json.body || "");
      if (channel === "email" && json.subject) setSubject(json.subject);
    }
    setBusy(null);
  };

  const doSend = async () => {
    setBusy("send");
    setResult(null);
    const json = await post("/api/marketing/send", { name, channel, segment, subject, body });
    if (json?.success) {
      setResult(t("mkt_sent_result").replace("{sent}", String(json.sent)).replace("{total}", String(json.recipients)));
      setName(""); setSubject(""); setBody(""); setBrief(""); setPreview(null);
      void loadCampaigns();
    } else {
      setResult(json?.detail || json?.error || "Error");
    }
    setBusy(null);
  };

  if (!planActive || !enabled) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-2xl font-bold text-black">{t("mkt_title")}</h1>
        <div className="mt-4 rounded-xl border-2 p-6 max-w-xl" style={CARD}>
          <p className="text-sm text-black">{t("mkt_disabled_hint")}</p>
          <Link href="/settings?tab=features" className="mt-3 inline-block text-sm font-semibold text-white rounded-lg px-4 py-2" style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}>
            {t("reviews_disabled_cta")}
          </Link>
        </div>
      </div>
    );
  }

  const canSend = !!name.trim() && !!body.trim() && (channel !== "email" || !!subject.trim());

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2"><Megaphone className="w-6 h-6" />{t("mkt_title")}</h1>
        <p className="text-sm text-black mt-1">{t("mkt_desc")}</p>
      </div>

      {/* Composer */}
      <div className="rounded-xl border-2 p-5 space-y-4" style={CARD}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-bold text-black mb-1">{t("mkt_name_label")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mkt_name_ph")} className={INPUT} style={INPUT_STYLE} />
          </div>
          <div>
            <label className="block text-sm font-bold text-black mb-1">{t("mkt_channel_label")}</label>
            <div className="flex gap-2">
              {(["email", "whatsapp"] as const).map((c) => (
                <button key={c} type="button" onClick={() => setChannel(c)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${channel === c ? "text-white" : "text-black"}`}
                  style={channel === c ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                  {c === "email" ? <Mail className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
                  {c === "email" ? "Email" : "WhatsApp"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Segment */}
        <div>
          <label className="block text-sm font-bold text-black mb-1">{t("mkt_segment_label")}</label>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={segKind} onChange={(e) => { setSegKind(e.target.value as SegKind); setPreview(null); }} className={`${INPUT} w-auto`} style={INPUT_STYLE}>
              <option value="all">{t("mkt_seg_all")}</option>
              <option value="lapsed">{t("mkt_seg_lapsed")}</option>
              <option value="vip">{t("mkt_seg_vip")}</option>
              <option value="birthday">{t("mkt_seg_birthday")}</option>
              <option value="tag">{t("mkt_seg_tag")}</option>
              <option value="no_show_risk">{t("mkt_seg_noshow")}</option>
            </select>
            {segKind === "lapsed" && (
              <span className="inline-flex items-center gap-1 text-sm text-black">
                <input type="number" min={7} value={segDays} onChange={(e) => setSegDays(e.target.value)} className={`${INPUT} w-20`} style={INPUT_STYLE} /> {t("mkt_seg_days")}
              </span>
            )}
            {segKind === "birthday" && (
              <input type="number" min={1} max={12} value={segMonth} onChange={(e) => setSegMonth(e.target.value)} className={`${INPUT} w-20`} style={INPUT_STYLE} />
            )}
            {segKind === "tag" && (
              <input value={segTag} onChange={(e) => setSegTag(e.target.value)} placeholder="vip" className={`${INPUT} w-32`} style={INPUT_STYLE} />
            )}
            <button type="button" onClick={doPreview} disabled={busy === "preview"}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-semibold text-black disabled:opacity-50" style={{ borderColor: "#c4956a" }}>
              <UsersIcon className="w-4 h-4" /> {busy === "preview" ? "…" : t("mkt_preview_btn")}
            </button>
          </div>
          {preview && (
            <p className="mt-2 text-xs font-medium text-black">
              {t("mkt_preview_result")
                .replace("{total}", String(preview.total))
                .replace("{contact}", String(channel === "email" ? preview.with_email : preview.with_phone))
                .replace("{opted}", String(preview.opted_out))}
            </p>
          )}
        </div>

        {/* AI brief */}
        <div className="rounded-lg border-2 p-3" style={{ borderColor: "rgba(196,149,106,0.5)", background: "rgba(196,149,106,0.08)" }}>
          <label className="block text-sm font-bold text-black mb-1 items-center gap-1.5"><Sparkles className="w-4 h-4 inline" /> {t("mkt_ai_label")}</label>
          <div className="flex gap-2">
            <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("mkt_ai_ph")} className={INPUT} style={{ ...INPUT_STYLE, background: "#fff" }} />
            <button type="button" onClick={doGenerate} disabled={busy === "ai" || !brief.trim()}
              className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}>
              {busy === "ai" ? "…" : t("mkt_ai_btn")}
            </button>
          </div>
        </div>

        {channel === "email" && (
          <div>
            <label className="block text-sm font-bold text-black mb-1">{t("mkt_subject_label")}</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          </div>
        )}
        <div>
          <label className="block text-sm font-bold text-black mb-1">{t("mkt_body_label")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "email" ? 7 : 4} maxLength={channel === "email" ? 4000 : 350}
            className={INPUT} style={INPUT_STYLE} />
          {channel === "whatsapp" && <p className="mt-1 text-xs text-black">{body.length}/350 · {t("mkt_wa_note")}</p>}
        </div>

        <div className="flex items-center gap-3">
          <button type="button" onClick={doSend} disabled={!canSend || busy === "send"}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}>
            <Send className="w-4 h-4" /> {busy === "send" ? t("mkt_sending") : t("mkt_send_btn")}
          </button>
          {result && <span className="text-sm font-medium text-black">{result}</span>}
        </div>
      </div>

      {/* History */}
      <div>
        <h2 className="text-sm font-bold text-black uppercase tracking-wider mb-2">{t("mkt_history")}</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-black italic">{t("mkt_history_none")}</p>
        ) : (
          <div className="rounded-xl border-2 overflow-hidden" style={CARD}>
            {campaigns.map((c, i) => (
              <div key={c.id} className={`flex items-center justify-between gap-2 px-4 py-3 ${i ? "border-t" : ""}`} style={{ borderColor: "rgba(196,149,106,0.3)" }}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-black truncate">{c.name}</p>
                  <p className="text-xs text-black">{new Date(c.created_at).toLocaleDateString()} · {c.channel}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-black">{c.sent_count}/{c.recipient_count}</p>
                  <p className={`text-[10px] font-bold uppercase ${c.status === "sent" ? "text-emerald-700" : c.status === "failed" ? "text-red-600" : "text-black"}`}>{c.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
