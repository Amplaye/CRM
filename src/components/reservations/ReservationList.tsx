"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Reservation } from "@/lib/types";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Clock, User, Phone, MessageSquare, Globe, UserCheck, AlertTriangle, UserMinus, CalendarCheck, Plus, Users, XCircle, Armchair } from "lucide-react";
import Link from "next/link";

interface ReservationListProps {
  date: string;
  onRowClick?: (res: Reservation) => void;
}

export function ReservationList({ date, onRowClick }: ReservationListProps) {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const [reservations, setReservations] = useState<(Reservation & { guest_name?: string; guest_phone?: string; table_names?: string[] })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);

    const supabase = createClient();

    const fetchReservations = async () => {
      const { data: resData, error } = await supabase
        .from("reservations")
        .select("*, guests(name, phone)")
        .eq("tenant_id", tenant.id)
        .eq("date", date);

      if (error) {
        console.error("Failed to load reservations", error);
        setLoading(false);
        return;
      }

      const resIds = (resData || []).map((r: any) => r.id);
      let tableMap: Record<string, string[]> = {};
      if (resIds.length > 0) {
        const { data: links } = await supabase
          .from("reservation_tables")
          .select("reservation_id, restaurant_tables(name)")
          .in("reservation_id", resIds);
        for (const link of (links || []) as any[]) {
          if (!tableMap[link.reservation_id]) tableMap[link.reservation_id] = [];
          if (link.restaurant_tables?.name) tableMap[link.reservation_id].push(link.restaurant_tables.name);
        }
      }

      const withNames = (resData || []).map((r: any) => ({
        ...r,
        guest_name: r.guests?.name || undefined,
        guest_phone: r.guests?.phone || undefined,
        table_names: tableMap[r.id] || [],
      })) as (Reservation & { guest_name?: string; guest_phone?: string; table_names?: string[] })[];

      const sorted = withNames.sort((a, b) => a.time.localeCompare(b.time));
      setReservations(sorted);
      setLoading(false);
    };

    fetchReservations();

    const channel = supabase.channel(`reservations-list-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${tenant.id}` }, () => fetchReservations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant, date]);

  const StatusPill = ({ status }: { status: Reservation['status'] }) => {
    switch (status) {
      case 'confirmed': return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><UserCheck className="w-3 h-3 mr-1" /> {t("status_confirmed")}</span>;
      case 'seated': return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">Seated</span>;
      case 'cancelled': return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200"><UserMinus className="w-3 h-3 mr-1" /> {t("status_cancelled")}</span>;
      case 'no_show': return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-100"><AlertTriangle className="w-3 h-3 mr-1" /> {t("status_no_show")}</span>;
      default: return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">Pending</span>;
    }
  };

  const SourceIcon = ({ source }: { source: Reservation['source'] }) => {
    switch(source) {
       case 'ai_chat': return <div title="AI WhatsApp" className="flex h-6 w-6 items-center justify-center rounded bg-terracotta-50 text-terracotta-600 ring-1 ring-terracotta-200"><MessageSquare className="h-3 w-3" /></div>;
       case 'ai_voice': return <div title="AI Voice" className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"><Phone className="h-3 w-3" /></div>;
       case 'web': return <div title="Website" className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-black ring-1 ring-zinc-200"><Globe className="h-3 w-3" /></div>;
       default: return <div title="Staff" className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-black ring-1 ring-zinc-200"><User className="h-3 w-3" /></div>;
    }
  };

  const handleCancel = async (e: React.MouseEvent, resId: string) => {
    e.stopPropagation();
    if (!confirm("¿Cancelar esta reserva?")) return;
    const supabase = createClient();
    await supabase.from("reservations").update({ status: "cancelled" }).eq("id", resId);
  };

  const handleSeat = async (e: React.MouseEvent, resId: string) => {
    e.stopPropagation();
    const supabase = createClient();
    await supabase.from("reservations").update({ status: "seated", updated_at: new Date().toISOString() }).eq("id", resId);
  };

  if (loading) {
    return (
      <div className="border-2 rounded-b-xl md:rounded-xl animate-pulse" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        <div className="h-12 border-b hidden md:block" style={{ borderColor: '#c4956a' }}></div>
        {[1,2,3,4,5].map(i => (
          <div key={i} className="h-16 border-b border-zinc-100 flex items-center px-4 md:px-6">
            <div className="h-4 w-12 bg-zinc-200 rounded mr-8"></div>
            <div className="h-4 w-48 bg-zinc-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  if (!reservations || reservations.length === 0) {
      return (
         <div className="border-2 rounded-b-xl md:rounded-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <CalendarCheck className="mx-auto h-12 w-12 text-black mb-4" />
            <h3 className="text-sm font-medium text-black">{t("res_empty_title")}</h3>
            <p className="mt-1 text-sm text-black">{t("res_empty_subtitle")}</p>
            <div className="mt-6">
               <button className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg">
                  <Plus className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
                  {t("res_new")}
               </button>
            </div>
         </div>
      );
  }

  return (
    <>
    {/* Mobile: card list */}
    <div className="md:hidden space-y-2">
      {reservations.map((res) => (
        <div
          key={res.id}
          onClick={() => onRowClick?.(res)}
          className={`rounded-xl border-2 p-3 transition-all ${onRowClick ? 'cursor-pointer active:scale-[0.98]' : ''}`}
          style={{ background: 'rgba(252,246,237,0.85)', borderColor: 'rgba(196,149,106,0.4)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
              <span className="text-sm font-bold text-black">{res.time}</span>
              <span className="text-[10px] text-black">{res.party_size}p</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-black truncate">{res.guest_name || "Guest"}</p>
                <SourceIcon source={res.source} />
              </div>
              <p className="text-xs text-black truncate">{res.guest_phone || "—"}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {res.status === 'confirmed' && (
                <button onClick={(e) => handleSeat(e, res.id)} className="px-2 py-1 text-xs font-bold rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors" title="Sentar">
                  <Armchair className="w-3.5 h-3.5" />
                </button>
              )}
              <StatusPill status={res.status} />
            </div>
          </div>
          {(res.notes || (res.table_names && res.table_names.length > 0)) && (
            <div className="flex items-center gap-2 mt-1.5 pl-[60px]">
              {res.table_names && res.table_names.length > 0 && <span className="text-[10px] text-black">{res.table_names.join(", ")}</span>}
              {res.notes && <p className="text-[11px] text-black truncate">{res.notes}</p>}
            </div>
          )}
        </div>
      ))}
    </div>

    {/* Desktop: full table */}
    <div className="hidden md:block border-2 rounded-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
      <table className="min-w-full table-fixed divide-y" style={{ borderColor: '#c4956a' }}>
        <thead>
          <tr>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_time")}</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_guest")}</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">Phone</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_party")}</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">Table</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_status")}</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_source")}</th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
          {reservations.map((res) => (
            <tr
               key={res.id}
               onClick={() => onRowClick?.(res)}
               className={`hover:bg-[#c4956a]/10 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
            >
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <div className="flex items-center justify-center text-sm font-bold text-black">
                  <Clock className="w-4 h-4 text-black mr-2" />
                  {res.time}
                </div>
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <div className="text-sm font-medium text-black">{res.guest_name || `Guest (${res.guest_id.substring(0,8)})`}</div>
                {res.notes && <div className="text-xs text-black truncate max-w-[200px] mx-auto text-center">{res.notes}</div>}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <div className="text-sm text-black">{res.guest_phone || "—"}</div>
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <div className="text-sm font-medium text-black">{res.party_size}</div>
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <div className="text-xs font-medium text-black">
                  {res.table_names && res.table_names.length > 0 ? res.table_names.join(", ") : "—"}
                </div>
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <StatusPill status={res.status} />
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                <Link href={`/conversations?guest=${res.guest_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex justify-center hover:scale-110 transition-transform" title="Open conversation">
                  <SourceIcon source={res.source} />
                </Link>
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-center">
                {!['cancelled', 'no_show'].includes(res.status) && (
                  <button onClick={(e) => handleCancel(e, res.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Cancelar reserva">
                    <XCircle className="w-5 h-5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
