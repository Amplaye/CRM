"use client";

import { AlertOctagon, CheckCircle2, Search, Zap, Clock, User, Link as LinkIcon, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Incident } from "@/lib/types";
import { useAuth } from "@/lib/contexts/AuthContext";

export default function IncidentsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const { user } = useAuth();
  const supabase = createClient();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;

    // Seed initial incidents if empty for demo purposes
    const seedIncidents = async () => {
      const { data: existing } = await supabase
        .from("incidents")
        .select("id")
        .eq("tenant_id", tenant.id)
        .limit(1);

      if (!existing || existing.length === 0) {
         const presets: Partial<Incident>[] = [
            {
               tenant_id: tenant.id,
               type: "ai_error",
               title: "Bland AI Hallucinated Pricing",
               description: "The AI agent quoted $15 for the premium tasting menu over a phone call.",
               status: "open",
               severity: "critical",
               owner_id: null,
               linked_conversation_id: "conv_12345",
            },
            {
               tenant_id: tenant.id,
               type: "conflict",
               title: "Double Booking at Table 4",
               description: "Walk-in overrode an online booking. Next.js server actions caught it but guest complained.",
               status: "investigating",
               severity: "medium",
               owner_id: user?.id || "staff_1",
               linked_reservation_id: "res_9982",
            },
            {
               tenant_id: tenant.id,
               type: "health_safety",
               title: "Nut Allergy Unreported during Booking",
               description: "Guest forgot to mention severe nut allergy. Safely handled by kitchen.",
               status: "resolved",
               severity: "critical",
               owner_id: "chef_1",
               linked_reservation_id: "res_1111",
            }
         ];

         for (const preset of presets) {
            await supabase.from("incidents").insert({
              ...preset,
              created_at: Date.now(),
              updated_at: Date.now()
            });
         }
      }
    };

    const fetchIncidents = async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select("*")
        .eq("tenant_id", tenant.id);

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      const docs = (data || []) as Incident[];
      // Sort by severity critical first, then newest
      docs.sort((a,b) => {
         if (a.severity === 'critical' && b.severity !== 'critical') return -1;
         if (b.severity === 'critical' && a.severity !== 'critical') return 1;
         return b.created_at - a.created_at;
      });
      setIncidents(docs);
      setLoading(false);
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchIncidents(), 500);
    };

    seedIncidents().then(() => {
       fetchIncidents();

       const channel = supabase
         .channel("incidents_realtime")
         .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `tenant_id=eq.${tenant.id}` }, () => debouncedFetch())
         .subscribe();

       return () => {
         if (debounceTimer) clearTimeout(debounceTimer);
         supabase.removeChannel(channel);
       };
    });
  }, [tenant, user?.id]);

  const handleStatusChange = async (id: string, newStatus: Incident["status"]) => {
     try {
        await supabase.from("incidents").update({
           status: newStatus,
           updated_at: Date.now(),
           owner_id: newStatus === 'investigating' && user ? user.id : null
        }).eq("id", id);
     } catch (err) { console.error(err); }
  };

  const columns: { id: Incident["status"]; label: string; bg: string }[] = [
    { id: "open", label: t("inc_open_triage"), bg: "bg-red-50/50 border-red-100" },
    { id: "investigating", label: t("inc_investigating"), bg: "bg-amber-50/50 border-amber-100" },
    { id: "resolved", label: t("inc_resolved_col"), bg: "bg-emerald-50/50 border-emerald-100" }
  ];

  const getIncidentIcon = (type: string) => {
     switch(type) {
        case 'ai_error': return <Zap className="w-4 h-4 text-purple-500" />;
        case 'conflict': return <Clock className="w-4 h-4 text-orange-500" />;
        case 'health_safety': return <AlertOctagon className="w-4 h-4 text-red-500" />;
        default: return <AlertTriangle className="w-4 h-4 text-black" />;
     }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] h-[calc(100vh-4rem)] flex flex-col mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{t("inc_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("inc_subtitle")}</p>
        </div>
        <div className="flex space-x-3 mt-4 sm:mt-0">
            <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
               <input type="text" placeholder={t("inc_search")} className="w-64 pl-9 pr-3 py-2 border-2 rounded-lg text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
            </div>
            <button className="px-4 py-2 bg-zinc-900 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-zinc-800 transition-colors">
               {t("inc_report_manual")}
            </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-black animate-pulse font-medium">{t("inc_loading")}</div>
      ) : (
        <div className="flex-1 flex gap-6 overflow-hidden pb-4">
           {columns.map(col => {
              const colIncidents = incidents.filter(i => i.status === col.id);

              return (
                 <div key={col.id} className={`flex-1 flex flex-col rounded-2xl border ${col.bg} overflow-hidden shadow-sm`}>
                    <div className="px-5 py-4 border-b border-black/5 bg-white/50 backdrop-blur-sm flex justify-between items-center shrink-0">
                       <h2 className="font-bold text-black tracking-tight">{col.label}</h2>
                       <span className="bg-white border border-black/10 text-black text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">{colIncidents.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                       {colIncidents.map(inc => (
                          <div key={inc.id} className="rounded-xl border-2 hover:shadow-md transition-shadow p-5 relative group cursor-pointer" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>

                             {inc.severity === 'critical' && (
                                <div className="absolute top-0 right-0 w-8 h-8 overflow-hidden rounded-tr-xl">
                                   <div className="absolute top-0 right-0 w-0 h-0 border-t-[24px] border-t-red-500 border-l-[24px] border-l-transparent"></div>
                                </div>
                             )}

                             <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-2">
                                   <div className="bg-zinc-50 p-1.5 rounded-md border border-zinc-100">
                                      {getIncidentIcon(inc.type)}
                                   </div>
                                   <span className="text-[10px] uppercase font-bold tracking-wider text-black bg-zinc-100 px-2 py-0.5 rounded border border-zinc-200">
                                      {inc.type.replace('_', ' ')}
                                   </span>
                                </div>
                             </div>

                             <h3 className="font-bold text-black leading-tight mb-1 pr-6">{inc.title}</h3>
                             <p className="text-xs text-black leading-relaxed mb-4 line-clamp-2">{inc.description}</p>

                             {(inc.linked_reservation_id || inc.linked_conversation_id) && (
                                <div className="flex flex-wrap gap-2 mb-4">
                                   {inc.linked_reservation_id && (
                                      <span className="inline-flex items-center text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 hover:bg-blue-100 transition-colors">
                                         <LinkIcon className="w-3 h-3 mr-1" /> Res {inc.linked_reservation_id.substring(0,4)}
                                      </span>
                                   )}
                                   {inc.linked_conversation_id && (
                                      <span className="inline-flex items-center text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded border border-purple-100 hover:bg-purple-100 transition-colors">
                                         <LinkIcon className="w-3 h-3 mr-1" /> Conv {inc.linked_conversation_id.substring(0,4)}
                                      </span>
                                   )}
                                </div>
                             )}

                             <div className="flex items-center justify-between pt-3 border-t border-zinc-50">
                                <div className="flex items-center text-[10px] font-bold text-black">
                                   <Clock className="w-3 h-3 mr-1" /> {new Date(inc.created_at).toLocaleDateString()}
                                </div>
                                <div className="flex items-center space-x-2">
                                   {col.id === 'open' && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleStatusChange(inc.id, 'investigating'); }}
                                        className="text-[10px] font-bold bg-zinc-900 text-white px-3 py-1.5 rounded-md shadow-sm hover:bg-zinc-800 transition-colors"
                                      >
                                        {t("inc_claim")}
                                      </button>
                                   )}
                                   {col.id === 'investigating' && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleStatusChange(inc.id, 'resolved'); }}
                                        className="text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-md shadow-sm hover:bg-emerald-200 transition-colors flex items-center"
                                      >
                                        <CheckCircle2 className="w-3 h-3 mr-1" /> {t("inc_resolve_btn")}
                                      </button>
                                   )}
                                   {inc.owner_id ? (
                                      <div className="h-6 w-6 rounded-full bg-zinc-200 border border-white flex items-center justify-center text-[10px] font-bold text-black shadow-sm" title={t("inc_assigned")}>
                                         <User className="w-3 h-3" />
                                      </div>
                                   ) : (
                                      <div className="h-6 w-6 rounded-full bg-red-50 border border-red-100 border-dashed flex items-center justify-center text-red-400" title={t("inc_unassigned")}>
                                         !
                                      </div>
                                   )}
                                </div>
                             </div>
                          </div>
                       ))}
                       {colIncidents.length === 0 && (
                          <div className="h-24 flex items-center justify-center border-2 border-dashed border-black/5 rounded-xl">
                             <span className="text-xs font-bold text-black uppercase tracking-widest">{t("inc_empty")}</span>
                          </div>
                       )}
                    </div>
                 </div>
              );
           })}
        </div>
      )}
    </div>
  );
}
