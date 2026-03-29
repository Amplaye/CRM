"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  Clock,
  MessageSquare,
  Users,
  BookOpen,
  Settings,
  Shield,
  LayoutDashboard,
  LayoutGrid,
  ClipboardList,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: "Tables", href: "/floor", icon: LayoutGrid },
  { name: "Reservations", href: "/reservations", icon: Calendar },
  { name: "Waitlist", href: "/waitlist", icon: Clock },
  { name: "Pending", href: "/pending", icon: ClipboardList },
  { name: "Conversations", href: "/conversations", icon: MessageSquare },
  { name: "Guests", href: "/guests", icon: Users },
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { globalRole, activeTenant, activeRole } = useTenant();
  const { t } = useLanguage();
  const { user } = useAuth();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <aside className="w-64 border-r h-screen flex flex-col hidden md:flex flex-shrink-0" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
      <div className="h-16 flex items-center px-4 border-b" style={{ borderColor: '#c4956a' }}>
        <img src="/logo.png" alt="BaliFlow" className="w-8 h-8 rounded-md flex-shrink-0 shadow-sm object-cover" />
        <span className="font-semibold text-black text-lg flex-1 text-center">
          {activeTenant?.name || "BaliFlow"}
        </span>
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
                  className="mr-3 flex-shrink-0 h-5 w-5 text-black"
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
            <div className="h-8 w-8 rounded-full bg-[#c4956a]/20 flex items-center justify-center text-[#8b6540] font-bold text-xs flex-shrink-0">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-black truncate">{user?.email || "User"}</p>
              <p className="text-xs font-medium text-black/60 uppercase tracking-wider mt-0.5">{activeRole?.replace('_', ' ') || "Guest"}</p>
            </div>
         </div>
         <button
           onClick={handleSignOut}
           className="mt-4 w-full text-xs text-black hover:text-black/70 font-medium text-left px-1 transition-colors"
         >
           Sign out
         </button>
      </div>
    </aside>
  );
}
