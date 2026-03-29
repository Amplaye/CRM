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
import { createClient } from "@/lib/supabase/client";

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

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <aside className="w-64 border-r h-screen flex flex-col hidden md:flex" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
      <div className="h-16 flex items-center px-4 border-b relative" style={{ borderColor: '#c4956a' }} ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#c4956a]/10 transition-colors"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <img src="/logo.png" alt="BaliFlow" className="w-8 h-8 rounded-md flex-shrink-0 shadow-sm object-cover" />
            <span className="font-semibold text-zinc-900 truncate">
              {activeTenant?.name || "Loading..."}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-black" />
        </button>

        {isDropdownOpen && availableTenants.length > 0 && (
          <div className="absolute top-14 left-4 right-4 border shadow-lg rounded-xl overflow-hidden z-50 py-1" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
            <div className="px-3 py-2 text-xs font-semibold tracking-wider text-black uppercase">
              Workspaces
            </div>
            {availableTenants.map((tenantOption) => (
              <button
                key={tenantOption.id}
                onClick={() => {
                  switchTenant(tenantOption.id);
                  setIsDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-black hover:bg-[#c4956a]/10 transition-colors text-left"
              >
                <span className="truncate pr-4">{tenantOption.name}</span>
                {activeTenant?.id === tenantOption.id && <Check className="w-4 h-4 text-[#c4956a] flex-shrink-0" />}
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
                    ? "bg-[#c4956a]/20 text-black"
                    : "text-black hover:bg-[#c4956a]/10 hover:text-black"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 flex-shrink-0 h-5 w-5",
                    isActive ? "text-black" : "text-black"
                  )}
                  aria-hidden="true"
                />
                {t(`nav_${item.name.toLowerCase().replace(" ", "_")}` as keyof Dictionary) || item.name}
              </Link>
            )
          })}

          {globalRole === "platform_admin" && (
            <div className="pt-4 mt-4 border-t" style={{ borderColor: '#c4956a' }}>
              <Link
               href="/admin"
                className={cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  pathname?.startsWith("/admin")
                    ? "bg-[#c4956a]/20 text-black"
                    : "text-black hover:bg-[#c4956a]/10 hover:text-black"
                )}
              >
                <Shield className="mr-3 flex-shrink-0 h-5 w-5 text-black" />
                {t("nav_admin")}
              </Link>
            </div>
          )}
        </nav>
      </div>

      <div className="p-4 border-t" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.85)' }}>
         <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-terracotta-100 flex items-center justify-center text-terracotta-700 font-bold text-xs flex-shrink-0">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-zinc-900 truncate">{user?.email || "User"}</p>
              <p className="text-xs font-medium text-black uppercase tracking-wider mt-0.5">{activeRole?.replace('_', ' ') || "Guest"}</p>
            </div>
         </div>
         <button
           onClick={handleSignOut}
           className="mt-4 w-full text-xs text-black hover:text-black font-medium text-left px-1 transition-colors"
         >
           Sign out
         </button>
      </div>
    </aside>
  );
}
