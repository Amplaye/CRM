"use client";

import { AuthProvider } from "@/lib/contexts/AuthContext";
import { TenantProvider } from "@/lib/contexts/TenantContext";
import { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TenantProvider>
        {children}
      </TenantProvider>
    </AuthProvider>
  );
}
