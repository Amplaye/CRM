"use client";

import { ReservationList } from "@/components/reservations/ReservationList";
import { ReservationTimeline } from "@/components/reservations/ReservationTimeline";
import { Plus, Download, Upload, X, Save, Clock, Menu, Phone } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Reservation, ReservationStatus } from "@/lib/types";

interface ReservationWithGuest extends Reservation {
  guest_name?: string;
  guest_phone?: string;
}
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createReservationAction, updateReservationDetailsAction } from "@/app/actions/reservations";
import { createClient } from "@/lib/supabase/client";

const downloadCSV = (data: string[][], filename: string) => {
  const csv = data.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const parseCSV = (text: string): string[][] => {
  const lines = text.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += char; }
    }
    result.push(current.trim());
    return result;
  });
};

interface RestaurantTable {
  id: string;
  name: string;
  seats: number;
  status: "active" | "inactive";
}

export default function ReservationsPage() {
  const [selectedRes, setSelectedRes] = useState<ReservationWithGuest | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [viewMode, setViewMode] = useState<"list" | "timeline">("list");

  const { t } = useLanguage();
  const { activeTenant } = useTenant();

  const [availableTables, setAvailableTables] = useState<RestaurantTable[]>([]);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!activeTenant) return;
    const { data: reservations } = await supabase
      .from('reservations')
      .select('*, guests(name, phone)')
      .eq('tenant_id', activeTenant.id)
      .eq('date', date);

    if (!reservations || reservations.length === 0) {
      alert('No reservations to export for this date');
      return;
    }

    // Fetch table assignments for these reservations
    const resIds = reservations.map((r: any) => r.id);
    const { data: tableLinks } = await supabase
      .from('reservation_tables')
      .select('reservation_id, restaurant_tables(name)')
      .in('reservation_id', resIds);

    const tableMap: Record<string, string[]> = {};
    if (tableLinks) {
      for (const link of tableLinks as any[]) {
        const rid = link.reservation_id;
        const tname = link.restaurant_tables?.name || '';
        if (!tableMap[rid]) tableMap[rid] = [];
        if (tname) tableMap[rid].push(tname);
      }
    }

    const headers = ['Date', 'Time', 'Guest Name', 'Phone', 'Party Size', 'Status', 'Source', 'Tables', 'Notes'];
    const rows = reservations.map((r: any) => [
      r.date,
      r.time,
      r.guests?.name || '',
      r.guests?.phone || '',
      String(r.party_size),
      r.status,
      r.source || '',
      (tableMap[r.id] || []).join('; '),
      r.notes || ''
    ]);
    downloadCSV([headers, ...rows], `reservations_export_${date}.csv`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTenant) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return;

    const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const dateIdx = headers.indexOf('date');
    const timeIdx = headers.indexOf('time');
    const nameIdx = headers.indexOf('guest_name');
    const phoneIdx = headers.indexOf('phone');
    const partyIdx = headers.indexOf('party_size');
    const notesIdx = headers.indexOf('notes');

    if (dateIdx === -1 || timeIdx === -1 || nameIdx === -1 || phoneIdx === -1) {
      alert('CSV must have Date, Time, Guest Name, and Phone columns');
      return;
    }

    let imported = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rDate = row[dateIdx]?.trim();
      const rTime = row[timeIdx]?.trim();
      const gName = row[nameIdx]?.trim();
      const gPhone = row[phoneIdx]?.trim();
      const partySize = partyIdx !== -1 ? parseInt(row[partyIdx]?.trim()) || 2 : 2;
      const notes = notesIdx !== -1 ? row[notesIdx]?.trim() || '' : '';

      if (!rDate || !rTime || !gName || !gPhone) continue;

      try {
        const res = await createReservationAction({
          tenantId: activeTenant.id,
          guestName: gName,
          guestPhone: gPhone,
          date: rDate,
          time: rTime,
          partySize: partySize,
          source: 'staff',
          notes
        });
        if (res.success) imported++;
      } catch (err) {
        console.error('Import row error:', err);
      }
    }

    alert(`Imported ${imported} reservations`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Fetch tables + occupied tables for selected date
  useEffect(() => {
    if (!activeTenant) return;
    const fetchTables = async () => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id, name, seats, status")
        .eq("tenant_id", activeTenant.id)
        .eq("status", "active")
        .order("name");
      const sorted = ((data || []) as RestaurantTable[]).sort((a, b) => {
        const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
        return numA - numB;
      });
      setAvailableTables(sorted);

      // Fetch occupied tables for the selected date
      const { data: resData } = await supabase
        .from("reservations")
        .select("id")
        .eq("tenant_id", activeTenant.id)
        .eq("date", date)
        .in("status", ["confirmed", "seated", "pending_confirmation"]);

      const resIds = (resData || []).map((r: any) => r.id);
      if (resIds.length > 0) {
        const { data: links } = await supabase
          .from("reservation_tables")
          .select("table_id")
          .in("reservation_id", resIds);
        setOccupiedTableIds(new Set((links || []).map((l: any) => l.table_id)));
      } else {
        setOccupiedTableIds(new Set());
      }
    };
    fetchTables();
  }, [activeTenant, date]);

  const toggleTable = (tableId: string) => {
    setSelectedTableIds(prev =>
      prev.includes(tableId) ? prev.filter(id => id !== tableId) : [...prev, tableId]
    );
  };

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
      const shift = formData.get("shift") as string || "dinner";
      const res = await createReservationAction({
        tenantId: activeTenant.id,
        guestName: formData.get("guestName") as string,
        guestPhone: formData.get("guestPhone") as string,
        date: formData.get("date") as string,
        time: formData.get("time") as string,
        partySize: Number(formData.get("partySize")),
        source: "staff",
        notes: (formData.get("notes") as string) || "",
        shift
      });

      if (!res.success) throw new Error(res.error);

      // Assign selected tables to the new reservation
      if (selectedTableIds.length > 0 && res.reservationId) {
        const tableInserts = selectedTableIds.map(tableId => ({
          reservation_id: res.reservationId,
          table_id: tableId,
        }));
        const { error: tableErr } = await supabase
          .from("reservation_tables")
          .insert(tableInserts);
        if (tableErr) console.error("Failed to assign tables:", tableErr);
      }

      setSelectedTableIds([]);
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
             <button onClick={handleExport} className="inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <Download className="-ml-1 mr-2 h-4 w-4" /> {t("res_export")}
             </button>
             <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <Upload className="-ml-1 mr-2 h-4 w-4" /> Import
             </button>
             <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
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
                  className={`px-3 py-1 text-sm font-semibold rounded-md flex items-center transition-colors ${viewMode === 'list' ? 'text-white' : 'text-black'}`}
                  style={{ background: viewMode === 'list' ? '#c4956a' : 'transparent' }}
                >
                  <Menu className="w-4 h-4 mr-1.5" /> List
                </button>
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`px-3 py-1 text-sm font-semibold rounded-md flex items-center transition-colors ${viewMode === 'timeline' ? 'text-white' : 'text-black'}`}
                  style={{ background: viewMode === 'timeline' ? '#c4956a' : 'transparent' }}
                >
                  <Clock className="w-4 h-4 mr-1.5" /> Timeline
                </button>
              </div>
           </div>
        </div>

        {viewMode === "list" ? (
          <ReservationList
            date={date}
            onRowClick={(res) => { setIsCreating(false); setSelectedRes(res as ReservationWithGuest); }}
          />
        ) : (
          <ReservationTimeline
            date={date}
            onRowClick={(res) => { setIsCreating(false); setSelectedRes(res as ReservationWithGuest); }}
          />
        )}
      </div>

      {/* QUICK STATUS EDIT DRAWER */}
      {selectedRes && (
        <div className="fixed inset-y-0 right-0 w-[400px] border-l shadow-2xl z-40 transform transition-transform duration-300 flex flex-col pt-16 overflow-hidden" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <div>
               <h2 className="text-lg font-bold text-zinc-900 tracking-tight">{t("res_quick_edit")}</h2>
               {(selectedRes.guest_name || selectedRes.guest_phone) && (
                 <div className="flex items-center gap-2 mt-1">
                   {selectedRes.guest_name && <span className="text-sm font-medium text-black">{selectedRes.guest_name}</span>}
                   {selectedRes.guest_phone && (
                     <span className="flex items-center text-xs text-black/60">
                       <Phone className="w-3 h-3 mr-1" />{selectedRes.guest_phone}
                     </span>
                   )}
                 </div>
               )}
             </div>
             <button onClick={() => setSelectedRes(null)} className="p-2 text-black hover:bg-[#c4956a]/10 hover:text-black rounded-full transition-colors">
                <X className="h-5 w-5" />
             </button>
          </div>
          <form onSubmit={handleUpdate} className="flex-1 flex flex-col min-h-0">
             <div className="flex-1 overflow-y-auto w-full p-6 space-y-6">
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
        <div className="fixed inset-y-0 right-0 w-[400px] border-l shadow-2xl z-40 transform transition-transform duration-300 flex flex-col pt-16 overflow-hidden" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <h2 className="text-lg font-bold text-zinc-900 tracking-tight">New Walk-in / Booking</h2>
             <button onClick={() => setIsCreating(false)} className="p-2 text-black hover:bg-[#c4956a]/10 hover:text-black rounded-full transition-colors">
                <X className="h-5 w-5" />
             </button>
          </div>
          <form onSubmit={handleCreate} className="flex-1 flex flex-col min-h-0">
             <div className="flex-1 overflow-y-auto p-6 space-y-5">
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

                <div>
                   <label className="block text-sm font-medium text-black mb-1">Date</label>
                   <input required name="date" type="date" defaultValue={date} className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-2">Shift</label>
                   <div className="flex border-2 rounded-lg overflow-hidden" style={{ borderColor: '#c4956a' }}>
                     <label className="flex-1 text-center">
                       <input type="radio" name="shift" value="lunch" className="sr-only peer" />
                       <div className="py-2 text-sm font-semibold cursor-pointer peer-checked:bg-[#c4956a] peer-checked:text-white text-black" style={{ background: 'rgba(252,246,237,0.6)' }}>
                         Lunch (12:30-15:30)
                       </div>
                     </label>
                     <label className="flex-1 text-center">
                       <input type="radio" name="shift" value="dinner" defaultChecked className="sr-only peer" />
                       <div className="py-2 text-sm font-semibold cursor-pointer peer-checked:bg-[#c4956a] peer-checked:text-white text-black" style={{ background: 'rgba(252,246,237,0.6)' }}>
                         Dinner (19:30-22:30)
                       </div>
                     </label>
                   </div>
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">Time</label>
                   <input required name="time" type="time" defaultValue="19:30" className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">Party Size</label>
                   <input required name="partySize" type="number" min="1" max="20" defaultValue="2" className="w-full border-2 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>

                {availableTables.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-black mb-2">Assign Tables</label>
                    <div className="border-2 rounded-lg p-3 space-y-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                      {availableTables.map(table => {
                        const isOccupied = occupiedTableIds.has(table.id);
                        return (
                          <label key={table.id} className={`flex items-center gap-2 text-sm ${isOccupied ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} text-black`}>
                            <input
                              type="checkbox"
                              checked={selectedTableIds.includes(table.id)}
                              onChange={() => !isOccupied && toggleTable(table.id)}
                              disabled={isOccupied}
                              className="rounded border-2 accent-[#c4956a]"
                              style={{ borderColor: '#c4956a' }}
                            />
                            <span className="font-medium">{table.name}</span>
                            <span className="text-xs text-zinc-500">
                              {isOccupied ? '(occupied)' : `(${table.seats} seats)`}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

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
