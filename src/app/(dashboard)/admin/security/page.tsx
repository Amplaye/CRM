"use client";

import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/lib/contexts/TenantContext";
import {
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  Globe,
  Monitor,
  AlertTriangle,
  Filter,
} from "lucide-react";

interface LoginEvent {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  geo: {
    country: string | null;
    country_code: string | null;
    city: string | null;
    region: string | null;
    org: string | null;
  };
  browser: string;
  os: string;
  day: string;
  flags: {
    new_ip: boolean;
    new_country: boolean;
    off_hours: boolean;
    many_ips_same_day: boolean;
  };
}

interface ApiResponse {
  events: LoginEvent[];
  total: number;
  anomalies: number;
  window_days: number;
}

const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };
const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

function flagLabel(key: keyof LoginEvent["flags"]) {
  switch (key) {
    case "new_ip": return "New IP";
    case "new_country": return "New country";
    case "off_hours": return "Off-hours";
    case "many_ips_same_day": return ">3 IPs/day";
  }
}

function hasAnyFlag(ev: LoginEvent) {
  return Object.values(ev.flags).some(Boolean);
}

export default function SecurityPage() {
  const { globalRole } = useTenant();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);

  const fetchData = async (d = days) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/login-events?days=${d}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j: ApiResponse = await res.json();
      setData(j);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(days); /* eslint-disable-next-line */ }, []);

  const tenants = useMemo(() => {
    if (!data) return [] as { id: string; name: string }[];
    const seen = new Map<string, string>();
    for (const e of data.events) {
      if (e.tenant_id && e.tenant_name && !seen.has(e.tenant_id)) {
        seen.set(e.tenant_id, e.tenant_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [] as LoginEvent[];
    return data.events.filter(e => {
      if (tenantFilter !== "all") {
        if (tenantFilter === "__none__" ? e.tenant_id !== null : e.tenant_id !== tenantFilter) return false;
      }
      if (onlyAnomalies && !hasAnyFlag(e)) return false;
      return true;
    });
  }, [data, tenantFilter, onlyAnomalies]);

  // Group by day
  const grouped = useMemo(() => {
    const m = new Map<string, LoginEvent[]>();
    for (const e of filtered) {
      const list = m.get(e.day) || [];
      list.push(e);
      m.set(e.day, list);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  if (globalRole && globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Login Monitor</h1>
        </div>
        <button
          onClick={() => fetchData(days)}
          className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">Logins ({data?.window_days ?? days}d)</p>
          <p className="text-xl font-bold text-black">{data?.total ?? 0}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">Anomalies</p>
          <p className={`text-xl font-bold ${(data?.anomalies ?? 0) > 0 ? "text-red-600" : "text-black"}`}>
            {data?.anomalies ?? 0}
          </p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">Distinct accounts</p>
          <p className="text-xl font-bold text-black">
            {data ? new Set(data.events.map(e => e.actor_id || e.actor_email)).size : 0}
          </p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">Distinct IPs</p>
          <p className="text-xl font-bold text-black">
            {data ? new Set(data.events.map(e => e.ip_address).filter(Boolean)).size : 0}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border-2 p-4 flex flex-wrap gap-3 items-center" style={cardStyle}>
        <div className="flex items-center gap-2 text-xs font-bold text-black uppercase tracking-wider">
          <Filter className="w-4 h-4" /> Filters
        </div>
        <div className="relative">
          <select
            value={days}
            onChange={e => { const d = Number(e.target.value); setDays(d); fetchData(d); }}
            className="text-xs border-2 rounded-lg px-3 py-2 pr-7 focus:outline-none focus:ring-1 focus:ring-[#c4956a] appearance-none"
            style={inputBorder}
          >
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <ChevronDown className="w-3 h-3 text-black absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={tenantFilter}
            onChange={e => setTenantFilter(e.target.value)}
            className="text-xs border-2 rounded-lg px-3 py-2 pr-7 focus:outline-none focus:ring-1 focus:ring-[#c4956a] appearance-none"
            style={inputBorder}
          >
            <option value="all">All clients</option>
            <option value="__none__">Has tenant</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown className="w-3 h-3 text-black absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-black cursor-pointer">
          <input
            type="checkbox"
            checked={onlyAnomalies}
            onChange={e => setOnlyAnomalies(e.target.checked)}
            className="rounded border-[#c4956a]"
          />
          Only anomalies
        </label>
      </div>

      {error && (
        <div className="rounded-xl border-2 p-4 text-sm text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      {/* Events by day */}
      {loading && !data ? (
        <div className="rounded-xl border-2 p-12 text-center text-black animate-pulse" style={cardStyle}>
          Loading login events…
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border-2 p-12 text-center text-black" style={cardStyle}>
          No logins in this window.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, list]) => {
            const dayAnomalies = list.filter(hasAnyFlag).length;
            return (
              <div key={day} className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
                <div className="px-4 sm:px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "#c4956a" }}>
                  <h2 className="text-sm font-bold text-black uppercase tracking-wider">
                    {new Date(day).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
                  </h2>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-black">{list.length} login{list.length === 1 ? "" : "s"}</span>
                    {dayAnomalies > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                        <AlertTriangle className="w-3 h-3" />
                        {dayAnomalies} anomal{dayAnomalies === 1 ? "y" : "ies"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-xs text-black uppercase tracking-wider">
                        <th className="px-4 py-2 text-left font-medium">Time</th>
                        <th className="px-4 py-2 text-left font-medium">Account</th>
                        <th className="px-4 py-2 text-left font-medium">Client</th>
                        <th className="px-4 py-2 text-left font-medium">IP</th>
                        <th className="px-4 py-2 text-left font-medium">Location</th>
                        <th className="px-4 py-2 text-left font-medium">Device</th>
                        <th className="px-4 py-2 text-left font-medium">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                      {list.map(ev => {
                        const flags = (Object.keys(ev.flags) as (keyof LoginEvent["flags"])[]).filter(k => ev.flags[k]);
                        const isAnomaly = flags.length > 0;
                        return (
                          <tr
                            key={ev.id}
                            className={`hover:bg-[#c4956a]/5 transition-colors ${isAnomaly ? "bg-red-50/40" : ""}`}
                          >
                            <td className="px-4 py-2 text-xs text-black whitespace-nowrap">
                              {new Date(ev.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="px-4 py-2 text-black">
                              <div className="font-medium">{ev.actor_email || "—"}</div>
                              {ev.action !== "login" && (
                                <div className="text-[10px] text-black/60">{ev.action}</div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-black">
                              {ev.tenant_name ? (
                                <span className="text-[10px] font-bold text-[#c4956a] bg-[#c4956a]/10 px-2 py-0.5 rounded">
                                  {ev.tenant_name}
                                </span>
                              ) : <span className="text-black/40">—</span>}
                            </td>
                            <td className="px-4 py-2 text-black font-mono text-xs">{ev.ip_address || "—"}</td>
                            <td className="px-4 py-2 text-black text-xs">
                              {ev.geo.country ? (
                                <span className="inline-flex items-center gap-1">
                                  <Globe className="w-3 h-3 text-black/50" />
                                  {[ev.geo.city, ev.geo.country].filter(Boolean).join(", ")}
                                </span>
                              ) : <span className="text-black/40">—</span>}
                            </td>
                            <td className="px-4 py-2 text-black text-xs">
                              <span className="inline-flex items-center gap-1">
                                <Monitor className="w-3 h-3 text-black/50" />
                                {ev.browser} · {ev.os}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap gap-1">
                                {flags.length === 0 ? (
                                  <span className="text-[10px] text-black/40">—</span>
                                ) : flags.map(f => (
                                  <span
                                    key={f}
                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200"
                                  >
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    {flagLabel(f)}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
