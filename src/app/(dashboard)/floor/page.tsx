"use client";

import { useEffect, useState, useCallback } from "react";
import { Calendar, Users, LayoutGrid, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { TOTAL_TABLES, getShift } from "@/lib/restaurant-rules";

interface TableData {
  id: string;
  name: string;
  seats: number;
  status: "active" | "inactive";
}

interface ReservationWithGuest {
  id: string;
  date: string;
  time: string;
  end_time?: string;
  shift?: "lunch" | "dinner";
  party_size: number;
  status: string;
  guests?: { name: string } | null;
}

interface ResTableLink {
  reservation_id: string;
  table_id: string;
  restaurant_tables?: { name: string } | null;
}

export default function FloorPage() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const router = useRouter();
  const [tables, setTables] = useState<TableData[]>([]);
  const [reservations, setReservations] = useState<ReservationWithGuest[]>([]);
  const [resTableLinks, setResTableLinks] = useState<ResTableLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedShift, setSelectedShift] = useState<"lunch" | "dinner">(new Date().getHours() < 16 ? "lunch" : "dinner");

  // Quick Seat state
  const [quickSeatTable, setQuickSeatTable] = useState<TableData | null>(null);
  const [quickSeatSize, setQuickSeatSize] = useState(2);
  const [quickSeatName, setQuickSeatName] = useState("");
  const [quickSeatLoading, setQuickSeatLoading] = useState(false);

  // Free Table modal state
  const [freeTableModal, setFreeTableModal] = useState<{ table: TableData; reservation: ReservationWithGuest } | null>(null);
  const [freeTableLoading, setFreeTableLoading] = useState(false);

  const today = selectedDate;

  const fetchData = useCallback(async () => {
    if (!activeTenant) return;
    const supabase = createClient();

    const [tablesRes, reservationsRes] = await Promise.all([
      supabase
        .from("restaurant_tables")
        .select("id, name, seats, status")
        .eq("tenant_id", activeTenant.id)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("reservations")
        .select("id, date, time, end_time, shift, party_size, status, guests(name)")
        .eq("tenant_id", activeTenant.id)
        .eq("date", today)
        .in("status", [
          "confirmed",
          "seated",
          "completed",
          "escalated",
          "pending_confirmation",
        ]),
    ]);

    const fetchedTables = (tablesRes.data || []) as TableData[];
    fetchedTables.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const fetchedRes = (reservationsRes.data || []) as unknown as ReservationWithGuest[];
    setTables(fetchedTables);
    setReservations(fetchedRes);

    // Fetch table assignments for today's reservations
    const resIds = fetchedRes.map((r) => r.id);
    if (resIds.length > 0) {
      const { data: links } = await supabase
        .from("reservation_tables")
        .select("reservation_id, table_id, restaurant_tables(name)")
        .in("reservation_id", resIds);
      setResTableLinks((links || []) as unknown as ResTableLink[]);
    } else {
      setResTableLinks([]);
    }

    setLoading(false);
  }, [activeTenant, today]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time subscriptions
  useEffect(() => {
    if (!activeTenant) return;
    const supabase = createClient();

    const channel = supabase
      .channel("floor-realtime")
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "reservations", filter: `tenant_id=eq.${activeTenant.id}` },
        () => fetchData()
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "reservation_tables" },
        () => fetchData()
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "restaurant_tables", filter: `tenant_id=eq.${activeTenant.id}` },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTenant, fetchData]);

  // Filter reservations by selected shift
  const shiftReservations = reservations.filter((r) => {
    const resShift = r.shift || getShift(r.time);
    return resShift === selectedShift;
  });

  // A table is occupied as long as the linked reservation is in an active
  // state. Tables are NEVER auto-released by time — staff must free them
  // manually via the "Liberar mesa" button (which sets status=completed).
  // This keeps the visual floor and the bot's availability check in sync.
  function getTableStatus(tableId: string): {
    status: "free" | "occupied";
    reservation?: ReservationWithGuest;
  } {
    for (const link of resTableLinks) {
      if (link.table_id !== tableId) continue;
      const res = shiftReservations.find((r) => r.id === link.reservation_id);
      if (!res) continue;
      // Same active set used by atomic_book_tables (DB-side) — keep aligned
      if (
        res.status !== "seated" &&
        res.status !== "confirmed" &&
        res.status !== "escalated" &&
        res.status !== "pending_confirmation"
      ) continue;
      return { status: "occupied", reservation: res };
    }
    return { status: "free" };
  }

  // Stats (filtered by shift)
  const activeStatuses = ["confirmed", "seated", "completed", "pending_confirmation"];
  const shiftActiveRes = shiftReservations.filter((r) =>
    activeStatuses.includes(r.status)
  );
  const totalGuests = shiftActiveRes.reduce((s, r) => s + r.party_size, 0);

  const occupiedTableIds = new Set<string>();
  for (const link of resTableLinks) {
    const res = shiftReservations.find((r) => r.id === link.reservation_id);
    if (res && activeStatuses.includes(res.status)) {
      occupiedTableIds.add(link.table_id);
    }
  }
  const occupiedCount = occupiedTableIds.size;
  const pendingCount = shiftReservations.filter(
    (r) => r.status === "escalated"
  ).length;

  // Current shift reservations (already filtered)
  const currentShiftRes = shiftReservations;

  function getTablesForRes(resId: string): string[] {
    return resTableLinks
      .filter((l) => l.reservation_id === resId)
      .map((l) => l.restaurant_tables?.name || "?");
  }

  function statusPill(status: string) {
    const colors: Record<string, string> = {
      confirmed: "bg-green-100 text-green-800",
      seated: "bg-blue-100 text-blue-800",
      completed: "bg-gray-100 text-gray-800",
      escalated: "bg-orange-100 text-orange-800",
      pending_confirmation: "bg-yellow-100 text-yellow-800",
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-800"}`}
      >
        {status.replace("_", " ")}
      </span>
    );
  }

  function tableBorderColor(tableStatus: "free" | "occupied"): string {
    return tableStatus === "occupied" ? "#ef4444" : "#22c55e";
  }

  async function confirmFreeTable() {
    if (!activeTenant || !freeTableModal) return;
    setFreeTableLoading(true);
    try {
      const supabase = createClient();
      await supabase
        .from("reservations")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", freeTableModal.reservation.id);
      setFreeTableModal(null);
      // Real-time subscription will refetch automatically
    } catch (err) {
      console.error("Free table error:", err);
    } finally {
      setFreeTableLoading(false);
    }
  }

  async function handleQuickSeat() {
    if (!activeTenant || !quickSeatTable) return;
    setQuickSeatLoading(true);
    const supabase = createClient();

    try {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const walkInShift = getShift(timeStr);

      // Create or find guest
      let guestId: string;
      const guestName = quickSeatName.trim() || "Walk-in";

      const { data: existingGuest } = await supabase
        .from("guests")
        .select("id")
        .eq("tenant_id", activeTenant.id)
        .eq("name", guestName)
        .limit(1)
        .maybeSingle();

      if (existingGuest) {
        guestId = existingGuest.id;
      } else {
        const { data: newGuest, error: guestErr } = await supabase
          .from("guests")
          .insert({
            tenant_id: activeTenant.id,
            name: guestName,
            phone: "",
            visit_count: 0,
            no_show_count: 0,
            cancellation_count: 0,
            tags: [],
            notes: "",
          })
          .select("id")
          .single();
        if (guestErr || !newGuest) throw guestErr;
        guestId = newGuest.id;
      }

      // Create reservation — no end_time: walk-ins stay until manually freed
      const { data: newRes, error: resErr } = await supabase
        .from("reservations")
        .insert({
          tenant_id: activeTenant.id,
          guest_id: guestId,
          date: todayStr,
          time: timeStr,
          shift: walkInShift,
          party_size: quickSeatSize,
          status: "seated",
          source: "walk_in",
          created_by_type: "staff",
          notes: "",
        })
        .select("id")
        .single();
      if (resErr || !newRes) throw resErr;

      // Assign table
      await supabase.from("reservation_tables").insert({
        reservation_id: newRes.id,
        table_id: quickSeatTable.id,
      });

      // Close modal and reset
      setQuickSeatTable(null);
      setQuickSeatSize(2);
      setQuickSeatName("");
    } catch (err) {
      console.error("Quick seat error:", err);
    } finally {
      setQuickSeatLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 w-full">
        <p className="text-black">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">
            {t("floor_title")}
          </h1>
          <p className="mt-1 text-sm text-black">{t("floor_subtitle")}</p>
        </div>
        <div className="mt-3 sm:mt-0 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex border-2 rounded-lg overflow-hidden flex-shrink-0" style={{ borderColor: '#c4956a' }}>
            <button
              onClick={() => setSelectedShift("lunch")}
              className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold transition-colors ${selectedShift === "lunch" ? "text-white" : "text-black"}`}
              style={{ background: selectedShift === "lunch" ? '#c4956a' : 'rgba(252,246,237,0.6)' }}
            >
              {t("floor_lunch")}
            </button>
            <button
              onClick={() => setSelectedShift("dinner")}
              className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold transition-colors ${selectedShift === "dinner" ? "text-white" : "text-black"}`}
              style={{ background: selectedShift === "dinner" ? '#c4956a' : 'rgba(252,246,237,0.6)' }}
            >
              {t("floor_dinner")}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split('T')[0]); }} className="p-1 sm:p-1.5 rounded-lg hover:bg-[#c4956a]/10 transition-colors">
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border-2 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            />
            <button onClick={() => { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split('T')[0]); }} className="p-1 sm:p-1.5 rounded-lg hover:bg-[#c4956a]/10 transition-colors">
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t("floor_today"),
            value: shiftActiveRes.length,
            icon: Calendar,
            href: "/reservations",
          },
          {
            label: t("floor_guests"),
            value: totalGuests,
            icon: Users,
            href: "/guests",
          },
          {
            label: t("floor_tables"),
            value: `${occupiedCount}/${tables.length || TOTAL_TABLES}`,
            icon: LayoutGrid,
            href: null,
          },
          {
            label: t("floor_pending"),
            value: pendingCount,
            icon: AlertTriangle,
            href: "/incidents",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            onClick={() => stat.href && router.push(stat.href)}
            className={`rounded-xl p-4 border-2 transition-all ${stat.href ? 'cursor-pointer hover:shadow-lg hover:scale-[1.02]' : ''}`}
            style={{
              background: "rgba(252,246,237,0.85)",
              borderColor: "#c4956a",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">{stat.label}</p>
                <p className="text-2xl font-bold text-black mt-1">
                  {stat.value}
                </p>
              </div>
              <stat.icon className="h-8 w-8 text-[#c4956a]" />
            </div>
          </div>
        ))}
      </div>

      {/* Table Map */}
      <div>
        <h2 className="text-lg font-bold text-black mb-4">
          {t("floor_tables")}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {tables.map((table) => {
            const { status: tStatus, reservation: tRes } =
              getTableStatus(table.id);
            const guestName =
              tRes?.guests && typeof tRes.guests === "object"
                ? (tRes.guests as any).name
                : null;

            return (
              <div
                key={table.id}
                className="rounded-xl p-4 border-2 transition-all cursor-pointer hover:shadow-lg hover:scale-[1.02]"
                style={{
                  background: "rgba(252,246,237,0.85)",
                  borderColor: tableBorderColor(tStatus),
                }}
                onClick={() => {
                  if (tStatus === "free") {
                    setQuickSeatTable(table);
                    setQuickSeatSize(2);
                    setQuickSeatName("");
                  } else if (tRes) {
                    setFreeTableModal({ table, reservation: tRes });
                  }
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-black text-sm">
                    {table.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      tStatus === "free" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {tStatus === "free" ? t("floor_free") : t("floor_occupied")}
                  </span>
                </div>
                {tRes && guestName && (() => {
                  // Count how many tables this reservation uses
                  const resTablesCount = resTableLinks.filter(l => l.reservation_id === tRes.id).length;
                  return (
                    <div>
                      <p className="text-xs text-black truncate font-medium">{guestName}</p>
                      <p className="text-[10px] text-black/50">{tRes.party_size}p · {tRes.time}{resTablesCount > 1 ? ` · ${resTablesCount} mesas` : ''}</p>
                    </div>
                  );
                })()}
                {tStatus === "free" && (
                  <p className="text-xs text-black/60">
                    {t("floor_seats").replace("{count}", String(table.seats))}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Reservations for selected shift */}
      <div
        className="rounded-xl border-2 overflow-hidden"
        style={{
          background: "rgba(252,246,237,0.85)",
          borderColor: "#c4956a",
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "#c4956a" }}
        >
          <h3 className="font-bold text-black">
            {selectedShift === "lunch" ? t("floor_lunch") : t("floor_dinner")} — {selectedDate}
          </h3>
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.3)" }}>
          {currentShiftRes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-black/60 text-center">
              {t("floor_no_reservations")}
            </p>
          ) : (
            currentShiftRes.map((res) => {
              const guestName =
                res.guests && typeof res.guests === "object"
                  ? (res.guests as any).name
                  : "Guest";
              const tableNames = getTablesForRes(res.id);
              return (
                <div
                  key={res.id}
                  className="px-4 py-3 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-bold text-black">
                        {res.time}
                      </span>
                      <span className="text-sm text-black truncate">
                        {guestName}
                      </span>
                      <span className="text-xs text-black/60">
                        {res.party_size}p
                      </span>
                      {tableNames.length > 0 && (
                        <span className="text-xs text-black/40">
                          {tableNames.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  {statusPill(res.status)}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Quick Seat Modal */}
      {quickSeatTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setQuickSeatTable(null)}>
          <div
            className="rounded-2xl p-6 w-full max-w-sm border-2 shadow-xl"
            style={{ background: "rgba(252,246,237,0.97)", borderColor: "#c4956a" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-black mb-4">
              {t("floor_quick_seat").replace("{name}", quickSeatTable.name)}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">{t("floor_party_size")}</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={quickSeatSize}
                  onChange={(e) => setQuickSeatSize(Number(e.target.value))}
                  className="w-full border-2 rounded-lg px-3 py-2 text-sm text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none"
                  style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">{t("floor_guest_name_optional")}</label>
                <input
                  type="text"
                  value={quickSeatName}
                  onChange={(e) => setQuickSeatName(e.target.value)}
                  placeholder={t("floor_walkin")}
                  className="w-full border-2 rounded-lg px-3 py-2 text-sm text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none"
                  style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setQuickSeatTable(null)}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border-2 text-black transition-colors hover:bg-[#c4956a]/10"
                style={{ borderColor: "#c4956a" }}
              >
                {t("floor_cancel")}
              </button>
              <button
                onClick={handleQuickSeat}
                disabled={quickSeatLoading}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
                style={{ background: "#c4956a" }}
              >
                {quickSeatLoading ? "..." : t("floor_seat_now")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Free Table Modal */}
      {freeTableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setFreeTableModal(null)}>
          <div
            className="rounded-2xl p-6 w-full max-w-sm border-2 shadow-xl"
            style={{ background: "rgba(252,246,237,0.97)", borderColor: "#c4956a" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-black mb-2">
              {t("floor_free_table_title").replace("{name}", freeTableModal.table.name)}
            </h3>
            <div className="text-sm text-black/70 mb-4 space-y-1">
              <p>
                <span className="font-semibold">
                  {freeTableModal.reservation.guests && typeof freeTableModal.reservation.guests === "object"
                    ? (freeTableModal.reservation.guests as any).name
                    : "Guest"}
                </span>
                {" · "}
                {freeTableModal.reservation.party_size}p · {freeTableModal.reservation.time}
              </p>
              <p className="text-xs text-black/60">{t("floor_free_confirm")}</p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setFreeTableModal(null)}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border-2 text-black transition-colors hover:bg-[#c4956a]/10"
                style={{ borderColor: "#c4956a" }}
              >
                {t("floor_cancel")}
              </button>
              <button
                onClick={confirmFreeTable}
                disabled={freeTableLoading}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
                style={{ background: "#c4956a" }}
              >
                {freeTableLoading ? "..." : t("floor_free_table")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
