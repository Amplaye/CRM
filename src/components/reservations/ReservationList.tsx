"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Reservation } from "@/lib/types";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Clock, User, Phone, MessageSquare, Globe, UserCheck, AlertTriangle, UserMinus, CalendarCheck, Plus } from "lucide-react";
import Link from "next/link";

interface ReservationListProps {
  date: string;
  onRowClick?: (res: Reservation) => void;
}

export function ReservationList({ date, onRowClick }: ReservationListProps) {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const [reservations, setReservations] = useState<(Reservation & { guest_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);

    const supabase = createClient();

    const fetchReservations = async () => {
      const { data: resData, error } = await supabase
        .from("reservations")
        .select("*, guests(name)")
        .eq("tenant_id", tenant.id)
        .eq("date", date);

      if (error) {
        console.error("Failed to load reservations", error);
        setLoading(false);
        return;
      }

      const withNames = (resData || []).map((r: any) => ({
        ...r,
        guest_name: r.guests?.name || undefined,
      })) as (Reservation & { guest_name?: string })[];

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
      case 'confirmed': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><UserCheck className="w-3 h-3 mr-1" /> {t("status_confirmed")}</span>;
      case 'seated': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">Seated</span>; // Not in dict, left as is
      case 'cancelled': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200"><UserMinus className="w-3 h-3 mr-1" /> {t("status_cancelled")}</span>;
      case 'no_show': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-100"><AlertTriangle className="w-3 h-3 mr-1" /> {t("status_no_show")}</span>;
      default: return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">Pending</span>;
    }
  };

  const SourceIcon = ({ source }: { source: Reservation['source'] }) => {
    switch(source) {
       case 'ai_chat': return <div title="AI WhatsApp" className="flex h-6 w-6 items-center justify-center rounded bg-terracotta-50 text-terracotta-600 ring-1 ring-terracotta-200"><MessageSquare className="h-3 w-3" /></div>;
       case 'ai_voice': return <div title="AI Voice" className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"><Phone className="h-3 w-3" /></div>;
       case 'web': return <div title="Website" className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200"><Globe className="h-3 w-3" /></div>;
       default: return <div title="Staff" className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200"><User className="h-3 w-3" /></div>;
    }
  };

  if (loading) {
    return (
      <div className="border-2 rounded-b-xl animate-pulse" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        <div className="h-12 border-b" style={{ borderColor: '#c4956a' }}></div>
        {[1,2,3,4,5].map(i => (
          <div key={i} className="h-16 border-b border-zinc-100 flex items-center px-6">
            <div className="h-4 w-12 bg-zinc-200 rounded mr-8"></div>
            <div className="h-4 w-48 bg-zinc-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  // Handle empty state gracefully
  if (!reservations || reservations.length === 0) {
      return (
         <div className="border-2 rounded-b-xl py-16 text-center" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <CalendarCheck className="mx-auto h-12 w-12 text-zinc-300 mb-4" />
            <h3 className="text-sm font-medium text-zinc-900">{t("res_empty_title")}</h3>
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
    <div className="border-2 rounded-b-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
      <table className="min-w-full table-fixed divide-y" style={{ borderColor: '#c4956a' }}>
        <thead>
          <tr>
            <th scope="col" className="w-1/5 px-6 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_time")}</th>
            <th scope="col" className="w-1/5 px-6 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_guest")}</th>
            <th scope="col" className="w-1/5 px-6 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_party")}</th>
            <th scope="col" className="w-1/5 px-6 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_status")}</th>
            <th scope="col" className="w-1/5 px-6 py-3 text-center text-xs font-semibold text-black uppercase tracking-wider">{t("res_col_source")}</th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
          {reservations.map((res) => (
            <tr
               key={res.id}
               onClick={() => onRowClick?.(res)}
               className={`hover:bg-[#c4956a]/10 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
            >
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <div className="flex items-center justify-center text-sm font-bold text-zinc-900">
                  <Clock className="w-4 h-4 text-black mr-2" />
                  {res.time}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <div className="text-sm font-medium text-zinc-900">{res.guest_name || `Guest (${res.guest_id.substring(0,8)})`}</div>
                {res.notes && <div className="text-xs text-black truncate max-w-[200px]">{res.notes}</div>}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <div className="text-sm font-medium text-zinc-900">{res.party_size}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <StatusPill status={res.status} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <Link href={`/conversations?guest=${res.guest_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex justify-center hover:scale-110 transition-transform" title="Open conversation">
                  <SourceIcon source={res.source} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
