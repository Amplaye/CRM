"use client";

import { Activity, Power, Settings2, ShieldAlert, Bot } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { AutomationRule } from "@/lib/types";

export default function AutomationsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const supabase = createClient();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;

    // Seed initial rules if empty
    const seedRules = async () => {
      const { data: existing } = await supabase
        .from("automation_rules")
        .select("id")
        .eq("tenant_id", tenant.id)
        .limit(1);

      if (!existing || existing.length === 0) {
         const presets: Partial<AutomationRule>[] = [
            {
               tenant_id: tenant.id,
               name: "Booking Confirmation via WhatsApp",
               description: "Instructs AI to automatically send a summary text when a booking finalizes.",
               trigger: "on_reservation_created",
               action: { type: "send_sms", payload: { message: "Your booking is confirmed." } },
               is_active: true,
            },
            {
               tenant_id: tenant.id,
               name: "Waitlist Auto-Matching Engine",
               description: "When a reservation cancels, background scan the Waitlist to alert highest scored match.",
               trigger: "on_reservation_cancelled",
               action: { type: "notify_staff", payload: {} },
               is_active: true,
            },
            {
               tenant_id: tenant.id,
               name: "High-Risk No-Show Escalator",
               description: "If an inbound chat reveals cancellation risk, immediately escalate to human inbox.",
               trigger: "on_ai_escalation",
               action: { type: "update_status", payload: { escalate: true } },
               is_active: false,
            }
         ];

         for (const preset of presets) {
            await supabase.from("automation_rules").insert({
              ...preset,
              created_at: Date.now(),
              updated_at: Date.now()
            });
         }
      }
    };

    const fetchRules = async () => {
      const { data, error } = await supabase
        .from("automation_rules")
        .select("*")
        .eq("tenant_id", tenant.id);

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      const res = (data || []) as AutomationRule[];
      res.sort((a,b) => a.created_at - b.created_at);
      setRules(res);
      setLoading(false);
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchRules(), 500);
    };

    seedRules().then(() => {
       fetchRules();

       const channel = supabase
         .channel("automation_rules_realtime")
         .on("postgres_changes", { event: "*", schema: "public", table: "automation_rules", filter: `tenant_id=eq.${tenant.id}` }, () => debouncedFetch())
         .subscribe();

       return () => {
         if (debounceTimer) clearTimeout(debounceTimer);
         supabase.removeChannel(channel);
       };
    });

  }, [tenant]);

  const toggleRule = async (ruleId: string, currentStatus: boolean) => {
     try {
        await supabase.from("automation_rules").update({
          is_active: !currentStatus,
          updated_at: Date.now()
        }).eq("id", ruleId);
     } catch (err) { console.error(err); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{t("auto_h1_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("auto_h1_subtitle")}</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {[1,2,3].map(i => (
              <div key={i} className="animate-pulse rounded-xl border-2 p-6 h-[220px]" style={{ background: 'rgba(252,246,237,0.6)', borderColor: '#c4956a' }}></div>
           ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {rules.map(rule => (
              <div key={rule.id} className={`rounded-xl border-2 p-6 relative transition-all duration-300 ${rule.is_active ? 'border-emerald-200' : ''}`} style={{ background: 'rgba(252,246,237,0.85)', borderColor: rule.is_active ? '#10b981' : '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>

                 {rule.is_active ? (
                    <div className="absolute top-4 right-4 group">
                      <span className="flex h-3 w-3 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                      </span>
                   </div>
                 ) : (
                    <div className="absolute top-4 right-4">
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-zinc-300"></span>
                   </div>
                 )}

                 <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-5 border ${rule.is_active ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 text-emerald-600 border-emerald-200 shadow-sm' : 'bg-zinc-100 text-black border-zinc-200'}`}>
                    <Bot className="h-6 w-6" />
                 </div>

                 <h3 className={`text-lg font-bold tracking-tight ${rule.is_active ? 'text-black' : 'text-black'}`}>
                   {rule.name}
                 </h3>

                 <p className="text-sm text-black mt-2 mb-6 h-10 leading-relaxed font-medium">
                   {rule.description}
                 </p>

                 <div className="flex items-center justify-between border-t border-zinc-100 pt-5 mt-auto">
                    <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider">
                       {rule.is_active ? (
                          <span className="text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">{t("auto_status_live")}</span>
                       ) : (
                          <span className="text-black bg-white px-2.5 py-1 rounded-md border border-zinc-200">{t("auto_status_sleeping")}</span>
                       )}
                       <span className="text-black">•</span>
                       <span className="text-black font-mono text-[10px]">{rule.trigger}</span>
                    </div>

                    <button
                       onClick={() => toggleRule(rule.id, rule.is_active)}
                       className={`inline-flex items-center px-4 py-2 text-xs font-bold rounded-lg transition-colors shadow-sm ${rule.is_active ? 'text-black bg-white border border-zinc-200 hover:bg-zinc-50' : 'text-white bg-zinc-900 hover:bg-zinc-800'}`}
                    >
                      <Power className={`h-3 w-3 mr-1.5 ${rule.is_active ? 'text-black' : 'text-black'}`} />
                      {rule.is_active ? t("auto_btn_disable") : t("auto_btn_activate")}
                    </button>
                 </div>
              </div>
           ))}
        </div>
      )}
    </div>
  );
}
