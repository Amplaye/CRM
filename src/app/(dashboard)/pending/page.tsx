"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { AlertTriangle, Check, X, MessageSquare, Phone, Calendar, Users, Clock } from "lucide-react";
import Link from "next/link";

interface PendingReservation {
  id: string;
  date: string;
  time: string;
  end_time?: string;
  party_size: number;
  status: string;
  source: string;
  notes: string;
  created_at: string;
  guest_id: string;
  guests?: { name: string; phone: string } | null;
}

interface TableOption {
  id: string;
  name: string;
  seats: number;
}

export default function PendingPage() {
  const { activeTenant: tenant } = useTenant();
  const supabase = createClient();

  const [pending, setPending] = useState<PendingReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());

  const fetchPending = async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from("reservations")
      .select("*, guests(name, phone)")
      .eq("tenant_id", tenant.id)
      .eq("status", "escalated")
      .order("created_at", { ascending: false });

    setPending((data || []) as PendingReservation[]);
    setLoading(false);
  };

  const fetchTables = async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from("restaurant_tables")
      .select("id, name, seats")
      .eq("tenant_id", tenant.id)
      .eq("status", "active");

    const sorted = ((data || []) as TableOption[]).sort((a, b) => {
      const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
      return numA - numB;
    });
    setTables(sorted);
  };

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    fetchPending();
    fetchTables();

    const channel = supabase
      .channel("pending-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${tenant.id}` }, () => fetchPending())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant]);

  const startConfirm = async (id: string) => {
    setConfirmingId(id);
    setSelectedTables(new Set());

    // Find the request's date and fetch occupied tables for that date
    const req = pending.find(p => p.id === id);
    if (req && tenant) {
      const { data: resData } = await supabase
        .from("reservations")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("date", req.date)
        .in("status", ["confirmed", "seated", "pending_confirmation"])
        .neq("id", id);

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
    }
  };

  const toggleTable = (tableId: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableId)) next.delete(tableId); else next.add(tableId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!confirmingId) return;

    // Assign selected tables
    if (selectedTables.size > 0) {
      const inserts = Array.from(selectedTables).map(tableId => ({
        reservation_id: confirmingId,
        table_id: tableId,
      }));
      await supabase.from("reservation_tables").insert(inserts);
    }

    // Update status to confirmed
    await supabase.from("reservations").update({ status: "confirmed" }).eq("id", confirmingId);
    setConfirmingId(null);
    setSelectedTables(new Set());
  };

  const handleReject = async (id: string) => {
    if (!confirm("¿Estás seguro de rechazar esta solicitud?")) return;
    await supabase.from("reservations").update({ status: "cancelled" }).eq("id", id);
  };

  const req = confirmingId ? pending.find(p => p.id === confirmingId) : null;

  return (
    <div className="p-8 w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-black tracking-tight">Solicitudes Pendientes</h1>
        <p className="mt-1 text-sm text-black/60">Reservas de grupos grandes pendientes de aprobación manual.</p>
      </div>

      {loading ? (
        <div className="text-sm text-black/40">Loading...</div>
      ) : pending.length === 0 ? (
        <div className="border-2 rounded-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <AlertTriangle className="mx-auto h-12 w-12 text-black/20 mb-4" />
          <p className="text-sm font-medium text-black">No hay solicitudes pendientes</p>
          <p className="text-xs text-black/40 mt-1">Las solicitudes de grupos grandes aparecerán aquí.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((req) => {
            const guestName = req.guests?.name || "Unknown";
            const guestPhone = req.guests?.phone || "";
            const isConfirming = confirmingId === req.id;

            return (
              <div
                key={req.id}
                className="border-2 rounded-xl overflow-hidden transition-all"
                style={{ background: 'rgba(252,246,237,0.85)', borderColor: isConfirming ? '#22c55e' : '#c4956a' }}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-200">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Pendiente
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-[#c4956a]/10 text-[#8b6540] border border-[#c4956a]/30">
                          {req.source === "ai_chat" ? "WhatsApp" : req.source === "ai_voice" ? "Voice" : "Staff"}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">Personas</p>
                            <p className="text-sm font-bold text-black">{req.party_size}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">Fecha</p>
                            <p className="text-sm font-bold text-black">{req.date}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">Hora</p>
                            <p className="text-sm font-bold text-black">{req.time}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">Teléfono</p>
                            <p className="text-sm font-bold text-black">{guestPhone || "—"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-black">{guestName}</span>
                        <Link href={`/conversations?guest=${req.guest_id}`} className="text-[#c4956a] hover:text-[#b8845c]" title="Ver conversación">
                          <MessageSquare className="w-4 h-4" />
                        </Link>
                      </div>

                      {req.notes && <p className="text-xs text-black/50">{req.notes}</p>}
                      <p className="text-[10px] text-black/30 mt-2">{new Date(req.created_at).toLocaleString()}</p>
                    </div>

                    {!isConfirming && (
                      <div className="flex flex-col gap-2 ml-4">
                        <button
                          onClick={() => startConfirm(req.id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:shadow-md"
                          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
                        >
                          <Check className="w-4 h-4" />
                          Confirmar
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-all"
                        >
                          <X className="w-4 h-4" />
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Table selection panel — shown when confirming */}
                {isConfirming && (
                  <div className="border-t-2 p-5" style={{ borderColor: '#22c55e', background: 'rgba(34,197,94,0.03)' }}>
                    <h3 className="text-sm font-bold text-black mb-3">Asignar mesas ({Math.ceil(req.party_size / 4)} necesarias para {req.party_size} personas)</h3>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-4">
                      {tables.map(table => {
                        const isOccupied = occupiedTableIds.has(table.id);
                        const isSelected = selectedTables.has(table.id);
                        return (
                          <button
                            key={table.id}
                            onClick={() => !isOccupied && toggleTable(table.id)}
                            disabled={isOccupied}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                              isOccupied
                                ? 'border-red-400 bg-red-50 text-red-400 cursor-not-allowed opacity-60'
                                : isSelected
                                  ? 'border-green-500 bg-green-50 text-green-800'
                                  : 'border-[#c4956a]/50 text-black hover:border-[#c4956a]'
                            }`}
                            style={!isOccupied && !isSelected ? { background: 'rgba(252,246,237,0.6)' } : undefined}
                          >
                            {table.name}
                            {isOccupied && <span className="text-[10px] block text-red-400">occupied</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleConfirm}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:shadow-md"
                        style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
                      >
                        <Check className="w-4 h-4" />
                        Confirmar con {selectedTables.size} mesa{selectedTables.size !== 1 ? 's' : ''}
                      </button>
                      <button
                        onClick={() => { setConfirmingId(null); setSelectedTables(new Set()); }}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium text-black/60 hover:text-black transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
