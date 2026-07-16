"use client";

import { Armchair, ShoppingBag, Coffee, Clock, Users } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { fmtEur } from "@/lib/cassa/totals";
import type { CassaOrderFull } from "@/lib/cassa/types";

// Room view: one tap per table. Free tables are outlined; tables with a live
// bill show its running total and age. Counter ("Banco") and takeaway sales
// live as chips above the grid, since they have no table.

export interface CassaTable {
  id: string;
  name: string;
  seats: number;
  zone: string;
}

interface SalaViewProps {
  tables: CassaTable[];
  openOrders: CassaOrderFull[];
  onOpenTable: (table: CassaTable, existing: CassaOrderFull | null) => void;
  onCounterSale: (kind: "banco" | "asporto") => void;
  onResume: (order: CassaOrderFull) => void;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function SalaView({ tables, openOrders, onOpenTable, onCounterSale, onResume }: SalaViewProps) {
  const { t } = useLanguage();

  const orderByTable = new Map<string, CassaOrderFull>();
  const looseOrders: CassaOrderFull[] = [];
  for (const o of openOrders) {
    if (o.table_id) orderByTable.set(o.table_id, o);
    else looseOrders.push(o);
  }

  const zones = [...new Set(tables.map((t_) => t_.zone || "Principal"))];

  return (
    <div className="space-y-5">
      {/* Counter / takeaway quick sales */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onCounterSale("banco")}
          className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border-2 text-sm font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer"
          style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
        >
          <Coffee className="w-4 h-4" /> {t("cassa_counter_sale")}
        </button>
        <button
          onClick={() => onCounterSale("asporto")}
          className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border-2 text-sm font-bold text-black hover:bg-[#c4956a]/10 cursor-pointer"
          style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
        >
          <ShoppingBag className="w-4 h-4" /> {t("cassa_takeaway")}
        </button>
        {looseOrders.map((o) => (
          <button
            key={o.id}
            onClick={() => onResume(o)}
            className="inline-flex items-center gap-2 px-4 h-11 rounded-xl text-sm font-bold text-white cursor-pointer"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {o.table_name} · {fmtEur(o.total)}
            <span className="inline-flex items-center gap-1 text-xs font-medium opacity-90">
              <Clock className="w-3 h-3" /> {minutesSince(o.opened_at)}′
            </span>
          </button>
        ))}
      </div>

      {tables.length === 0 && (
        <div
          className="rounded-xl border-2 p-6 text-center text-black text-sm"
          style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
        >
          {t("cassa_no_tables_hint")}
        </div>
      )}

      {zones.map((zone) => (
        <div key={zone}>
          {zones.length > 1 && (
            <h3 className="text-sm font-bold text-black uppercase tracking-wide mb-2">{zone}</h3>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {tables
              .filter((tb) => (tb.zone || "Principal") === zone)
              .map((tb) => {
                const order = orderByTable.get(tb.id) || null;
                return (
                  <button
                    key={tb.id}
                    onClick={() => onOpenTable(tb, order)}
                    className="relative h-24 rounded-2xl border-2 p-3 text-left cursor-pointer transition-transform active:scale-95"
                    style={
                      order
                        ? { background: "linear-gradient(135deg, #d4a574, #c4956a)", borderColor: "#b07f4e" }
                        : { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }
                    }
                  >
                    <div className={`font-bold text-base truncate ${order ? "text-white" : "text-black"}`}>
                      {tb.name}
                    </div>
                    {order ? (
                      <>
                        <div className="text-white font-bold text-lg leading-tight">{fmtEur(order.total)}</div>
                        <div className="text-white/90 text-xs flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {minutesSince(order.opened_at)}′
                          {order.covers > 0 && (
                            <>
                              <span>·</span>
                              <Users className="w-3 h-3" /> {order.covers}
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-black text-xs flex items-center gap-1 mt-1">
                        <Armchair className="w-3.5 h-3.5" /> {tb.seats}
                      </div>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
