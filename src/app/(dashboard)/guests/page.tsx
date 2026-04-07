"use client";

import { Download, Upload, Search, X, CalendarCheck, User, LayoutGrid, List, Trash2, Phone } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState, useRef } from "react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Guest, Reservation } from "@/lib/types";
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

export default function GuestsPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = createClient();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestReservations, setGuestReservations] = useState<Reservation[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const headers = ['Name', 'Phone', 'Visits', 'No-Shows', 'Notes'];
    const rows = guests.map(g => [g.name, g.phone, String(g.visit_count), String(g.no_show_count), g.notes || '']);
    downloadCSV([headers, ...rows], 'guests_export.csv');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTenant) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return;
    const headers = rows[0].map(h => h.toLowerCase());
    const nameIdx = headers.indexOf('name');
    const phoneIdx = headers.indexOf('phone');
    if (nameIdx === -1 || phoneIdx === -1) { alert('CSV must have Name and Phone columns'); return; }
    let imported = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = row[nameIdx]?.trim();
      const phone = row[phoneIdx]?.trim();
      if (!name || !phone) continue;
      const { error } = await supabase.from('guests').insert({ tenant_id: activeTenant.id, name, phone, visit_count: 0, no_show_count: 0, cancellation_count: 0, tags: [], notes: '' });
      if (!error) imported++;
    }
    alert(`Imported ${imported} guests`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (!activeTenant) return;
    setLoading(true);
    const fetchGuests = async () => {
      const { data } = await supabase.from("guests").select("*").eq("tenant_id", activeTenant.id);
      setGuests((data || []) as Guest[]);
      setLoading(false);
    };
    fetchGuests();
    const channel = supabase.channel("guests_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests", filter: `tenant_id=eq.${activeTenant.id}` }, () => fetchGuests())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTenant]);

  useEffect(() => {
    if (!selectedGuest || !activeTenant) return;
    const fetchRes = async () => {
      const { data } = await supabase.from("reservations").select("*").eq("tenant_id", activeTenant.id).eq("guest_id", selectedGuest.id);
      const res = (data || []) as Reservation[];
      res.sort((a, b) => b.date.localeCompare(a.date));
      setGuestReservations(res);
    };
    fetchRes();
  }, [selectedGuest, activeTenant]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const selectAll = () => { selectedIds.size === guests.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(guests.map(g => g.id))); };
  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    setGuests(prev => prev.filter(g => !selectedIds.has(g.id)));
    if (selectedGuest && selectedIds.has(selectedGuest.id)) setSelectedGuest(null);
    setSelectedIds(new Set());
    await supabase.from("guests").delete().in("id", ids);
    setDeleting(false);
  };
  const deleteSingle = async (id: string) => {
    setGuests(prev => prev.filter(g => g.id !== id));
    if (selectedGuest?.id === id) setSelectedGuest(null);
    await supabase.from("guests").delete().eq("id", id);
  };

  const filtered = guests.filter(g => {
    if (!search) return true;
    const s = search.toLowerCase().trim();
    const name = (g.name || '').toLowerCase();
    const phone = (g.phone || '').replace(/\D/g, '');
    return name.includes(s) || phone.includes(s.replace(/\D/g, ''));
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className={`transition-all duration-300 ${selectedGuest ? 'pr-0 sm:pr-[400px]' : ''}`}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-black">{t("guests_title")}</h1>
            <p className="text-xs sm:text-sm text-black mt-0.5">{filtered.length} clientes</p>
          </div>
          <div className="mt-3 sm:mt-0 flex items-center gap-2">
            <div className="flex p-0.5 rounded-lg border-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
              <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-md transition-colors`} style={{ background: viewMode === 'grid' ? '#c4956a' : 'transparent' }}>
                <LayoutGrid className={`h-4 w-4 ${viewMode === 'grid' ? 'text-white' : 'text-black'}`} />
              </button>
              <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-md transition-colors`} style={{ background: viewMode === 'list' ? '#c4956a' : 'transparent' }}>
                <List className={`h-4 w-4 ${viewMode === 'list' ? 'text-white' : 'text-black'}`} />
              </button>
            </div>
            <button onClick={handleExport} className="inline-flex items-center px-3 py-2 border-2 text-xs font-medium rounded-lg text-black" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center px-3 py-2 border-2 text-xs font-medium rounded-lg text-black" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Importar
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </div>
        </div>

        {/* Search + bulk actions */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o teléfono..." className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
          </div>
          {filtered.length > 0 && (
            <button onClick={selectAll} className="text-xs font-medium text-black/60 hover:text-black">
              {selectedIds.size === guests.length ? 'Deseleccionar' : 'Seleccionar todo'}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={deleteSelected} disabled={deleting} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> Eliminar ({selectedIds.size})
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-sm text-black">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="border-2 rounded-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
            <User className="mx-auto h-12 w-12 text-zinc-300 mb-4" />
            <h3 className="text-sm font-medium text-black">{search ? 'Sin resultados' : 'Sin clientes'}</h3>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(guest => (
              <div key={guest.id} onClick={() => setSelectedGuest(guest)}
                className="rounded-xl border-2 p-4 hover:shadow-md cursor-pointer transition-all"
                style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0" style={{ background: 'rgba(196,149,106,0.2)' }}>
                      {guest.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-black truncate">{guest.name}</p>
                      <p className="text-xs text-black truncate">{guest.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); deleteSingle(guest.id); }} className="p-1 text-black/20 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    <input type="checkbox" checked={selectedIds.has(guest.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(guest.id); }} className="w-4 h-4 rounded accent-[#c4956a] cursor-pointer" />
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <div className="flex-1">
                    <p className="text-lg font-bold text-black">{guest.visit_count}</p>
                    <p className="text-[10px] text-black font-medium uppercase">Visitas</p>
                  </div>
                  <div className="flex-1 border-l" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
                    <p className={`text-lg font-bold ${guest.no_show_count > 0 ? 'text-red-600' : 'text-black'}`}>{guest.no_show_count}</p>
                    <p className="text-[10px] text-black font-medium uppercase">No-Shows</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-2 rounded-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
            <table className="min-w-full divide-y" style={{ borderColor: '#c4956a' }}>
              <thead>
                <tr>
                  <th className="px-3 py-3 w-10"></th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-black uppercase">Nombre</th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-black uppercase">Teléfono</th>
                  <th className="px-3 sm:px-6 py-3 text-center text-xs font-semibold text-black uppercase">Visitas</th>
                  <th className="px-3 sm:px-6 py-3 text-center text-xs font-semibold text-black uppercase">No-Shows</th>
                  <th className="px-3 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
                {filtered.map(guest => (
                  <tr key={guest.id} onClick={() => setSelectedGuest(guest)} className="hover:bg-[#c4956a]/10 transition-colors cursor-pointer">
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selectedIds.has(guest.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(guest.id); }} className="w-4 h-4 rounded accent-[#c4956a] cursor-pointer" />
                    </td>
                    <td className="px-3 sm:px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0" style={{ background: 'rgba(196,149,106,0.2)' }}>{guest.name.charAt(0).toUpperCase()}</div>
                        <span className="text-sm font-bold text-black">{guest.name}</span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-3 text-sm text-black">{guest.phone}</td>
                    <td className="px-3 sm:px-6 py-3 text-sm font-medium text-black text-center">{guest.visit_count}</td>
                    <td className="px-3 sm:px-6 py-3 text-sm font-medium text-center">
                      <span className={guest.no_show_count > 0 ? 'text-red-600' : 'text-black'}>{guest.no_show_count}</span>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={(e) => { e.stopPropagation(); deleteSingle(guest.id); }} className="p-1 text-black/20 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Guest Detail Drawer */}
      {selectedGuest && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[400px] border-l shadow-2xl z-40 flex flex-col" style={{ background: 'rgba(252,246,237,0.98)', borderColor: '#c4956a' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center text-black font-bold" style={{ background: 'rgba(196,149,106,0.2)' }}>
                {selectedGuest.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-black">{selectedGuest.name}</h2>
                <p className="text-xs text-black flex items-center gap-1"><Phone className="w-3 h-3" />{selectedGuest.phone}</p>
              </div>
            </div>
            <button onClick={() => setSelectedGuest(null)} className="p-2 hover:bg-[#c4956a]/10 rounded-full"><X className="h-5 w-5 text-black" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border-2 p-3 text-center" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                <p className="text-2xl font-bold text-black">{selectedGuest.visit_count}</p>
                <p className="text-xs text-black font-medium">Visitas</p>
              </div>
              <div className="rounded-lg border-2 p-3 text-center" style={{ borderColor: selectedGuest.no_show_count > 0 ? '#ef4444' : '#c4956a', background: selectedGuest.no_show_count > 0 ? 'rgba(239,68,68,0.05)' : 'rgba(252,246,237,0.6)' }}>
                <p className={`text-2xl font-bold ${selectedGuest.no_show_count > 0 ? 'text-red-600' : 'text-black'}`}>{selectedGuest.no_show_count}</p>
                <p className="text-xs text-black font-medium">No-Shows</p>
              </div>
            </div>

            {/* Reservation History */}
            <div>
              <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-3">Historial de reservas</h3>
              {guestReservations.length === 0 ? (
                <p className="text-xs text-black/50 italic">Sin reservas.</p>
              ) : (
                <div className="space-y-2">
                  {guestReservations.map(res => (
                    <div key={res.id} className="flex items-center justify-between border-2 rounded-lg p-3" style={{ borderColor: 'rgba(196,149,106,0.3)', background: 'rgba(252,246,237,0.6)' }}>
                      <div className="flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-[#c4956a] flex-shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-black">{res.date}</p>
                          <p className="text-xs text-black">{res.time} · {res.party_size}p</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${
                        res.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' :
                        res.status === 'cancelled' || res.status === 'no_show' ? 'bg-red-50 text-red-700' :
                        'bg-zinc-100 text-zinc-700'
                      }`}>{res.status.replace('_', ' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
