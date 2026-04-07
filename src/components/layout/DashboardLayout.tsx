"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReactNode, useState, useEffect } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useRouter, usePathname } from "next/navigation";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { globalRole, activeTenant, loading } = useTenant();
  const router = useRouter();
  const pathname = usePathname();

  // Platform admin with no tenant → redirect to /admin
  useEffect(() => {
    if (!loading && globalRole === "platform_admin" && !activeTenant && !pathname?.startsWith("/admin")) {
      router.replace("/admin");
    }
  }, [loading, globalRole, activeTenant, pathname, router]);

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
