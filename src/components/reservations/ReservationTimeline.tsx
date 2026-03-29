"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Reservation } from "@/lib/types";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/layout/Sidebar";

export function ReservationTimeline({ date, onRowClick }: { date: string, onRowClick: (r: Reservation) => void }) {
  const { activeTenant } = useTenant();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant) return;

    const supabase = createClient();

    const fetchReservations = async () => {
      const { data: results, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("tenant_id", activeTenant.id)
        .eq("date", date);

      if (error) {
        console.error("Failed to load timeline reservations", error);
        setLoading(false);
        return;
      }

      const sorted = (results as Reservation[]).sort((a, b) => a.time.localeCompare(b.time));
      setReservations(sorted);
      setLoading(false);
    };

    fetchReservations();

    const channel = supabase.channel(`reservations-timeline-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${activeTenant.id}` }, () => fetchReservations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTenant, date]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta-500" />
      </div>
    );
  }

  if (reservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-black border-2 rounded-xl" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        <p>No reservations for this date timeline.</p>
      </div>
    );
  }

  // Generate hours from 11:00 to 23:00
  const hours = Array.from({ length: 13 }, (_, i) => i + 11);

  return (
    <div className="border-2 text-sm rounded-xl overflow-hidden relative" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
      <div className="flex border-b" style={{ borderColor: '#c4956a' }}>
        <div className="w-24 border-r py-3 px-4 font-semibold text-black" style={{ borderColor: '#c4956a' }}>Time</div>
        <div className="flex-1 py-3 px-4 font-semibold text-black">Service Floor</div>
      </div>

      {hours.map((hour) => {
        const hourString = `${hour.toString().padStart(2, '0')}`;
        // Find matching reservations in this hour block (e.g. 11:00 - 11:59)
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
                    "px-3 py-2 rounded-lg text-left transition-colors border shadow-sm w-48",
                    res.status === 'confirmed' ? "border-[#c4956a] hover:border-[#b8845c] focus:ring-1 focus:ring-[#c4956a]" :
                    res.status === 'seated' ? "bg-blue-50 border-blue-200 text-blue-900" :
                    res.status === 'completed' ? "bg-green-50 border-green-200 text-green-900" :
                    "bg-zinc-100 border-zinc-200 text-zinc-500 opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                     <span className="font-bold text-zinc-900">{res.time}</span>
                     <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">v.{res.party_size}</span>
                  </div>
                  <div className="text-xs truncate font-medium text-black mt-1">
                     {res.guest_id.slice(0, 8)} | Table Auto
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  );
}
