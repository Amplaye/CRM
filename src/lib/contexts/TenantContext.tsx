"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";
import { useAuth } from "./AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Tenant, GlobalRole } from "@/lib/types";
import { safeLocal, safeSession } from "@/lib/safe-storage";

interface TenantContextType {
  activeTenant: Tenant | null;
  activeRole: string | null;
  globalRole: GlobalRole | null;
  availableTenants: Tenant[];
  switchTenant: (tenantId: string) => void;
  refreshActiveTenant: () => Promise<void>;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  activeTenant: null,
  activeRole: null,
  globalRole: null,
  availableTenants: [],
  switchTenant: () => {},
  refreshActiveTenant: async () => {},
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
    const cached = safeSession.get(cacheKey);
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
          const savedId = safeLocal.get("active_tenant_id");
          active = tenants.find((t: Tenant) => t.id === savedId) || tenants[0];
          activeR = memberships!.find((m: any) => m.tenant_id === active!.id)?.role || null;
          safeLocal.set("active_tenant_id", active!.id);
        }

        setActiveTenant(active);
        setActiveRole(activeR);

        // Cache in sessionStorage
        safeSession.set(cacheKey, JSON.stringify({
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
      safeLocal.set("active_tenant_id", target.id);
      // Clear cache so it reloads with new tenant
      if (user) safeSession.remove(`tenant_ctx_${user.id}`);
      window.location.reload();
    }
  };

  // Re-fetch the active tenant's row from Supabase and update both state
  // and the sessionStorage cache. Call this after mutations to Settings so
  // the rest of the app sees the new values without a page reload.
  const refreshActiveTenant = async () => {
    if (!user || !activeTenant) return;
    try {
      const { data } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", activeTenant.id)
        .maybeSingle();
      if (!data) return;
      const fresh = data as Tenant;
      setActiveTenant(fresh);
      const updatedList = availableTenants.map((t) => (t.id === fresh.id ? fresh : t));
      setAvailableTenants(updatedList);
      safeSession.set(`tenant_ctx_${user.id}`, JSON.stringify({
        globalRole, tenants: updatedList, activeTenant: fresh, activeRole,
      }));
    } catch (err) {
      console.error("Failed to refresh active tenant", err);
    }
  };

  const ctxValue = useMemo(
    () => ({ activeTenant, activeRole, globalRole, availableTenants, switchTenant, refreshActiveTenant, loading }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTenant, activeRole, globalRole, availableTenants, loading]
  );

  return (
    <TenantContext.Provider value={ctxValue}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
