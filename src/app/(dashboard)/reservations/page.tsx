"use client";

import { ReservationList } from "@/components/reservations/ReservationList";
import { ReservationTimeline } from "@/components/reservations/ReservationTimeline";
import { Plus, Download, Upload, X, Save, Clock, Menu, Phone, ChevronLeft, ChevronRight } from "lucide-react";
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
import { useSearchParams } from "next/navigation";

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

  const searchParams = useSearchParams();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(searchParams.get('date') || today);

  // React to URL date changes (e.g. from notifications)
  useEffect(() => {
    const urlDate = searchParams.get('date');
    if (urlDate && urlDate !== date) setDate(urlDate);
  }, [searchParams]);

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().split('T')[0]);
  };
  const [viewMode, setViewMode] = useState<"list" | "timeline">("list");

  const { t, language } = useLanguage();
  const { activeTenant } = useTenant();

  const [availableTables, setAvailableTables] = useState<RestaurantTable[]>([]);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());
  const [createShift, setCreateShift] = useState<"lunch" | "dinner">("dinner");
  const [createDate, setCreateDate] = useState(date);
  const supabase = createClient();

  const shiftTimes = {
    lunch: ["12:30", "12:45", "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30"],
    dinner: ["19:30", "19:45", "20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30", "21:45", "22:00", "22:15", "22:30"],
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!activeTenant) return;
    const { data: reservations } = await supabase
      .from('reservations')
      .select('*, guests(name, phone)')
      .eq('tenant_id', activeTenant.id)
      .eq('date', date);

    if (!reservations || reservations.length === 0) {
      alert(t('res_no_export'));
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
      alert(t('res_csv_error'));
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

    alert(t('res_imported').replace('{count}', String(imported)));
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

      // Fetch occupied tables for the date being created
      const checkDate = isCreating ? createDate : date;
      const { data: resData } = await supabase
        .from("reservations")
        .select("id")
        .eq("tenant_id", activeTenant.id)
        .eq("date", checkDate)
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
  }, [activeTenant, date, createDate, isCreating]);

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

    // Capacity check: warn if selected tables have fewer seats than party size
    const partySize = Number(formData.get("partySize"));
    if (selectedTableIds.length > 0) {
      const totalSeats = selectedTableIds.reduce((sum, tableId) => {
        const table = availableTables.find(t => t.id === tableId);
        return sum + (table?.seats || 0);
      }, 0);
      if (totalSeats < partySize) {
        const confirmed = window.confirm(
          t('res_table_confirm').replace('{seats}', String(totalSeats)).replace('{size}', String(partySize))
        );
        if (!confirmed) { setSaving(false); return; }
      }
    }

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
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div className={`flex-1 transition-all duration-300 ${(selectedRes || isCreating) ? 'md:pr-[400px]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 lg:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-black tracking-tight">{t("res_title")}</h1>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-black">{t("res_subtitle")}</p>
          </div>
          <div className="mt-3 sm:mt-0 flex flex-wrap gap-2 sm:space-x-3">
             <button onClick={handleExport} className="hidden sm:inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <Download className="-ml-1 mr-2 h-4 w-4" /> {t("res_export")}
             </button>
             <button onClick={() => fileInputRef.current?.click()} className="hidden sm:inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <Upload className="-ml-1 mr-2 h-4 w-4" /> {t("res_import")}
             </button>
             <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
             <button
               onClick={() => { setSelectedRes(null); setIsCreating(true); setCreateDate(date); setSelectedTableIds([]); }}
               className="inline-flex items-center px-3 sm:px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"
             >
                <Plus className="-ml-1 mr-1.5 sm:mr-2 h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
                {t("res_new")}
             </button>
          </div>
        </div>

        {/* Mobile controls */}
        <div className="md:hidden flex items-center gap-2 mb-3">
          <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg border-2 hover:bg-[#c4956a]/10" style={{ borderColor: '#c4956a' }}>
            <ChevronLeft className="w-4 h-4 text-black" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 border-2 rounded-lg px-3 py-2 text-sm font-medium text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none"
            style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
          />
          <button onClick={() => shiftDate(1)} className="p-2 rounded-lg border-2 hover:bg-[#c4956a]/10" style={{ borderColor: '#c4956a' }}>
            <ChevronRight className="w-4 h-4 text-black" />
          </button>
          <div className="flex p-0.5 rounded-lg border-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'text-white' : 'text-black'}`}
              style={{ background: viewMode === 'list' ? '#c4956a' : 'transparent' }}
            >
              <Menu className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              className={`p-2 rounded-md transition-colors ${viewMode === 'timeline' ? 'text-white' : 'text-black'}`}
              style={{ background: viewMode === 'timeline' ? '#c4956a' : 'transparent' }}
            >
              <Clock className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Desktop controls */}
        <div className="p-4 flex flex-col sm:flex-row items-center justify-between border-b rounded-t-xl hidden md:flex border-x border-t border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
           <div className="flex space-x-4 items-center">
              <button onClick={() => shiftDate(-1)} className="p-1.5 rounded-lg hover:bg-[#c4956a]/10 transition-colors">
                <ChevronLeft className="w-5 h-5 text-black" />
              </button>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-2 rounded-md px-3 py-1.5 text-sm font-medium text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none shadow-sm"
                style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
              />
              <button onClick={() => shiftDate(1)} className="p-1.5 rounded-lg hover:bg-[#c4956a]/10 transition-colors">
                <ChevronRight className="w-5 h-5 text-black" />
              </button>
              <div className="flex p-1 rounded-lg border-2 ml-4" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-3 py-1 text-sm font-semibold rounded-md flex items-center transition-colors ${viewMode === 'list' ? 'text-white' : 'text-black'}`}
                  style={{ background: viewMode === 'list' ? '#c4956a' : 'transparent' }}
                >
                  <Menu className="w-4 h-4 mr-1.5" /> {t("res_list")}
                </button>
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`px-3 py-1 text-sm font-semibold rounded-md flex items-center transition-colors ${viewMode === 'timeline' ? 'text-white' : 'text-black'}`}
                  style={{ background: viewMode === 'timeline' ? '#c4956a' : 'transparent' }}
                >
                  <Clock className="w-4 h-4 mr-1.5" /> {t("res_timeline")}
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
      {selectedRes && (() => {
        const inputCls = "block w-full border-2 rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#c4956a]";
        const inputStyle: React.CSSProperties = { borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)', maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none' as const, MozAppearance: 'none' as const };
        return (
        <>
        <div className="fixed inset-0 bg-black/40 z-30 sm:hidden" onClick={() => setSelectedRes(null)} />
        <div className="fixed top-14 left-0 right-0 bottom-0 sm:top-0 sm:left-auto sm:right-0 sm:w-[400px] border-l shadow-2xl z-40 flex flex-col overflow-hidden" style={{ background: 'rgb(252,246,237)', borderColor: '#c4956a' }}>
          <div className="mx-5 sm:mx-6 pt-2 pb-2 sm:py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <div className="min-w-0 flex-1 mr-3">
               <h2 className="text-base sm:text-lg font-bold text-black tracking-tight">{t("res_quick_edit")}</h2>
               {(selectedRes.guest_name || selectedRes.guest_phone) && (
                 <div className="mt-0.5">
                   {selectedRes.guest_name && <p className="text-sm font-medium text-black">{selectedRes.guest_name}</p>}
                   {selectedRes.guest_phone && (
                     <p className="flex items-center gap-1 text-sm text-black mt-0.5">
                       <Phone className="w-3.5 h-3.5 flex-shrink-0" />{selectedRes.guest_phone}
                     </p>
                   )}
                 </div>
               )}
             </div>
             <button onClick={() => setSelectedRes(null)} className="p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                <X className="h-4 w-4" />
             </button>
          </div>
          <form onSubmit={handleUpdate} className="flex-1 flex flex-col min-h-0 overflow-hidden">
             <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-3 sm:py-5 space-y-3 sm:space-y-4">
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_status")}</label>
                   <select name="status" defaultValue={selectedRes.status} className={inputCls} style={inputStyle}>
                      <option value="pending_confirmation">{t("res_pending_confirmation")}</option>
                      <option value="confirmed">{t("status_confirmed")}</option>
                      <option value="seated">{t("status_seated")}</option>
                      <option value="completed">{t("status_completed")}</option>
                      <option value="cancelled">{t("status_cancelled")}</option>
                      <option value="no_show">{t("status_no_show")}</option>
                   </select>
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_date")}</label>
                   <input name="date" type="date" defaultValue={selectedRes.date} className={inputCls} style={inputStyle} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_time")}</label>
                   <input name="time" type="time" defaultValue={selectedRes.time} className={inputCls} style={inputStyle} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_party")}</label>
                   <input name="party_size" type="number" defaultValue={selectedRes.party_size} className={inputCls} style={inputStyle} />
                </div>

                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_notes")}</label>
                   <textarea name="notes" defaultValue={selectedRes.notes} rows={2}
                     className={`${inputCls} sm:rows-4`} style={inputStyle}
                     placeholder={t("res_edit_placeholder")}
                   />
                   <style>{`@media (min-width: 640px) { textarea[name="notes"] { min-height: 120px; } }`}</style>
                </div>
             </div>
             <div className="mx-5 sm:mx-6 py-2 sm:py-4 pb-4 sm:pb-4 border-t" style={{ borderColor: '#c4956a' }}>
                <button type="submit" disabled={saving}
                   className="w-full flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                   <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : t("res_edit_save")}
                </button>
             </div>
          </form>
        </div>
        </>
        );
      })()}

      {/* NEW RESERVATION DRAWER */}
      {isCreating && (
        <>
        <div className="fixed inset-0 bg-black/40 z-30 sm:hidden" onClick={() => setIsCreating(false)} />
        <div className="fixed top-14 left-0 right-0 bottom-0 sm:top-0 sm:left-auto sm:right-0 sm:w-[400px] border-l shadow-2xl z-40 flex flex-col overflow-hidden" style={{ background: 'rgb(252,246,237)', borderColor: '#c4956a' }}>
          <div className="mx-5 sm:mx-6 pt-2 pb-2 sm:py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
             <h2 className="text-base sm:text-lg font-bold text-black tracking-tight">{t("res_new")}</h2>
             <button onClick={() => setIsCreating(false)} className="p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                <X className="h-4 w-4" />
             </button>
          </div>
          {(() => {
            const iCls = "w-full border-2 rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#c4956a] box-border";
            const iSty = { borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' };
            return (
          <form onSubmit={handleCreate} className="flex-1 flex flex-col min-h-0">
             <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_col_guest")}</label>
                   <input required name="guestName" type="text" placeholder={t("auth_name_placeholder")} className={iCls} style={iSty} />
                </div>
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_phone")}</label>
                   <input required name="guestPhone" type="tel" placeholder="+34 600 000 000" className={iCls} style={iSty} />
                </div>
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_date")}</label>
                   <input required name="date" type="date" value={createDate} onChange={(e) => { setCreateDate(e.target.value); setSelectedTableIds([]); }} className={iCls} style={iSty} />
                </div>
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("floor_lunch")} / {t("floor_dinner")}</label>
                   <input type="hidden" name="shift" value={createShift} />
                   <div className="flex border-2 rounded-lg overflow-hidden" style={{ borderColor: '#c4956a' }}>
                     <button type="button" onClick={() => setCreateShift("lunch")}
                       className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${createShift === "lunch" ? "bg-[#c4956a] text-white" : "text-black"}`}
                       style={createShift !== "lunch" ? { background: 'rgba(252,246,237,0.6)' } : undefined}>
                       {t("floor_lunch")}
                     </button>
                     <button type="button" onClick={() => setCreateShift("dinner")}
                       className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${createShift === "dinner" ? "bg-[#c4956a] text-white" : "text-black"}`}
                       style={createShift !== "dinner" ? { background: 'rgba(252,246,237,0.6)' } : undefined}>
                       {t("floor_dinner")}
                     </button>
                   </div>
                </div>
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_time")}</label>
                   <select required name="time" defaultValue={createShift === "lunch" ? "13:00" : "20:00"} className={iCls} style={iSty}>
                     {shiftTimes[createShift].map(time => (
                       <option key={time} value={time}>{time}</option>
                     ))}
                   </select>
                </div>
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_party")}</label>
                   <input required name="partySize" type="number" min="1" max="20" defaultValue="2" className={iCls} style={iSty} />
                </div>
                {availableTables.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-black mb-2">{t("floor_tables")} <span className="text-xs font-normal text-black">(Opcional)</span></label>
                    <div className="grid grid-cols-4 gap-2">
                      {availableTables.map(table => {
                        const isOccupied = occupiedTableIds.has(table.id);
                        const isSelected = selectedTableIds.includes(table.id);
                        return (
                          <button key={table.id} type="button" disabled={isOccupied}
                            onClick={() => !isOccupied && toggleTable(table.id)}
                            className={`py-2 px-1 text-xs font-semibold rounded-lg border-2 transition-colors ${
                              isOccupied ? "border-red-400 text-red-400 opacity-50 cursor-not-allowed"
                                : isSelected ? "border-green-500 bg-green-500 text-white"
                                  : "border-[#c4956a] text-black"
                            }`}
                            style={!isOccupied && !isSelected ? { background: 'rgba(252,246,237,0.6)' } : undefined}>
                            {table.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                   <label className="block text-sm font-medium text-black mb-1">{t("res_edit_notes")}</label>
                   <textarea name="notes" rows={3} className={iCls} style={iSty} placeholder={t("res_edit_placeholder")} />
                </div>
             </div>
             <div className="px-4 sm:px-6 py-3 sm:py-4 pb-6 sm:pb-4 border-t" style={{ borderColor: '#c4956a' }}>
                <button type="submit" disabled={saving}
                   className="w-full flex items-center justify-center text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                   style={{ background: 'linear-gradient(135deg, #c4956a, #a0764e)' }}>
                   <Save className="h-4 w-4 mr-2" /> {saving ? "..." : t("res_new")}
                </button>
             </div>
          </form>
            );
          })()}
        </div>
        </>
      )}
    </div>
  );
}
