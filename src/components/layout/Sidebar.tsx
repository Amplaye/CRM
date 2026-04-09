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
  LayoutGrid,
  BarChart3,
  ClipboardList,
  X,
  Activity,
  AlertOctagon,
  DollarSign,
  Bug,
  StickyNote,
  Inbox,
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
  { name: "Analytics", href: "/", icon: BarChart3 },
  { name: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  { name: "Settings", href: "/settings", icon: Settings },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { globalRole, activeTenant, activeRole } = useTenant();
  const { t } = useLanguage();
  const { user } = useAuth();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleNavClick = () => {
    onClose?.();
  };

  const isPlatformOnly = globalRole === "platform_admin" && !activeTenant;

  const adminNavItems = [
    { href: "/admin", icon: Shield, label: "Tenants" },
    { href: "/admin/bali", icon: Inbox, label: "Bali Inbox" },
    { href: "/admin/costs", icon: DollarSign, label: "Usage & Costs" },
    { href: "/admin/debug", icon: Bug, label: "Quick Debug" },
    { href: "/admin/clients", icon: StickyNote, label: "Client Notes" },
    { href: "/admin/health", icon: Activity, label: "System Health" },
    { href: "/admin/incidents", icon: AlertOctagon, label: "All Incidents" },
  ];

  const sidebarContent = (
    <>
      <div className="h-14 md:h-16 flex items-center px-4 border-b" style={{ borderColor: '#c4956a' }}>
        <img src="/logo.png" alt="BaliFlow" className="w-7 h-7 md:w-8 md:h-8 rounded-md flex-shrink-0 shadow-sm object-cover" />
        <span className="font-semibold text-black text-base md:text-lg flex-1 text-center">
          {isPlatformOnly ? "Platform Admin" : activeTenant?.name || "BaliFlow"}
        </span>
        <button onClick={onClose} className="md:hidden p-1 -mr-1 hover:bg-[#c4956a]/10 rounded-lg">
          <X className="w-5 h-5 text-black" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3 md:py-4">
        <nav className="space-y-0.5 md:space-y-1 px-2 md:px-3">
          {/* Restaurant nav — only show if user has a tenant */}
          {!isPlatformOnly && navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center px-3 py-2.5 md:py-2 text-sm font-medium rounded-md transition-colors",
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

          {/* Admin nav */}
          {globalRole === "platform_admin" && (
            <div className={isPlatformOnly ? "" : "pt-3 mt-3 md:pt-4 md:mt-4 border-t"} style={isPlatformOnly ? {} : { borderColor: '#c4956a' }}>
              <div className="space-y-0.5">
                {adminNavItems.map(item => (
                  <Link key={item.href} href={item.href} onClick={handleNavClick}
                    className={cn(
                      "flex items-center px-3 py-2.5 md:py-2 text-sm font-medium rounded-md transition-colors",
                      pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href))
                        ? "bg-[#c4956a]/20 text-black"
                        : "text-black hover:bg-[#c4956a]/10 hover:text-black"
                    )}>
                    <item.icon className="mr-3 flex-shrink-0 h-5 w-5 text-black" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>
      </div>

      <div className="p-3 md:p-4 border-t" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.85)' }}>
         <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-[#c4956a]/20 flex items-center justify-center text-[#8b6540] font-bold text-xs flex-shrink-0">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-black truncate">{user?.email || "User"}</p>
              <p className="text-xs font-medium text-black/60 uppercase tracking-wider mt-0.5">{isPlatformOnly ? "Platform Admin" : activeRole?.replace('_', ' ') || "Guest"}</p>
            </div>
         </div>
         <button
           onClick={handleSignOut}
           className="mt-3 md:mt-4 w-full text-xs text-black hover:text-black/70 font-medium text-left px-1 transition-colors"
         >
           {t("auth_sign_out")}
         </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar - always visible from md+ */}
      <aside className="w-64 border-r h-full hidden md:flex flex-col flex-shrink-0" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        {sidebarContent}
      </aside>

      {/* Mobile overlay + drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/40" onClick={onClose} />
          {/* Drawer */}
          <aside className="relative w-72 max-w-[80vw] h-full flex flex-col flex-shrink-0 shadow-xl" style={{ background: 'rgba(252,246,237,0.98)', borderRight: '2px solid #c4956a' }}>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
