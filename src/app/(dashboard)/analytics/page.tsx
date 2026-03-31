"use client";

import { Download, TrendingUp, TrendingDown, Info, Sparkles } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from "recharts";
import { useLanguage } from "@/lib/contexts/LanguageContext";

const performanceData = [
  { month: 'Jan', covers: 3200, noShows: 85, recovered: 0 },
  { month: 'Feb', covers: 3150, noShows: 90, recovered: 0 },
  { month: 'Mar', covers: 3500, noShows: 25, recovered: 85 }, // AI implemented in March
];

export default function AnalyticsPage() {
  const { t } = useLanguage();
  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6 sm:space-y-8 lg:space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
           <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">{t("analytics_title")}</h1>
           <p className="mt-1 text-sm text-black">{t("analytics_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
           <select className="border-2 text-black text-sm rounded-lg block p-2 shadow-sm font-medium" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
              <option>{t("analytics_30d")}</option>
              <option>{t("analytics_ytd")}</option>
              <option>{t("analytics_all_time")}</option>
           </select>
           <button className="inline-flex items-center px-4 py-2 border-2 text-sm font-medium rounded-lg shadow-sm text-black transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
             <Download className="-ml-1 mr-2 h-4 w-4" />
             {t("analytics_export")}
           </button>
        </div>
      </div>

      <div className="rounded-2xl p-8 border-2 relative overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
         <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-emerald-50 via-white to-transparent opacity-60 rounded-full blur-3xl pointer-events-none transform translate-x-10 -translate-y-10"></div>
         <div className="flex items-center mb-8 relative z-10 text-black">
            <Info className="h-4 w-4 mr-2"/>
            <span className="text-sm font-medium">{t("analytics_factors")}</span>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
            <div className="border-l-2 border-emerald-100 pl-6">
               <p className="text-black font-semibold text-[13px] mb-2 uppercase tracking-widest flex items-center">
                 <Sparkles className="h-4 w-4 mr-1.5 text-emerald-500" /> {t("analytics_net_value")}
               </p>
               <p className="text-5xl font-bold tracking-tight text-zinc-900">€14,250</p>
               <div className="mt-4 flex items-center">
                 <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-sm font-semibold flex items-center">
                    <TrendingUp className="h-4 w-4 mr-1" /> {t("analytics_roi_cost")}
                 </span>
               </div>
            </div>
            <div className="border-l border-zinc-100 pl-6">
               <p className="text-black font-semibold text-[13px] mb-2 uppercase tracking-widest">{t("analytics_waitlist_matches")}</p>
               <p className="text-4xl font-bold tracking-tight text-zinc-900">€8,100</p>
               <p className="text-black font-medium mt-3 text-sm">{t("analytics_recovered_seats")}</p>
            </div>
            <div className="border-l border-zinc-100 pl-6">
               <p className="text-black font-semibold text-[13px] mb-2 uppercase tracking-widest">{t("analytics_noshow_reduction")}</p>
               <p className="text-4xl font-bold tracking-tight text-zinc-900">-70%</p>
               <div className="mt-3 flex items-center text-sm font-medium text-emerald-600">
                  <TrendingDown className="h-4 w-4 mr-1" /> €3,400 {t("analytics_saved_loss")}
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         <div className="p-6 rounded-2xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h3 className="text-[15px] font-semibold text-zinc-900 mb-6">{t("analytics_chart_1_title")}</h3>
            <div className="h-80">
               <ResponsiveContainer width="100%" height="100%">
                 <LineChart data={performanceData} margin={{ top: 5, right: 30, left: -20, bottom: 5 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                   <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#A1A1AA', fontSize: 12}} dy={10} />
                   <YAxis axisLine={false} tickLine={false} tick={{fill: '#A1A1AA', fontSize: 12}} />
                   <Tooltip 
                     contentStyle={{ borderRadius: '12px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }} 
                   />
                   <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                   <Line type="monotone" dataKey="noShows" name="No Shows (Missed)" stroke="#ef4444" strokeWidth={3} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}} />
                   <Line type="monotone" dataKey="recovered" name="Waitlist Recovered" stroke="#10b981" strokeWidth={3} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}} />
                 </LineChart>
               </ResponsiveContainer>
            </div>
         </div>
         <div className="p-6 rounded-2xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h3 className="text-[15px] font-semibold text-zinc-900 mb-6">{t("analytics_chart_2_title")}</h3>
            <div className="h-80">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={performanceData} margin={{ top: 5, right: 30, left: -20, bottom: 5 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                   <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#A1A1AA', fontSize: 12}} dy={10} />
                   <YAxis axisLine={false} tickLine={false} tick={{fill: '#A1A1AA', fontSize: 12}} />
                   <Tooltip 
                     cursor={{fill: '#fafafa'}} 
                     contentStyle={{ borderRadius: '12px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }} 
                   />
                   <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                   <Bar dataKey="covers" name="Monthly Covers" fill="#0f172a" radius={[4, 4, 0, 0]} maxBarSize={60} />
                 </BarChart>
               </ResponsiveContainer>
            </div>
         </div>
      </div>
    </div>
  );
}
