"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export default function AdminPage() {
  const { globalRole } = useTenant();
  const { t } = useLanguage();

  if (globalRole !== "platform_admin") {
     return (
        <div className="p-8 max-w-7xl mx-auto flex justify-center mt-20 text-black text-center">
           {t("admin_unauthorized")}
        </div>
     );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">{t("admin_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("admin_subtitle")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h3 className="font-semibold text-black text-sm">{t("admin_total_tenants")}</h3>
            <p className="text-3xl font-bold mt-2">12</p>
         </div>
         <div className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h3 className="font-semibold text-black text-sm">{t("admin_conv_processed")}</h3>
            <p className="text-3xl font-bold mt-2 text-indigo-600">4,209</p>
         </div>
         <div className="p-6 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
            <h3 className="font-semibold text-black text-sm">{t("admin_health")}</h3>
            <p className="text-3xl font-bold mt-2 text-emerald-600">100%</p>
         </div>
      </div>

      <div className="border-2 rounded-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
         <div className="px-6 py-4 border-b flex justify-between items-center" style={{ borderColor: '#c4956a' }}>
            <h2 className="font-medium text-zinc-900">{t("admin_tenants_list")}</h2>
            <button className="px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded">{t("admin_provision")}</button>
         </div>
         <table className="min-w-full divide-y divide-zinc-200">
            <tbody className="divide-y divide-zinc-100 text-sm">
               <tr className="hover:bg-zinc-50">
                  <td className="px-6 py-4 font-medium">PICNIC</td>
                  <td className="px-6 py-4 text-black">{t("admin_since_oct")}</td>
                  <td className="px-6 py-4"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">{t("admin_healthy")}</span></td>
                  <td className="px-6 py-4 text-right text-indigo-600 font-medium cursor-pointer">{t("admin_impersonate")}</td>
               </tr>
               <tr className="hover:bg-zinc-50">
                  <td className="px-6 py-4 font-medium">Trattoria Napoletana</td>
                  <td className="px-6 py-4 text-black">{t("admin_since_dec")}</td>
                  <td className="px-6 py-4"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">{t("admin_healthy")}</span></td>
                  <td className="px-6 py-4 text-right text-indigo-600 font-medium cursor-pointer">{t("admin_impersonate")}</td>
               </tr>
            </tbody>
         </table>
      </div>
    </div>
  );
}
