"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
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

  const startEdit = (t: TenantUsage) => {
    setEditingId(t.id);
    setEditValues({
      client_monthly_fee: t.monthlyFee,
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
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };
  const inputStyle = "w-20 text-xs border-2 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#c4956a]";
  const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

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
        <div className="space-y-3">
          {(data?.tenants || []).map(t => (
            <div key={t.id} className="rounded-xl border-2 p-4" style={cardStyle}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-black">{t.name}</h3>
                {editingId === t.id ? (
                  <button onClick={saveEdit} disabled={saving}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                    style={{ background: "#c4956a" }}>
                    <Save className="w-3 h-3" /> {saving ? "Saving..." : "Save"}
                  </button>
                ) : (
                  <button onClick={() => startEdit(t)}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border-2 text-black/60 hover:bg-[#c4956a]/10 transition-colors"
                    style={{ borderColor: "rgba(196,149,106,0.3)" }}>
                    <Settings className="w-3 h-3" /> Configure
                  </button>
                )}
              </div>

              {/* Edit form */}
              {editingId === t.id && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                  <div>
                    <label className="text-[10px] font-medium text-black/50 block mb-1">Monthly Fee (€)</label>
                    <input type="number" value={editValues.client_monthly_fee}
                      onChange={e => setEditValues({ ...editValues, client_monthly_fee: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-black/50 block mb-1">Cost/WhatsApp msg (€)</label>
                    <input type="number" step="0.01" value={editValues.cost_per_whatsapp}
                      onChange={e => setEditValues({ ...editValues, cost_per_whatsapp: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-black/50 block mb-1">Cost/Voice min (€)</label>
                    <input type="number" step="0.01" value={editValues.cost_per_voice_min}
                      onChange={e => setEditValues({ ...editValues, cost_per_voice_min: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-black/50 block mb-1">Avg call duration (min)</label>
                    <input type="number" value={editValues.avg_voice_duration_min}
                      onChange={e => setEditValues({ ...editValues, avg_voice_duration_min: Number(e.target.value) })}
                      className={inputStyle} style={inputBorder} />
                  </div>
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-black/40 font-medium">Fee/mo</p>
                  <p className="text-sm font-bold text-black">{t.monthlyFee > 0 ? `€${t.monthlyFee}` : "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/40 font-medium">WhatsApp</p>
                  <p className="text-sm font-bold text-black">€{t.costs.whatsapp.toFixed(2)}</p>
                  <p className="text-[10px] text-black/30">{t.usage.whatsappConversations} msg</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/40 font-medium">Voice</p>
                  <p className="text-sm font-bold text-black">€{t.costs.voice.toFixed(2)}</p>
                  <p className="text-[10px] text-black/30">{t.usage.voiceCalls} calls</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/40 font-medium">API</p>
                  <p className="text-sm font-bold text-black">€{t.costs.api.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/40 font-medium">Total Cost</p>
                  <p className="text-sm font-bold text-red-500">€{t.costs.total.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/40 font-medium">Margin</p>
                  <p className={`text-sm font-bold ${t.monthlyFee === 0 ? "text-black/30" : t.margin > 50 ? "text-emerald-600" : t.margin > 20 ? "text-yellow-600" : "text-red-600"}`}>
                    {t.monthlyFee > 0 ? `${t.margin}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-black/40 font-medium">AI Revenue</p>
                  <p className="text-sm font-bold text-[#22c55e]">€{t.aiRevenue.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
