"use client";

import { Download, Search, SlidersHorizontal, Star, AlertTriangle, X, Save, CalendarCheck } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Guest, Reservation } from "@/lib/types";
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export default function GuestsPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestReservations, setGuestReservations] = useState<Reservation[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeTenant) return;
    setLoading(true);

    const q = query(
      collection(db, "guests"),
      where("tenant_id", "==", activeTenant.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const results: Guest[] = [];
      snapshot.forEach(d => results.push({ id: d.id, ...d.data() } as Guest));
      setGuests(results);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [activeTenant]);

  // Fetch reservations when a specific guest is selected
  useEffect(() => {
    if (!selectedGuest || !activeTenant) return;
    const fetchRes = async () => {
       const q = query(
         collection(db, "reservations"),
         where("tenant_id", "==", activeTenant.id),
         where("guest_id", "==", selectedGuest.id),
       );
       const snap = await getDocs(q);
       const res = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
       // sort by date descending
       res.sort((a,b) => b.date.localeCompare(a.date));
       setGuestReservations(res);
    };
    fetchRes();
  }, [selectedGuest, activeTenant]);

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedGuest) return;
    
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    try {
      await updateDoc(doc(db, "guests", selectedGuest.id), {
        email: formData.get("email"),
        dietary_notes: formData.get("dietary_notes"),
        accessibility_notes: formData.get("accessibility_notes"),
        family_notes: formData.get("family_notes"),
        notes: formData.get("notes"),
        updated_at: Date.now()
      });
      // updating local state to reflect UI changes instantly if needed or let snapshot handle it
      setSelectedGuest(null);
    } catch(err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const isVip = (g: Guest) => g.visit_count >= 10 || (g.estimated_spend && g.estimated_spend > 1000);
  const isHighRisk = (g: Guest) => g.no_show_count >= 2;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 flex">
      <div className={`flex-1 transition-all duration-300 ${selectedGuest ? 'pr-[400px]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{t("guests_title")}</h1>
            <p className="mt-1 text-sm text-zinc-500">{t("guests_subtitle")}</p>
          </div>
          <div className="mt-4 sm:mt-0 flex space-x-3">
            <button className="inline-flex items-center px-4 py-2 border border-zinc-200 text-sm font-medium rounded-md shadow-sm text-zinc-700 bg-white hover:bg-zinc-50 transition-colors">
              <Download className="-ml-1 mr-2 h-4 w-4" />
              {t("guests_export")}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-8">
           <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input 
                type="text" 
                placeholder={t("guests_search")}
                className="w-full pl-9 pr-3 py-2 bg-white border border-zinc-200 rounded-md text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
           </div>
           <button className="px-4 py-2 border border-zinc-200 bg-white text-zinc-700 rounded-md text-sm font-medium flex items-center hover:bg-zinc-50 shadow-sm">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              {t("guests_filters")}
           </button>
        </div>

        {loading ? (
           <div className="text-sm text-zinc-500">Loading guests...</div>
        ) : guests.length === 0 ? (
           <div className="bg-white border rounded-xl border-zinc-200 py-16 text-center shadow-sm">
              <User className="mx-auto h-12 w-12 text-zinc-300 mb-4" />
              <h3 className="text-sm font-medium text-zinc-900">No Guests Found</h3>
              <p className="mt-1 text-sm text-zinc-500">Guests will automatically populate here when reservations are booked.</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {guests.map((guest) => (
               <div 
                 key={guest.id} 
                 onClick={() => setSelectedGuest(guest)}
                 className={`bg-white rounded-xl border ${isHighRisk(guest) ? 'border-red-200' : 'border-zinc-200'} shadow-sm p-6 hover:border-terracotta-400 cursor-pointer transition-colors relative overflow-hidden`}
               >
                  {isHighRisk(guest) && <div className="absolute top-0 inset-x-0 h-1 bg-red-500"></div>}
                  <div className="flex justify-between items-start mb-4">
                     <div className="flex items-center overflow-hidden pr-2">
                        <div className="h-10 w-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 font-bold text-sm flex-shrink-0">
                           {guest.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="ml-3 truncate">
                           <h3 className="text-base font-bold text-zinc-900 flex items-center truncate">
                              {guest.name}
                              {isVip(guest) && <Star className="h-4 w-4 text-amber-400 ml-1.5 fill-current flex-shrink-0" />}
                           </h3>
                           <p className="text-xs text-zinc-500 truncate">{guest.phone}</p>
                        </div>
                     </div>
                     {isHighRisk(guest) ? (
                        <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center uppercase tracking-wider flex-shrink-0">
                           <AlertTriangle className="h-3 w-3 mr-1" /> Risk
                        </span>
                     ) : isVip(guest) ? (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">VIP</span>
                     ) : null}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 border-y border-zinc-100 py-3 mb-3">
                     <div className="text-center">
                        <p className="text-lg font-bold text-zinc-900">{guest.visit_count}</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">Visits</p>
                     </div>
                     <div className="text-center border-l border-zinc-100">
                        <p className={`text-lg font-bold ${guest.no_show_count > 0 ? 'text-red-600' : 'text-zinc-900'}`}>{guest.no_show_count}</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">No-Shows</p>
                     </div>
                     <div className="text-center border-l border-zinc-100">
                        <p className="text-lg font-bold text-zinc-900">${guest.estimated_spend || 0}</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">Value</p>
                     </div>
                  </div>

                  <div>
                     <div className="flex flex-wrap gap-1.5">
                        {guest.dietary_notes && <span className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-widest rounded border border-blue-100">Dietary</span>}
                        {guest.accessibility_notes && <span className="px-2 py-1 bg-purple-50 text-purple-700 text-[10px] font-bold uppercase tracking-widest rounded border border-purple-100">Access</span>}
                        {!guest.dietary_notes && !guest.accessibility_notes && <span className="text-xs text-zinc-400 italic">No special alerts</span>}
                     </div>
                  </div>
               </div>
             ))}
          </div>
        )}
      </div>

      {/* GUEST DETAIL DRAWER */}
      {selectedGuest && (
        <div className="fixed inset-y-0 right-0 w-[400px] bg-white border-l border-zinc-200 shadow-2xl z-40 transform transition-transform duration-300 flex flex-col pt-16">
          <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-100 bg-zinc-50">
             <div>
               <h2 className="text-lg font-bold text-zinc-900 tracking-tight flex items-center">
                 {selectedGuest.name}
                 {isVip(selectedGuest) && <Star className="h-4 w-4 text-amber-400 ml-2 fill-current" />}
               </h2>
               <p className="text-xs text-zinc-500 font-medium">{selectedGuest.phone}</p>
             </div>
             <button onClick={() => setSelectedGuest(null)} className="p-2 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 rounded-full transition-colors">
                <X className="h-5 w-5" />
             </button>
          </div>
          
          <form onSubmit={handleUpdate} className="flex-1 flex flex-col overflow-hidden">
             <div className="flex-1 overflow-y-auto w-full p-6 space-y-8 bg-zinc-50/30">
                
                {/* Guest CRM Data */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 border-b border-zinc-200 pb-2">Profile Details</h3>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">Email</label>
                    <input name="email" type="email" defaultValue={selectedGuest.email} className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" placeholder="guest@email.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">Dietary Requirements</label>
                    <textarea name="dietary_notes" defaultValue={selectedGuest.dietary_notes} rows={2} className="w-full border border-blue-200 bg-blue-50/30 rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="e.g. Vegan, Gluten-free..." />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">Accessibility Notes</label>
                    <input name="accessibility_notes" type="text" defaultValue={selectedGuest.accessibility_notes} className="w-full border border-purple-200 bg-purple-50/30 rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="Wheelchair access needed..." />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">Family / Seating Prefs</label>
                    <input name="family_notes" type="text" defaultValue={selectedGuest.family_notes} className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" placeholder="High chair required, booth..." />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">Internal Staff Notes</label>
                    <textarea name="notes" defaultValue={selectedGuest.notes} rows={3} className="w-full border border-zinc-200 bg-white rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" placeholder="Usually orders the expensive wine..." />
                  </div>
                </div>

                {/* Booking History */}
                <div>
                   <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 border-b border-zinc-200 pb-2">Reservation History</h3>
                   {guestReservations.length === 0 ? (
                      <p className="text-xs text-zinc-500 italic">No historical reservations found.</p>
                   ) : (
                      <div className="space-y-3">
                         {guestReservations.map(res => (
                            <div key={res.id} className="flex items-center justify-between bg-white border border-zinc-200 p-3 rounded-lg shadow-sm">
                               <div>
                                  <p className="text-sm font-bold text-zinc-900">{res.date}</p>
                                  <p className="text-xs text-zinc-500">{res.time} • v.{res.party_size}</p>
                               </div>
                               <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                                 res.status === 'completed' ? 'bg-green-100 text-green-800' :
                                 res.status === 'cancelled' || res.status === 'no_show' ? 'bg-red-100 text-red-800' :
                                 'bg-zinc-100 text-zinc-800'
                               }`}>
                                 {res.status.replace('_', ' ')}
                               </span>
                            </div>
                         ))}
                      </div>
                   )}
                </div>

             </div>
             <div className="p-6 border-t border-zinc-100 bg-white flex space-x-3">
                <button 
                   type="submit"
                   disabled={saving}
                   className="flex-1 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-50 text-sm"
                >
                   <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save Profile"}
                </button>
             </div>
          </form>
        </div>
      )}
    </div>
  );
}
