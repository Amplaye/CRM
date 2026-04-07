"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReactNode, useState, useEffect } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { globalRole, activeTenant, loading } = useTenant();
  const router = useRouter();
  const pathname = usePathname();

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
