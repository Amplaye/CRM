"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReactNode, useState, useEffect, useMemo } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useAuth } from "@/lib/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { globalRole, activeTenant, loading } = useTenant();
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
  }, [user?.id, activeTenant?.id, supabase]);

  const isPlatformOnly = !loading && globalRole === "platform_admin" && !activeTenant;
  const isOnAdminPage = pathname?.startsWith("/admin");

  // Platform admin with no tenant → redirect to /admin
  useEffect(() => {
    if (!loading && isPlatformOnly && !isOnAdminPage) {
      router.replace("/admin");
    }
  }, [loading, isPlatformOnly, isOnAdminPage, router]);

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
          <Topbar onMenuToggle={() => setMobileMenuOpen(true)} />
          <main className="flex-1 overflow-y-auto">
             {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
