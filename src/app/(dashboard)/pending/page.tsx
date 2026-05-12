"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { AlertTriangle, Check, X, MessageSquare, Phone, Calendar, Users, Clock, List, LayoutPanelTop } from "lucide-react";
import Link from "next/link";
import { zoneLabel } from "@/lib/restaurant-rules";
import { TranslateNoteButton } from "@/components/ui/TranslateNoteButton";
import { useSeenSnapshotAndMark } from "@/lib/hooks/useLastSeen";
import { formatDateLong } from "@/lib/format-date";

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
  shape: "round" | "square" | "rectangle";
  position_x: number | null;
  position_y: number | null;
}

type TableShape = "round" | "square" | "rectangle";

function tableDims(shape: TableShape, seats: number): { w: number; h: number } {
  if (shape === "round") return seats <= 2 ? { w: 60, h: 60 } : { w: 80, h: 80 };
  if (shape === "square") return seats <= 2 ? { w: 60, h: 60 } : { w: 80, h: 80 };
  return seats <= 6 ? { w: 130, h: 70 } : { w: 160, h: 70 };
}

export default function PendingPage() {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const supabase = createClient();
  const seenAt = useSeenSnapshotAndMark(tenant?.id, "pending");

  const [pending, setPending] = useState<PendingReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());
  // Zone filter for the table picker (null = all zones)
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  // Prevents double-click from confirming the same reservation twice
  const [confirmInFlight, setConfirmInFlight] = useState(false);
  // Inline validation dialog (replaces window.confirm so it works on mobile)
  type ConfirmWarning =
    | { kind: "too_few"; totalSeats: number; partySize: number }
    | { kind: "too_many"; totalSeats: number; partySize: number }
    | { kind: "no_tables"; partySize: number }
    | null;
  const [warning, setWarning] = useState<ConfirmWarning>(null);
  // Table picker view mode: grid (buttons) or plan (visual canvas)
  const [tablePickerView, setTablePickerView] = useState<"grid" | "plan">("grid");

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
      .select("id, name, seats, zone, shape, position_x, position_y")
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

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchPending(), 500);
    };

    const channel = supabase
      .channel("pending-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${tenant.id}` }, () => debouncedFetch())
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
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
        .select("id, time, shift, reservation_tables(table_id)")
        .eq("tenant_id", tenant.id)
        .eq("date", req.date)
        .in("status", ["confirmed", "seated", "pending_confirmation"])
        .neq("id", id);

      const occupied = new Set<string>();
      for (const r of ((resData || []) as any[])) {
        const rShift = r.shift || getShift(r.time);
        if (rShift !== reqShift) continue;
        for (const link of (r.reservation_tables || [])) {
          if (link.table_id) occupied.add(link.table_id);
        }
      }
      setOccupiedTableIds(occupied);
    }
  };

  const toggleTable = (tableId: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableId)) next.delete(tableId); else next.add(tableId);
      return next;
    });
  };

  const handleConfirm = async (skipWarnings = false) => {
    if (!confirmingId || confirmInFlight) return;
    const req = pending.find(p => p.id === confirmingId);

    // Inline validation — replaces window.confirm() so it actually works on mobile.
    if (!skipWarnings && req) {
      if (selectedTables.size > 0) {
        const selectedTableObjs = Array.from(selectedTables)
          .map(tid => tables.find(t => t.id === tid))
          .filter((t): t is typeof tables[number] => !!t);
        const totalSeats = selectedTableObjs.reduce((sum, t) => sum + (t.seats || 0), 0);

        if (totalSeats < req.party_size) {
          setWarning({ kind: "too_few", totalSeats, partySize: req.party_size });
          return;
        }
        if (selectedTableObjs.length > 1) {
          const smallest = selectedTableObjs.reduce(
            (min, t) => (t.seats < min.seats ? t : min),
            selectedTableObjs[0]
          );
          if (totalSeats - smallest.seats >= req.party_size) {
            setWarning({ kind: "too_many", totalSeats, partySize: req.party_size });
            return;
          }
        }
      } else {
        setWarning({ kind: "no_tables", partySize: req.party_size });
        return;
      }
    }

    setWarning(null);
    setConfirmInFlight(true);
    try {
      // 1) Reset + assign selected tables. DELETE-then-INSERT keeps the handler idempotent:
      // a previous failed attempt (insert OK, status update failed) would leave stale links
      // and the next click would 23505 on the unique key (reservation_id, table_id).
      const { error: delErr } = await supabase
        .from("reservation_tables")
        .delete()
        .eq("reservation_id", confirmingId);
      if (delErr) throw delErr;
      if (selectedTables.size > 0) {
        const inserts = Array.from(selectedTables).map(tableId => ({
          reservation_id: confirmingId,
          table_id: tableId,
        }));
        const { error: rtErr } = await supabase.from("reservation_tables").insert(inserts);
        if (rtErr) throw rtErr;
      }

      // 2) Update status — same: fail loud.
      const { error: upErr } = await supabase
        .from("reservations")
        .update({ status: "confirmed" })
        .eq("id", confirmingId);
      if (upErr) throw upErr;

      // 3) Best-effort side effects (WhatsApp, audit, owner notify) — never block on these.
      if (req) {
        const guestPhone = req.guests?.phone || '';
        const assignedTableObjs = Array.from(selectedTables).map(tid => tables.find(x => x.id === tid)).filter(Boolean) as typeof tables;
        const assignedTableNames = assignedTableObjs.map(t => t.name).join(', ');
        const zoneFromTables = assignedTableObjs[0]?.zone;
        const notesRaw = ((req as any).notes || '').toLowerCase();
        const zoneFromNotes = notesRaw.includes('interior') ? 'inside' : notesRaw.includes('exterior') ? 'outside' : null;
        const zone = zoneFromTables || zoneFromNotes || null;
        const zoneLine = zone ? `\n📍 Zona: ${zone === 'inside' ? 'Interior' : 'Exterior'}` : '';

        if (guestPhone) {
          const lang = (['es', 'it', 'en', 'de'] as const).includes(((req as any).language || '') as any)
            ? ((req as any).language as 'es' | 'it' | 'en' | 'de')
            : 'es';
          const T = {
            es: { title: '✅ *Reserva confirmada*', date: 'Fecha', time: 'Hora', people: 'Personas', zone: 'Zona', name: 'Nombre', tablesLbl: 'Mesas', interior: 'Interior', exterior: 'Exterior', footer: 'Para modificar escribe *MODIFICAR*.\nPara cancelar escribe *CANCELAR*.' },
            it: { title: '✅ *Prenotazione confermata*', date: 'Data', time: 'Ora', people: 'Persone', zone: 'Zona', name: 'Nome', tablesLbl: 'Tavoli', interior: 'Interno', exterior: 'Esterno', footer: 'Per modificare scrivi *MODIFICARE*.\nPer annullare scrivi *ANNULLA*.' },
            en: { title: '✅ *Booking confirmed*', date: 'Date', time: 'Time', people: 'People', zone: 'Area', name: 'Name', tablesLbl: 'Tables', interior: 'Indoor', exterior: 'Outdoor', footer: 'To modify write *MODIFY*.\nTo cancel write *CANCEL*.' },
            de: { title: '✅ *Reservierung bestätigt*', date: 'Datum', time: 'Uhrzeit', people: 'Personen', zone: 'Bereich', name: 'Name', tablesLbl: 'Tische', interior: 'Innenbereich', exterior: 'Außenbereich', footer: 'Zum Ändern schreibe *ÄNDERN*.\nZum Stornieren schreibe *STORNIEREN*.' },
          }[lang];
          const zoneLineL = zone ? `\n📍 ${T.zone}: ${zone === 'inside' ? T.interior : T.exterior}` : '';
          const confirmMsg = `${T.title}\n📅 ${T.date}: ${formatDateLong(req.date, lang)}\n⏰ ${T.time}: ${req.time}\n👥 ${T.people}: ${req.party_size}${zoneLineL}\n📝 ${T.name}: ${req.guests?.name || ''}${assignedTableNames ? '\n🪑 ' + T.tablesLbl + ': ' + assignedTableNames : ''}\n\n${T.footer}`;
          fetch("/api/send-whatsapp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: guestPhone, message: confirmMsg }),
          }).catch((e) => console.error("WhatsApp confirm error:", e));
        }

        // Notify owner of manual confirmation
        const ownerMsg = `📅 NUEVA RESERVA (confirmada manualmente)\n\n${req.guests?.name || ''}\n${req.date} ${req.time}\n${req.party_size} personas${assignedTableNames ? '\n🪑 ' + assignedTableNames : ''}${zoneLine}\nTel: ${guestPhone || '—'}`;
        fetch("/api/send-whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: '+34641790137', message: ownerMsg }),
        }).catch(() => {});

        // Audit trail (best-effort)
        supabase.from('reservation_events').insert({
          tenant_id: tenant?.id,
          reservation_id: confirmingId,
          action: 'status_changed',
          new_status: 'confirmed',
          details: `Manually confirmed from /pending. Tables: ${assignedTableNames || 'none'}`,
        }).then(({ error }: { error: { message: string } | null }) => { if (error) console.warn('audit insert failed:', error.message); });
      }

      setConfirmingId(null);
      setSelectedTables(new Set());
    } catch (err: any) {
      console.error("Confirm error:", err);
      window.alert(t("pending_confirm_error") + (err?.message ? `\n\n${err.message}` : ''));
      // Re-fetch to resync state with the database
      fetchPending();
    } finally {
      setConfirmInFlight(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm(t("pending_reject_confirm"))) return;
    const rejectedReq = pending.find(p => p.id === id);

    try {
      const { error: upErr } = await supabase
        .from("reservations")
        .update({ status: "cancelled", cancellation_source: "staff" })
        .eq("id", id);
      if (upErr) throw upErr;

      // Notify the client + owner + audit (all best-effort)
      if (rejectedReq) {
        const guestPhone = rejectedReq.guests?.phone || '';
        if (guestPhone) {
          const rejectMsg = `Hola${rejectedReq.guests?.name ? ' ' + rejectedReq.guests.name : ''}, lamentablemente no podemos aceptar tu solicitud de reserva para el ${rejectedReq.date} a las ${rejectedReq.time} (${rejectedReq.party_size} personas). Si quieres, puedes llamarnos al +34 828 712 623 para buscar otra fecha. ¡Gracias!`;
          fetch("/api/send-whatsapp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: guestPhone, message: rejectMsg }),
          }).catch((e) => console.error("WhatsApp reject error:", e));
        }

        const ownerMsg = `❌ SOLICITUD RECHAZADA\n\n${rejectedReq.guests?.name || ''}\n${rejectedReq.date} ${rejectedReq.time}\n${rejectedReq.party_size} personas\nTel: ${guestPhone || '—'}`;
        fetch("/api/send-whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: '+34641790137', message: ownerMsg }),
        }).catch(() => {});

        supabase.from('reservation_events').insert({
          tenant_id: tenant?.id,
          reservation_id: id,
          action: 'cancelled',
          new_status: 'cancelled',
          details: 'Rejected by staff from /pending',
        }).then(({ error }: { error: { message: string } | null }) => { if (error) console.warn('audit insert failed:', error.message); });

        // Trigger waitlist auto-assign (freed capacity) — fire-and-forget
        const shift = parseInt(rejectedReq.time.split(':')[0]) < 16 ? 'lunch' : 'dinner';
        fetch("/api/ai/waitlist-process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenant?.id, date: rejectedReq.date, shift }),
        }).catch((e) => console.error("Waitlist process error:", e));
      }
    } catch (err: any) {
      console.error("Reject error:", err);
      window.alert(t("pending_reject_error") + (err?.message ? `\n\n${err.message}` : ''));
      fetchPending();
    }
  };

  const req = confirmingId ? pending.find(p => p.id === confirmingId) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-black tracking-tight">{t("pending_title")}</h1>
        <p className="mt-1 text-sm text-black">{t("pending_subtitle")}</p>
      </div>

      {loading ? (
        <div className="text-sm text-black">{t("loading")}</div>
      ) : pending.length === 0 ? (
        <div className="border-2 rounded-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <AlertTriangle className="mx-auto h-12 w-12 text-black/20 mb-4" />
          <p className="text-sm font-medium text-black">{t("pending_no_requests")}</p>
          <p className="text-xs text-black mt-1">{t("pending_no_requests_desc")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(() => { let newRowIdx = 0; return pending.map((req) => {
            const guestName = req.guests?.name || "Unknown";
            const guestPhone = req.guests?.phone || "";
            const isConfirming = confirmingId === req.id;
            const isNew = (req as any).created_at && (req as any).created_at > seenAt;
            const rowIdx = isNew ? newRowIdx++ : 0;

            return (
              <div
                key={req.id}
                className={`border-2 rounded-xl overflow-hidden transition-all ${isNew ? 'is-new-row' : ''}`}
                style={{ background: 'rgba(252,246,237,0.85)', borderColor: isConfirming ? '#22c55e' : '#c4956a', ...(isNew ? { ['--row-new-index' as any]: rowIdx } : {}) }}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 sm:gap-3 mb-3 flex-wrap">
                        <span className="inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-200">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {t("pending_status")}
                        </span>
                        <span className="inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium bg-[#c4956a]/10 text-[#8b6540] border border-[#c4956a]/30">
                          {req.source === "ai_chat" ? "WhatsApp" : req.source === "ai_voice" ? "Voice" : "Staff"}
                        </span>
                        <span className={`inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider ${
                          getShift(req.time) === 'lunch'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                        }`}>
                          {getShift(req.time) === 'lunch' ? t("pending_lunch") : t("pending_dinner")}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_people_label")}</p>
                            <p className="text-sm font-bold text-black">{req.party_size}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_date_label")}</p>
                            <p className="text-sm font-bold text-black">{req.date}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_time_label")}</p>
                            <p className="text-sm font-bold text-black">{req.time}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_phone_label")}</p>
                            <p className="text-sm font-bold text-black truncate">{guestPhone || "—"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-black">{guestName}</span>
                        <Link href={`/conversations?guest=${req.guest_id}`} className="text-[#c4956a] hover:text-[#b8845c]" title={t("pending_view_conversation")}>
                          <MessageSquare className="w-4 h-4" />
                        </Link>
                      </div>

                      {req.notes && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-black">{req.notes}</p>
                          <TranslateNoteButton text={req.notes} />
                        </div>
                      )}
                      <p className="text-[10px] text-black mt-2">{new Date(req.created_at).toLocaleString()}</p>
                    </div>

                    {!isConfirming && (
                      <div className="flex flex-row sm:flex-col gap-2 sm:ml-4">
                        <button
                          onClick={() => startConfirm(req.id)}
                          className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:shadow-md"
                          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
                        >
                          <Check className="w-4 h-4" />
                          {t("pending_confirm_btn")}
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-all"
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
                  const planZone = tablePickerView === "plan" && !zoneFilter ? allZones[0] : zoneFilter;
                  const displayTables = planZone ? tables.filter(t => (t.zone || "Principal") === planZone) : tables;
                  const availableSeats = displayTables
                    .filter(t => !occupiedTableIds.has(t.id))
                    .map(t => t.seats)
                    .sort((a, b) => b - a);
                  let minTablesNeeded = 0;
                  let sumSeats = 0;
                  for (const s of availableSeats) {
                    if (sumSeats >= req.party_size) break;
                    sumSeats += s;
                    minTablesNeeded++;
                  }
                  if (sumSeats < req.party_size) minTablesNeeded = availableSeats.length;
                  return (
                  <div className="border-t-2 p-3 sm:p-5" style={{ borderColor: '#22c55e', background: 'rgba(34,197,94,0.03)' }}>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <h3 className="text-xs sm:text-sm font-bold text-black">
                        {t("pending_assign_tables")} — {getShift(req.time) === 'lunch' ? t("pending_lunch") : t("pending_dinner")} {req.date} ({minTablesNeeded} {t("pending_needed_for")} {req.party_size} {t("pending_people")})
                      </h3>
                      <div className="inline-flex rounded-lg border-2 overflow-hidden" style={{ borderColor: "#c4956a" }}>
                        <button
                          onClick={() => setTablePickerView("grid")}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-colors"
                          style={{ background: tablePickerView === "grid" ? "#c4956a" : "rgba(252,246,237,0.6)", color: tablePickerView === "grid" ? "#fff" : "#000" }}
                        >
                          <List className="w-3 h-3" /> Lista
                        </button>
                        <button
                          onClick={() => setTablePickerView("plan")}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-colors"
                          style={{ background: tablePickerView === "plan" ? "#c4956a" : "rgba(252,246,237,0.6)", color: tablePickerView === "plan" ? "#fff" : "#000" }}
                        >
                          <LayoutPanelTop className="w-3 h-3" /> Plano
                        </button>
                      </div>
                    </div>
                    {allZones.length > 1 && (
                      <div className="flex items-center gap-1 mb-3 flex-wrap">
                        {/* "All zones" only in grid view — plan view needs one zone at a time */}
                        {tablePickerView === "grid" && (
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
                        )}
                        {allZones.map(z => {
                          const isActive = tablePickerView === "plan"
                            ? (zoneFilter || allZones[0]) === z
                            : zoneFilter === z;
                          return (
                          <button
                            key={z}
                            onClick={() => setZoneFilter(z)}
                            className="px-3 py-1 text-xs font-semibold rounded-lg border-2 transition-colors"
                            style={{
                              borderColor: "#c4956a",
                              background: isActive ? "#c4956a" : "rgba(252,246,237,0.6)",
                              color: isActive ? "#fff" : "#000",
                            }}
                          >
                            {zoneLabel(z, t)}
                          </button>
                          );
                        })}
                      </div>
                    )}

                    {(() => {
                      return tablePickerView === "grid" ? (
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
                      {displayTables.map(table => {
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
                            <span className="text-[10px] block text-black">{table.seats}p</span>
                            {isOccupied && <span className="text-[10px] block text-red-400">{t("res_occupied")}</span>}
                          </button>
                        );
                      })}
                    </div>
                    ) : (
                    <TablePickerCanvas
                      tables={displayTables}
                      occupiedTableIds={occupiedTableIds}
                      selectedTables={selectedTables}
                      onToggleTable={toggleTable}
                    />
                    );
                    })()}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleConfirm()}
                        disabled={confirmInFlight}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
                      >
                        <Check className="w-4 h-4" />
                        {confirmInFlight ? '...' : `${t("pending_confirm_with")} ${selectedTables.size} ${selectedTables.size !== 1 ? t("pending_tables") : t("pending_table")}`}
                      </button>
                      <button
                        onClick={() => { setConfirmingId(null); setSelectedTables(new Set()); }}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium text-black hover:text-black transition-colors"
                      >
                        {t("pending_cancel")}
                      </button>
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          }); })()}
        </div>
      )}

      {/* Inline confirmation dialog (replaces window.confirm so it works on mobile) */}
      {warning && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={() => setWarning(null)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-2xl border-2 p-5 sm:p-6 shadow-xl"
            style={{ background: 'rgba(252,246,237,0.98)', borderColor: '#c4956a' }}>
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-amber-100">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-black">{t("pending_warning_title")}</h3>
                <p className="text-sm text-black mt-1.5 leading-relaxed">
                  {warning.kind === "too_few" &&
                    t("pending_seats_warning")
                      .replace("{seats}", String(warning.totalSeats))
                      .replace("{size}", String(warning.partySize))}
                  {warning.kind === "too_many" &&
                    t("pending_too_many_warning")
                      .replace("{seats}", String(warning.totalSeats))
                      .replace("{size}", String(warning.partySize))}
                  {warning.kind === "no_tables" &&
                    t("pending_no_tables_warning").replace("{size}", String(warning.partySize))}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setWarning(null)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border-2 border-[#c4956a] text-black bg-[rgba(252,246,237,0.6)]"
              >
                {t("pending_cancel")}
              </button>
              <button
                onClick={() => { setWarning(null); handleConfirm(true); }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
              >
                {t("pending_confirm_anyway")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   TablePickerCanvas — visual floor plan for table selection
   ──────────────────────────────────────────────────────── */

interface TablePickerCanvasProps {
  tables: TableOption[];
  occupiedTableIds: Set<string>;
  selectedTables: Set<string>;
  onToggleTable: (id: string) => void;
}

function TablePickerCanvas({ tables, occupiedTableIds, selectedTables, onToggleTable }: TablePickerCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={canvasRef}
      className="relative rounded-xl border-2 mb-4"
      style={{
        overflow: "auto",
        background: "rgba(252,246,237,0.6)",
        borderColor: "#c4956a",
        height: "400px",
        backgroundImage: "radial-gradient(rgba(196,149,106,0.25) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div className="relative" style={{ minWidth: "500px", minHeight: "400px" }}>
        {tables.map((table) => {
          const shape = table.shape || "square";
          const dims = tableDims(shape, table.seats);
          const x = table.position_x ?? 60;
          const y = table.position_y ?? 60;
          const isOccupied = occupiedTableIds.has(table.id);
          const isSelected = selectedTables.has(table.id);

          const borderColor = isOccupied ? "#ef4444" : isSelected ? "#22c55e" : "#c4956a";
          const bg = isOccupied
            ? "rgba(254,226,226,0.95)"
            : isSelected
              ? "rgba(220,252,231,0.95)"
              : "rgba(252,246,237,0.95)";

          return (
            <div
              key={table.id}
              onClick={() => !isOccupied && onToggleTable(table.id)}
              className={`absolute flex flex-col items-center justify-center text-center select-none transition-all ${
                isOccupied ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:shadow-lg hover:scale-105"
              }`}
              style={{
                left: x,
                top: y,
                width: dims.w,
                height: dims.h,
                borderRadius: shape === "round" ? "50%" : shape === "square" ? "10px" : "14px",
                border: `3px solid ${borderColor}`,
                background: bg,
                zIndex: 10,
              }}
            >
              <span className="text-[11px] font-bold text-black leading-none">{table.name}</span>
              <span className="text-[9px] text-black leading-tight">{table.seats}p</span>
              {isSelected && (
                <span className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center text-white rounded-full" style={{ background: "#22c55e" }}>
                  <Check className="w-3 h-3" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
