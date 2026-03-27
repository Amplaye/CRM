"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
  const supabase = createClient();

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

        // Load user global role
        const { data: userData } = await supabase
          .from("users")
          .select("global_role")
          .eq("id", user.id)
          .single();

        if (userData) setGlobalRole(userData.global_role as GlobalRole);

        // Load memberships with tenant data
        const { data: memberships } = await supabase
          .from("tenant_members")
          .select("tenant_id, role, tenants(*)")
          .eq("user_id", user.id);

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
  }, [user, authLoading]);

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
