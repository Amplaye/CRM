"use client";

import { Bell, Search, Menu, Globe } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";

export function Topbar() {
  const { activeTenant, availableTenants, switchTenant } = useTenant();
  const { language, setLanguage, t } = useLanguage();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-4 sm:px-6 lg:px-8">
      <div className="flex items-center flex-1">
        <button className="md:hidden text-zinc-400 hover:text-zinc-500 p-2 mr-2">
          <Menu className="h-6 w-6" />
        </button>

        {isClient && availableTenants.length > 0 && (
          <div className="flex items-center">
             <select
                className="bg-zinc-50 border border-zinc-200 text-zinc-900 text-sm rounded-lg focus:ring-zinc-500 focus:border-zinc-500 block w-full p-2.5 outline-none font-medium"
                value={activeTenant?.id || ""}
                onChange={(e) => switchTenant(e.target.value)}
             >
                {availableTenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
             </select>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3 sm:space-x-4">
        {isClient && (
          <div className="flex items-center bg-zinc-50 border border-zinc-200 rounded-md px-2 py-1">
            <Globe className="h-4 w-4 text-zinc-400 mr-2" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "es")}
              className="bg-transparent text-sm font-medium text-zinc-700 outline-none cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
          </div>
        )}
      
        <div className="relative hidden sm:block">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-zinc-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-zinc-200 rounded-md leading-5 bg-zinc-50 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-500 sm:text-sm transition-colors"
            placeholder={t("search_placeholder")}
          />
        </div>
        
        <button className="relative p-2 text-zinc-400 hover:text-zinc-500 bg-zinc-50 rounded-full border border-zinc-200">
          <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-400 ring-2 ring-white" />
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
