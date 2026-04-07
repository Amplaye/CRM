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

    // Check sessionStorage cache to avoid re-fetching on every navigation
    const cacheKey = `tenant_ctx_${user.id}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        setGlobalRole(c.globalRole);
        setAvailableTenants(c.tenants);
        setActiveTenant(c.activeTenant);
        setActiveRole(c.activeRole);
        setLoading(false);
        return;
      } catch { /* fall through to fetch */ }
    }

    const loadTenantData = async () => {
      try {
        setLoading(true);

        const [userRes, membershipsRes] = await Promise.all([
          supabase.from("users").select("global_role").eq("id", user.id).single(),
          supabase.from("tenant_members").select("tenant_id, role, tenants(*)").eq("user_id", user.id)
        ]);

        const role = (userRes.data?.global_role || "user") as GlobalRole;
        setGlobalRole(role);

        const memberships = membershipsRes.data;
        const tenants = memberships && memberships.length > 0
          ? memberships.map((m: any) => m.tenants as Tenant)
          : [];
        setAvailableTenants(tenants);

        let active: Tenant | null = null;
        let activeR: string | null = null;

        if (tenants.length > 0) {
          const savedId = localStorage.getItem("active_tenant_id");
          active = tenants.find(t => t.id === savedId) || tenants[0];
          activeR = memberships!.find((m: any) => m.tenant_id === active!.id)?.role || null;
          localStorage.setItem("active_tenant_id", active.id);
        }

        setActiveTenant(active);
        setActiveRole(activeR);

        // Cache in sessionStorage
        sessionStorage.setItem(cacheKey, JSON.stringify({
          globalRole: role, tenants, activeTenant: active, activeRole: activeR,
        }));
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
      // Clear cache so it reloads with new tenant
      if (user) sessionStorage.removeItem(`tenant_ctx_${user.id}`);
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
