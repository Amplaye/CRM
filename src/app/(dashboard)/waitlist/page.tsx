"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useAuth } from "@/lib/contexts/AuthContext";
import {
  UserPlus, Sparkles, Send, Activity, X, MessageSquare,
  List, LayoutPanelTop, Check, Users, Clock, Calendar, Phone,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { zoneLabel } from "@/lib/restaurant-rules";
import { WaitlistEntry } from "@/lib/types";
import { createWaitlistEntryAction, updateWaitlistStatusAction } from "@/app/actions/waitlist";
import { createReservationAction } from "@/app/actions/reservations";

interface WaitlistWithGuest extends WaitlistEntry {
  guests?: { name: string; phone: string; email?: string };
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

const getShift = (time: string) => {
  const h = parseInt(time.split(':')[0]);
  return h < 16 ? 'lunch' : 'dinner';
};

export default function WaitlistPage() {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const { user } = useAuth();
  const supabase = createClient();

  const [entries, setEntries] = useState<WaitlistWithGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableOption[]>([]);

  // Same state model as /pending
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [confirmInFlight, setConfirmInFlight] = useState(false);
  const [tablePickerView, setTablePickerView] = useState<"grid" | "plan">("grid");

  // Waitlist-specific: create-entry drawer
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const fetchEntries = async () => {
    if (!tenant) return;
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
    fetchEntries();
    fetchTables();

    const channel = supabase
      .channel("waitlist_entries_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "waitlist_entries", filter: `tenant_id=eq.${tenant.id}` }, () => fetchEntries())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant, today]);

  // Pulled out of startConfirm so we can re-run it on realtime changes.
  const loadOccupiedFor = async (entryId: string) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry || !tenant) return;
    const reqShift = getShift(entry.target_time);
    const { data: resData } = await supabase
      .from("reservations")
      .select("id, time, shift")
      .eq("tenant_id", tenant.id)
      .eq("date", entry.date)
      .in("status", ["confirmed", "seated", "pending_confirmation"]);

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
  };

  // Keep occupied table set in sync while a picker is open: subscribe to
  // reservation_tables and reservations changes for the current tenant/date
  // and re-pull on any event. This means assigning tables to waitlist entry A
  // updates entry B's picker instantly without a manual reload.
  useEffect(() => {
    if (!confirmingId || !tenant) return;
    const channel = supabase
      .channel(`waitlist_occupied_${confirmingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reservation_tables" }, () => loadOccupiedFor(confirmingId))
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${tenant.id}` }, () => loadOccupiedFor(confirmingId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingId, tenant?.id]);

  const startConfirm = async (id: string) => {
    setConfirmingId(id);
    setSelectedTables(new Set());
    setZoneFilter(null);
    await loadOccupiedFor(id);
  };

  const toggleTable = (tableId: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableId)) next.delete(tableId); else next.add(tableId);
      return next;
    });
  };

  /**
   * Identical UX to /pending#handleConfirm, but backed by the
   * createReservation + override + close-waitlist + WhatsApp flow
   * because a waitlist entry has no reservation to flip.
   */
  const handleConfirm = async () => {
    if (!confirmingId || confirmInFlight) return;
    const entry = entries.find(e => e.id === confirmingId);
    if (!entry || !tenant || !user) return;

    // Same guardrails as /pending
    if (selectedTables.size > 0) {
      const selectedTableObjs = Array.from(selectedTables)
        .map(tid => tables.find(t => t.id === tid))
        .filter((t): t is TableOption => !!t);
      const totalSeats = selectedTableObjs.reduce((sum, tb) => sum + (tb.seats || 0), 0);

      if (totalSeats < entry.party_size) {
        const ok = window.confirm(
          t("pending_seats_warning").replace("{seats}", String(totalSeats)).replace("{size}", String(entry.party_size))
        );
        if (!ok) return;
      } else if (selectedTableObjs.length > 1) {
        const smallest = selectedTableObjs.reduce(
          (min, tb) => (tb.seats < min.seats ? tb : min),
          selectedTableObjs[0]
        );
        if (totalSeats - smallest.seats >= entry.party_size) {
          const ok = window.confirm(
            t("pending_too_many_warning")
              .replace("{seats}", String(totalSeats))
              .replace("{size}", String(entry.party_size))
          );
          if (!ok) return;
        }
      }
    }

    if (selectedTables.size === 0) {
      const ok = window.confirm(
        t("pending_no_tables_warning").replace("{size}", String(entry.party_size))
      );
      if (!ok) return;
    }

    setConfirmInFlight(true);
    try {
      const guestName = entry.guests?.name || `Guest ${entry.guest_id.substring(0, 6)}`;
      const guestPhone = entry.guests?.phone || "0000000";

      // 1. Create reservation (auto-assigns via atomic RPC)
      const res = await createReservationAction({
        tenantId: tenant.id,
        guestName,
        guestPhone,
        date: entry.date,
        time: entry.target_time,
        partySize: entry.party_size,
        source: "staff",
        notes: "Converted from waitlist",
      });
      if (!res.success || !res.reservationId) throw new Error((res as any).error || "Could not create reservation");

      const reservationId = res.reservationId;

      // 2. Override auto-assigned tables with manager's selection
      if (selectedTables.size > 0) {
        await supabase.from("reservation_tables").delete().eq("reservation_id", reservationId);
        const inserts = Array.from(selectedTables).map(tableId => ({
          reservation_id: reservationId,
          table_id: tableId,
        }));
        await supabase.from("reservation_tables").insert(inserts);
      }

      // 3. Force confirmed (atomic RPC may have escalated it)
      await supabase.from("reservations").update({ status: "confirmed" }).eq("id", reservationId);

      // 4. Close waitlist entry
      await updateWaitlistStatusAction({
        tenantId: tenant.id,
        waitlistId: entry.id,
        newStatus: "converted_to_booking",
      });

      // 5. Best-effort WhatsApp confirmation
      if (guestPhone && guestPhone !== "0000000") {
        const assignedTableObjs = Array.from(selectedTables).map(tid => tables.find(x => x.id === tid)).filter(Boolean) as TableOption[];
        const assignedTableNames = assignedTableObjs.map(tb => tb.name).join(', ');
        const zoneFromTables = assignedTableObjs[0]?.zone;
        const notesRaw = (entry.notes || '').toLowerCase();
        const zoneFromNotes = notesRaw.includes('interior') ? 'inside' : notesRaw.includes('exterior') ? 'outside' : null;
        const zone = zoneFromTables || zoneFromNotes || null;
        const zoneLine = zone ? `\n📍 Zona: ${zone === 'inside' ? 'Interior' : zone === 'outside' ? 'Exterior' : zone}` : '';
        const confirmMsg = `✅ *Reserva confirmada*\n📅 Fecha: ${entry.date}\n⏰ Hora: ${entry.target_time}\n👥 Personas: ${entry.party_size}${zoneLine}\n📝 Nombre: ${guestName}${assignedTableNames ? '\n🪑 Mesas: ' + assignedTableNames : ''}\n\nSi necesitas cancelar, escríbenos con CANCELAR.`;
        try {
          await fetch("/api/send-whatsapp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: guestPhone, message: confirmMsg }),
          });
        } catch (e) { console.error("WhatsApp confirm error:", e); }
      }

      setConfirmingId(null);
      setSelectedTables(new Set());
    } catch (err: any) {
      console.error(err);
      alert("Failed to assign + book: " + (err?.message || "unknown"));
    } finally {
      setConfirmInFlight(false);
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

  const matchFoundEntry = entries.find(e => e.status === "match_found");

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{t("waitlist_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("waitlist_subtitle")} ({today})</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"
        >
          <UserPlus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
          {t("waitlist_add")}
        </button>
      </div>

      {/* AI Match Alert Banner — waitlist-specific */}
      {matchFoundEntry && (
        <div className="relative overflow-hidden rounded-2xl border-2 flex items-start sm:items-center p-6 justify-between flex-col sm:flex-row gap-4" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
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
                {t("waitlist_cancellation_match")} <span className="font-bold text-black">{matchFoundEntry.guests?.name || `Guest ${matchFoundEntry.guest_id.substring(0, 8)}`}</span> ({matchFoundEntry.party_size} pax). Their flexible window is {matchFoundEntry.acceptable_time_range.start} – {matchFoundEntry.acceptable_time_range.end}.
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

      {loading ? (
        <div className="text-sm text-black">{t("loading")}</div>
      ) : entries.length === 0 ? (
        <div className="border-2 rounded-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <Activity className="mx-auto h-12 w-12 text-black/20 mb-4" />
          <p className="text-sm font-medium text-black">{t("waitlist_no_entries")}</p>
          <p className="text-xs text-black mt-1">{t("waitlist_no_management")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const guestName = entry.guests?.name || `Guest ${entry.guest_id.substring(0, 6)}`;
            const guestPhone = entry.guests?.phone || "";
            const isConfirming = confirmingId === entry.id;
            const waitMinutes = Math.max(0, Math.floor((Date.now() - (typeof entry.created_at === 'number' ? entry.created_at : new Date(entry.created_at as any).getTime())) / 60000));

            return (
              <div
                key={entry.id}
                className="border-2 rounded-xl overflow-hidden transition-all"
                style={{ background: 'rgba(252,246,237,0.85)', borderColor: isConfirming ? '#22c55e' : '#c4956a' }}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 sm:gap-3 mb-3 flex-wrap">
                        <span className="inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-200">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {entry.status.replace('_', ' ')}
                        </span>
                        <span className="inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium bg-[#c4956a]/10 text-[#8b6540] border border-[#c4956a]/30">
                          {entry.contact_preference}
                        </span>
                        <span className={`inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider ${
                          getShift(entry.target_time) === 'lunch'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                        }`}>
                          {getShift(entry.target_time) === 'lunch' ? t("pending_lunch") : t("pending_dinner")}
                        </span>
                        <span className="inline-flex items-center px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium bg-zinc-100 text-black border border-zinc-200">
                          <Clock className="w-3 h-3 mr-1" />
                          {t("waitlist_wait_time").replace("{min}", String(waitMinutes))}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_people_label")}</p>
                            <p className="text-sm font-bold text-black">{entry.party_size}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_date_label")}</p>
                            <p className="text-sm font-bold text-black">{entry.date}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-black flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-black">{t("pending_time_label")}</p>
                            <p className="text-sm font-bold text-black">{entry.target_time}</p>
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
                        <Link href={`/conversations?guest=${entry.guest_id}`} className="text-[#c4956a] hover:text-[#b8845c]" title={t("pending_view_conversation")}>
                          <MessageSquare className="w-4 h-4" />
                        </Link>
                      </div>

                      {entry.notes && <p className="text-xs text-black">{entry.notes}</p>}
                      <p className="text-[10px] text-black mt-2">{new Date(entry.created_at as any).toLocaleString()}</p>
                    </div>

                    {!isConfirming && (
                      <div className="flex flex-row sm:flex-col gap-2 sm:ml-4">
                        <button
                          onClick={() => startConfirm(entry.id)}
                          className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:shadow-md"
                          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
                        >
                          <Check className="w-4 h-4" />
                          {t("pending_confirm_btn")}
                        </button>
                        {entry.status === 'waiting' && (
                          <button
                            onClick={() => markContacted(entry)}
                            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold text-black bg-white border border-zinc-200 hover:bg-zinc-50 transition-all"
                          >
                            <Send className="w-4 h-4" />
                            {t("waitlist_notify")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Table selection panel — identical layout/logic to /pending */}
                {isConfirming && (() => {
                  const allZones = Array.from(new Set(tables.map(tb => tb.zone || "Principal"))).sort();
                  const planZone = tablePickerView === "plan" && !zoneFilter ? allZones[0] : zoneFilter;
                  const displayTables = planZone ? tables.filter(tb => (tb.zone || "Principal") === planZone) : tables;
                  const availableSeats = displayTables
                    .filter(tb => !occupiedTableIds.has(tb.id))
                    .map(tb => tb.seats)
                    .sort((a, b) => b - a);
                  let minTablesNeeded = 0;
                  let sumSeats = 0;
                  for (const s of availableSeats) {
                    if (sumSeats >= entry.party_size) break;
                    sumSeats += s;
                    minTablesNeeded++;
                  }
                  if (sumSeats < entry.party_size) minTablesNeeded = availableSeats.length;
                  return (
                    <div className="border-t-2 p-3 sm:p-5" style={{ borderColor: '#22c55e', background: 'rgba(34,197,94,0.03)' }}>
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h3 className="text-xs sm:text-sm font-bold text-black">
                          {t("pending_assign_tables")} — {getShift(entry.target_time) === 'lunch' ? t("pending_lunch") : t("pending_dinner")} {entry.date} ({minTablesNeeded} {t("pending_needed_for")} {entry.party_size} {t("pending_people")})
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
                          onClick={handleConfirm}
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
          })}
        </div>
      )}

      {/* CREATE WAITLIST ENTRY DRAWER — waitlist-specific */}
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
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   TablePickerCanvas — visual floor plan for table selection
   (identical to /pending)
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
