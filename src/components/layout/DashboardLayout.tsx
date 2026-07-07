"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { ReactNode, useState, useEffect, useMemo } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, Eye, LogOut } from "lucide-react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { globalRole, activeTenant, activeRole, isImpersonating, switchTenant, loading } = useTenant();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  // Kick out signed-in users the moment the Admin removes them from the
  // tenant. Three layers:
  //  1. Realtime DELETE on tenant_members (instant, requires REPLICA IDENTITY
  //     FULL + open websocket).
  //  2. Periodic poll every 20s while the tab is visible (covers the case
  //     where the websocket is asleep on a backgrounded phone).
  //  3. Re-check on tab/visibility regain (covers the phone-in-pocket case).
  useEffect(() => {
    if (!user?.id || !activeTenant?.id) return;
    // Platform admins impersonate tenants without holding a tenant_members row,
    // so the membership guard would always evict them. Skip the guard for them.
    if (globalRole === "platform_admin") return;

    let cancelled = false;
    const tenantId = activeTenant.id;
    const userId = user.id;

    const kickOut = async () => {
      if (cancelled) return;
      cancelled = true;
      await supabase.auth.signOut().catch(() => {});
      window.location.href = "/login";
    };

    const checkMembership = async () => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("id")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (cancelled) return;
      // If the membership row is gone (data null, no error) OR the auth user
      // has been deleted server-side (PostgREST/RLS errors out), bail.
      if (!error && !data) {
        await kickOut();
        return;
      }
      // 401/403 → token invalid (e.g. auth user deleted). Bail too.
      if ((error as any)?.code === "PGRST301" || (error as any)?.status === 401) {
        await kickOut();
      }
    };

    const ch = supabase
      .channel(`membership-guard-${userId}-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tenant_members", filter: `user_id=eq.${userId}` },
        async (payload: any) => {
          if (payload?.old?.tenant_id && payload.old.tenant_id !== tenantId) return;
          await kickOut();
        }
      )
      .subscribe();

    void checkMembership();
    const interval = setInterval(checkMembership, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") void checkMembership(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(ch);
    };
  }, [user?.id, activeTenant?.id, globalRole, supabase]);

  const isPlatformOnly = !loading && globalRole === "platform_admin" && !activeTenant;
  const isOnAdminPage = pathname?.startsWith("/admin");

  // Platform admin with no tenant → redirect to /admin
  useEffect(() => {
    if (!loading && isPlatformOnly && !isOnAdminPage) {
      router.replace("/admin");
    }
  }, [loading, isPlatformOnly, isOnAdminPage, router]);

  // Self-serve owner whose bot isn't provisioned yet → push into the wizard.
  // Gated on the EXPLICIT marker register-tenant writes (onboarding.completed:false),
  // so legacy tenants (which lack the marker) are never force-redirected.
  const needsOnboarding =
    !loading && globalRole !== "platform_admin" && activeRole === "owner" &&
    (activeTenant?.settings as any)?.onboarding?.completed === false;
  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  // Show spinner only briefly while auth is resolving — not on every navigation
  // Skip spinner entirely if on admin pages (they don't need tenant)
  if (loading && !isOnAdminPage) {
    return (
      <div className="h-[100dvh] flex items-center justify-center" style={{ background: "rgba(252,246,237,0.85)" }}>
        <Loader2 className="w-8 h-8 animate-spin text-[#c4956a]" />
      </div>
    );
  }

  return (
    <ProtectedRoute>
      <div className="h-[100dvh] flex relative z-10 overflow-hidden">
        <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0">
          {isImpersonating && activeTenant && (
            <div className="flex items-center justify-between gap-3 px-3 sm:px-4 md:px-6 py-2 bg-amber-500 text-white text-sm font-medium shadow-sm">
              <span className="flex items-center gap-2 min-w-0">
                <Eye className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  Stai operando come <strong>{activeTenant.name}</strong> — ogni modifica è reale; i messaggi ai clienti sono sospesi.
                </span>
              </span>
              <button
                onClick={() => switchTenant(null)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-white/20 hover:bg-white/30 px-2.5 py-1 font-semibold transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Esci
              </button>
            </div>
          )}
          <Topbar onMenuToggle={() => setMobileMenuOpen(true)} />
          <main className="flex-1 overflow-y-auto overscroll-contain">
             {children}
          </main>
        </div>
        {/* Built-in help assistant (local KB, no external APIs). Tenant pages only. */}
        {!isOnAdminPage && activeTenant && <AssistantWidget />}
      </div>
    </ProtectedRoute>
  );
}
