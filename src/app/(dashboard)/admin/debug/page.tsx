"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { Bug, MessageSquare, Phone, Calendar, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, ExternalLink } from "lucide-react";

export default function DebugPage() {
  const { globalRole } = useTenant();
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);
  const [expandedRes, setExpandedRes] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(r => r.json())
      .then(d => {
        const ts = d.tenants || [];
        setTenants(ts);
        if (ts.length > 0) setSelectedTenant(ts[0].id);
      })
      .catch(() => {});
  }, []);

  const fetchDebug = () => {
    if (!selectedTenant) return;
    setLoading(true);
    setExpandedConv(null);
    setExpandedRes(null);
    Promise.all([
      fetch(`/api/admin/tenant?id=${selectedTenant}`).then(r => r.json()),
      fetch(`/api/admin/system-logs?tenant_id=${selectedTenant}&status=all`).then(r => r.json()),
    ]).then(([tenant, logs]) => {
      setDebugData({ ...tenant, systemLogs: logs.logs || [] });
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchDebug(); }, [selectedTenant]);

  const resolveLog = async (id: string) => {
    await fetch("/api/admin/system-logs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    fetchDebug();
  };

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Bug className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Quick Debug</h1>
        </div>
        <div className="relative">
          <select value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)}
            className="text-sm border-2 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-[#c4956a] appearance-none"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown className="w-4 h-4 text-black absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-black animate-pulse">Loading...</div>
      ) : debugData ? (
        <div className="space-y-4">
          {/* Quick status */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black">Bookings (7d)</p>
              <p className="text-xl font-bold text-black">{debugData.kpis?.totalBookings7 || 0}</p>
            </div>
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black">AI Handled</p>
              <p className="text-xl font-bold text-black">{debugData.kpis?.aiPct || 0}%</p>
            </div>
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black">Escalations</p>
              <p className={`text-xl font-bold ${debugData.kpis?.escalations > 0 ? "text-red-500" : "text-black"}`}>{debugData.kpis?.escalations || 0}</p>
            </div>
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black">Open Errors</p>
              <p className={`text-xl font-bold ${(debugData.systemLogs || []).filter((l: any) => l.status === "open").length > 0 ? "text-red-500" : "text-black"}`}>
                {(debugData.systemLogs || []).filter((l: any) => l.status === "open").length}
              </p>
            </div>
          </div>

          {/* Three columns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Conversations — clickable to expand */}
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
                <MessageSquare className="w-3.5 h-3.5 text-[#c4956a]" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Conversations</h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {(debugData.recentConversations || []).length === 0 ? (
                  <p className="p-4 text-xs text-black text-center">No conversations</p>
                ) : (debugData.recentConversations || []).map((c: any) => (
                  <div key={c.id} className="cursor-pointer hover:bg-[#c4956a]/5 transition-colors"
                    onClick={() => setExpandedConv(expandedConv === c.id ? null : c.id)}>
                    <div className="px-4 py-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <ChevronRight className={`w-3 h-3 text-black transition-transform ${expandedConv === c.id ? "rotate-90" : ""}`} />
                        {c.channel === "whatsapp" ? <MessageSquare className="w-3 h-3 text-[#c4956a]" /> : <Phone className="w-3 h-3 text-indigo-500" />}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          c.status === "escalated" ? "bg-red-50 text-red-700" :
                          c.status === "resolved" ? "bg-emerald-50 text-emerald-700" :
                          "bg-zinc-100 text-black"
                        }`}>{c.status}</span>
                        {c.sentiment && c.sentiment !== "neutral" && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.sentiment === "negative" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
                            {c.sentiment}
                          </span>
                        )}
                        <span className="text-[10px] text-black ml-auto">{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-black pl-5">{c.summary || "No summary"}</p>
                    </div>
                    {expandedConv === c.id && (
                      <div className="px-4 pb-3 pl-9">
                        <div className="text-[10px] text-black space-y-1 p-2 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                          <p><strong>ID:</strong> {c.id}</p>
                          <p><strong>Channel:</strong> {c.channel}</p>
                          <p><strong>Status:</strong> {c.status}</p>
                          <p><strong>Sentiment:</strong> {c.sentiment || "—"}</p>
                          <p><strong>Created:</strong> {new Date(c.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Reservations — clickable to expand */}
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
                <Calendar className="w-3.5 h-3.5 text-[#c4956a]" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Reservations</h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {(debugData.recentReservations || []).length === 0 ? (
                  <p className="p-4 text-xs text-black text-center">No reservations</p>
                ) : (debugData.recentReservations || []).map((r: any) => (
                  <div key={r.id} className="cursor-pointer hover:bg-[#c4956a]/5 transition-colors"
                    onClick={() => setExpandedRes(expandedRes === r.id ? null : r.id)}>
                    <div className="px-4 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <ChevronRight className={`w-3 h-3 text-black transition-transform ${expandedRes === r.id ? "rotate-90" : ""}`} />
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            r.source === "ai_chat" ? "bg-orange-50 text-orange-700" :
                            r.source === "ai_voice" ? "bg-indigo-50 text-indigo-700" :
                            "bg-zinc-100 text-black"
                          }`}>{r.source}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            r.status === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                            r.status === "no_show" ? "bg-red-50 text-red-700" :
                            r.status === "cancelled" ? "bg-zinc-100 text-black" :
                            "bg-yellow-50 text-yellow-700"
                          }`}>{r.status}</span>
                        </div>
                        <span className="text-[10px] text-black">{r.date} {r.time}</span>
                      </div>
                      <p className="text-xs text-black pl-5">{r.guests?.name || "Guest"} — {r.party_size}p</p>
                    </div>
                    {expandedRes === r.id && (
                      <div className="px-4 pb-3 pl-9">
                        <div className="text-[10px] text-black space-y-1 p-2 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                          <p><strong>ID:</strong> {r.id}</p>
                          <p><strong>Guest:</strong> {r.guests?.name || "—"} {r.guests?.phone ? `(${r.guests.phone})` : ""}</p>
                          <p><strong>Date/Time:</strong> {r.date} {r.time}</p>
                          <p><strong>Party:</strong> {r.party_size} people</p>
                          <p><strong>Source:</strong> {r.source}</p>
                          <p><strong>Status:</strong> {r.status}</p>
                          <p><strong>Created:</strong> {new Date(r.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Errors — with resolve button */}
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Errors & Incidents</h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {(() => {
                  const items = [
                    ...(debugData.recentIncidents || []).map((i: any) => ({ ...i, _type: "incident", _time: i.created_at })),
                    ...(debugData.systemLogs || []).map((l: any) => ({ ...l, _type: "log", _time: l.created_at })),
                  ].sort((a: any, b: any) => new Date(b._time).getTime() - new Date(a._time).getTime()).slice(0, 20);

                  if (items.length === 0) return <p className="p-4 text-xs text-black text-center">No errors</p>;

                  return items.map((item: any, i: number) => (
                    <div key={i} className="px-4 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            (item.severity === "critical" || item.severity === "high") ? "bg-red-50 text-red-700 border-red-200" :
                            "bg-yellow-50 text-yellow-700 border-yellow-200"
                          }`}>{item.severity}</span>
                          <span className="text-[10px] text-black">{item._type === "log" ? item.category : item.type?.replace("_", " ")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {item._type === "log" && item.status === "open" && (
                            <button onClick={(e) => { e.stopPropagation(); resolveLog(item.id); }}
                              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                              <CheckCircle2 className="w-3 h-3" /> Resolve
                            </button>
                          )}
                          {item.status === "resolved" && (
                            <span className="text-[10px] font-bold text-emerald-600">Resolved</span>
                          )}
                          {item.status === "open" && item._type === "incident" && (
                            <span className="text-[10px] font-bold text-red-500">Open</span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs font-medium text-black">{item.title}</p>
                      {item.description && <p className="text-[10px] text-black mt-0.5">{item.description}</p>}
                      <p className="text-[10px] text-black/25 mt-1">{new Date(item._time).toLocaleString()}</p>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
