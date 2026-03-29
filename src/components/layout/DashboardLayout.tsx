"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen flex relative z-10">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
             {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
