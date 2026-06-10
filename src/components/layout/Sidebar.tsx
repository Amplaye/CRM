"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  Clock,
  MessageSquare,
  Users,
  BookOpen,
  UtensilsCrossed,
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
  ShieldAlert,
  Calculator,
  PieChart,
  Package,
  Lock,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useTenant } from "@/lib/contexts/TenantContext";
import { getFeatures } from "@/lib/types/tenant-settings";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { useNotificationCounts, NotificationCounts } from "@/lib/hooks/useNotificationCounts";
import { TenantSwitcher } from "./TenantSwitcher";
import { useEffect, useMemo, useState } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems: Array<{ name: string; href: string; icon: any; badgeKey?: keyof NotificationCounts; badgeStyle?: "alert" | "info"; feature?: keyof ReturnType<typeof getFeatures> }> = [
  { name: "Tables", href: "/floor", icon: LayoutGrid },
  { name: "Reservations", href: "/reservations", icon: Calendar, badgeKey: "reservations", badgeStyle: "info" },
  { name: "Waitlist", href: "/waitlist", icon: Clock, badgeKey: "waitlist", badgeStyle: "alert" },
  { name: "Pending", href: "/pending", icon: ClipboardList, badgeKey: "pending", badgeStyle: "alert" },
  { name: "Conversations", href: "/conversations", icon: MessageSquare, badgeKey: "conversations", badgeStyle: "alert" },
  { name: "Guests", href: "/guests", icon: Users },
  { name: "Menu", href: "/menu", icon: UtensilsCrossed },
  { name: "Analytics", href: "/", icon: BarChart3 },
  { name: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  // Gestionale (controllo gestione) — only when management_enabled is ON.
  { name: "Food Cost", href: "/food-cost", icon: Calculator, feature: "management_enabled" },
  { name: "PL", href: "/pl", icon: PieChart, feature: "management_enabled" },
  { name: "Inventory", href: "/inventory", icon: Package, feature: "management_enabled" },
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
  const counts = useNotificationCounts(activeTenant?.id);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleNavClick = () => {
    onClose?.();
  };

  const isPlatformOnly = globalRole === "platform_admin" && !activeTenant;

  // Fetch the signed-in user's display name from public.users so the sidebar
  // footer shows "Mario · Staff" rather than the raw email. Staff (host) rows
  // have no email at all — without the name fallback the avatar shows "?".
  const supabaseClient = useMemo(() => createClient(), []);
  const [displayName, setDisplayName] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) { setDisplayName(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabaseClient
        .from("users")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setDisplayName((data as any)?.name || null);
    })();
    return () => { cancelled = true; };
  }, [user?.id, supabaseClient]);

  const roleLabel =
    isPlatformOnly ? "Platform Admin"
    : activeRole === "owner" ? "Admin"
    : activeRole === "host" ? "Staff"
    : activeRole?.replace("_", " ") || "Guest";

  // Staff (host) accounts are created via QR and have no email; if we couldn't
  // load the name yet, show "Staff" placeholder instead of an empty line.
  const primaryLabel = activeRole === "host"
    ? (displayName || t("team_role_staff") || "Staff")
    : (displayName || user?.email || "User");
  const avatarChar = (displayName || user?.email || "U").charAt(0).toUpperCase();
  // The restaurant's own logo (uploaded in Settings → General). When set it
  // replaces the BaliFlow mark top-left and the initials avatar bottom-left.
  // Platform admins keep the BaliFlow logo so the tenant switcher stays neutral.
  const customLogo = globalRole !== "platform_admin" ? activeTenant?.settings?.branding?.logo_url : undefined;

  // Staff (camerieri) see only the two pages they need: floor for walk-ins
  // and reservations to mark arrivals/no-shows. Everything else is hidden.
  const isHost = activeRole === "host";
  const features = getFeatures(activeTenant?.settings);
  // The gestionale pages are gated by a PAID add-on (smart_inventory →
  // management_enabled). Unlike a plain hide, we keep them VISIBLE but LOCKED when
  // not entitled: a greyed item with a padlock that deep-links to the upgrade
  // screen, so the feature sells itself instead of being invisible. `locked` is
  // computed per item from its gating flag.
  const visibleNavItems = (isHost
    ? navItems.filter(i => i.href === "/floor" || i.href === "/reservations")
    : navItems
  // Feature flag: hide the Waitlist page for tenants that don't use it.
  ).filter(i => i.href !== "/waitlist" || features.waitlist_enabled)
  .map(i => ({ ...i, locked: !!i.feature && !features[i.feature] }));

  const adminNavItems = [
    { href: "/admin", icon: Shield, label: "Tenants" },
    { href: "/admin/bali", icon: Inbox, label: "Bali Inbox" },
    { href: "/admin/costs", icon: DollarSign, label: "Usage & Costs" },
    { href: "/admin/debug", icon: Bug, label: "Quick Debug" },
    { href: "/admin/clients", icon: StickyNote, label: "Client Notes" },
    { href: "/admin/health", icon: Activity, label: "System Health" },
    { href: "/admin/security", icon: ShieldAlert, label: "Login Monitor" },
    { href: "/admin/incidents", icon: AlertOctagon, label: "All Incidents" },
  ];

  const isAdmin = globalRole === "platform_admin";

  const sidebarContent = (
    <>
      <div className="h-14 md:h-16 flex items-center px-3 border-b gap-2 shrink-0" style={{ borderColor: '#c4956a' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={customLogo || "/logo.png"} alt={activeTenant?.name || "BaliFlow"} className="w-7 h-7 md:w-8 md:h-8 rounded-md flex-shrink-0 shadow-sm object-cover" />
        {isAdmin ? (
          <div className="flex-1 min-w-0">
            <TenantSwitcher />
          </div>
        ) : (
          <span className="font-semibold text-black text-base md:text-lg flex-1 text-center truncate">
            {activeTenant?.name || "BaliFlow"}
          </span>
        )}
        <button onClick={onClose} className="md:hidden p-1 -mr-1 hover:bg-[#c4956a]/10 rounded-lg">
          <X className="w-5 h-5 text-black" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3 md:py-4">
        <nav className="space-y-0.5 md:space-y-1 px-2 md:px-3">
          {/* Restaurant nav — only show if user has a tenant */}
          {!isPlatformOnly && visibleNavItems.map((item) => {
            const label = t(`nav_${item.name.toLowerCase().replace(" ", "_")}` as keyof Dictionary) || item.name;
            // Locked (paid add-on not active): greyed, padlock, and a deep-link to
            // the upgrade screen instead of the (forbidden) feature page.
            if (item.locked) {
              return (
                <Link
                  key={item.name}
                  href="/settings?upgrade=management"
                  onClick={handleNavClick}
                  title={t("billing_addon_locked_hint" as keyof Dictionary) || "Funzione a pagamento — sblocca dall'abbonamento"}
                  className="flex items-center px-3 py-2.5 md:py-2 text-sm font-medium rounded-md transition-colors text-black hover:bg-[#c4956a]/10 hover:text-black"
                >
                  <item.icon className="mr-3 flex-shrink-0 h-5 w-5 text-black" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  <Lock className="ml-2 flex-shrink-0 h-3.5 w-3.5 text-black" aria-label="locked" />
                </Link>
              );
            }
            const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            const badgeCount = item.badgeKey ? counts[item.badgeKey] : 0;
            const badgeBg = item.badgeStyle === "alert" ? "bg-red-500" : "bg-[#c4956a]";
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
                <span className="flex-1">{label}</span>
                {badgeCount > 0 && (
                  <span
                    className={cn(
                      "ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold text-white",
                      badgeBg
                    )}
                    aria-label={`${badgeCount} new`}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
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
         <div className="flex items-center justify-between gap-3">
            <div className="flex items-center min-w-0">
              <div className="h-8 w-8 rounded-full bg-[#c4956a]/20 flex items-center justify-center text-[#8b6540] font-bold text-xs flex-shrink-0 overflow-hidden">
                {customLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={customLogo} alt={activeTenant?.name || ""} className="h-full w-full object-cover" />
                ) : (
                  avatarChar
                )}
              </div>
              <div className="ml-3 overflow-hidden">
                <p className="text-sm font-medium text-black truncate">{primaryLabel}</p>
                <p className="text-xs font-medium text-black uppercase tracking-wider mt-0.5">{roleLabel}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="text-xs font-medium px-2.5 py-1 rounded-md border border-red-600 text-red-600 hover:bg-red-600 hover:text-white transition-colors flex-shrink-0 cursor-pointer"
            >
              {t("auth_sign_out")}
            </button>
         </div>
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
