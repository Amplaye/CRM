"use client";

import { Activity, Power, Settings2, ShieldAlert, Bot } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { AutomationRule } from "@/lib/types";

export default function AutomationsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    
    // Seed initial rules if empty
    const seedRules = async () => {
      const q = query(collection(db, "automation_rules"), where("tenant_id", "==", tenant.id));
      const snap = await getDocs(q);
      
      if (snap.empty) {
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
            const rRef = doc(collection(db, "automation_rules"));
            await setDoc(rRef, { ...preset, id: rRef.id, created_at: Date.now(), updated_at: Date.now() });
         }
      }
    };
    
    seedRules().then(() => {
       const q = query(collection(db, "automation_rules"), where("tenant_id", "==", tenant.id));
       const unsubscribe = onSnapshot(q, (snapshot) => {
         const res = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AutomationRule));
         res.sort((a,b) => a.created_at - b.created_at);
         setRules(res);
         setLoading(false);
       });
       return () => unsubscribe();
    });
    
  }, [tenant]);

  const toggleRule = async (ruleId: string, currentStatus: boolean) => {
     try {
        await updateDoc(doc(db, "automation_rules", ruleId), { 
          is_active: !currentStatus,
          updated_at: Date.now()
        });
     } catch (err) { console.error(err); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">AI Integrations & Rules</h1>
          <p className="mt-1 text-sm text-zinc-500">Configure boundaries and external webhook triggers for your AI agents.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {[1,2,3].map(i => (
              <div key={i} className="animate-pulse bg-white rounded-xl border border-zinc-200 shadow-sm p-6 h-[220px]"></div>
           ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {rules.map(rule => (
              <div key={rule.id} className={`bg-white rounded-xl border shadow-sm p-6 relative transition-all duration-300 ${rule.is_active ? 'border-emerald-200 bg-gradient-to-br from-white to-emerald-50/10' : 'border-zinc-200 bg-zinc-50/50'}`}>
                 
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

                 <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-5 border ${rule.is_active ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 text-emerald-600 border-emerald-200 shadow-sm' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>
                    <Bot className="h-6 w-6" />
                 </div>
                 
                 <h3 className={`text-lg font-bold tracking-tight ${rule.is_active ? 'text-zinc-900' : 'text-zinc-500'}`}>
                   {rule.name}
                 </h3>
                 
                 <p className="text-sm text-zinc-500 mt-2 mb-6 h-10 leading-relaxed font-medium">
                   {rule.description}
                 </p>
                 
                 <div className="flex items-center justify-between border-t border-zinc-100 pt-5 mt-auto">
                    <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider">
                       {rule.is_active ? (
                          <span className="text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">Live Config</span>
                       ) : (
                          <span className="text-zinc-500 bg-white px-2.5 py-1 rounded-md border border-zinc-200">Sleeping</span>
                       )}
                       <span className="text-zinc-300">•</span>
                       <span className="text-zinc-400 font-mono text-[10px]">{rule.trigger}</span>
                    </div>
                    
                    <button 
                       onClick={() => toggleRule(rule.id, rule.is_active)}
                       className={`inline-flex items-center px-4 py-2 text-xs font-bold rounded-lg transition-colors shadow-sm ${rule.is_active ? 'text-zinc-900 bg-white border border-zinc-200 hover:bg-zinc-50' : 'text-white bg-zinc-900 hover:bg-zinc-800'}`}
                    >
                      <Power className={`h-3 w-3 mr-1.5 ${rule.is_active ? 'text-zinc-400' : 'text-zinc-300'}`} /> 
                      {rule.is_active ? 'Disable' : 'Activate'}
                    </button>
                 </div>
              </div>
           ))}
        </div>
      )}
    </div>
  );
}
