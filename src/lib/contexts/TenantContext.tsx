"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";
import { useAuth } from "./AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Tenant, GlobalRole } from "@/lib/types";

interface TenantContextType {
  activeTenant: Tenant | null;
  activeRole: string | null;
  globalRole: GlobalRole | null;
  availableTenants: Tenant[];
  switchTenant: (tenantId: string) => void;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  activeTenant: null,
  activeRole: null,
  globalRole: null,
  availableTenants: [],
  switchTenant: () => {},
  loading: true,
});

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [activeTenant, setActiveTenant] = useState<Tenant | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [globalRole, setGlobalRole] = useState<GlobalRole | null>(null);
  const [availableTenants, setAvailableTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setActiveTenant(null);
      setActiveRole(null);
      setGlobalRole(null);
      setAvailableTenants([]);
      setLoading(false);
      return;
    }

    const loadTenantData = async () => {
      try {
        setLoading(true);

        // Single parallel fetch for both user role and memberships
        const [userRes, membershipsRes] = await Promise.all([
          supabase.from("users").select("global_role").eq("id", user.id).single(),
          supabase.from("tenant_members").select("tenant_id, role, tenants(*)").eq("user_id", user.id)
        ]);

        if (userRes.data) setGlobalRole(userRes.data.global_role as GlobalRole);

        const memberships = membershipsRes.data;
        if (memberships && memberships.length > 0) {
          const tenants = memberships.map((m: any) => m.tenants as Tenant);
          setAvailableTenants(tenants);

          const savedId = localStorage.getItem("active_tenant_id");
          const targetTenant = tenants.find(t => t.id === savedId) || tenants[0];

          if (targetTenant) {
            setActiveTenant(targetTenant);
            setActiveRole(memberships.find((m: any) => m.tenant_id === targetTenant.id)?.role || null);
            localStorage.setItem("active_tenant_id", targetTenant.id);
          }
        }
      } catch (err) {
        console.error("Failed to load tenant context", err);
      } finally {
        setLoading(false);
      }
    };

    loadTenantData();
  }, [user, authLoading, supabase]);

  const switchTenant = (tenantId: string) => {
    const target = availableTenants.find(t => t.id === tenantId);
    if (target) {
      setActiveTenant(target);
      localStorage.setItem("active_tenant_id", target.id);
      window.location.reload();
    }
  };

  return (
    <TenantContext.Provider value={{ activeTenant, activeRole, globalRole, availableTenants, switchTenant, loading }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
