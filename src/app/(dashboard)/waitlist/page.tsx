"use client";

import { UserPlus, Sparkles, Clock, Send, Activity, X, CheckCircle, MessageSquare } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { WaitlistEntry } from "@/lib/types";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createWaitlistEntryAction, updateWaitlistStatusAction } from "@/app/actions/waitlist";
import { createReservationAction } from "@/app/actions/reservations";
import Link from "next/link";

interface WaitlistWithGuest extends WaitlistEntry {
  guests?: { name: string; phone: string; email?: string };
}

export default function WaitlistPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const { user } = useAuth();
  const supabase = createClient();

  const [entries, setEntries] = useState<WaitlistWithGuest[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WaitlistWithGuest | null>(null);

  const openDetail = (entry: WaitlistWithGuest) => {
    setSelectedEntry(entry);
  };

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);

    const fetchEntries = async () => {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .select("*, guests(name, phone, email)")
        .eq("tenant_id", tenant.id)
        .eq("date", today)
        .in("status", ["waiting", "match_found", "contacted"]);

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      const docs = (data || []) as WaitlistWithGuest[];
      const ts = (v: any) => (typeof v === 'number' ? v : new Date(v).getTime());
      docs.sort((a, b) => b.priority_score - a.priority_score || ts(a.created_at) - ts(b.created_at));
      setEntries(docs);
      setLoading(false);
    };

    fetchEntries();

    const channel = supabase
      .channel("waitlist_entries_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "waitlist_entries", filter: `tenant_id=eq.${tenant.id}` }, () => {
        fetchEntries();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant, today]);

  const matchFoundEntry = entries.find(e => e.status === "match_found");

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!tenant || !user) return;
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    try {
       const res = await createWaitlistEntryAction({
          tenantId: tenant.id,
          guestName: formData.get("guestName") as string,
          guestPhone: formData.get("guestPhone") as string,
          date: formData.get("date") as string,
          targetTime: formData.get("targetTime") as string,
          partySize: Number(formData.get("partySize")),
          timeRangeStart: formData.get("timeRangeStart") as string,
          timeRangeEnd: formData.get("timeRangeEnd") as string,
          contactPreference: formData.get("contactPreference") as any,
          notes: formData.get("notes") as string
       });
       if (!res.success) throw new Error((res as any).error || "Unknown error");
       setIsCreating(false);
    } catch (err: any) {
       alert("Failed to create: " + err.message);
    } finally {
       setSaving(false);
    }
  };

  const markContacted = async (entry: WaitlistEntry) => {
    if (!user || !tenant) return;
    try {
      await updateWaitlistStatusAction({
         tenantId: tenant.id,
         waitlistId: entry.id,
         newStatus: "contacted"
      });
    } catch (err) { console.error(err); }
  };

  const convertToBooking = async (entry: WaitlistWithGuest) => {
    if (!user || !tenant) return;
    const guestName = entry.guests?.name || `Guest ${entry.guest_id.substring(0,6)}`;
    const guestPhone = entry.guests?.phone || "0000000";
    if (!confirm(`Convert ${guestName} (${entry.party_size} pax) at ${entry.target_time} to a confirmed booking?`)) return;

    try {
      // 1. Create Reservation natively
      const res = await createReservationAction({
         tenantId: tenant.id,
         guestName,
         guestPhone,
         date: entry.date,
         time: entry.target_time,
         partySize: entry.party_size,
         source: "staff",
         notes: "Converted from waitlist"
      });
      // 2. Mark Waitlist Status
      await updateWaitlistStatusAction({
         tenantId: tenant.id,
         waitlistId: entry.id,
         newStatus: "converted_to_booking"
      });
    } catch (err) { console.error(err); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8 flex">
      <div className={`flex-1 transition-all duration-300 ${isCreating ? 'pr-[400px]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-black tracking-tight">{t("waitlist_title")}</h1>
            <p className="mt-1 text-sm text-black">{t("waitlist_subtitle")} ({today})</p>
          </div>
          <div className="mt-4 sm:mt-0 flex space-x-3">
            <button
               onClick={() => setIsCreating(true)}
               className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"
            >
              <UserPlus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
              {t("waitlist_add")}
            </button>
          </div>
        </div>

        {/* AI Match Alert Banner */}
        {matchFoundEntry && (
          <div className="mb-8 relative overflow-hidden rounded-2xl border-2 flex items-start sm:items-center p-6 justify-between flex-col sm:flex-row gap-4" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
             <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-terracotta-50/80 to-transparent rounded-full blur-3xl pointer-events-none transform translate-x-10 -translate-y-10"></div>

             <div className="flex items-start relative z-10 w-full">
                <div className="flex-shrink-0 mt-1">
                   <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-terracotta-100 to-terracotta-50 text-terracotta-600 border border-terracotta-100 shadow-sm">
                      <Sparkles className="h-6 w-6" />
                   </div>
                </div>
                <div className="ml-5 flex-1">
                   <h3 className="text-lg font-bold text-black tracking-tight">{t("waitlist_recovery_match")}</h3>
                   <p className="text-sm text-black mt-1 max-w-2xl leading-relaxed">
                     {t("waitlist_cancellation_match")} <span className="font-bold text-black">{matchFoundEntry.guests?.name || `Guest ${matchFoundEntry.guest_id.substring(0,8)}`}</span> ({matchFoundEntry.party_size} pax). Their flexible window is {matchFoundEntry.acceptable_time_range.start} – {matchFoundEntry.acceptable_time_range.end}.
                   </p>
                   <div className="mt-3 flex items-center space-x-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider font-bold bg-zinc-900 text-white shadow-sm">
                         Score: {matchFoundEntry.priority_score}
                      </span>
                      {matchFoundEntry.priority_score > 30 && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider font-bold bg-amber-100 text-amber-700 border border-amber-200">
                           {t("waitlist_vip_loyalty")}
                        </span>
                      )}
                   </div>
                </div>
                <div className="flex flex-col space-y-2 shrink-0">
                  <button
                     onClick={() => markContacted(matchFoundEntry)}
                     className="w-full sm:w-auto px-5 py-2.5 text-white text-sm font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center"
                     style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
                  >
                     <Send className="h-4 w-4 mr-2" /> {t("waitlist_notify_guest")}
                  </button>
                </div>
             </div>
          </div>
        )}

        <div className="border-2 rounded-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
           <div className="px-6 py-4 border-b flex justify-between items-center" style={{ borderColor: '#c4956a' }}>
              <h2 className="font-bold text-black tracking-tight">{t("waitlist_queue")}</h2>
              <span className="bg-zinc-200 text-black text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-md">{entries.length} {t("waitlist_checking")}</span>
           </div>

           {entries.length === 0 && !loading ? (
              <div className="py-16 text-center text-black">
                 <Activity className="w-12 h-12 text-black mx-auto mb-4" />
                 <p className="text-sm font-bold text-black">{t("waitlist_no_entries")}</p>
                 <p className="text-xs text-black mt-1">{t("waitlist_no_management")}</p>
              </div>
           ) : loading ? (
               <div className="py-16 text-center animate-pulse text-black">Loading...</div>
           ) : (
             <div className="overflow-x-auto">
             <table className="min-w-full divide-y divide-zinc-200">
               <thead className="bg-white">
                 <tr>
                   <th scope="col" className="px-3 sm:px-6 py-3 text-center text-[10px] font-bold text-black uppercase tracking-widest">{t("waitlist_col_pos")}</th>
                   <th scope="col" className="px-3 sm:px-6 py-3 text-center text-[10px] font-bold text-black uppercase tracking-widest">{t("waitlist_col_guest")}</th>
                   <th scope="col" className="px-3 sm:px-6 py-3 text-center text-[10px] font-bold text-black uppercase tracking-widest">{t("waitlist_target_flex")}</th>
                   <th scope="col" className="px-3 sm:px-6 py-3 text-center text-[10px] font-bold text-black uppercase tracking-widest">{t("waitlist_status_score")}</th>
                   <th scope="col" className="relative px-3 sm:px-6 py-3 text-center"><span className="sr-only">Actions</span></th>
                 </tr>
               </thead>
               <tbody className="bg-white divide-y divide-zinc-100">
                 {entries.map((entry, idx) => {
                   const waitMinutes = Math.max(0, Math.floor((Date.now() - (typeof entry.created_at === 'number' ? entry.created_at : new Date(entry.created_at as any).getTime())) / 60000));
                   return (
                   <tr key={entry.id} onClick={() => openDetail(entry)} className={`cursor-pointer ${entry.status === 'match_found' ? 'bg-terracotta-50/20 hover:bg-terracotta-50/40' : entry.status === 'contacted' ? 'bg-blue-50/20 hover:bg-blue-50/40' : 'hover:bg-zinc-50/50'} transition-colors`}>
                     <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-center">
                       <div className="flex flex-col items-center">
                         <span className={`text-2xl font-black tracking-tighter ${entry.status === 'match_found' ? 'text-terracotta-600' : 'text-black'}`}>{idx + 1}</span>
                         <div className={`text-sm font-bold flex items-center justify-center mt-1 ${entry.status === 'match_found' ? 'text-black' : 'text-black'}`}>
                            <Clock className={`w-3.5 h-3.5 mr-1 ${entry.status === 'match_found' ? 'text-terracotta-500' : 'text-black'}`} />
                            {t("waitlist_wait_time").replace("{min}", String(waitMinutes))}
                         </div>
                       </div>
                     </td>
                     <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-center">
                       <div className="text-sm font-bold text-black tracking-tight flex items-center justify-center">
                         {entry.guests?.name || `Guest ${entry.guest_id.substring(0,6)}`} ({entry.party_size} pax)
                         <Link href={`/conversations?guest=${entry.guest_id}`} onClick={(e) => e.stopPropagation()} className="ml-2 text-[#c4956a] hover:text-[#b8845c] transition-colors" title="Open conversation">
                           <MessageSquare className="w-4 h-4" />
                         </Link>
                       </div>
                       {entry.guests?.phone && (
                         <div className="text-xs font-medium text-black mt-0.5">{entry.guests.phone}</div>
                       )}
                       <div className="text-xs font-medium text-black flex items-center justify-center mt-0.5">
                          {entry.date} &middot; {t("waitlist_prefers")} {entry.contact_preference}
                       </div>
                     </td>
                     <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-center">
                        <div className="text-sm font-bold text-black">{entry.target_time}</div>
                        <div className="text-[11px] font-medium text-black bg-zinc-100 px-2 py-0.5 rounded-md inline-flex mt-1 border border-zinc-200">
                           {entry.acceptable_time_range.start} – {entry.acceptable_time_range.end}
                        </div>
                     </td>
                     <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex flex-col items-center gap-1">
                           <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                              entry.status === 'contacted' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              entry.status === 'match_found' ? 'bg-terracotta-50 text-terracotta-700 border-terracotta-200' :
                              'bg-zinc-100 text-black border-zinc-200'
                           }`}>
                              {entry.status.replace('_', ' ')}
                           </span>
                        </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                       {entry.status === 'contacted' ? (
                          <button onClick={(e) => { e.stopPropagation(); convertToBooking(entry); }} className="px-3 py-1.5 font-bold border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 shadow-sm rounded-lg transition-colors flex items-center mx-auto">
                            <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Book
                          </button>
                       ) : entry.status === 'waiting' && (
                          <button onClick={(e) => { e.stopPropagation(); markContacted(entry); }} className="px-3 py-1.5 font-bold border border-zinc-200 text-black hover:text-black hover:bg-zinc-50 shadow-sm rounded-lg transition-colors mx-auto">
                            Manual Contact
                          </button>
                       )}
                     </td>
                   </tr>
                 );
                 })}
               </tbody>
             </table>
             </div>
           )}
        </div>
      </div>

      {/* CREATE WAITLIST ENTRY DRAWER */}
      {isCreating && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[400px] border-l shadow-2xl z-40 transform transition-transform duration-300 flex flex-col" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <h2 className="text-lg font-bold text-black tracking-tight">{t("waitlist_registration")}</h2>
             <button onClick={() => setIsCreating(false)} className="p-2 text-black hover:bg-[#c4956a]/10 hover:text-black rounded-full transition-colors">
                <X className="h-5 w-5" />
             </button>
          </div>
          <form onSubmit={handleCreate} className="flex-1 flex flex-col overflow-hidden">
             <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="bg-zinc-900 text-white text-xs p-3 rounded-lg border border-black shadow-sm font-medium mb-4 flex items-start">
                  <Activity className="w-4 h-4 mr-2 shrink-0 opacity-70" />
                  {t("waitlist_priority_note")}
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-xs font-bold text-black mb-1">{t("waitlist_guest_name")}</label>
                     <input required name="guestName" type="text" placeholder="John Doe" className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                   </div>
                   <div>
                     <label className="block text-xs font-bold text-black mb-1">{t("waitlist_guest_phone")}</label>
                     <input required name="guestPhone" type="tel" placeholder="+44 77..." className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-xs font-bold text-black mb-1">{t("waitlist_date")}</label>
                     <input required name="date" type="date" defaultValue={today} className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                   </div>
                   <div>
                     <label className="block text-xs font-bold text-black mb-1">{t("waitlist_party_size")}</label>
                     <input required name="partySize" type="number" min="1" max="20" defaultValue="2" className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                   </div>
                </div>

                <div className="border border-zinc-200 rounded-lg p-4 bg-white shadow-sm">
                   <h3 className="text-[10px] font-bold text-black uppercase tracking-widest mb-3">{t("waitlist_time_flex")}</h3>
                   <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-black mb-1">Target Ideal Time</label>
                        <input required name="targetTime" type="time" defaultValue="19:00" className="w-full border border-zinc-200 bg-zinc-50 rounded-md px-3 py-2 text-sm font-bold" />
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-100">
                        <div>
                           <label className="block text-[10px] font-bold text-black uppercase">Earliest Arrival</label>
                           <input required name="timeRangeStart" type="time" defaultValue="18:30" className="w-full border border-zinc-200 rounded-md px-2 py-1 mt-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold text-black uppercase">Latest Seating</label>
                           <input required name="timeRangeEnd" type="time" defaultValue="20:00" className="w-full border border-zinc-200 rounded-md px-2 py-1 mt-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                        </div>
                      </div>
                   </div>
                </div>

                <div>
                   <label className="block text-xs font-bold text-black mb-1">{t("waitlist_contact_pref")}</label>
                   <select required name="contactPreference" className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900">
                      <option value="whatsapp">WhatsApp (Automated Matcher)</option>
                      <option value="sms">SMS Text Message</option>
                      <option value="call">Voice Call</option>
                   </select>
                </div>

                <div>
                   <label className="block text-xs font-bold text-black mb-1">{t("waitlist_internal_notes")}</label>
                   <textarea
                     name="notes"
                     rows={2}
                     className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                     placeholder={t("waitlist_notes_placeholder")}
                   />
                </div>
             </div>

             <div className="p-6 border-t" style={{ borderColor: '#c4956a' }}>
                <button
                   type="submit"
                   disabled={saving}
                   className="w-full flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-50 text-sm"
                >
                   {saving ? "Registering..." : t("waitlist_add_live")}
                </button>
             </div>
          </form>
        </div>
      )}

      {/* DETAIL DRAWER */}
      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setSelectedEntry(null)} />
          <div className="w-full sm:w-[480px] h-full border-l shadow-2xl flex flex-col" style={{ background: 'rgba(252,246,237,0.98)', borderColor: '#c4956a' }}>
            <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
              <h2 className="text-lg font-bold text-black tracking-tight">{t("waitlist_detail_title")}</h2>
              <button onClick={() => setSelectedEntry(null)} className="p-2 text-black hover:bg-[#c4956a]/10 rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_col_guest")}</div>
                <div className="text-base font-bold text-black">{selectedEntry.guests?.name || `Guest ${selectedEntry.guest_id.substring(0,6)}`}</div>
                {selectedEntry.guests?.phone && <div className="text-sm text-black">{selectedEntry.guests.phone}</div>}
                {selectedEntry.guests?.email && <div className="text-sm text-black">{selectedEntry.guests.email}</div>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_party")}</div>
                  <div className="text-sm font-bold text-black">{selectedEntry.party_size} pax</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_date")}</div>
                  <div className="text-sm font-bold text-black">{selectedEntry.date}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_target_time")}</div>
                  <div className="text-sm font-bold text-black">{selectedEntry.target_time}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_flex_range")}</div>
                  <div className="text-sm font-bold text-black">{selectedEntry.acceptable_time_range.start} – {selectedEntry.acceptable_time_range.end}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_contact_pref")}</div>
                  <div className="text-sm font-bold text-black capitalize">{selectedEntry.contact_preference}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_status")}</div>
                  <div className="text-sm font-bold text-black">{selectedEntry.status.replace('_', ' ')}</div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">{t("waitlist_detail_notes")}</div>
                <div className="text-sm text-black bg-white border border-zinc-200 rounded-lg p-3 min-h-[60px] whitespace-pre-wrap">{selectedEntry.notes?.trim() || t("waitlist_detail_no_notes")}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
