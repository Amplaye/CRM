"use client";

import { ReservationList } from "@/components/reservations/ReservationList";
import { ReservationTimeline } from "@/components/reservations/ReservationTimeline";
import { Plus, SlidersHorizontal, Download, X, Save, Clock, Menu } from "lucide-react";
import { useState } from "react";
import { Reservation, ReservationStatus } from "@/lib/types";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createReservationAction, updateReservationDetailsAction } from "@/app/actions/reservations";

export default function ReservationsPage() {
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [viewMode, setViewMode] = useState<"list" | "timeline">("list");

  const { t } = useLanguage();
  const { activeTenant } = useTenant();

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeTenant || !selectedRes) return;

    setSaving(true);
    const formData = new FormData(e.currentTarget);
    try {
      const res = await updateReservationDetailsAction({
        tenantId: activeTenant.id,
        reservationId: selectedRes.id,
        data: {
          status: formData.get("status") as ReservationStatus,
          date: formData.get("date") as string,
          time: formData.get("time") as string,
          party_size: Number(formData.get("party_size")),
          notes: formData.get("notes") as string
        }
      });

      if (!res.success) throw new Error(res.error);
      setSelectedRes(null);
    } catch (err: any) {
      alert("Failed to update: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeTenant) return;

    setSaving(true);
    const formData = new FormData(e.currentTarget);
    try {
      const res = await createReservationAction({
        tenantId: activeTenant.id,
        guestName: formData.get("guestName") as string,
        guestPhone: formData.get("guestPhone") as string,
        date: formData.get("date") as string,
        time: formData.get("time") as string,
        partySize: Number(formData.get("partySize")),
        source: "staff",
        notes: (formData.get("notes") as string) || ""
      });

      if (!res.success) throw new Error(res.error);
      setIsCreating(false);
    } catch (err: any) {
      alert("Failed to create booking: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 w-full space-y-8 flex">
      <div className={`flex-1 transition-all duration-300 ${(selectedRes || isCreating) ? 'pr-[400px]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">{t("res_title")}</h1>
            <p className="mt-1 text-sm text-black">{t("res_subtitle")}</p>
          </div>
          <div className="mt-4 sm:mt-0 flex space-x-3">
             <button className="inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <Download className="-ml-1 mr-2 h-4 w-4" /> {t("res_export")}
             </button>
             <button
               onClick={() => { setSelectedRes(null); setIsCreating(true); }}
               className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"
             >
                <Plus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                {t("res_new")}
             </button>
          </div>
        </div>

        <div className="p-4 flex flex-col sm:flex-row items-center justify-between border-b rounded-t-xl hidden md:flex border-x border-t border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
           <div className="flex space-x-4 items-center">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-2 rounded-md px-3 py-1.5 text-sm font-medium text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none shadow-sm"
                style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
              />
              <div className="flex p-1 rounded-lg border-2 ml-4" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-3 py-1 text-sm font-medium rounded-md flex items-center transition-colors ${viewMode === 'list' ? 'text-black shadow-sm' : 'text-black'}`}
                  style={viewMode === 'list' ? { background: 'rgba(252,246,237,0.85)' } : {}}
                >
                  <Menu className="w-4 h-4 mr-1.5" /> List
                </button>
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`px-3 py-1 text-sm font-medium rounded-md flex items-center transition-colors ${viewMode === 'timeline' ? 'text-black shadow-sm' : 'text-black'}`}
                  style={viewMode === 'timeline' ? { background: 'rgba(252,246,237,0.85)' } : {}}
                >
                  <Clock className="w-4 h-4 mr-1.5" /> Timeline
                </button>
              </div>
           </div>
           <button className="flex items-center text-sm font-medium text-black hover:text-black px-3 py-1.5 border border-transparent hover:bg-[#c4956a]/10 rounded-md transition-colors">
              <SlidersHorizontal className="h-4 w-4 mr-2" /> {t("res_filters")}
           </button>
        </div>

        {viewMode === "list" ? (
          <ReservationList
            date={date}
            onRowClick={(res) => { setIsCreating(false); setSelectedRes(res); }}
          />
        ) : (
          <ReservationTimeline
            date={date}
            onRowClick={(res) => { setIsCreating(false); setSelectedRes(res); }}
          />
        )}
      </div>

      {/* QUICK STATUS EDIT DRAWER */}
      {selectedRes && (
        <div className="fixed inset-y-0 right-0 w-[400px] border-l shadow-2xl z-40 transform transition-transform duration-300 flex flex-col pt-16" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <h2 className="text-lg font-bold text-zinc-900 tracking-tight">{t("res_quick_edit")}</h2>
             <button onClick={() => setSelectedRes(null)} className="p-2 text-black hover:bg-[#c4956a]/10 hover:text-black rounded-full transition-colors">
                <X className="h-5 w-5" />
             </button>
          </div>
          <form onSubmit={handleUpdate} className="flex-1 flex flex-col">
             <div className="flex-1 overflow-y-auto w-full p-6 space-y-6 bg-transparent">
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_status")}</label>
                   <select
                     name="status"
                     defaultValue={selectedRes.status}
                     className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a] font-medium" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                   >
                      <option value="pending_confirmation">Pending Confirmation</option>
                      <option value="confirmed">{t("status_confirmed")}</option>
                      <option value="seated">{t("status_seated")}</option>
                      <option value="completed">{t("status_completed")}</option>
                      <option value="cancelled">{t("status_cancelled")}</option>
                      <option value="no_show">{t("status_no_show")}</option>
                   </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-sm font-medium text-black mb-1">{t("res_edit_date")}</label>
                     <input name="date" type="date" defaultValue={selectedRes.date} className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-black mb-1">{t("res_edit_time")}</label>
                     <input name="time" type="time" defaultValue={selectedRes.time} className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                   </div>
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_party")}</label>
                   <input name="party_size" type="number" defaultValue={selectedRes.party_size} className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_notes")}</label>
                   <textarea
                     name="notes"
                     defaultValue={selectedRes.notes}
                     rows={4}
                     className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                     placeholder={t("res_edit_placeholder")}
                   />
                </div>
             </div>
             <div className="p-6 border-t" style={{ borderColor: '#c4956a' }}>
                <button
                   type="submit"
                   disabled={saving}
                   className="w-full flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                   <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : t("res_edit_save")}
                </button>
             </div>
          </form>
        </div>
      )}

      {/* NEW RESERVATION DRAWER */}
      {isCreating && (
        <div className="fixed inset-y-0 right-0 w-[400px] border-l shadow-2xl z-40 transform transition-transform duration-300 flex flex-col pt-16" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <h2 className="text-lg font-bold text-zinc-900 tracking-tight">New Walk-in / Booking</h2>
             <button onClick={() => setIsCreating(false)} className="p-2 text-black hover:bg-[#c4956a]/10 hover:text-black rounded-full transition-colors">
                <X className="h-5 w-5" />
             </button>
          </div>
          <form onSubmit={handleCreate} className="flex-1 flex flex-col">
             <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-transparent">
                <div className="bg-blue-50 text-blue-800 text-sm p-3 rounded-md border border-blue-100 mb-4 font-medium">
                  This transaction will automatically create or link a Guest profile natively.
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">Guest Name</label>
                   <input required name="guestName" type="text" placeholder="John Doe" className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>
                <div>
                   <label className="block text-sm font-medium text-black mb-1">Guest Phone</label>
                   <input required name="guestPhone" type="tel" placeholder="+1 555-0192" className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                   <div>
                     <label className="block text-sm font-medium text-black mb-1">Date</label>
                     <input required name="date" type="date" defaultValue={date} className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-black mb-1">Time</label>
                     <input required name="time" type="time" defaultValue="19:00" className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                   </div>
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">Party Size</label>
                   <input required name="partySize" type="number" min="1" max="20" defaultValue="2" className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">Notes</label>
                   <textarea
                     name="notes"
                     rows={3}
                     className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                     placeholder="Allergies, special occasions..."
                   />
                </div>
             </div>
             <div className="p-6 border-t" style={{ borderColor: '#c4956a' }}>
                <button
                   type="submit"
                   disabled={saving}
                   className="w-full flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                   <Save className="h-4 w-4 mr-2" /> {saving ? "Creating..." : "Create Reservation"}
                </button>
             </div>
          </form>
        </div>
      )}
    </div>
  );
}
