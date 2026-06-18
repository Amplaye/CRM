"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Activity, AlertOctagon, AlertTriangle, CheckCircle2, XCircle, Filter,
  Zap, Clock, RefreshCw, Wrench,
} from "lucide-react";

// ---- shared types ----
interface TenantOverview {
  id: string;
  name: string;
  health: "healthy" | "attention" | "critical";
  activeIssues: number;
  criticalIssues: number;
  lastActivity: string;
}
interface Incident {
  id: string;
  tenant_id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  created_at: number;
  tenants?: { name: string };
}
interface SystemLog {
  id: string;
  tenant_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  tenants: { name: string } | null;
}

type Tab = "attention" | "issues" | "logs";

const sevStyle = (s: string) => {
  switch (s) {
    case "critical": return "bg-red-50 text-red-700 border-red-200";
    case "high": return "bg-orange-50 text-orange-700 border-orange-200";
    case "medium": return "bg-yellow-50 text-yellow-700 border-yellow-200";
    default: return "bg-zinc-50 text-black border-zinc-200";
  }
};
const typeIcon = (type: string) => {
  switch (type) {
    case "ai_error": return <Zap className="w-4 h-4 text-purple-500" />;
    case "conflict": return <Clock className="w-4 h-4 text-orange-500" />;
    case "health_safety": return <AlertOctagon className="w-4 h-4 text-red-500" />;
    default: return <AlertTriangle className="w-4 h-4 text-black" />;
  }
};
const healthBadge = (h: string) => {
  switch (h) {
    case "critical": return { dot: "bg-red-500", bg: "bg-red-50 text-red-700 border-red-200", label: "Critical" };
    case "attention": return { dot: "bg-yellow-500", bg: "bg-yellow-50 text-yellow-700 border-yellow-200", label: "Attention" };
    default: return { dot: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Healthy" };
  }
};

const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

export default function AdminMonitoringPage() {
  const { globalRole } = useTenant();
  const [tab, setTab] = useState<Tab>("attention");

  // attention
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  const [loadingAttn, setLoadingAttn] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

  // issues
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loadingInc, setLoadingInc] = useState(true);
  const [incSeverity, setIncSeverity] = useState("all");
  const [incStatus, setIncStatus] = useState("all");

  // logs
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [logFilter, setLogFilter] = useState<"open" | "resolved" | "all">("open");

  const fetchAttention = useCallback(async () => {
    setLoadingAttn(true);
    try {
      const res = await fetch("/api/admin/overview");
      const data = await res.json();
      setTenants(data.tenants || []);
    } catch (err) { console.error(err); }
    setLoadingAttn(false);
  }, []);

  const fetchIncidents = useCallback(async () => {
    setLoadingInc(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("incidents")
        .select("*, tenants(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      setIncidents(data || []);
    } catch (err) { console.error(err); }
    setLoadingInc(false);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/admin/system-logs?status=${logFilter}`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) { console.error(err); }
    setLoadingLogs(false);
  }, [logFilter]);

  useEffect(() => { fetchAttention(); }, [fetchAttention]);
  useEffect(() => { if (tab === "issues") fetchIncidents(); }, [tab, fetchIncidents]);
  useEffect(() => { if (tab === "logs") fetchLogs(); }, [tab, fetchLogs]);

  const runReconcile = async () => {
    setReconciling(true);
    setReconcileMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/reconcile", { method: "POST" });
      const data = await res.json();
      const fixed = (data?.repaired ?? data?.fixed ?? data?.count);
      setReconcileMsg(typeof fixed === "number" ? `Reconcile completato — ${fixed} sistemati` : "Reconcile completato");
      fetchAttention();
    } catch {
      setReconcileMsg("Reconcile fallito");
    }
    setReconciling(false);
  };

  const resolveLog = async (id: string) => {
    await fetch("/api/admin/system-logs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    fetchLogs();
  };

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const needsAttention = tenants.filter((t) => t.health !== "healthy" || t.activeIssues > 0);
  const filteredInc = incidents.filter((i) => {
    if (incSeverity !== "all" && i.severity !== incSeverity) return false;
    if (incStatus !== "all" && i.status !== incStatus) return false;
    return true;
  });

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors ${
        tab === id ? "bg-[#c4956a] text-white border-[#c4956a]" : "text-black border-[#c4956a]/40 hover:bg-[#c4956a]/10"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Monitoring</h1>
        </div>
        <div className="flex gap-2">
          {tabBtn("attention", "Da sistemare")}
          {tabBtn("issues", "Incidenti")}
          {tabBtn("logs", "Log di sistema")}
        </div>
      </div>

      {/* ---- NEEDS ATTENTION ---- */}
      {tab === "attention" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-black">{needsAttention.length} tenant da tenere d&apos;occhio</p>
            <div className="flex items-center gap-2">
              {reconcileMsg && <span className="text-xs text-black">{reconcileMsg}</span>}
              <button onClick={runReconcile} disabled={reconciling}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c4956a] text-white text-xs font-bold hover:bg-[#8b6540] transition-colors disabled:opacity-60">
                <Wrench className={`w-3.5 h-3.5 ${reconciling ? "animate-pulse" : ""}`} /> Ripara provisioning
              </button>
              <button onClick={fetchAttention} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
                <RefreshCw className={`w-4 h-4 text-black ${loadingAttn ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {loadingAttn ? (
            <div className="p-12 text-center text-black animate-pulse">Loading...</div>
          ) : needsAttention.length === 0 ? (
            <div className="rounded-xl border-2 p-12 text-center" style={cardStyle}>
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-black">Tutto in salute</p>
            </div>
          ) : (
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-black uppercase tracking-wider border-b" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                      <th className="px-4 py-3 text-left font-medium">Salute</th>
                      <th className="px-4 py-3 text-left font-medium">Ristorante</th>
                      <th className="px-4 py-3 text-center font-medium">Problemi</th>
                      <th className="px-4 py-3 text-right font-medium">Ultima attività</th>
                      <th className="px-4 py-3 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                    {needsAttention.map((t) => {
                      const badge = healthBadge(t.health);
                      return (
                        <tr key={t.id} className="hover:bg-[#c4956a]/5 transition-colors">
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-black">{t.name}</td>
                          <td className="px-4 py-3 text-center">
                            {t.activeIssues > 0 ? (
                              <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${t.criticalIssues > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
                                {t.criticalIssues > 0 && <AlertTriangle className="w-3 h-3" />}
                                {t.activeIssues}
                              </span>
                            ) : <span className="text-black">0</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-black">
                            {t.lastActivity ? new Date(t.lastActivity).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link href={`/admin/tenant/${t.id}`} className="text-xs font-medium text-[#c4956a] hover:text-[#8b6540] transition-colors">
                              Apri
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- INCIDENTS ---- */}
      {tab === "issues" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-black">{filteredInc.length} incidenti</p>
            <div className="flex gap-2 items-center">
              <Filter className="w-4 h-4 text-black" />
              <select value={incSeverity} onChange={(e) => setIncSeverity(e.target.value)}
                className="text-xs border-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c4956a] text-black"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                <option value="all">Tutte le severità</option>
                <option value="critical">Critical</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select value={incStatus} onChange={(e) => setIncStatus(e.target.value)}
                className="text-xs border-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c4956a] text-black"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                <option value="all">Tutti gli stati</option>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>

          {loadingInc ? (
            <div className="p-12 text-center text-black animate-pulse">Loading...</div>
          ) : filteredInc.length === 0 ? (
            <div className="rounded-xl border-2 p-12 text-center" style={cardStyle}>
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-black">Nessun incidente</p>
            </div>
          ) : (
            <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-black uppercase tracking-wider border-b" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                      <th className="px-4 py-3 text-left font-medium">Severità</th>
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
                      <th className="px-4 py-3 text-left font-medium">Tenant</th>
                      <th className="px-4 py-3 text-left font-medium">Titolo</th>
                      <th className="px-4 py-3 text-left font-medium">Stato</th>
                      <th className="px-4 py-3 text-right font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                    {filteredInc.map((inc) => (
                      <tr key={inc.id} className="hover:bg-[#c4956a]/5 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sevStyle(inc.severity)}`}>
                            {inc.severity?.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {typeIcon(inc.type)}
                            <span className="text-xs text-black">{inc.type?.replace("_", " ")}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-black">{inc.tenants?.name || "—"}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-black truncate max-w-[300px]">{inc.title}</p>
                          {inc.description && <p className="text-xs text-black truncate max-w-[300px]">{inc.description}</p>}
                        </td>
                        <td className="px-4 py-3"><span className="text-[10px] font-bold text-black">{inc.status}</span></td>
                        <td className="px-4 py-3 text-right text-xs text-black">{new Date(inc.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- SYSTEM LOGS ---- */}
      {tab === "logs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-black">{logs.length} log</p>
            <div className="flex gap-1">
              {(["open", "resolved", "all"] as const).map((f) => (
                <button key={f} onClick={() => setLogFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border-2 transition-colors ${logFilter === f ? "bg-[#c4956a] text-white border-[#c4956a]" : "text-black border-[#c4956a]/30 hover:bg-[#c4956a]/10"}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {loadingLogs ? (
            <div className="p-12 text-center text-black animate-pulse">Loading...</div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border-2 p-12 text-center" style={cardStyle}>
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-black">Nessun log {logFilter === "all" ? "" : logFilter}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="rounded-xl border-2 p-4 flex items-start gap-4" style={cardStyle}>
                  {log.severity === "critical" ? (
                    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  ) : log.severity === "high" ? (
                    <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <Activity className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sevStyle(log.severity)}`}>
                        {log.severity?.toUpperCase()}
                      </span>
                      <span className="text-[10px] font-medium text-black bg-zinc-100 px-2 py-0.5 rounded">{log.category}</span>
                      {log.tenants?.name && <span className="text-[10px] font-medium text-[#c4956a]">{log.tenants.name}</span>}
                    </div>
                    <p className="text-sm font-medium text-black">{log.title}</p>
                    {log.description && <p className="text-xs text-black mt-0.5">{log.description}</p>}
                    <p className="text-[10px] text-black mt-1">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                  {log.status === "open" ? (
                    <button onClick={() => resolveLog(log.id)}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex-shrink-0">
                      Resolve
                    </button>
                  ) : log.status === "resolved" ? (
                    <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">Resolved</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
