"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Bot, AlertTriangle, MessageSquare, Calendar,
  Phone, TrendingUp, UserX, Zap, Clock, Lightbulb, DollarSign, ShieldCheck, Eye,
} from "lucide-react";
import { TENANT_STATUSES, type TenantStatus } from "@/lib/tenants/status";

const STATUS_BADGE: Record<TenantStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trial: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  suspended: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-zinc-100 text-zinc-600 border-zinc-300",
};

interface TenantDetail {
  tenant: { id: string; name: string; status: TenantStatus; created_at: string; archived_at?: string | null; purge_after?: string | null };
  kpis: {
    aiRevenue7: number;
    aiRevenue30: number;
    aiPct: number;
    totalBookings30: number;
    totalBookings7: number;
    aiCount: number;
    noShows: number;
    escalations: number;
    escalationRate: number;
  };
  recentReservations: any[];
  recentConversations: any[];
  recentIncidents: any[];
  recentLogs: any[];
}

const sourceIcon = (s: string) => {
  switch (s) {
    case "ai_chat": return <MessageSquare className="w-3.5 h-3.5 text-[#c4956a]" />;
    case "ai_voice": return <Phone className="w-3.5 h-3.5 text-indigo-500" />;
    default: return <Calendar className="w-3.5 h-3.5 text-black" />;
  }
};

export default function TenantDetailPage() {
  const { globalRole } = useTenant();
  const params = useParams();
  const tenantId = params?.id as string;
  const [data, setData] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<any[]>([]);
  const [statusSaving, setStatusSaving] = useState(false);
  const [danger, setDanger] = useState<null | "archive" | "purge">(null);
  const [confirmText, setConfirmText] = useState("");
  const [working, setWorking] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const runArchive = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/archive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_name: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setDownloadUrl(j.download_url || null);
      setActionMsg(`Archiviato. Cancellazione definitiva il ${new Date(j.purge_after).toLocaleDateString()}.`);
      setData((p) => (p ? { ...p, tenant: { ...p.tenant, status: "archived" } } : p));
      setDanger(null); setConfirmText("");
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
  const runPurge = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/purge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_name: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setActionMsg("Cliente cancellato definitivamente.");
      setDanger(null); setConfirmText("");
      setTimeout(() => { window.location.href = "/admin"; }, 1200);
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
  const runRestore = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/restore", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setActionMsg("Ripristinato.");
      setData((p) => (p ? { ...p, tenant: { ...p.tenant, status: j.status } } : p));
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };

  const changeStatus = async (status: TenantStatus) => {
    if (!tenantId) return;
    setStatusSaving(true);
    try {
      const res = await fetch("/api/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setData((prev) => (prev ? { ...prev, tenant: { ...prev.tenant, status } } : prev));
    } catch (err) {
      console.error(err);
    }
    setStatusSaving(false);
  };

  useEffect(() => {
    if (!tenantId) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const [detailRes, insightRes] = await Promise.all([
          fetch(`/api/admin/tenant?id=${tenantId}`),
          fetch(`/api/insights?tenant_id=${tenantId}`),
        ]);
        const json = await detailRes.json();
        if (json.error) throw new Error(json.error);
        setData(json);
        const insightData = await insightRes.json();
        setInsights(insightData.all_insights || []);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    fetchDetail();
  }, [tenantId]);

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  if (loading) {
    return <div className="p-12 text-center text-black animate-pulse">Loading tenant details...</div>;
  }

  if (!data) {
    return <div className="p-12 text-center text-black">Tenant not found</div>;
  }

  const { tenant, kpis, recentReservations, recentConversations, recentIncidents, recentLogs } = data;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin" className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 text-black" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-black">{tenant.name}</h1>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[tenant.status] || STATUS_BADGE.pending}`}>
              {tenant.status}
            </span>
          </div>
          <p className="text-xs text-black">Tenant since {new Date(tenant.created_at).toLocaleDateString()}</p>
        </div>
        {/* Lifecycle control: only trial/active receive AI traffic. */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-black uppercase tracking-wider hidden sm:block">Status</label>
          <select
            value={tenant.status}
            disabled={statusSaving || tenant.status === "archived"}
            onChange={(e) => changeStatus(e.target.value as TenantStatus)}
            className="text-xs border-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c4956a] disabled:opacity-50"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
          >
            {TENANT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">AI Revenue (7d)</p>
          <p className="text-xl font-bold text-[#22c55e]">€{kpis.aiRevenue7.toLocaleString()}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">AI Revenue (30d)</p>
          <p className="text-xl font-bold text-[#22c55e]">€{kpis.aiRevenue30.toLocaleString()}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <div className="flex items-center gap-1">
            <Bot className="w-3.5 h-3.5 text-[#c4956a]" />
            <p className="text-xs text-black font-medium">AI Handled</p>
          </div>
          <p className="text-xl font-bold text-black">{kpis.aiPct}%</p>
          <p className="text-[10px] text-black">{kpis.aiCount} AI / {kpis.totalBookings30 - kpis.aiCount} Staff</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <div className="flex items-center gap-1">
            <UserX className="w-3.5 h-3.5 text-red-400" />
            <p className="text-xs text-black font-medium">No-Shows (30d)</p>
          </div>
          <p className="text-xl font-bold text-black">{kpis.noShows}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-orange-400" />
            <p className="text-xs text-black font-medium">Escalation Rate</p>
          </div>
          <p className="text-xl font-bold text-black">{kpis.escalationRate}%</p>
          <p className="text-[10px] text-black">{kpis.escalations} escalated</p>
        </div>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="rounded-xl border-2 p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Insights & Opportunities</h3>
          </div>
          <div className="space-y-2">
            {insights.map((ins: any, i: number) => {
              const iconMap: Record<string, any> = {
                revenue_opportunity: <DollarSign className="w-3.5 h-3.5 text-emerald-500" />,
                performance_drop: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
                ai_optimization: <Zap className="w-3.5 h-3.5 text-purple-500" />,
                loss_prevention: <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />,
                hidden_value: <Eye className="w-3.5 h-3.5 text-indigo-500" />,
              };
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                  <div className="mt-0.5">{iconMap[ins.type] || <Lightbulb className="w-3.5 h-3.5 text-amber-500" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-black">{ins.title}</p>
                      {ins.estimated_value > 0 && (
                        <span className="text-xs font-bold text-[#22c55e]">€{ins.estimated_value.toLocaleString()}/mo</span>
                      )}
                    </div>
                    <p className="text-[10px] text-black mt-0.5">{ins.description}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    ins.confidence === "high" ? "bg-emerald-50 text-emerald-700" :
                    ins.confidence === "medium" ? "bg-yellow-50 text-yellow-700" :
                    "bg-zinc-50 text-black"
                  }`}>{ins.confidence}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two columns: Reservations + Conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent Reservations */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Recent Reservations</h3>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {recentReservations.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No recent reservations</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentReservations.map((r: any) => (
                  <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                    {sourceIcon(r.source)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-black truncate">
                        {r.guests?.name || "Guest"} — {r.party_size}p
                      </p>
                      <p className="text-[10px] text-black">{r.date} {r.time}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      r.status === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                      r.status === "no_show" ? "bg-red-50 text-red-700" :
                      r.status === "cancelled" ? "bg-zinc-100 text-black" :
                      "bg-yellow-50 text-yellow-700"
                    }`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Conversations */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Recent Conversations</h3>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {recentConversations.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No recent conversations</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentConversations.map((c: any) => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                    {c.channel === "whatsapp" ? (
                      <MessageSquare className="w-3.5 h-3.5 text-[#c4956a]" />
                    ) : (
                      <Phone className="w-3.5 h-3.5 text-indigo-500" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-black truncate">{c.summary || "No summary"}</p>
                      <p className="text-[10px] text-black">{new Date(c.created_at).toLocaleString()}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      c.status === "escalated" ? "bg-red-50 text-red-700" :
                      c.status === "resolved" ? "bg-emerald-50 text-emerald-700" :
                      "bg-zinc-100 text-black"
                    }`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Incidents + System Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Incidents */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Incidents</h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {recentIncidents.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No incidents</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentIncidents.map((inc: any) => (
                  <div key={inc.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        inc.severity === "critical" ? "bg-red-50 text-red-700 border-red-200" :
                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }`}>{inc.severity}</span>
                      <span className="text-[10px] text-black">{inc.type.replace("_", " ")}</span>
                    </div>
                    <p className="text-xs font-medium text-black">{inc.title}</p>
                    <p className="text-[10px] text-black">{new Date(inc.created_at).toLocaleDateString()} — {inc.status}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* System Logs */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">System Logs</h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {recentLogs.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No system logs</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentLogs.map((log: any) => (
                  <div key={log.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        log.severity === "critical" ? "bg-red-50 text-red-700 border-red-200" :
                        log.severity === "high" ? "bg-orange-50 text-orange-700 border-orange-200" :
                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }`}>{log.severity}</span>
                      <span className="text-[10px] text-black">{log.category}</span>
                    </div>
                    <p className="text-xs font-medium text-black">{log.title}</p>
                    <p className="text-[10px] text-black">{new Date(log.created_at).toLocaleDateString()} — {log.status}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Danger Zone — platform_admin only (page already gates) */}
      <div className="rounded-xl border-2 border-red-300 bg-red-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
          <AlertTriangle className="w-4 h-4" /> Danger Zone
        </div>

        {actionMsg && <p className="text-xs font-medium text-black">{actionMsg}</p>}
        {downloadUrl && (
          <a href={downloadUrl} className="text-xs font-bold text-blue-700 underline" target="_blank" rel="noreferrer">
            ⬇︎ Scarica il backup dei dati (JSON)
          </a>
        )}

        {tenant.status === "archived" ? (
          <div className="space-y-2">
            <p className="text-xs text-black">
              Archiviato{tenant.archived_at ? ` il ${new Date(tenant.archived_at).toLocaleDateString()}` : ""}.
              {tenant.purge_after ? ` Cancellazione automatica il ${new Date(tenant.purge_after).toLocaleDateString()}.` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={runRestore} disabled={working}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                Ripristina
              </button>
              <button onClick={() => { setDanger("purge"); setConfirmText(""); }} disabled={working}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
                Cancella adesso definitivamente
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setDanger("archive"); setConfirmText(""); }} disabled={working}
              className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 disabled:opacity-50">
              Archivia &amp; rimuovi (recuperabile 90 giorni)
            </button>
            <button onClick={() => { setDanger("purge"); setConfirmText(""); }} disabled={working}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
              Cancella subito (salta l&apos;attesa)
            </button>
          </div>
        )}
      </div>

      {/* Typed-name confirm modal */}
      {danger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !working && setDanger(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {danger === "archive" ? "Archivia e rimuovi" : "Cancella definitivamente"}
            </h3>
            <p className="text-xs text-black">
              {danger === "archive"
                ? "Il cliente sparisce subito dal CRM e i suoi servizi si fermano. Recuperabile per 90 giorni, poi cancellato per sempre."
                : "Cancellazione IMMEDIATA e irreversibile: dati, workflow n8n, assistente vocale e accessi staff. Esiste un backup scaricabile."}
            </p>
            <p className="text-xs text-black">Scrivi il nome esatto del ristorante per confermare: <b>{tenant.name}</b></p>
            <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              className="w-full border-2 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
              style={{ borderColor: "#fca5a5" }} placeholder={tenant.name} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDanger(null)} disabled={working}
                className="px-3 py-1.5 rounded-lg border text-xs font-bold text-black disabled:opacity-50">Annulla</button>
              <button
                onClick={danger === "archive" ? runArchive : runPurge}
                disabled={working || confirmText.trim() !== tenant.name}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
                {working ? "..." : (danger === "archive" ? "Archivia" : "Cancella per sempre")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
