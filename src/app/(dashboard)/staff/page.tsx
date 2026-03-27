"use client";

import { UserPlus, Shield } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export default function StaffPage() {
  const { t } = useLanguage();
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t("staff_title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("staff_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors">
            <UserPlus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
            {t("staff_invite")}
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
         <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("staff_col_name")}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("staff_col_role")}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("staff_col_status")}</th>
              <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            <tr>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-zinc-100 flex justify-center items-center text-zinc-600 font-bold">SO</div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-zinc-900">Sarah Owner</div>
                    <div className="text-sm text-zinc-500">sarah@picnic.com</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-zinc-900 flex items-center">
                    <Shield className="w-4 h-4 mr-1 text-terracotta-600" /> Owner
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-800">Active</span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <span className="text-zinc-400 hover:text-zinc-900 cursor-pointer">Edit</span>
              </td>
            </tr>
            
            <tr>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-zinc-100 flex justify-center items-center text-zinc-600 font-bold">JD</div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-zinc-900">John Doe (You)</div>
                    <div className="text-sm text-zinc-500">manager@picnic.com</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-zinc-900">Manager</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-800">Active</span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              </td>
            </tr>
            
            <tr>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-zinc-100 flex justify-center items-center text-zinc-600 font-bold">?</div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-zinc-900 italic">Pending Invite</div>
                    <div className="text-sm text-zinc-500">host1@picnic.com</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-zinc-900">Host</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-zinc-100 text-zinc-800">Invited</span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <span className="text-red-600 hover:text-red-900 cursor-pointer">Revoke</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
