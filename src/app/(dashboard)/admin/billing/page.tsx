"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

interface BillingRow {
  source: "sub" | "pilot";
  tenantId: string | null;
  tenantName: string | null;
  plan: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  cycle: string | null;
  provider: string | null;
  mrr: number;
  started: string | null;
  renewal: string | null;
  cancelAtPeriodEnd: boolean;
  addons: string[];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  customerEmail: string | null;
  businessName: string | null;
}

interface BillingSummary {
  mrr: number;
  arr: number;
  total: number;
  activeCount: number;
  trialing: number;
  trialsEndingSoon: number;
  pastDue: number;
  canceled30: number;
}

type StatusFilter = "all" | "active" | "trialing" | "past_due" | "canceled";

const statusBadge = (s: string) => {
  switch (s) {
    case "active": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "trialing": return "bg-blue-50 text-blue-700 border-blue-200";
    case "past_due": return "bg-red-50 text-red-700 border-red-200";
    case "canceled": return "bg-zinc-100 text-zinc-600 border-zinc-300";
    default: return "bg-zinc-100 text-zinc-600 border-zinc-300";
  }
};

export default function AdminBillingPage() {
  const { globalRole } = useTenant();
  const { t } = useLanguage();
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumRes, subsRes] = await Promise.all([
        fetch("/api/admin/billing/summary"),
        fetch("/api/admin/billing/subscriptions"),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (subsRes.ok) setRows((await subsRes.json()).rows || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (globalRole !== "platform_admin") {
    return (
      <div className="p-4 sm:p-6 lg:p-8 w-full flex justify-center mt-20 text-black text-center">
        {t("admin_unauthorized")}
      </div>
    );
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const eur = (n: number) => `€${n.toLocaleString("es-ES")}`;
  const stripeCustomerUrl = (id: string) => `https://dashboard.stripe.com/customers/${id}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Billing & Pagamenti</h1>
        </div>
        <button onClick={fetchData} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Totals */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 sm:gap-4">
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">MRR</p>
            <p className="text-xl font-bold text-[#22c55e]">{eur(summary.mrr)}</p>
            <p className="text-[10px] text-black/70">ARR {eur(summary.arr)}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Attivi</p>
            <p className="text-xl font-bold text-black">{summary.activeCount}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">In trial</p>
            <p className="text-xl font-bold text-black">{summary.trialing}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Trial in scadenza ≤7g</p>
            <p className={`text-xl font-bold ${summary.trialsEndingSoon > 0 ? "text-amber-600" : "text-black"}`}>{summary.trialsEndingSoon}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Insoluti</p>
            <p className={`text-xl font-bold ${summary.pastDue > 0 ? "text-red-600" : "text-black"}`}>{summary.pastDue}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">Disdette (30g)</p>
            <p className="text-xl font-bold text-black">{summary.canceled30}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(["all", "active", "trialing", "past_due", "canceled"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors ${
              filter === f ? "bg-[#c4956a] text-white border-[#c4956a]" : "text-black border-[#c4956a]/40 hover:bg-[#c4956a]/10"
            }`}
          >
            {f === "all" ? "Tutti" : f === "active" ? "Attivi" : f === "trialing" ? "Trial" : f === "past_due" ? "Insoluti" : "Disdetti"}
          </button>
        ))}
      </div>

      {/* Subscriptions table */}
      <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
        <div className="px-4 sm:px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "#c4956a" }}>
          <h2 className="text-sm font-bold text-black uppercase tracking-wider">Abbonamenti ({visible.length})</h2>
          <span className="text-[11px] text-black/70">Azioni che muovono denaro → cruscotto Stripe</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-black animate-pulse">Loading...</div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-black">Nessun abbonamento.</div>
        ) : (
          <>
          {/* Mobile: card per subscription — the 8-column table would otherwise
              scroll sideways with the Stripe link off-screen. */}
          <ul className="sm:hidden divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
            {visible.map((r, i) => (
              <li key={`m-${r.source}-${r.stripeSubscriptionId || r.tenantId || i}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-black">
                    {r.tenantName || (
                      <span className="text-black/70">
                        {r.businessName || r.customerEmail || "lead non collegato"}
                        <span className="ml-1 text-[10px] uppercase font-bold text-amber-700">lead</span>
                      </span>
                    )}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusBadge(r.status)}`}>
                    {r.status === "past_due" && <AlertTriangle className="w-3 h-3" />}
                    {r.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-black">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${r.source === "pilot" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-[#c4956a]/10 text-black border-[#c4956a]/30"}`}>
                    {r.source === "pilot" ? "Pilot" : "Sub"}
                  </span>
                  <span className="capitalize">{r.plan || "—"}</span>
                  {r.cycle && <span className="text-black/60">{r.cycle === "yearly" || r.cycle === "annual" ? "/anno" : "/mese"}</span>}
                  <span className="font-medium">{r.mrr > 0 ? eur(r.mrr) : "—"}</span>
                </div>
                {r.cancelAtPeriodEnd && (
                  <div className="mt-1 text-[10px] text-amber-700 font-bold">disdetta a fine periodo</div>
                )}
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-black">
                  <div>
                    <span className="text-black/60">Inizio </span>
                    {r.started ? new Date(r.started).toLocaleDateString() : "—"}
                  </div>
                  <div>
                    <span className="text-black/60">Rinnovo </span>
                    {r.renewal ? new Date(r.renewal).toLocaleDateString() : "—"}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  {r.tenantId && (
                    <Link href={`/admin/tenant/${r.tenantId}`} className="text-xs font-medium text-[#c4956a] hover:text-[#8b6540] transition-colors">
                      Dettagli
                    </Link>
                  )}
                  {r.stripeCustomerId && (
                    <a href={stripeCustomerUrl(r.stripeCustomerId)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-black/70 hover:text-black transition-colors">
                      Stripe <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-black uppercase tracking-wider">
                  <th className="px-4 py-3 text-left font-medium">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium">Flusso</th>
                  <th className="px-4 py-3 text-left font-medium">Piano</th>
                  <th className="px-4 py-3 text-left font-medium">Stato</th>
                  <th className="px-4 py-3 text-right font-medium">MRR</th>
                  <th className="px-4 py-3 text-right font-medium hidden lg:table-cell">Inizio</th>
                  <th className="px-4 py-3 text-right font-medium">Rinnovo / Fine trial</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
                {visible.map((r, i) => (
                  <tr key={`${r.source}-${r.stripeSubscriptionId || r.tenantId || i}`} className="hover:bg-[#c4956a]/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-black">
                      {r.tenantName ? (
                        r.tenantName
                      ) : (
                        <span className="text-black/70">
                          {r.businessName || r.customerEmail || "lead non collegato"}
                          <span className="ml-1 text-[10px] uppercase font-bold text-amber-700">lead</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${r.source === "pilot" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-[#c4956a]/10 text-black border-[#c4956a]/30"}`}>
                        {r.source === "pilot" ? "Pilot" : "Sub"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-black capitalize">
                      {r.plan || "—"}
                      {r.cycle && <span className="text-[10px] text-black/60 ml-1">{r.cycle === "yearly" || r.cycle === "annual" ? "/anno" : "/mese"}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadge(r.status)}`}>
                        {r.status === "past_due" && <AlertTriangle className="w-3 h-3" />}
                        {r.status}
                      </span>
                      {r.cancelAtPeriodEnd && <span className="ml-1 text-[10px] text-amber-700 font-bold">disdetta a fine periodo</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-black">{r.mrr > 0 ? eur(r.mrr) : "—"}</td>
                    <td className="px-4 py-3 text-right text-xs text-black hidden lg:table-cell">
                      {r.started ? new Date(r.started).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-black">
                      {r.renewal ? new Date(r.renewal).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.tenantId && (
                        <Link href={`/admin/tenant/${r.tenantId}`} className="text-xs font-medium text-[#c4956a] hover:text-[#8b6540] transition-colors mr-3">
                          Dettagli
                        </Link>
                      )}
                      {r.stripeCustomerId && (
                        <a href={stripeCustomerUrl(r.stripeCustomerId)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-black/70 hover:text-black transition-colors">
                          Stripe <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
