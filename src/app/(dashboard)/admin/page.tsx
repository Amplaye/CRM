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
    case "critical": return { dot: "bg-red-500", bg: "bg-red-50 text-red-700 border-red-200", labelKey: "adm_home_health_critical" as const };
    case "attention": return { dot: "bg-yellow-500", bg: "bg-yellow-50 text-yellow-700 border-yellow-200", labelKey: "adm_home_health_attention" as const };
    default: return { dot: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", labelKey: "adm_home_health_healthy" as const };
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
          <h1 className="text-xl sm:text-2xl font-bold text-black">{t("adm_home_title")}</h1>
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
              ? t("adm_home_pending_wa_one")
              : t("adm_home_pending_wa_many").replace("{n}", String(pendingWa.length))}
          </div>
          <div className="space-y-2">
            {pendingWa.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-black">{p.name}</span>
                  {p.slug && (
                    <span className="text-xs text-emerald-700/90 block sm:inline sm:ml-2">
                      {t("adm_home_webhook_prefix")} <code className="bg-white px-1 py-0.5 rounded">{p.slug}-whatsapp</code>
                    </span>
                  )}
                </div>
                <button
                  onClick={() => markWaDone(p.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors flex-shrink-0"
                >
                  <Check className="w-3 h-3" /> {t("adm_home_done")}
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
            <p className="text-xs text-black font-medium">{t("adm_home_tenants")}</p>
            <p className="text-xl font-bold text-black">{platform.totalTenants}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_home_bookings_7d")}</p>
            <p className="text-xl font-bold text-black">{platform.totalBookings7}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_home_ai_revenue_7d")}</p>
            <p className="text-xl font-bold text-[#22c55e]">€{platform.totalAiRevenue7.toLocaleString()}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_home_open_issues")}</p>
            <p className="text-xl font-bold text-black">{platform.totalOpenIssues}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_home_critical")}</p>
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
            <p className="text-xs text-black font-medium">{t("adm_home_trials_ending")}</p>
            <p className={`text-xl font-bold ${billing.trialsEndingSoon > 0 ? "text-amber-600" : "text-black"}`}>{billing.trialsEndingSoon}</p>
          </Link>
          <Link href="/admin/billing" className="rounded-xl p-3 sm:p-4 border-2 hover:bg-[#c4956a]/5 transition-colors" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_home_past_due")}</p>
            <p className={`text-xl font-bold ${billing.pastDue > 0 ? "text-red-600" : "text-black"}`}>{billing.pastDue}</p>
          </Link>
          <Link href="/admin/billing" className="rounded-xl p-3 sm:p-4 border-2 hover:bg-[#c4956a]/5 transition-colors" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_home_canceled_30")}</p>
            <p className="text-xl font-bold text-black">{billing.canceled30}</p>
          </Link>
        </div>
      )}

      {/* Archived tenants — recoverable until their purge date */}
      {archived.length > 0 && (
        <div className="rounded-xl border-2 border-zinc-300 bg-zinc-50 p-4 space-y-2">
          <h2 className="text-sm font-bold text-black uppercase tracking-wider">{t("adm_home_archived")} ({archived.length})</h2>
          <div className="space-y-2">
            {archived.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-black">{a.name}</span>
                  {a.purge_after && (
                    <span className="text-xs text-black block sm:inline sm:ml-2">
                      {t("adm_home_purge_on").replace("{date}", new Date(a.purge_after).toLocaleDateString())}
                    </span>
                  )}
                </div>
                <Link href={`/admin/tenant/${a.id}`} className="text-xs font-bold text-[#c4956a] hover:text-[#8b6540] flex-shrink-0">
                  {t("adm_home_manage")}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tenant Table */}
      <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
        <div className="px-4 sm:px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "#c4956a" }}>
          <h2 className="text-sm font-bold text-black uppercase tracking-wider">{t("adm_home_all_tenants")}</h2>
          <Link href="/admin/onboard" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors">
            {t("adm_home_new_crm")}
          </Link>
        </div>
        {loading ? (
          <div className="p-12 text-center text-black animate-pulse">{t("adm_home_loading")}</div>
        ) : (
          <>
          {/* Mobile: one card per tenant. The 10-column table is unusable on a
              phone (it degrades to a wide sideways scroll with "Details" far
              off-screen), so below sm we render the same data stacked. */}
          <ul className="sm:hidden divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
            {tenants.map(tn => {
              const badge = healthBadge(tn.health);
              return (
                <li key={tn.id}>
                  <Link href={`/admin/tenant/${tn.id}`} className="block px-4 py-3 active:bg-[#c4956a]/10 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-black">{tn.name}</span>
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${badge.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {t(badge.labelKey)}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-black">
                      <div>
                        <span className="text-black/60">{t("adm_home_ai_rev_7d")} </span>
                        <span className="font-medium text-[#22c55e]">€{tn.aiRevenue7.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-black/60">{t("adm_home_ai_pct")} </span>
                        <span className="font-medium">{tn.aiPct}%</span>
                      </div>
                      <div>
                        <span className="text-black/60">{t("adm_home_bookings_7d")} </span>
                        <span className="font-medium">{tn.totalBookings7}</span>
                        {tn.bookingChange !== 0 && (
                          <span className={`ml-1 font-bold ${tn.bookingChange > 0 ? "text-green-600" : "text-red-500"}`}>
                            {tn.bookingChange > 0 ? "+" : ""}{tn.bookingChange}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-black/60">{t("adm_home_no_shows")} </span>
                        <span className="font-medium">{tn.noShows7}</span>
                        {tn.noShowTrend === "up" && <TrendingUp className="w-3 h-3 text-red-500" />}
                        {tn.noShowTrend === "down" && <TrendingDown className="w-3 h-3 text-green-500" />}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                      {tn.activeIssues > 0 ? (
                        <span className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full ${tn.criticalIssues > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
                          {tn.criticalIssues > 0 && <AlertTriangle className="w-3 h-3" />}
                          {tn.activeIssues} {tn.activeIssues === 1 ? t("adm_home_issue_one") : t("adm_home_issue_many")}
                        </span>
                      ) : (
                        <span className="text-black/60">{t("adm_home_no_issues")}</span>
                      )}
                      <span className="text-black/60">{new Date(tn.lastActivity).toLocaleDateString()}</span>
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
                  <th className="px-4 py-3 text-left font-medium">{t("adm_home_col_status")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("adm_home_col_restaurant")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("adm_home_ai_rev_7d")}</th>
                  <th className="px-4 py-3 text-right font-medium hidden lg:table-cell">{t("adm_home_ai_rev_30d")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("adm_home_ai_pct")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("adm_home_bookings_7d")}</th>
                  <th className="px-4 py-3 text-center font-medium">{t("adm_home_no_shows")}</th>
                  <th className="px-4 py-3 text-center font-medium">{t("adm_home_issues")}</th>
                  <th className="px-4 py-3 text-right font-medium hidden lg:table-cell">{t("adm_home_last_activity")}</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                {tenants.map(tn => {
                  const badge = healthBadge(tn.health);
                  return (
                    <tr key={tn.id} className="hover:bg-[#c4956a]/5 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {t(badge.labelKey)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-black">{tn.name}</td>
                      <td className="px-4 py-3 text-right font-medium text-[#22c55e]">€{tn.aiRevenue7.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-black hidden lg:table-cell">€{tn.aiRevenue30.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-black">{tn.aiPct}%</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-black">{tn.totalBookings7}</span>
                        {tn.bookingChange !== 0 && (
                          <span className={`ml-1 text-[10px] font-bold ${tn.bookingChange > 0 ? "text-green-600" : "text-red-500"}`}>
                            {tn.bookingChange > 0 ? "+" : ""}{tn.bookingChange}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-black">{tn.noShows7}</span>
                          {tn.noShowTrend === "up" && <TrendingUp className="w-3 h-3 text-red-500" />}
                          {tn.noShowTrend === "down" && <TrendingDown className="w-3 h-3 text-green-500" />}
                          {tn.noShowTrend === "stable" && <Minus className="w-3 h-3 text-black" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tn.activeIssues > 0 ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${tn.criticalIssues > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
                            {tn.criticalIssues > 0 && <AlertTriangle className="w-3 h-3" />}
                            {tn.activeIssues}
                          </span>
                        ) : (
                          <span className="text-black">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-black hidden lg:table-cell">
                        {new Date(tn.lastActivity).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/tenant/${tn.id}`}
                          className="text-xs font-medium text-[#c4956a] hover:text-[#8b6540] transition-colors">
                          {t("adm_home_details")}
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
