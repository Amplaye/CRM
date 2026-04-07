"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

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

const severityStyle = (s: string) => {
  switch (s) {
    case "critical": return "bg-red-50 text-red-700 border-red-200";
    case "high": return "bg-orange-50 text-orange-700 border-orange-200";
    case "medium": return "bg-yellow-50 text-yellow-700 border-yellow-200";
    default: return "bg-zinc-50 text-zinc-600 border-zinc-200";
  }
};

const categoryLabel: Record<string, string> = {
  booking_error: "Booking Error",
  webhook_failure: "Webhook Failure",
  message_failure: "Message Failure",
  api_error: "API Error",
  ai_error: "AI Error",
  system: "System",
};

export default function SystemHealthPage() {
  const { globalRole } = useTenant();
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/system-logs?status=${filter}`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, [filter]);

  const handleResolve = async (id: string) => {
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

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">System Health</h1>
        </div>
        <div className="flex gap-1">
          {(["open", "resolved", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border-2 transition-colors ${filter === f ? "bg-[#c4956a] text-white border-[#c4956a]" : "text-black border-[#c4956a]/30 hover:bg-[#c4956a]/10"}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-black/50 animate-pulse">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border-2 p-12 text-center" style={cardStyle}>
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-black">No {filter === "all" ? "" : filter} issues</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${severityStyle(log.severity)}`}>
                    {log.severity.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-medium text-black/40 bg-zinc-100 px-2 py-0.5 rounded">
                    {categoryLabel[log.category] || log.category}
                  </span>
                  {log.tenants?.name && (
                    <span className="text-[10px] font-medium text-[#c4956a]">{log.tenants.name}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-black">{log.title}</p>
                {log.description && <p className="text-xs text-black/50 mt-0.5">{log.description}</p>}
                <p className="text-[10px] text-black/30 mt-1">{new Date(log.created_at).toLocaleString()}</p>
              </div>

              {log.status === "open" && (
                <button onClick={() => handleResolve(log.id)}
                  className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex-shrink-0">
                  Resolve
                </button>
              )}
              {log.status === "resolved" && (
                <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">Resolved</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
