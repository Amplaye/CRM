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
  // tenant — relies on REPLICA IDENTITY FULL on tenant_members so the DELETE
  // payload carries user_id and our filter actually matches. Staff on phones
  // would otherwise keep working with a stale session until next refresh.
  useEffect(() => {
    if (!user?.id || !activeTenant?.id) return;
    const ch = supabase
      .channel(`membership-guard-${user.id}-${activeTenant.id}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tenant_members", filter: `user_id=eq.${user.id}` },
        async (payload: any) => {
          if (payload?.old?.tenant_id !== activeTenant.id) return;
          await supabase.auth.signOut();
          window.location.href = "/login";
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
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
