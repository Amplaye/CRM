"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, AlertTriangle, TrendingUp, TrendingDown, Minus, RefreshCw, MessageSquare, Check } from "lucide-react";

interface TenantOverview {
  id: string;
  name: string;
  health: "healthy" | "attention" | "critical";
  aiRevenue7: number;
  aiRevenue30: number;
  aiPct: number;
  totalBookings7: number;
  totalBookings30: number;
  noShows7: number;
  noShowTrend: "up" | "down" | "stable";
  activeIssues: number;
  criticalIssues: number;
  lastActivity: string;
  bookingChange: number;
}

interface PlatformTotals {
  totalTenants: number;
  totalOpenIssues: number;
  totalCritical: number;
  totalBookings7: number;
  totalAiRevenue7: number;
}

interface BillingSummary {
  mrr: number;
  arr: number;
  trialsEndingSoon: number;
  pastDue: number;
  canceled30: number;
}

const healthBadge = (h: string) => {
  switch (h) {
    case "critical": return { dot: "bg-red-500", bg: "bg-red-50 text-red-700 border-red-200", label: "Critical" };
    case "attention": return { dot: "bg-yellow-500", bg: "bg-yellow-50 text-yellow-700 border-yellow-200", label: "Attention" };
    default: return { dot: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Healthy" };
  }
};

export default function AdminPage() {
  const { globalRole } = useTenant();
  const { t } = useLanguage();
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  const [platform, setPlatform] = useState<PlatformTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingWa, setPendingWa] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [archived, setArchived] = useState<Array<{ id: string; name: string; archived_at: string; purge_after: string }>>([]);
  const [billing, setBilling] = useState<BillingSummary | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/overview");
      const data = await res.json();
      setTenants(data.tenants || []);
      setPlatform(data.platform || null);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const fetchPendingWa = async () => {
    try {
      const res = await fetch("/api/admin/pending-whatsapp");
      if (res.ok) setPendingWa((await res.json()).pending || []);
    } catch { /* non-blocking reminder */ }
  };

  const markWaDone = async (tenantId: string) => {
    setPendingWa((p) => p.filter((x) => x.id !== tenantId)); // optimistic
    await fetch("/api/admin/mark-whatsapp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    }).catch(() => {});
  };

  const fetchArchived = async () => {
    try {
      const res = await fetch("/api/admin/archived-tenants");
      if (res.ok) setArchived((await res.json()).archived || []);
    } catch { /* non-blocking */ }
  };

  const fetchBilling = async () => {
    try {
      const res = await fetch("/api/admin/billing/summary");
      if (res.ok) setBilling(await res.json());
    } catch { /* non-blocking */ }
  };

  useEffect(() => { fetchData(); fetchPendingWa(); fetchArchived(); fetchBilling(); }, []);

  if (globalRole !== "platform_admin") {
    return (
      <div className="p-4 sm:p-6 lg:p-8 w-full flex justify-center mt-20 text-black text-center">
        {t("admin_unauthorized")}
      </div>
    );
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Platform Admin</h1>
        </div>
        <button onClick={fetchData} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* New self-serve clients waiting for the WhatsApp number (non-blocking reminder) */}
      {pendingWa.length > 0 && (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
            <MessageSquare className="w-4 h-4" />
            {pendingWa.length === 1
              ? "1 nuovo cliente ha completato il provisioning — attacca il numero WhatsApp"
              : `${pendingWa.length} nuovi clienti hanno completato il provisioning — attacca il numero WhatsApp`}
          </div>
          <div className="space-y-2">
            {pendingWa.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-black">{p.name}</span>
                  {p.slug && (
                    <span className="text-xs text-emerald-700/90 block sm:inline sm:ml-2">
                      webhook Twilio → <code className="bg-white px-1 py-0.5 rounded">{p.slug}-whatsapp</code>
                    </span>
                  )}
                </div>
                <button
                  onClick={() => markWaDone(p.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors flex-shrink-0"
                >
                  <Check className="w-3 h-3" /> Fatto
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform Summary */}
      {platform && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Tenants</p>
            <p className="text-xl font-bold text-black">{platform.totalTenants}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Bookings (7d)</p>
            <p className="text-xl font-bold text-black">{platform.totalBookings7}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">AI Revenue (7d)</p>
            <p className="text-xl font-bold text-[#22c55e]">€{platform.totalAiRevenue7.toLocaleString()}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Open Issues</p>
            <p className="text-xl font-bold text-black">{platform.totalOpenIssues}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Critical</p>
            <p className={`text-xl font-bold ${platform.totalCritical > 0 ? "text-red-600" : "text-black"}`}>{platform.totalCritical}</p>
          </div>
        </div>
      )}

      {/* Billing health — clickable, deep-links into the Billing console */}
      {billing && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <Link href="/admin/billing" className="rounded-xl p-3 sm:p-4 border-2 hover:bg-[#c4956a]/5 transition-colors" style={cardStyle}>
            <p className="text-xs text-black font-medium">MRR</p>
            <p className="text-xl font-bold text-[#22c55e]">€{billing.mrr.toLocaleString()}</p>
            <p className="text-[10px] text-black/70">ARR €{billing.arr.toLocaleString()}</p>
          </Link>
          <Link href="/admin/billing" className="rounded-xl p-3 sm:p-4 border-2 hover:bg-[#c4956a]/5 transition-colors" style={cardStyle}>
            <p className="text-xs text-black font-medium">Trial in scadenza ≤7g</p>
            <p className={`text-xl font-bold ${billing.trialsEndingSoon > 0 ? "text-amber-600" : "text-black"}`}>{billing.trialsEndingSoon}</p>
          </Link>
          <Link href="/admin/billing" className="rounded-xl p-3 sm:p-4 border-2 hover:bg-[#c4956a]/5 transition-colors" style={cardStyle}>
            <p className="text-xs text-black font-medium">Insoluti</p>
            <p className={`text-xl font-bold ${billing.pastDue > 0 ? "text-red-600" : "text-black"}`}>{billing.pastDue}</p>
          </Link>
          <Link href="/admin/billing" className="rounded-xl p-3 sm:p-4 border-2 hover:bg-[#c4956a]/5 transition-colors" style={cardStyle}>
            <p className="text-xs text-black font-medium">Disdette (30g)</p>
            <p className="text-xl font-bold text-black">{billing.canceled30}</p>
          </Link>
        </div>
      )}

      {/* Archived tenants — recoverable until their purge date */}
      {archived.length > 0 && (
        <div className="rounded-xl border-2 border-zinc-300 bg-zinc-50 p-4 space-y-2">
          <h2 className="text-sm font-bold text-black uppercase tracking-wider">Archiviati ({archived.length})</h2>
          <div className="space-y-2">
            {archived.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-black">{a.name}</span>
                  {a.purge_after && (
                    <span className="text-xs text-black block sm:inline sm:ml-2">
                      cancellazione il {new Date(a.purge_after).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Link href={`/admin/tenant/${a.id}`} className="text-xs font-bold text-[#c4956a] hover:text-[#8b6540] flex-shrink-0">
                  Gestisci →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tenant Table */}
      <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
        <div className="px-4 sm:px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "#c4956a" }}>
          <h2 className="text-sm font-bold text-black uppercase tracking-wider">All Tenants</h2>
          <Link href="/admin/onboard" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors">
            + Nuovo CRM
          </Link>
        </div>
        {loading ? (
          <div className="p-12 text-center text-black animate-pulse">Loading...</div>
        ) : (
          <>
          {/* Mobile: one card per tenant. The 10-column table is unusable on a
              phone (it degrades to a wide sideways scroll with "Details" far
              off-screen), so below sm we render the same data stacked. */}
          <ul className="sm:hidden divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
            {tenants.map(t => {
              const badge = healthBadge(t.health);
              return (
                <li key={t.id}>
                  <Link href={`/admin/tenant/${t.id}`} className="block px-4 py-3 active:bg-[#c4956a]/10 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-black">{t.name}</span>
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${badge.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-black">
                      <div>
                        <span className="text-black/60">AI Rev (7d) </span>
                        <span className="font-medium text-[#22c55e]">€{t.aiRevenue7.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-black/60">AI % </span>
                        <span className="font-medium">{t.aiPct}%</span>
                      </div>
                      <div>
                        <span className="text-black/60">Bookings (7d) </span>
                        <span className="font-medium">{t.totalBookings7}</span>
                        {t.bookingChange !== 0 && (
                          <span className={`ml-1 font-bold ${t.bookingChange > 0 ? "text-green-600" : "text-red-500"}`}>
                            {t.bookingChange > 0 ? "+" : ""}{t.bookingChange}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-black/60">No-Shows </span>
                        <span className="font-medium">{t.noShows7}</span>
                        {t.noShowTrend === "up" && <TrendingUp className="w-3 h-3 text-red-500" />}
                        {t.noShowTrend === "down" && <TrendingDown className="w-3 h-3 text-green-500" />}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                      {t.activeIssues > 0 ? (
                        <span className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full ${t.criticalIssues > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
                          {t.criticalIssues > 0 && <AlertTriangle className="w-3 h-3" />}
                          {t.activeIssues} {t.activeIssues === 1 ? "issue" : "issues"}
                        </span>
                      ) : (
                        <span className="text-black/60">No issues</span>
                      )}
                      <span className="text-black/60">{new Date(t.lastActivity).toLocaleDateString()}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-black uppercase tracking-wider">
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Restaurant</th>
                  <th className="px-4 py-3 text-right font-medium">AI Rev (7d)</th>
                  <th className="px-4 py-3 text-right font-medium hidden lg:table-cell">AI Rev (30d)</th>
                  <th className="px-4 py-3 text-right font-medium">AI %</th>
                  <th className="px-4 py-3 text-right font-medium">Bookings (7d)</th>
                  <th className="px-4 py-3 text-center font-medium">No-Shows</th>
                  <th className="px-4 py-3 text-center font-medium">Issues</th>
                  <th className="px-4 py-3 text-right font-medium hidden lg:table-cell">Last Activity</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                {tenants.map(t => {
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
                      <td className="px-4 py-3 text-right font-medium text-[#22c55e]">€{t.aiRevenue7.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-black hidden lg:table-cell">€{t.aiRevenue30.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-black">{t.aiPct}%</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-black">{t.totalBookings7}</span>
                        {t.bookingChange !== 0 && (
                          <span className={`ml-1 text-[10px] font-bold ${t.bookingChange > 0 ? "text-green-600" : "text-red-500"}`}>
                            {t.bookingChange > 0 ? "+" : ""}{t.bookingChange}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-black">{t.noShows7}</span>
                          {t.noShowTrend === "up" && <TrendingUp className="w-3 h-3 text-red-500" />}
                          {t.noShowTrend === "down" && <TrendingDown className="w-3 h-3 text-green-500" />}
                          {t.noShowTrend === "stable" && <Minus className="w-3 h-3 text-black" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {t.activeIssues > 0 ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${t.criticalIssues > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
                            {t.criticalIssues > 0 && <AlertTriangle className="w-3 h-3" />}
                            {t.activeIssues}
                          </span>
                        ) : (
                          <span className="text-black">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-black hidden lg:table-cell">
                        {new Date(t.lastActivity).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/tenant/${t.id}`}
                          className="text-xs font-medium text-[#c4956a] hover:text-[#8b6540] transition-colors">
                          Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
