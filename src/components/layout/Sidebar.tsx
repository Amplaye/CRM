"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  BarChart, 
  Calendar, 
  Clock, 
  MessageSquare, 
  Users, 
  AlertTriangle, 
  BookOpen, 
  Zap, 
  Settings, 
  Shield,
  LayoutDashboard,
  ChevronDown,
  Check
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useAuth } from "@/lib/contexts/AuthContext";
import { useState, useRef, useEffect } from "react";
import { auth } from "@/lib/firebase/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Reservations", href: "/reservations", icon: Calendar },
  { name: "Waitlist", href: "/waitlist", icon: Clock },
  { name: "Conversations", href: "/conversations", icon: MessageSquare },
  { name: "Guests", href: "/guests", icon: Users },
  { name: "Analytics", href: "/analytics", icon: BarChart },
  { name: "Incidents", href: "/incidents", icon: AlertTriangle },
  { name: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  { name: "Automations", href: "/automations", icon: Zap },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { globalRole, activeTenant, availableTenants, switchTenant, activeRole } = useTenant();
  const { t } = useLanguage();
  const { user } = useAuth();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <aside className="w-64 bg-zinc-50 border-r border-zinc-200 h-screen flex flex-col hidden md:flex">
      <div className="h-16 flex items-center px-4 border-b border-zinc-200 relative" ref={dropdownRef}>
        <button 
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-200/50 transition-colors"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 bg-terracotta-600 rounded-md flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-white font-bold tracking-tighter text-sm">TF</span>
            </div>
            <span className="font-semibold text-zinc-900 truncate">
              {activeTenant?.name || "Loading..."}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        </button>

        {isDropdownOpen && availableTenants.length > 0 && (
          <div className="absolute top-14 left-4 right-4 bg-white border border-zinc-200 shadow-lg rounded-xl overflow-hidden z-50 py-1">
            <div className="px-3 py-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
              Workspaces
            </div>
            {availableTenants.map((tenantOption) => (
              <button
                key={tenantOption.id}
                onClick={() => {
                  switchTenant(tenantOption.id);
                  setIsDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors text-left"
              >
                <span className="truncate pr-4">{tenantOption.name}</span>
                {activeTenant?.id === tenantOption.id && <Check className="w-4 h-4 text-terracotta-600 flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-zinc-200 text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 flex-shrink-0 h-5 w-5",
                    isActive ? "text-zinc-900" : "text-zinc-400"
                  )}
                  aria-hidden="true"
                />
                {t(`nav_${item.name.toLowerCase().replace(" ", "_")}` as keyof Dictionary) || item.name}
              </Link>
            )
          })}

          {globalRole === "platform_admin" && (
            <div className="pt-4 mt-4 border-t border-zinc-200">
              <Link
               href="/admin"
                className={cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  pathname?.startsWith("/admin")
                    ? "bg-zinc-200 text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                <Shield className="mr-3 flex-shrink-0 h-5 w-5 text-zinc-400" />
                {t("nav_admin")}
              </Link>
            </div>
          )}
        </nav>
      </div>
      
      <div className="p-4 border-t border-zinc-200 bg-white">
         <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-terracotta-100 flex items-center justify-center text-terracotta-700 font-bold text-xs flex-shrink-0">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-zinc-900 truncate">{user?.email || "Demo User"}</p>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mt-0.5">{activeRole?.replace('_', ' ') || "Guest"}</p>
            </div>
         </div>
         <button 
           onClick={() => { auth.signOut(); }} 
           className="mt-4 w-full text-xs text-zinc-500 hover:text-zinc-900 font-medium text-left px-1 transition-colors"
         >
           Sign out
         </button>
      </div>
    </aside>
  );
}
