"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { DollarSign, RefreshCw } from "lucide-react";

interface TenantUsage {
  id: string;
  name: string;
  monthlyFee: number;
  costs: { whatsapp: number; voice: number; api: number; total: number };
  usage: { reservations: number; aiBookings: number; whatsappConversations: number; voiceCalls: number; waitlistEntries: number };
  aiRevenue: number;
  margin: number;
}

export default function CostsPage() {
  const { globalRole } = useTenant();
  const [data, setData] = useState<{ tenants: TenantUsage[]; platform: any } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/usage");
      setData(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Usage & Costs</h1>
          <span className="text-xs text-black/40">Last 30 days</span>
        </div>
        <button onClick={fetchData} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Platform totals */}
      {data?.platform && (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black/60 font-medium">Total Client Fees</p>
            <p className="text-xl font-bold text-black">€{data.platform.totalFees.toLocaleString()}/mo</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black/60 font-medium">Total Costs</p>
            <p className="text-xl font-bold text-red-500">€{data.platform.totalCosts.toLocaleString()}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black/60 font-medium">AI Revenue Generated</p>
            <p className="text-xl font-bold text-[#22c55e]">€{data.platform.totalAiRevenue.toLocaleString()}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-black/50 animate-pulse">Loading...</div>
      ) : (
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-black/50 uppercase tracking-wider border-b" style={{ borderColor: "rgba(196,149,106,0.3)" }}>
                  <th className="px-4 py-3 text-left font-medium">Client</th>
                  <th className="px-4 py-3 text-right font-medium">Fee/mo</th>
                  <th className="px-4 py-3 text-right font-medium">WhatsApp</th>
                  <th className="px-4 py-3 text-right font-medium">Voice</th>
                  <th className="px-4 py-3 text-right font-medium">API</th>
                  <th className="px-4 py-3 text-right font-medium">Total Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Margin</th>
                  <th className="px-4 py-3 text-right font-medium">AI Rev Generated</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {(data?.tenants || []).map(t => (
                  <tr key={t.id} className="hover:bg-[#c4956a]/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-black">{t.name}</td>
                    <td className="px-4 py-3 text-right text-black">
                      {t.monthlyFee > 0 ? `€${t.monthlyFee}` : <span className="text-black/30">not set</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-black">€{t.costs.whatsapp.toFixed(2)}</span>
                      <span className="text-[10px] text-black/40 ml-1">({t.usage.whatsappConversations} msg)</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-black">€{t.costs.voice.toFixed(2)}</span>
                      <span className="text-[10px] text-black/40 ml-1">({t.usage.voiceCalls} calls)</span>
                    </td>
                    <td className="px-4 py-3 text-right text-black">€{t.costs.api.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-medium text-red-500">€{t.costs.total.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      {t.monthlyFee > 0 ? (
                        <span className={`font-bold ${t.margin > 50 ? "text-emerald-600" : t.margin > 20 ? "text-yellow-600" : "text-red-600"}`}>
                          {t.margin}%
                        </span>
                      ) : <span className="text-black/30">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[#22c55e]">€{t.aiRevenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t text-xs text-black/40" style={{ borderColor: "rgba(196,149,106,0.2)" }}>
            Costs are estimates based on per-unit rates in Settings. Set <strong>client_monthly_fee</strong>, <strong>cost_per_whatsapp</strong>, <strong>cost_per_voice_min</strong> in tenant settings for accurate tracking.
          </div>
        </div>
      )}
    </div>
  );
}
