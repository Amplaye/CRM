"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { AlertTriangle, Check, X, MessageSquare, Phone, Calendar, Users, Clock } from "lucide-react";
import Link from "next/link";
import { zoneLabel } from "@/lib/restaurant-rules";

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
  zone: string;
}

export default function PendingPage() {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const supabase = createClient();

  const [pending, setPending] = useState<PendingReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());
  // Zone filter for the table picker (null = all zones)
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);

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
      .select("id, name, seats, zone")
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

  const getShift = (time: string) => {
    const h = parseInt(time.split(':')[0]);
    return h < 16 ? 'lunch' : 'dinner';
  };

  const startConfirm = async (id: string) => {
    setConfirmingId(id);
    setSelectedTables(new Set());
    setZoneFilter(null);

    // Find the request's date and shift, fetch occupied tables for that date+shift
    const req = pending.find(p => p.id === id);
    if (req && tenant) {
      const reqShift = getShift(req.time);
      const { data: resData } = await supabase
        .from("reservations")
        .select("id, time, shift")
        .eq("tenant_id", tenant.id)
        .eq("date", req.date)
        .in("status", ["confirmed", "seated", "pending_confirmation"])
        .neq("id", id);

      // Only count tables from same shift as occupied
      const sameShiftIds = (resData || []).filter((r: any) => {
        const rShift = r.shift || getShift(r.time);
        return rShift === reqShift;
      }).map((r: any) => r.id);

      if (sameShiftIds.length > 0) {
        const { data: links } = await supabase
          .from("reservation_tables")
          .select("table_id")
          .in("reservation_id", sameShiftIds);
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
    const req = pending.find(p => p.id === confirmingId);

    // Validate: warn if selected tables have fewer seats than party size
    if (req && selectedTables.size > 0) {
      const selectedTableObjs = Array.from(selectedTables)
        .map(tid => tables.find(t => t.id === tid))
        .filter((t): t is typeof tables[number] => !!t);
      const totalSeats = selectedTableObjs.reduce((sum, t) => sum + (t.seats || 0), 0);

      if (totalSeats < req.party_size) {
        const ok = window.confirm(
          t("pending_seats_warning").replace("{seats}", String(totalSeats)).replace("{size}", String(req.party_size))
        );
        if (!ok) return;
      } else if (selectedTableObjs.length > 1) {
        // Warn if there's at least one redundant table — i.e. removing the
        // smallest selected table still covers the party. That means the
        // assignment is wasteful and the staff probably picked one too many.
        const smallest = selectedTableObjs.reduce(
          (min, t) => (t.seats < min.seats ? t : min),
          selectedTableObjs[0]
        );
        if (totalSeats - smallest.seats >= req.party_size) {
          const ok = window.confirm(
            t("pending_too_many_warning")
              .replace("{seats}", String(totalSeats))
              .replace("{size}", String(req.party_size))
          );
          if (!ok) return;
        }
      }
    }

    // Warn if no tables selected for a large group
    if (req && selectedTables.size === 0) {
      const ok = window.confirm(
        t("pending_no_tables_warning").replace("{size}", String(req.party_size))
      );
      if (!ok) return;
    }

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

    // Send WhatsApp confirmation to client
    if (req) {
      const guestPhone = req.guests?.phone || '';
      if (guestPhone) {
        const assignedTableNames = Array.from(selectedTables).map(tid => {
          const t = tables.find(x => x.id === tid);
          return t?.name || '';
        }).filter(Boolean).join(', ');
        const confirmMsg = `✅ *Reserva confirmada*\n📅 Fecha: ${req.date}\n⏰ Hora: ${req.time}\n👥 Personas: ${req.party_size}\n📝 Nombre: ${req.guests?.name || ''}${assignedTableNames ? '\n🪑 Mesas: ' + assignedTableNames : ''}\n\nSi necesitas cancelar, escríbenos con CANCELAR.`;
        try {
          await fetch("/api/send-whatsapp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: guestPhone, message: confirmMsg }),
          });
        } catch (e) { console.error("WhatsApp confirm error:", e); }
      }
    }

    setConfirmingId(null);
    setSelectedTables(new Set());
  };

  const handleReject = async (id: string) => {
    if (!confirm(t("pending_reject_confirm"))) return;
    const rejectedReq = pending.find(p => p.id === id);
    await supabase.from("reservations").update({ status: "cancelled" }).eq("id", id);

    // Trigger waitlist auto-assign (freed capacity)
    if (rejectedReq) {
      try {
        const shift = parseInt(rejectedReq.time.split(':')[0]) < 16 ? 'lunch' : 'dinner';
        await fetch("/api/ai/waitlist-process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenant?.id, date: rejectedReq.date, shift }),
        });
      } catch (e) { console.error("Waitlist process error:", e); }
    }
  };

  const req = confirmingId ? pending.find(p => p.id === confirmingId) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-black tracking-tight">{t("pending_title")}</h1>
        <p className="mt-1 text-sm text-black/60">{t("pending_subtitle")}</p>
      </div>

      {loading ? (
        <div className="text-sm text-black/40">{t("loading")}</div>
      ) : pending.length === 0 ? (
        <div className="border-2 rounded-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <AlertTriangle className="mx-auto h-12 w-12 text-black/20 mb-4" />
          <p className="text-sm font-medium text-black">{t("pending_no_requests")}</p>
          <p className="text-xs text-black/40 mt-1">{t("pending_no_requests_desc")}</p>
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
                          {t("pending_status")}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-[#c4956a]/10 text-[#8b6540] border border-[#c4956a]/30">
                          {req.source === "ai_chat" ? "WhatsApp" : req.source === "ai_voice" ? "Voice" : "Staff"}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${
                          getShift(req.time) === 'lunch'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                        }`}>
                          {getShift(req.time) === 'lunch' ? t("pending_lunch") : t("pending_dinner")}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">{t("pending_people_label")}</p>
                            <p className="text-sm font-bold text-black">{req.party_size}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">{t("pending_date_label")}</p>
                            <p className="text-sm font-bold text-black">{req.date}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">{t("pending_time_label")}</p>
                            <p className="text-sm font-bold text-black">{req.time}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-black/40" />
                          <div>
                            <p className="text-xs text-black/40">{t("pending_phone_label")}</p>
                            <p className="text-sm font-bold text-black">{guestPhone || "—"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-black">{guestName}</span>
                        <Link href={`/conversations?guest=${req.guest_id}`} className="text-[#c4956a] hover:text-[#b8845c]" title={t("pending_view_conversation")}>
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
                          {t("pending_confirm_btn")}
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-all"
                        >
                          <X className="w-4 h-4" />
                          {t("pending_reject_btn")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Table selection panel — shown when confirming */}
                {isConfirming && (() => {
                  const allZones = Array.from(new Set(tables.map(t => t.zone || "Principal"))).sort();
                  const visibleTables = zoneFilter ? tables.filter(t => (t.zone || "Principal") === zoneFilter) : tables;
                  return (
                  <div className="border-t-2 p-5" style={{ borderColor: '#22c55e', background: 'rgba(34,197,94,0.03)' }}>
                    <h3 className="text-sm font-bold text-black mb-3">
                      {t("pending_assign_tables")} — {getShift(req.time) === 'lunch' ? t("pending_lunch") : t("pending_dinner")} {req.date} ({Math.ceil(req.party_size / 4)} {t("pending_needed_for")} {req.party_size} {t("pending_people")})
                    </h3>
                    {allZones.length > 1 && (
                      <div className="flex items-center gap-1 mb-3 flex-wrap">
                        <button
                          onClick={() => setZoneFilter(null)}
                          className="px-3 py-1 text-xs font-semibold rounded-lg border-2 transition-colors"
                          style={{
                            borderColor: "#c4956a",
                            background: zoneFilter === null ? "#c4956a" : "rgba(252,246,237,0.6)",
                            color: zoneFilter === null ? "#fff" : "#000",
                          }}
                        >
                          {t("pending_zone_all")}
                        </button>
                        {allZones.map(z => (
                          <button
                            key={z}
                            onClick={() => setZoneFilter(z)}
                            className="px-3 py-1 text-xs font-semibold rounded-lg border-2 transition-colors"
                            style={{
                              borderColor: "#c4956a",
                              background: zoneFilter === z ? "#c4956a" : "rgba(252,246,237,0.6)",
                              color: zoneFilter === z ? "#fff" : "#000",
                            }}
                          >
                            {zoneLabel(z, t)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-4">
                      {visibleTables.map(table => {
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
                            <span className="text-[10px] block text-black/50">{table.seats}p</span>
                            {isOccupied && <span className="text-[10px] block text-red-400">{t("res_occupied")}</span>}
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
                        {t("pending_confirm_with")} {selectedTables.size} {selectedTables.size !== 1 ? t("pending_tables") : t("pending_table")}
                      </button>
                      <button
                        onClick={() => { setConfirmingId(null); setSelectedTables(new Set()); }}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium text-black/60 hover:text-black transition-colors"
                      >
                        {t("pending_cancel")}
                      </button>
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
