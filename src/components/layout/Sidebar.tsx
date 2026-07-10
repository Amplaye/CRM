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
  DollarSign,
  Inbox,
  Calculator,
  PieChart,
  Package,
  Banknote,
  Lock,
  CalendarClock,
  Star,
  Megaphone,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useTenant } from "@/lib/contexts/TenantContext";
import { getFeatures } from "@/lib/types/tenant-settings";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { isWipHref, canSeeWip } from "@/lib/billing/wip";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { useNotificationCounts, NotificationCounts } from "@/lib/hooks/useNotificationCounts";
import { useVisitedSections } from "@/lib/hooks/useVisitedSections";
import { TenantSwitcher } from "./TenantSwitcher";
import { useEffect, useMemo, useState } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems: Array<{ name: string; href: string; icon: any; badgeKey?: keyof NotificationCounts; badgeStyle?: "alert" | "info"; feature?: keyof ReturnType<typeof getFeatures> }> = [
  { name: "Tables", href: "/floor", icon: LayoutGrid },
  // Cassa nativa (built-in POS) is NOT here: it gets the pinned CTA at the
  // bottom of the sidebar (the till is the most-used tool, it must pop).
  { name: "Reservations", href: "/reservations", icon: Calendar, badgeKey: "reservations", badgeStyle: "info" },
  { name: "Waitlist", href: "/waitlist", icon: Clock, badgeKey: "waitlist", badgeStyle: "alert" },
  { name: "Pending", href: "/pending", icon: ClipboardList, badgeKey: "pending", badgeStyle: "alert" },
  { name: "Conversations", href: "/conversations", icon: MessageSquare, badgeKey: "conversations", badgeStyle: "alert" },
  { name: "Guests", href: "/guests", icon: Users },
  // Certified reviews — hidden until the owner flips reviews_enabled.
  { name: "Reviews", href: "/reviews", icon: Star },
  // Campaign suite — hidden until the owner flips marketing_enabled.
  { name: "Marketing", href: "/marketing", icon: Megaphone },
  { name: "Menu", href: "/menu", icon: UtensilsCrossed },
  { name: "Staff", href: "/staff", icon: CalendarClock },
  { name: "Analytics", href: "/", icon: BarChart3 },
  { name: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  // Gestionale (controllo gestione) — only when management_enabled is ON.
  { name: "Food Cost", href: "/food-cost", icon: Calculator, feature: "management_enabled" },
  { name: "PL", href: "/pl", icon: PieChart, feature: "management_enabled" },
  { name: "Inventory", href: "/inventory", icon: Package, feature: "management_enabled" },
  { name: "Settings", href: "/settings", icon: Settings },
];

// The ONLY sections an "entry-package" tenant (no active plan) can use: the menu
// editor + its public menu, and Settings (to buy a plan / manage account).
// Everything else is shown plan-locked. Keep in sync with the page-level guards.
const FREE_HREFS = new Set(["/menu", "/settings"]);

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

  // Keep the mobile drawer mounted through its closing animation: when
  // mobileOpen flips false we hold `rendered` true for the exit transition,
  // then unmount. `closing` drives the reverse (slide-out) animation.
  const [rendered, setRendered] = useState(mobileOpen);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (mobileOpen) {
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
      const timeout = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, 280); // matches drawer-panel-in duration
      return () => clearTimeout(timeout);
    }
  }, [mobileOpen, rendered]);

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
    : activeRole === "manager" ? (t("team_role_responsabile") || "Responsabile")
    : activeRole === "host" ? "Staff"
    : activeRole?.replace("_", " ") || "Guest";

  // Staff (host) and Responsabile (manager) accounts are created via QR and
  // have no email; if we couldn't load the name yet, show the role placeholder.
  const primaryLabel = activeRole === "host" || activeRole === "manager"
    ? (displayName || roleLabel)
    : (displayName || user?.email || "User");
  const avatarChar = (displayName || user?.email || "U").charAt(0).toUpperCase();
  // The restaurant's own logo (uploaded in Settings → General). When set it
  // replaces the BaliFlow mark top-left and the initials avatar bottom-left.
  // Platform admins keep the BaliFlow logo so the tenant switcher stays neutral.
  const customLogo = globalRole !== "platform_admin" ? activeTenant?.settings?.branding?.logo_url : undefined;

  // Staff (camerieri) and Responsabili (manager) see the pages they need
  // day-to-day: floor for walk-ins, reservations to mark arrivals/no-shows, and
  // the menu to consult it (read-only — editing is owner-only). The cassa
  // reaches both via the pinned bottom CTA. Everything else — settings,
  // billing, analytics, management — stays hidden.
  const isHost = activeRole === "host" || activeRole === "manager";
  const features = getFeatures(activeTenant?.settings);
  // PLAN gate: a tenant with no active subscription sees only the entry package
  // (menu + settings); every other core section is shown LOCKED. This is separate
  // from — and stacks on top of — the gestionale add-on gate below. (Hosts only
  // exist on a paid tenant, so planActive is always true for them; no host
  // exception needed.)
  const planActive = hasActivePlan(activeTenant?.settings);
  // Two kinds of lock, both shown as a greyed item + padlock that deep-links to
  // the upgrade screen (so the feature sells itself instead of being invisible):
  //   • "addon" — the gestionale pages, gated by the paid smart_inventory add-on
  //     (→ management_enabled). Checked first so its hint wins.
  //   • "plan"  — any non-free section while the tenant has no active plan.
  const visibleNavItems = (isHost
    // Hosts (camerieri) see the day-to-day pages; the cassa reaches them via
    // the pinned bottom CTA (taking orders and cashing bills IS their job).
    ? navItems.filter(i => i.href === "/floor" || i.href === "/reservations" || i.href === "/menu" || i.href === "/staff")
    : navItems
  // Feature flag: hide the Waitlist page for tenants that don't use it.
  ).filter(i => i.href !== "/waitlist" || features.waitlist_enabled)
  // Feature flag: Reviews appears only when the owner enabled the module.
  .filter(i => i.href !== "/reviews" || features.reviews_enabled)
  // Feature flag: Marketing appears only when the owner enabled the module.
  .filter(i => i.href !== "/marketing" || features.marketing_enabled)
  // Work-in-progress: hide the gestionale sections still under development
  // (inventory, P&L, food cost) for everyone except the WIP allowlist.
  .filter(i => !isWipHref(i.href) || canSeeWip(activeTenant?.id))
  .map(i => {
    const featureLocked = !!i.feature && !features[i.feature];
    const planLocked = !planActive && !FREE_HREFS.has(i.href);
    return {
      ...i,
      locked: featureLocked || planLocked,
      lockKind: (featureLocked ? "addon" : "plan") as "addon" | "plan",
    };
  });

  // Post-onboarding discovery dots: once a freshly-installed tenant has finished
  // onboarding, every nav section the owner hasn't physically opened yet gets a
  // small marker nudging them to explore it (reinforces the activity badges).
  // The dot clears the instant the section is opened — locked (paid) sections
  // included, since clicking them still counts as "visited" even while gated.
  const onboardingCompleted = (activeTenant?.settings as any)?.onboarding?.completed === true;
  const navHrefs = useMemo(() => visibleNavItems.map(i => i.href), [visibleNavItems]);
  const { visited, mark: markVisited } = useVisitedSections(activeTenant?.id, navHrefs);
  // Only nudge real owners/managers, never hosts or platform-only admins.
  const showDiscoveryDots = onboardingCompleted && !isHost && !isPlatformOnly;

  // Mark the *current* route as visited regardless of how the user got here
  // (sidebar click, direct link, redirect, refresh) so the dot always clears
  // once the section is actually on screen.
  useEffect(() => {
    if (!activeTenant?.id || !pathname) return;
    const match = navHrefs.find(h => h === pathname || (h !== "/" && pathname.startsWith(h)));
    // pathname "/" must only match the Analytics item (href "/"), never every route.
    const current = pathname === "/" ? (navHrefs.includes("/") ? "/" : undefined) : match;
    if (current) markVisited(current);
  }, [pathname, activeTenant?.id, navHrefs, markVisited]);

  // Command center: 4 focused sections. Usage&Costs is absorbed into Billing;
  // Quick Debug + System Health + All Incidents are merged into Monitoring;
  // Client Notes is folded into the per-tenant page; Login Monitor is reachable
  // by URL but no longer in the nav (security audit log, rarely actioned).
  const adminNavItems = [
    { href: "/admin", icon: Shield, label: "Tenants" },
    { href: "/admin/billing", icon: DollarSign, label: "Billing" },
    { href: "/admin/monitoring", icon: Activity, label: "Monitoring" },
    { href: "/admin/bali", icon: Inbox, label: "Bali Inbox" },
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
            // Discovery dot: shown when a newly-onboarded owner hasn't opened
            // this section yet. Suppressed when a numeric badge is already
            // present so we never stack two markers on the same row.
            const showDot = showDiscoveryDots && !visited.has(item.href);
            if (item.locked) {
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => { markVisited(item.href); handleNavClick(); }}
                  title={
                    item.lockKind === "plan"
                      ? t("plan_locked_hint") || "Disponibile con un piano attivo"
                      : t("billing_addon_locked_hint" as keyof Dictionary) || "Funzione a pagamento — sblocca dall'abbonamento"
                  }
                  className="flex items-center px-3 py-2.5 md:py-2 text-sm font-medium rounded-md transition-colors text-black hover:bg-[#c4956a]/10 hover:text-black"
                >
                  <item.icon className="mr-3 flex-shrink-0 h-5 w-5 text-black" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  {showDot && (
                    <span
                      className="mr-2 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-[#c4956a]"
                      aria-label={t("nav_new_section" as keyof Dictionary) || "New section"}
                    />
                  )}
                  <Lock className="ml-0 flex-shrink-0 h-3.5 w-3.5 text-black" aria-label="locked" />
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
                onClick={() => { markVisited(item.href); handleNavClick(); }}
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
                {badgeCount > 0 ? (
                  <span
                    className={cn(
                      "ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold text-white",
                      badgeBg
                    )}
                    aria-label={`${badgeCount} new`}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                ) : showDot ? (
                  <span
                    className="ml-2 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-[#c4956a]"
                    aria-label={t("nav_new_section" as keyof Dictionary) || "New section"}
                  />
                ) : null}
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

      {/* Cassa — pinned CTA at the bottom so the till is always one tap away
          and impossible to miss. Same gates as the old nav item: management
          add-on + active plan; locked state stays visible and sells the upgrade. */}
      {!isPlatformOnly && (() => {
        const cassaFeatureLocked = !features.management_enabled;
        const cassaLocked = cassaFeatureLocked || !planActive;
        const cassaActive = pathname?.startsWith("/cassa");
        return (
          <div className="px-3 py-2.5 border-t shrink-0" style={{ borderColor: "#c4956a" }}>
            <Link
              href="/cassa"
              onClick={() => { markVisited("/cassa"); handleNavClick(); }}
              title={
                cassaLocked
                  ? (cassaFeatureLocked
                      ? t("billing_addon_locked_hint" as keyof Dictionary) || "Funzione a pagamento — sblocca dall'abbonamento"
                      : t("plan_locked_hint") || "Disponibile con un piano attivo")
                  : undefined
              }
              className={cn(
                "flex items-center justify-center gap-2.5 h-12 rounded-xl text-base font-bold tracking-wide transition-all",
                cassaLocked
                  ? "border-2 border-dashed text-black opacity-70 hover:opacity-100 hover:bg-[#c4956a]/10"
                  : "text-white shadow-lg hover:brightness-105 active:scale-[0.98]",
                !cassaLocked && cassaActive && "ring-2 ring-[#8b6540] ring-offset-1"
              )}
              style={cassaLocked
                ? { borderColor: "#c4956a" }
                : { background: "linear-gradient(135deg, #d4a574, #c4956a)", boxShadow: "0 4px 14px rgba(196,149,106,0.5)" }}
            >
              {cassaLocked ? <Lock className="w-4.5 h-4.5" /> : <Banknote className="w-5.5 h-5.5" />}
              {(t("nav_cassa" as keyof Dictionary) || "Cassa").toUpperCase()}
            </Link>
          </div>
        );
      })()}

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

      {/* Mobile overlay + drawer — slides in/out (see .drawer-* in globals.css).
          Stays mounted through the closing animation via `rendered`/`closing`. */}
      {rendered && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className={cn("fixed inset-0 bg-black/40", closing ? "drawer-backdrop--closing" : "drawer-backdrop")}
            onClick={onClose}
          />
          {/* Drawer */}
          <aside
            className={cn(
              "relative w-72 max-w-[80vw] h-full flex flex-col flex-shrink-0 shadow-xl",
              closing ? "drawer-panel--closing" : "drawer-panel"
            )}
            style={{ background: 'rgba(252,246,237,0.98)', borderRight: '2px solid #c4956a' }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
