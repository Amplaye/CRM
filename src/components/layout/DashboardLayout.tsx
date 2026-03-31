"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReactNode, useState } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
