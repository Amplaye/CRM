"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { DollarSign, RefreshCw, Save, Settings } from "lucide-react";

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
  const { t } = useLanguage();
  const [data, setData] = useState<{ tenants: TenantUsage[]; platform: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ client_monthly_fee: 0, cost_per_whatsapp: 0.05, cost_per_voice_min: 0.15, avg_voice_duration_min: 3 });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/usage");
      setData(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const startEdit = (ten: TenantUsage) => {
    setEditingId(ten.id);
    setEditValues({
      client_monthly_fee: ten.monthlyFee,
      cost_per_whatsapp: 0.05,
      cost_per_voice_min: 0.15,
      avg_voice_duration_min: 3,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    await fetch("/api/admin/tenant", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: editingId, settings: editValues }),
    });
    setSaving(false);
    setEditingId(null);
    fetchData();
  };

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">{t("adm_costs_unauthorized")}</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };
  const inputStyle = "w-20 text-xs border-2 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#c4956a]";
  const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">{t("adm_costs_title")}</h1>
          <span className="text-xs text-black">{t("adm_costs_last_30_days")}</span>
        </div>
        <button onClick={fetchData} className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Platform totals */}
      {data?.platform && (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_costs_total_client_fees")}</p>
            <p className="text-xl font-bold text-black">€{data.platform.totalFees.toLocaleString()}/mo</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_costs_total_costs")}</p>
            <p className="text-xl font-bold text-red-500">€{data.platform.totalCosts.toLocaleString()}</p>
          </div>
          <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
            <p className="text-xs text-black font-medium">{t("adm_costs_ai_revenue_generated")}</p>
            <p className="text-xl font-bold text-[#22c55e]">€{data.platform.totalAiRevenue.toLocaleString()}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-black animate-pulse">{t("adm_costs_loading")}</div>
      ) : (
        <div className="space-y-3">
          {(data?.tenants || []).map(ten => (
            <div key={ten.id} className="rounded-xl border-2 p-4" style={cardStyle}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-black">{ten.name}</h3>
                {editingId === ten.id ? (
                  <button onClick={saveEdit} disabled={saving}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                    style={{ background: "#c4956a" }}>
                    <Save className="w-3 h-3" /> {saving ? t("adm_costs_saving") : t("adm_costs_save")}
                  </button>
                ) : (
                  <button onClick={() => startEdit(ten)}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border-2 text-black hover:bg-[#c4956a]/10 transition-colors"
                    style={{ borderColor: "rgba(196,149,106,0.3)" }}>
                    <Settings className="w-3 h-3" /> {t("adm_costs_configure")}
                  </button>
                )}
              </div>

              {/* Edit form */}
              {editingId === ten.id && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                  <div>
                    <label className="text-[10px] font-medium text-black block mb-1">{t("adm_costs_monthly_fee")}</label>
                    <input type="number" value={editValues.client_monthly_fee}
                      onChange={e => setEditValues({ ...editValues, client_monthly_fee: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-black block mb-1">{t("adm_costs_cost_per_whatsapp")}</label>
                    <input type="number" step="0.01" value={editValues.cost_per_whatsapp}
                      onChange={e => setEditValues({ ...editValues, cost_per_whatsapp: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-black block mb-1">{t("adm_costs_cost_per_voice_min")}</label>
                    <input type="number" step="0.01" value={editValues.cost_per_voice_min}
                      onChange={e => setEditValues({ ...editValues, cost_per_voice_min: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-black block mb-1">{t("adm_costs_avg_call_duration")}</label>
                    <input type="number" value={editValues.avg_voice_duration_min}
                      onChange={e => setEditValues({ ...editValues, avg_voice_duration_min: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_fee_per_mo")}</p>
                  <p className="text-sm font-bold text-black">{ten.monthlyFee > 0 ? `€${ten.monthlyFee}` : "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_whatsapp")}</p>
                  <p className="text-sm font-bold text-black">€{ten.costs.whatsapp.toFixed(2)}</p>
                  <p className="text-[10px] text-black">{ten.usage.whatsappConversations} {t("adm_costs_msg")}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_voice")}</p>
                  <p className="text-sm font-bold text-black">€{ten.costs.voice.toFixed(2)}</p>
                  <p className="text-[10px] text-black">{ten.usage.voiceCalls} {t("adm_costs_calls")}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_api")}</p>
                  <p className="text-sm font-bold text-black">€{ten.costs.api.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_total_cost")}</p>
                  <p className="text-sm font-bold text-red-500">€{ten.costs.total.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_margin")}</p>
                  <p className={`text-sm font-bold ${ten.monthlyFee === 0 ? "text-black" : ten.margin > 50 ? "text-emerald-600" : ten.margin > 20 ? "text-yellow-600" : "text-red-600"}`}>
                    {ten.monthlyFee > 0 ? `${ten.margin}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-black font-medium">{t("adm_costs_ai_revenue")}</p>
                  <p className="text-sm font-bold text-[#22c55e]">€{ten.aiRevenue.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
