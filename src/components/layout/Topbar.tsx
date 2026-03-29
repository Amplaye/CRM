"use client";

import { Bell, Search, Menu, Globe } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";

export function Topbar() {
  const { language, setLanguage, t } = useLanguage();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <header className="h-16 border-b flex items-center justify-end px-4 sm:px-6 lg:px-8" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
      <div className="flex items-center space-x-3 sm:space-x-4">
        {isClient && (
          <div className="flex items-center border-2 rounded-lg px-3 py-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
            <Globe className="h-4 w-4 text-black mr-2" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "es")}
              className="bg-transparent text-sm font-medium text-black outline-none cursor-pointer"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
        )}

        <div className="relative hidden sm:block">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-black" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border-2 rounded-lg leading-5 placeholder-black/40 focus:outline-none sm:text-sm transition-colors"
            style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            placeholder={t("search_placeholder")}
          />
        </div>

        <button className="relative p-2 text-black hover:text-black rounded-lg border-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
          <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-400 ring-2 ring-white" />
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
