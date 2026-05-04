"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Reservation } from "@/lib/types";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/layout/Sidebar";

interface ResWithGuest extends Reservation {
  guest_name?: string;
  table_names?: string[];
}

export function ReservationTimeline({ date, shiftFilter = "all", onRowClick }: { date: string, shiftFilter?: "all" | "lunch" | "dinner", onRowClick: (r: Reservation) => void }) {
  const { activeTenant } = useTenant();
  const [reservations, setReservations] = useState<ResWithGuest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant) return;

    const supabase = createClient();

    const fetchReservations = async () => {
      const { data: results, error } = await supabase
        .from("reservations")
        .select("*, guests(name), reservation_tables(restaurant_tables(name))")
        .eq("tenant_id", activeTenant.id)
        .eq("date", date);

      if (error) {
        console.error("Failed to load timeline reservations", error);
        setLoading(false);
        return;
      }

      const resData = (results || []) as any[];

      const withNames: ResWithGuest[] = resData.map(r => ({
        ...r,
        guest_name: r.guests?.name || undefined,
        table_names: (r.reservation_tables || [])
          .map((rt: any) => rt.restaurant_tables?.name)
          .filter(Boolean),
      }));

      const sorted = withNames.sort((a, b) => a.time.localeCompare(b.time));
      const filtered = shiftFilter === "all"
        ? sorted
        : sorted.filter((r: any) => {
            const rs = r.shift || (parseInt((r.time || '00').split(':')[0]) < 16 ? 'lunch' : 'dinner');
            return rs === shiftFilter;
          });
      setReservations(filtered);
      setLoading(false);
    };

    fetchReservations();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchReservations(), 300);
    };

    const channel = supabase.channel(`reservations-timeline-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${activeTenant.id}` }, (payload: any) => {
        const row = payload.new || payload.old;
        if (row && row.date && row.date !== date) return;
        debouncedFetch();
      })
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [activeTenant, date, shiftFilter]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-[#c4956a]" />
      </div>
    );
  }

  if (reservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-black border-2 border-t-0 rounded-b-xl" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        <p>No reservations for this date.</p>
      </div>
    );
  }

  const hours = Array.from({ length: 13 }, (_, i) => i + 11);

  return (
    <div className="border-2 border-t-0 text-sm rounded-b-xl overflow-hidden relative" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
      <div className="flex border-b" style={{ borderColor: '#c4956a' }}>
        <div className="w-24 border-r py-3 px-4 font-semibold text-black" style={{ borderColor: '#c4956a' }}>Time</div>
        <div className="flex-1 py-3 px-4 font-semibold text-black">Service Floor</div>
      </div>

      {hours.map((hour) => {
        const hourString = `${hour.toString().padStart(2, '0')}`;
        const activeRes = reservations.filter(r => r.time.startsWith(hourString));

        return (
          <div key={hour} className="flex border-b min-h-[80px]" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
            <div className="w-24 border-r py-4 px-4 font-medium text-black text-xs" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
              {hourString}:00
            </div>
            <div className="flex-1 p-2 flex flex-wrap gap-2 items-start content-start">
              {activeRes.map((res) => (
                <button
                  key={res.id}
                  onClick={() => onRowClick(res)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-left transition-colors border shadow-sm w-52",
                    res.status === 'confirmed' ? "border-[#c4956a] hover:border-[#b8845c]" :
                    res.status === 'seated' ? "bg-blue-50 border-blue-200 text-blue-900" :
                    res.status === 'completed' ? "bg-green-50 border-green-200 text-green-900" :
                    res.status === 'escalated' ? "bg-orange-50 border-orange-200 text-orange-900" :
                    "bg-zinc-100 border-zinc-200 text-black opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-black">{res.time}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 text-black font-medium">{res.party_size}p</span>
                  </div>
                  <div className="text-xs font-medium text-black truncate">
                    {res.guest_name || "Unknown"}
                  </div>
                  {res.table_names && res.table_names.length > 0 && (
                    <div className="text-[10px] text-black mt-0.5">
                      {res.table_names.join(", ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  );
}
