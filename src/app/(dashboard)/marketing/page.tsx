"use client";

import { hasActivePlan } from "@/lib/billing/entitlements";
import { getFeatures } from "@/lib/types/tenant-settings";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Megaphone, Sparkles, Send, Mail, MessageCircle, Users as UsersIcon, Euro, ChevronRight, X, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
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
  // Loaded up-front so opening a campaign shows its content with no extra roundtrip.
  subject: string | null;
  body: string;
  segment: SegmentDef;
}

/** One delivery row of an opened campaign — this is WHERE a send actually failed. */
interface RecipientRow {
  id: string;
  status: "pending" | "sent" | "failed" | "skipped";
  error: string | null;
  guests: { name: string | null; phone: string | null; email: string | null } | null;
}

/** Email identity. The ADDRESS comes from the venue's OWN Resend account (an ESP
 *  won't send from a domain it hasn't verified), so the tenant owns the display
 *  name on top of it. `connected: false` → no key, hence no From and no send at
 *  all. Campaigns are send-only. See src/lib/email/from.ts. */
interface SenderConfig {
  sender_name: string;
  resolved_from: string | null;
  connected: boolean;
}

/** Monthly email quota, from /api/marketing/email-provider. Always the venue's own
 *  Resend free tier — the only account its email goes out on. `connected: false`
 *  means nothing is being sent at all (Impostazioni → Email). */
interface EmailUsage {
  connected: boolean;
  marketing: { sent: number; limit: number };
  transactional: { sent: number; limit: number };
}

interface PreviewResult {
  total: number;
  with_email: number;
  with_phone: number;
  opted_out: number;
  channel: "email" | "whatsapp";
  reachable: number;
  capped: boolean;
  cap: number;
  cost: { billable: number; total_eur: number; per_message_eur: number | null };
}

const INPUT = "block w-full rounded-lg border-2 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]";
const INPUT_STYLE = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" } as const;
const CARD = { borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" } as const;

const fmtEur = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(n);

type SegKind = SegmentDef["kind"];

export default function MarketingPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const enabled = getFeatures(activeTenant?.settings).marketing_enabled;
  const planActive = hasActivePlan(activeTenant?.settings);

  const [campaigns, setCampaigns] = useState<CampaignListRow[]>([]);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp">("whatsapp");
  const [segKind, setSegKind] = useState<SegKind>("all");
  const [segDays, setSegDays] = useState("90");
  const [segTag, setSegTag] = useState("");
  const [segMonth, setSegMonth] = useState(String(new Date().getMonth() + 1));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [brief, setBrief] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<"ai" | "preview" | "send" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [openedCampaign, setOpenedCampaign] = useState<CampaignListRow | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [sender, setSender] = useState<SenderConfig | null>(null);
  const [senderSaved, setSenderSaved] = useState(false);
  const [emailUsage, setEmailUsage] = useState<EmailUsage | null>(null);

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
      .select("id, name, channel, status, recipient_count, sent_count, failed_count, created_at, subject, body, segment")
      .eq("tenant_id", activeTenant.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setCampaigns((data || []) as CampaignListRow[]);
  };

  // Open a past campaign: show what was sent and, per recipient, what happened
  // (sent / skipped-no-email / failed-with-Meta-error). This is the only place
  // the owner can see WHY a send of 11 delivered 9.
  const openCampaign = async (c: CampaignListRow) => {
    setOpenedCampaign(c);
    setRecipients(null);
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, status, error, guests(name, phone, email)")
      .eq("campaign_id", c.id)
      .order("status");
    setRecipients((data || []) as unknown as RecipientRow[]);
  };
  useEffect(() => { void loadCampaigns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeTenant?.id]);

  // Email identity (display name + reply-to) — what the guest sees in the inbox.
  useEffect(() => {
    if (!activeTenant) return;
    let alive = true;
    void fetch(`/api/marketing/sender?tenant_id=${activeTenant.id}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j?.success) setSender(j as SenderConfig); })
      .catch(() => {});
    return () => { alive = false; };
  }, [activeTenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Monthly email quota, shown right where the owner decides to send: no point
  // making them open Settings to find out they're at 980/1.000. Re-read after
  // every send (loadEmailUsage is called there) so the number stays honest.
  const loadEmailUsage = async () => {
    if (!activeTenant) return;
    try {
      const j = await (await fetch(`/api/marketing/email-provider?tenant_id=${activeTenant.id}`)).json();
      if (j?.success) setEmailUsage(j.usage as EmailUsage);
    } catch { /* a missing counter must never block the campaign form */ }
  };
  useEffect(() => { void loadEmailUsage(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeTenant?.id]);

  const saveSender = async () => {
    if (!sender) return;
    const json = await post("/api/marketing/sender", { sender_name: sender.sender_name }, "PATCH");
    if (json?.success) {
      setSender({ ...sender, resolved_from: json.resolved_from });
      setSenderSaved(true);
      setTimeout(() => setSenderSaved(false), 2000);
    }
  };

  // Segment or channel changed → the last preview no longer matches.
  useEffect(() => { setPreview(null); }, [segKind, segDays, segTag, segMonth, channel]);

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
    const json = await post("/api/marketing/send", { segment, channel }, "PUT");
    if (json?.success) setPreview(json as PreviewResult);
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
      void loadEmailUsage(); // il contatore deve riflettere l'invio appena fatto
    } else if (json?.error === "email_not_configured") {
      // Niente è partito e niente è stato addebitato: la campagna si ripreme
      // com'è appena collegata la chiave.
      setResult(t("mkt_err_email_not_configured"));
      void loadEmailUsage();
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

  // No Resend key of their own → the CRM sends this venue no email at all, so the
  // send button has to refuse BEFORE the click, not come back with a 403 after it.
  // `sender !== null` keeps it from flashing the warning while the status loads.
  const emailBlocked = channel === "email" && sender !== null && !sender.connected;
  const canSend =
    !!name.trim() && !!body.trim() && (channel !== "email" || (!!subject.trim() && !emailBlocked));
  const reachOnChannel = preview ? (channel === "email" ? preview.with_email : preview.with_phone) : null;

  // Raw ledger errors → something the owner can act on. Unknown provider errors
  // pass through verbatim (a Meta code beats a shrug).
  const humanError = (error: string): string => {
    if (error === "no_email") return t("mkt_err_no_email");
    if (error === "no_phone") return t("mkt_err_no_phone");
    if (error === "email_not_configured") return t("mkt_err_email_not_configured");
    if (error.includes("131030")) return t("mkt_err_not_allowed");
    if (error.includes("132001")) return t("mkt_err_no_template");
    return error;
  };

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2"><Megaphone className="w-6 h-6" />{t("mkt_title")}</h1>
        <p className="text-sm text-black mt-1">{t("mkt_desc")}</p>
      </div>

      {/* Two blocks: form (left) + phone preview (right) */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        {/* ── BLOCK 1: the campaign form ─────────────────────────── */}
        <div className="rounded-xl border-2 p-5 space-y-4" style={CARD}>
          <h2 className="text-xs font-bold text-black uppercase tracking-wider">{t("mkt_col_form")}</h2>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-black mb-1">{t("mkt_name_label")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mkt_name_ph")} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-sm font-bold text-black mb-1">{t("mkt_channel_label")}</label>
              <div className="flex gap-2">
                {(["whatsapp", "email"] as const).map((c) => (
                  // min-w-0: without it the icon + "WhatsApp" label sets an
                  // intrinsic floor that flex-1 can't go under, so the pair
                  // overflowed this grid cell on narrow panes.
                  <button key={c} type="button" onClick={() => setChannel(c)}
                    className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-lg border-2 px-2 sm:px-3 py-2 text-sm font-semibold ${channel === c ? "text-white" : "text-black"}`}
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
              <select value={segKind} onChange={(e) => setSegKind(e.target.value as SegKind)} className={`${INPUT} w-auto`} style={INPUT_STYLE}>
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
          </div>

          {/* AI brief */}
          <div className="rounded-lg border-2 p-3" style={{ borderColor: "rgba(196,149,106,0.5)", background: "rgba(196,149,106,0.08)" }}>
            <label className="block text-sm font-bold text-black mb-1 items-center gap-1.5"><Sparkles className="w-4 h-4 inline" /> {t("mkt_ai_label")}</label>
            <div className="flex gap-2">
              {/* min-w-0: an <input> defaults to a ~180px intrinsic width that
                  flex won't shrink past, pushing the button out of the card. */}
              <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("mkt_ai_ph")} className={`${INPUT} min-w-0`} style={{ ...INPUT_STYLE, background: "#fff" }} />
              <button type="button" onClick={doGenerate} disabled={busy === "ai" || !brief.trim()}
                className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}>
                {busy === "ai" ? "…" : t("mkt_ai_btn")}
              </button>
            </div>
          </div>

          {/* Email identity. The venue sends on ITS OWN Resend account, so the
              address comes from the domain IT verified — the owner controls the
              NAME laid on top. No key connected → no email leaves at all, and
              that has to be said here, where the send button is. */}
          {channel === "email" && sender && !sender.connected && (
            <div className="rounded-lg border-2 p-3 space-y-2" style={{ borderColor: "#dc2626", background: "rgba(220,38,38,0.06)" }}>
              <p className="text-sm font-bold text-red-600">{t("mkt_email_off_title")}</p>
              <p className="text-xs text-black">{t("mkt_email_off_body")}</p>
              <Link
                href="/settings?tab=email"
                className="inline-block text-xs font-bold underline"
                style={{ color: "#8b6540" }}
              >
                {t("mkt_email_off_cta")}
              </Link>
            </div>
          )}

          {channel === "email" && sender?.connected && (
            <div className="rounded-lg border-2 p-3 space-y-3" style={{ borderColor: "rgba(196,149,106,0.5)", background: "rgba(196,149,106,0.08)" }}>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-bold text-black">{t("mkt_sender_label")}</label>
                {senderSaved && <span className="text-xs font-semibold text-emerald-700">{t("mkt_sender_saved")}</span>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-black mb-1">{t("mkt_sender_name")}</label>
                <input
                  value={sender.sender_name}
                  onChange={(e) => setSender({ ...sender, sender_name: e.target.value })}
                  onBlur={() => void saveSender()}
                  placeholder={activeTenant?.name || ""}
                  className={INPUT}
                  style={{ ...INPUT_STYLE, background: "#fff" }}
                />
              </div>
              <p className="text-xs text-black">
                {t("mkt_sender_from_note")} <span className="font-semibold">{sender.resolved_from}</span>
              </p>
              <p className="text-xs text-black">{t("mkt_sender_noreply_note")}</p>

              {/* Quota del mese, qui e non solo in Impostazioni: è QUI che si decide
                  di inviare, ed è qui che serve sapere quante email restano. */}
              {emailUsage && (() => {
                const { sent, limit } = emailUsage.marketing;
                const left = Math.max(0, limit - sent);
                const pct = Math.min(100, Math.round((sent / limit) * 100));
                // Ambra oltre l'80%: deve accorgersene PRIMA di restare a secco.
                const bar = pct >= 100 ? "#dc2626" : pct >= 80 ? "#d97706" : "#c4956a";
                return (
                  <div className="pt-2 border-t" style={{ borderColor: "rgba(196,149,106,0.4)" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-black">Email rimaste questo mese</span>
                      <span className="text-xs font-bold text-black tabular-nums">
                        {left.toLocaleString()} su {limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.2)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bar }} />
                    </div>
                    {left === 0 && (
                      <p className="mt-1 text-xs font-semibold text-red-600">
                        Quota esaurita: le prossime email verranno rifiutate da Resend fino al 1° del mese.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

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

        {/* ── BLOCK 2: phone preview + reach + cost ──────────────── */}
        <div className="space-y-4 lg:sticky lg:top-6">
          <h2 className="text-xs font-bold text-black uppercase tracking-wider">{t("mkt_col_preview")}</h2>

          <PhoneMock
            channel={channel}
            senderName={(channel === "email" && sender?.sender_name.trim()) || activeTenant?.name || ""}
            subject={subject}
            body={body}
            sampleName={t("mkt_preview_sample_name")}
            emptyLabel={t("mkt_preview_empty")}
            waFramePre={t("mkt_wa_frame_pre")}
            waFramePost={t("mkt_wa_frame_post")}
            emailNoReply={t("mkt_email_noreply_body")}
            emailUnsub={t("mkt_email_unsub")}
          />
          <p className="text-xs text-black text-center">
            {channel === "whatsapp" ? t("mkt_preview_wa_hint") : t("mkt_preview_email_hint")}
          </p>

          {/* Reach + cost card */}
          <div className="rounded-xl border-2 p-4 space-y-3" style={CARD}>
            {!preview ? (
              <p className="text-sm text-black">{t("mkt_cost_none")}</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-black">{reachOnChannel}</span>
                  <div className="text-xs text-black leading-tight">
                    <p className="font-bold uppercase tracking-wide">{t("mkt_reach_reachable")}</p>
                    <p>{t("mkt_reach_of").replace("{total}", String(preview.total))}</p>
                    <p>{channel === "email" ? t("mkt_reach_channel_email") : t("mkt_reach_channel_wa")}</p>
                  </div>
                </div>
                {preview.opted_out > 0 && (
                  <p className="text-xs text-black">{t("mkt_reach_optout").replace("{n}", String(preview.opted_out))}</p>
                )}
                {preview.capped && (
                  <p className="text-xs font-semibold text-amber-700">{t("mkt_reach_capped").replace("{cap}", String(preview.cap))}</p>
                )}

                <div className="border-t pt-3" style={{ borderColor: "rgba(196,149,106,0.35)" }}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-black">
                      <Euro className="w-4 h-4" /> {t("mkt_cost_title")}
                    </span>
                    <span className="text-lg font-extrabold text-black">
                      {preview.cost.total_eur > 0 ? fmtEur(preview.cost.total_eur) : t("mkt_cost_free")}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-black">
                    <span>
                      {channel === "email"
                        ? t("mkt_count_emails").replace("{n}", String(preview.cost.billable))
                        : t("mkt_count_messages").replace("{n}", String(preview.cost.billable))}
                    </span>
                    {preview.cost.per_message_eur != null && preview.cost.per_message_eur > 0 && (
                      <span>{t("mkt_cost_per").replace("{price}", fmtEur(preview.cost.per_message_eur))}</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
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
              <button
                key={c.id}
                type="button"
                onClick={() => void openCampaign(c)}
                className={`w-full text-left flex items-center justify-between gap-2 px-4 py-3 cursor-pointer hover:bg-[#c4956a]/10 ${i ? "border-t" : ""}`}
                style={{ borderColor: "rgba(196,149,106,0.3)" }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-black truncate">{c.name}</p>
                  <p className="text-xs text-black">{new Date(c.created_at).toLocaleDateString()} · {c.channel}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-black">{c.sent_count}/{c.recipient_count}</p>
                    <p className={`text-[10px] font-bold uppercase ${c.status === "sent" ? "text-emerald-700" : c.status === "failed" ? "text-red-600" : "text-black"}`}>{c.status}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-black" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Campaign detail drawer — what was sent, and what happened to each recipient */}
      {openedCampaign && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenedCampaign(null)} />
          <div className="fixed inset-y-0 right-0 w-full sm:w-[440px] border-l shadow-2xl z-50 flex flex-col"
            style={{ background: "rgba(252,246,237,0.98)", borderColor: "#c4956a" }}>
            <div className="px-5 py-4 flex items-start justify-between border-b" style={{ borderColor: "#c4956a" }}>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-black truncate">{openedCampaign.name}</h2>
                <p className="text-xs text-black">
                  {new Date(openedCampaign.created_at).toLocaleString()} · {openedCampaign.channel === "email" ? "Email" : "WhatsApp"}
                </p>
              </div>
              <button onClick={() => setOpenedCampaign(null)} className="p-2 hover:bg-[#c4956a]/10 rounded-full cursor-pointer">
                <X className="w-5 h-5 text-black" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Outcome counters */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["sent", openedCampaign.sent_count, "text-emerald-700"],
                  ["failed", openedCampaign.failed_count, "text-red-600"],
                  ["total", openedCampaign.recipient_count, "text-black"],
                ] as const).map(([key, val, cls]) => (
                  <div key={key} className="rounded-lg border-2 p-2 text-center" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                    <p className={`text-xl font-extrabold ${cls}`}>{val}</p>
                    <p className="text-[10px] font-bold uppercase text-black">{t(`mkt_detail_${key}`)}</p>
                  </div>
                ))}
              </div>

              {/* What was actually sent */}
              <div>
                <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-2">{t("mkt_detail_content")}</h3>
                <div className="rounded-lg border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "#fff" }}>
                  {openedCampaign.subject && (
                    <p className="text-sm font-bold text-black border-b pb-2" style={{ borderColor: "rgba(196,149,106,0.3)" }}>
                      {openedCampaign.subject}
                    </p>
                  )}
                  <p className="text-sm text-black whitespace-pre-wrap leading-relaxed">{openedCampaign.body}</p>
                </div>
              </div>

              {/* Per-recipient outcome — the "why" behind a partial delivery */}
              <div>
                <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-2">{t("mkt_detail_recipients")}</h3>
                {recipients === null ? (
                  <p className="text-sm text-black">…</p>
                ) : recipients.length === 0 ? (
                  <p className="text-sm text-black italic">{t("mkt_detail_no_recipients")}</p>
                ) : (
                  <div className="rounded-lg border-2 overflow-hidden" style={{ borderColor: "#c4956a" }}>
                    {recipients.map((r, i) => {
                      const Icon = r.status === "sent" ? CheckCircle2 : r.status === "failed" ? XCircle : MinusCircle;
                      const cls = r.status === "sent" ? "text-emerald-700" : r.status === "failed" ? "text-red-600" : "text-black";
                      const contact = openedCampaign.channel === "email" ? r.guests?.email : r.guests?.phone;
                      return (
                        <div key={r.id} className={`flex items-start gap-2 px-3 py-2 ${i ? "border-t" : ""}`}
                          style={{ borderColor: "rgba(196,149,106,0.3)", background: "rgba(252,246,237,0.6)" }}>
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cls}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-black truncate">{r.guests?.name || "—"}</p>
                            <p className="text-xs text-black truncate">{contact || "—"}</p>
                            {r.error && (
                              <p className={`text-xs font-medium mt-0.5 ${cls}`}>{humanError(r.error)}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Phone mockup: renders the message as the client will receive it ─────────
function PhoneMock({
  channel, senderName, subject, body, sampleName, emptyLabel, waFramePre, waFramePost,
  emailNoReply, emailUnsub,
}: {
  channel: "email" | "whatsapp";
  senderName: string;
  subject: string;
  body: string;
  sampleName: string;
  emptyLabel: string;
  /** Fixed greeting BEFORE the free body — "{name}" is replaced with the sample. */
  waFramePre: string;
  /** Fixed sign-off AFTER the free body. */
  waFramePost: string;
  /** Footer lines the real email carries — shown so the preview isn't a lie. */
  emailNoReply: string;
  emailUnsub: string;
}) {
  const hasBody = !!body.trim();
  // Mirror the approved WhatsApp template frame exactly: greeting + free body +
  // sign-off (Meta requires fixed text around every variable).
  const pre = waFramePre.replace("{name}", sampleName);
  const waText = hasBody ? `${pre}\n\n${body}\n\n${waFramePost}` : "";

  return (
    <div className="mx-auto w-full max-w-[300px]">
      {/* phone shell */}
      <div className="rounded-[2.2rem] bg-neutral-900 p-2.5 shadow-xl">
        <div className="rounded-[1.7rem] overflow-hidden bg-white">
          {channel === "whatsapp" ? (
            <div className="flex flex-col h-[460px]" style={{ background: "#e5ddd5" }}>
              {/* WA header */}
              <div className="flex items-center gap-2 px-3 py-2.5 text-white" style={{ background: "#075e54" }}>
                <div className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center text-sm font-bold">
                  {(senderName || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{senderName || "Business"}</p>
                  <p className="text-[10px] opacity-80">online</p>
                </div>
              </div>
              {/* WA chat body */}
              <div className="flex-1 overflow-y-auto p-3">
                {hasBody ? (
                  <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
                    <p className="text-[13px] text-black whitespace-pre-wrap leading-snug">{waText}</p>
                    <p className="text-right text-[10px] text-neutral-400 mt-1">12:30</p>
                  </div>
                ) : (
                  <p className="text-center text-xs text-neutral-500 mt-8">{emptyLabel}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-[460px] bg-white">
              {/* Email header */}
              <div className="px-4 py-3 border-b border-neutral-200">
                <p className="text-[11px] text-neutral-500 font-medium">{senderName || "Business"}</p>
                <p className="text-sm font-bold text-black truncate">{subject || (hasBody ? senderName : "")}</p>
              </div>
              {/* Email body + the real footer (no-reply notice + unsubscribe) */}
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col">
                {hasBody ? (
                  <>
                    <p className="text-[13px] text-black whitespace-pre-wrap leading-relaxed flex-1">{body}</p>
                    <div className="mt-4 pt-3 border-t border-neutral-200 space-y-1">
                      <p className="text-[10px] text-neutral-500 leading-snug">{emailNoReply}</p>
                      <p className="text-[10px] text-neutral-500 underline">{emailUnsub}</p>
                    </div>
                  </>
                ) : (
                  <p className="text-center text-xs text-neutral-500 mt-8">{emptyLabel}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
