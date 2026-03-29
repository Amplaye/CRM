"use client";

import { Save } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export default function SettingsPage() {
  const { t } = useLanguage();
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b pb-5" style={{ borderColor: '#c4956a' }}>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t("settings_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("settings_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors">
            <Save className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
            {t("settings_save")}
          </button>
        </div>
      </div>

      <div className="space-y-6">
         {/* General Section */}
         <section className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_general")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                   <label className="block text-sm font-medium text-black">{t("settings_name")}</label>
                   <input type="text" defaultValue="PICNIC" className="mt-1 block w-full rounded-md border-2 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
                </div>
                <div>
                   <label className="block text-sm font-medium text-black">{t("settings_timezone")}</label>
                   <select className="mt-1 block w-full rounded-md border-2 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                     <option>Europe/Madrid</option>
                     <option>Europe/London</option>
                     <option>America/New_York</option>
                   </select>
                </div>
            </div>
         </section>

         {/* Analytics Baselines */}
         <section className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h2 className="text-lg font-bold text-zinc-900 mb-4">{t("settings_analytics")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                   <label className="block text-sm font-medium text-black">{t("settings_avg_spend")}</label>
                   <div className="mt-1 relative rounded-md shadow-sm">
                     <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                       <span className="text-black sm:text-sm">€</span>
                     </div>
                     <input type="number" defaultValue="50" className="pl-7 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
                   </div>
                </div>
                <div>
                   <label className="block text-sm font-medium text-black">{t("settings_avg_cost")}</label>
                   <div className="mt-1 relative rounded-md shadow-sm">
                     <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                       <span className="text-black sm:text-sm">€</span>
                     </div>
                     <input type="number" defaultValue="25" className="pl-7 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
                   </div>
                </div>
            </div>
            <p className="mt-4 text-xs text-black">{t("settings_analytics_desc")}</p>
         </section>

         {/* AI Settings */}
         <section className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <div className="flex justify-between items-center mb-4">
               <h2 className="text-lg font-bold text-zinc-900">{t("settings_ai_title")}</h2>
            </div>
            <div className="space-y-4">
               <div className="flex items-start">
                  <div className="flex items-center h-5">
                     <input id="ai_booking" type="checkbox" defaultChecked className="focus:ring-zinc-500 h-4 w-4 text-zinc-600 border-zinc-300 rounded" />
                  </div>
                  <div className="ml-3 text-sm">
                     <label htmlFor="ai_booking" className="font-medium text-black">{t("settings_ai_booking")}</label>
                     <p className="text-black">{t("settings_ai_booking_desc")}</p>
                  </div>
               </div>
               <div className="flex items-start">
                  <div className="flex items-center h-5">
                     <input id="ai_voice" type="checkbox" defaultChecked className="focus:ring-zinc-500 h-4 w-4 text-zinc-600 border-zinc-300 rounded" />
                  </div>
                  <div className="ml-3 text-sm">
                     <label htmlFor="ai_voice" className="font-medium text-black">{t("settings_ai_voice")}</label>
                     <p className="text-black">{t("settings_ai_voice_desc")}</p>
                  </div>
               </div>
            </div>
         </section>
      </div>
    </div>
  );
}
