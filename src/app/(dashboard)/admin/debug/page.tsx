"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { Bug, Search, MessageSquare, Phone, Calendar, AlertTriangle, ChevronDown } from "lucide-react";

export default function DebugPage() {
  const { globalRole } = useTenant();
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);

  // Load tenants list
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

  // Load debug data when tenant selected
  useEffect(() => {
    if (!selectedTenant) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/tenant?id=${selectedTenant}`).then(r => r.json()),
      fetch(`/api/admin/system-logs?tenant_id=${selectedTenant}&status=all`).then(r => r.json()),
    ]).then(([tenant, logs]) => {
      setDebugData({ ...tenant, systemLogs: logs.logs || [] });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [selectedTenant]);

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      {/* Header with tenant selector */}
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
          <ChevronDown className="w-4 h-4 text-black/40 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-black/50 animate-pulse">Loading debug data...</div>
      ) : debugData ? (
        <div className="space-y-4">

          {/* Quick status */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black/60">Bookings (7d)</p>
              <p className="text-xl font-bold text-black">{debugData.kpis?.totalBookings7 || 0}</p>
            </div>
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black/60">AI Handled</p>
              <p className="text-xl font-bold text-black">{debugData.kpis?.aiPct || 0}%</p>
            </div>
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black/60">Escalations</p>
              <p className={`text-xl font-bold ${debugData.kpis?.escalations > 0 ? "text-red-500" : "text-black"}`}>{debugData.kpis?.escalations || 0}</p>
            </div>
            <div className="rounded-xl p-3 border-2" style={cardStyle}>
              <p className="text-xs text-black/60">Open Errors</p>
              <p className={`text-xl font-bold ${debugData.systemLogs.filter((l: any) => l.status === "open").length > 0 ? "text-red-500" : "text-black"}`}>
                {debugData.systemLogs.filter((l: any) => l.status === "open").length}
              </p>
            </div>
          </div>

          {/* Three columns: Conversations, Reservations, Errors */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Last conversations */}
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
                <MessageSquare className="w-3.5 h-3.5 text-[#c4956a]" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Last Conversations</h3>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {(debugData.recentConversations || []).length === 0 ? (
                  <p className="p-4 text-xs text-black/40 text-center">No conversations</p>
                ) : (debugData.recentConversations || []).map((c: any) => (
                  <div key={c.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      {c.channel === "whatsapp" ? (
                        <MessageSquare className="w-3 h-3 text-[#c4956a]" />
                      ) : (
                        <Phone className="w-3 h-3 text-indigo-500" />
                      )}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        c.status === "escalated" ? "bg-red-50 text-red-700" :
                        c.status === "resolved" ? "bg-emerald-50 text-emerald-700" :
                        "bg-zinc-100 text-zinc-500"
                      }`}>{c.status}</span>
                      <span className="text-[10px] text-black/30">{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-black truncate">{c.summary || "No summary"}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Last reservations */}
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
                <Calendar className="w-3.5 h-3.5 text-[#c4956a]" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Last Reservations</h3>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {(debugData.recentReservations || []).length === 0 ? (
                  <p className="p-4 text-xs text-black/40 text-center">No reservations</p>
                ) : (debugData.recentReservations || []).map((r: any) => (
                  <div key={r.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          r.source === "ai_chat" ? "bg-orange-50 text-orange-700" :
                          r.source === "ai_voice" ? "bg-indigo-50 text-indigo-700" :
                          "bg-zinc-100 text-zinc-500"
                        }`}>{r.source}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          r.status === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                          r.status === "no_show" ? "bg-red-50 text-red-700" :
                          r.status === "cancelled" ? "bg-zinc-100 text-zinc-500" :
                          "bg-yellow-50 text-yellow-700"
                        }`}>{r.status}</span>
                      </div>
                      <span className="text-[10px] text-black/30">{r.date} {r.time}</span>
                    </div>
                    <p className="text-xs text-black">{r.guests?.name || "Guest"} — {r.party_size}p</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Errors & logs */}
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "#c4956a" }}>
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Errors & Incidents</h3>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {[...(debugData.recentIncidents || []).map((i: any) => ({ ...i, _type: "incident", _time: i.created_at })),
                  ...(debugData.systemLogs || []).map((l: any) => ({ ...l, _type: "log", _time: l.created_at })),
                ].sort((a: any, b: any) => new Date(b._time).getTime() - new Date(a._time).getTime())
                .slice(0, 20)
                .map((item: any, i: number) => (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        (item.severity === "critical" || item.severity === "high") ? "bg-red-50 text-red-700 border-red-200" :
                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }`}>{item.severity}</span>
                      <span className="text-[10px] text-black/30">{item._type}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        item.status === "open" ? "bg-red-50 text-red-600" :
                        item.status === "resolved" ? "bg-emerald-50 text-emerald-600" :
                        "bg-zinc-100 text-zinc-500"
                      }`}>{item.status}</span>
                    </div>
                    <p className="text-xs font-medium text-black">{item.title}</p>
                    <p className="text-[10px] text-black/40">{new Date(item._time).toLocaleString()}</p>
                  </div>
                ))}
                {(debugData.recentIncidents || []).length === 0 && (debugData.systemLogs || []).length === 0 && (
                  <p className="p-4 text-xs text-black/40 text-center">No errors</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
