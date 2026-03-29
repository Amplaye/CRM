"use client";

import { useEffect, useState, useCallback } from "react";
import { Calendar, Users, LayoutGrid, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { TOTAL_TABLES, getShift, calculateEndTime, getRotationMinutes } from "@/lib/restaurant-rules";

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

  const today = selectedDate;
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

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

  // Helpers
  function timeToMin(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }

  function getTableStatus(tableId: string): {
    status: "free" | "occupied" | "ending_soon";
    reservation?: ReservationWithGuest;
  } {
    // Find a seated reservation assigned to this table right now
    for (const link of resTableLinks) {
      if (link.table_id !== tableId) continue;
      const res = reservations.find((r) => r.id === link.reservation_id);
      if (!res) continue;
      if (res.status !== "seated" && res.status !== "confirmed") continue;

      const dayOfWeek = new Date(today + "T12:00:00").getDay();
      const shift = res.shift || getShift(res.time);
      const endTime =
        res.end_time ||
        calculateEndTime(
          res.time,
          getRotationMinutes(res.party_size, shift, dayOfWeek)
        );
      const endMin = timeToMin(endTime);
      const startMin = timeToMin(res.time);

      // Check if reservation is active now
      if (nowMinutes >= startMin && nowMinutes < endMin) {
        const minutesLeft = endMin - nowMinutes;
        return {
          status: minutesLeft <= 15 ? "ending_soon" : "occupied",
          reservation: res,
        };
      }
    }
    return { status: "free" };
  }

  // Stats
  const activeStatuses = ["confirmed", "seated", "completed"];
  const todayActiveRes = reservations.filter((r) =>
    activeStatuses.includes(r.status)
  );
  const totalGuests = todayActiveRes.reduce((s, r) => s + r.party_size, 0);

  const seatedRes = reservations.filter((r) => r.status === "seated");
  const occupiedTableIds = new Set<string>();
  for (const link of resTableLinks) {
    const res = reservations.find((r) => r.id === link.reservation_id);
    if (res && res.status === "seated") {
      occupiedTableIds.add(link.table_id);
    }
  }
  const occupiedCount = occupiedTableIds.size;
  const pendingCount = reservations.filter(
    (r) => r.status === "escalated"
  ).length;

  // Split by shift
  const lunchRes = reservations.filter((r) => {
    const shift = r.shift || getShift(r.time);
    return shift === "lunch";
  });
  const dinnerRes = reservations.filter((r) => {
    const shift = r.shift || getShift(r.time);
    return shift === "dinner";
  });

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

  function tableBorderColor(
    tableStatus: "free" | "occupied" | "ending_soon"
  ): string {
    if (tableStatus === "occupied") return "#ef4444";
    if (tableStatus === "ending_soon") return "#f97316";
    return "#22c55e";
  }

  if (loading) {
    return (
      <div className="p-8 w-full">
        <p className="text-black">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="p-8 w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">
            {t("floor_title")}
          </h1>
          <p className="mt-1 text-sm text-black">{t("floor_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border-2 rounded-md px-3 py-1.5 text-sm font-medium text-black focus:ring-1 focus:ring-[#c4956a] focus:outline-none shadow-sm"
            style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t("floor_today"),
            value: todayActiveRes.length,
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
                className="rounded-xl p-4 border-2 transition-all"
                style={{
                  background: "rgba(252,246,237,0.85)",
                  borderColor: tableBorderColor(tStatus),
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-black text-sm">
                    {table.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      tStatus === "free"
                        ? "bg-green-100 text-green-800"
                        : tStatus === "ending_soon"
                          ? "bg-orange-100 text-orange-800"
                          : "bg-red-100 text-red-800"
                    }`}
                  >
                    {tStatus === "free"
                      ? t("floor_free")
                      : tStatus === "ending_soon"
                        ? t("floor_ending_soon")
                        : t("floor_occupied")}
                  </span>
                </div>
                {tRes && guestName && (
                  <p className="text-xs text-black truncate">
                    {guestName} - {tRes.party_size}p
                  </p>
                )}
                {tStatus === "free" && (
                  <p className="text-xs text-black/60">
                    {table.seats} seats
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Reservations by Shift */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lunch */}
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
            <h3 className="font-bold text-black">{t("floor_lunch")}</h3>
          </div>
          <div className="divide-y" style={{ borderColor: "#c4956a" }}>
            {lunchRes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-black/60 text-center">
                {t("floor_no_reservations")}
              </p>
            ) : (
              lunchRes.map((res) => {
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
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-black">
                          {res.time}
                        </span>
                        <span className="text-sm text-black truncate">
                          {guestName}
                        </span>
                        <span className="text-xs text-black/60">
                          {res.party_size}p
                        </span>
                      </div>
                      {tableNames.length > 0 && (
                        <p className="text-xs text-black/60 mt-0.5">
                          {tableNames.join(", ")}
                        </p>
                      )}
                    </div>
                    {statusPill(res.status)}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Dinner */}
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
            <h3 className="font-bold text-black">{t("floor_dinner")}</h3>
          </div>
          <div className="divide-y" style={{ borderColor: "#c4956a" }}>
            {dinnerRes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-black/60 text-center">
                {t("floor_no_reservations")}
              </p>
            ) : (
              dinnerRes.map((res) => {
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
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-black">
                          {res.time}
                        </span>
                        <span className="text-sm text-black truncate">
                          {guestName}
                        </span>
                        <span className="text-xs text-black/60">
                          {res.party_size}p
                        </span>
                      </div>
                      {tableNames.length > 0 && (
                        <p className="text-xs text-black/60 mt-0.5">
                          {tableNames.join(", ")}
                        </p>
                      )}
                    </div>
                    {statusPill(res.status)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
