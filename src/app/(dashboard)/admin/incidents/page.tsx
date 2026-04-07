"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { AlertOctagon, Zap, Clock, AlertTriangle, CheckCircle2, Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

const typeIcon = (type: string) => {
  switch (type) {
    case "ai_error": return <Zap className="w-4 h-4 text-purple-500" />;
    case "conflict": return <Clock className="w-4 h-4 text-orange-500" />;
    case "health_safety": return <AlertOctagon className="w-4 h-4 text-red-500" />;
    default: return <AlertTriangle className="w-4 h-4 text-zinc-500" />;
  }
};

const severityStyle = (s: string) => {
  switch (s) {
    case "critical": return "bg-red-50 text-red-700 border-red-200";
    case "medium": return "bg-yellow-50 text-yellow-700 border-yellow-200";
    default: return "bg-zinc-50 text-zinc-600 border-zinc-200";
  }
};

const statusStyle = (s: string) => {
  switch (s) {
    case "open": return "bg-red-50 text-red-700";
    case "investigating": return "bg-yellow-50 text-yellow-700";
    case "resolved": return "bg-emerald-50 text-emerald-700";
    default: return "bg-zinc-50 text-zinc-600";
  }
};

export default function AdminIncidentsPage() {
  const { globalRole } = useTenant();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    const fetchIncidents = async () => {
      setLoading(true);
      // Use service role via API — can't query cross-tenant from client
      const res = await fetch("/api/admin/system-logs?status=all");
      // Also fetch incidents from all tenants via a dedicated approach
      // For now, use the Supabase client which has platform_admin RLS
      const supabase = createClient();
      const { data } = await supabase
        .from("incidents")
        .select("*, tenants(name)")
        .order("created_at", { ascending: false })
        .limit(100);

      setIncidents(data || []);
      setLoading(false);
    };
    fetchIncidents();
  }, []);

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const filtered = incidents.filter(i => {
    if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
    if (filterStatus !== "all" && i.status !== filterStatus) return false;
    return true;
  });

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">All Incidents</h1>
          <span className="text-xs text-black/40 ml-2">{filtered.length} results</span>
        </div>
        <div className="flex gap-2 items-center">
          <Filter className="w-4 h-4 text-black/40" />
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
            className="text-xs border-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="text-xs border-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-black/50 animate-pulse">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 p-12 text-center" style={cardStyle}>
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-black">No incidents matching filters</p>
        </div>
      ) : (
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-black/50 uppercase tracking-wider border-b" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                  <th className="px-4 py-3 text-left font-medium">Severity</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium">Title</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {filtered.map(inc => (
                  <tr key={inc.id} className="hover:bg-[#c4956a]/5 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${severityStyle(inc.severity)}`}>
                        {inc.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {typeIcon(inc.type)}
                        <span className="text-xs text-black/60">{inc.type.replace("_", " ")}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-black">
                      {(inc as any).tenants?.name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-black truncate max-w-[300px]">{inc.title}</p>
                      {inc.description && <p className="text-xs text-black/40 truncate max-w-[300px]">{inc.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusStyle(inc.status)}`}>
                        {inc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-black/50">
                      {new Date(inc.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
