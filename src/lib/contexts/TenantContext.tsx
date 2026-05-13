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
  isImpersonating: boolean;
  switchTenant: (tenantId: string | null) => void;
  refreshActiveTenant: () => Promise<void>;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  activeTenant: null,
  activeRole: null,
  globalRole: null,
  availableTenants: [],
  isImpersonating: false,
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
  const [isImpersonating, setIsImpersonating] = useState(false);
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
        setIsImpersonating(!!c.isImpersonating);
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
        const membershipTenants = memberships && memberships.length > 0
          ? memberships.map((m: any) => m.tenants as Tenant)
          : [];

        // Platform admin: also fetch every tenant so they can impersonate any client.
        let tenants: Tenant[] = membershipTenants;
        if (role === "platform_admin") {
          try {
            const res = await fetch("/api/admin/all-tenants");
            if (res.ok) {
              const json = await res.json();
              const all = (json.tenants ?? []) as Tenant[];
              // Merge: membership tenants first (preserve order), then admin-only ones.
              const seen = new Set(membershipTenants.map((t: Tenant) => t.id));
              tenants = [
                ...membershipTenants,
                ...all.filter((t: Tenant) => !seen.has(t.id)),
              ];
            }
          } catch {
            // Fall back to membership tenants only.
          }
        }
        setAvailableTenants(tenants);

        let active: Tenant | null = null;
        let activeR: string | null = null;
        let impersonating = false;

        if (tenants.length > 0) {
          const savedId = safeLocal.get("active_tenant_id");
          // Platform admin default: stay in Platform Admin view (no tenant) unless they explicitly picked one.
          if (role === "platform_admin") {
            if (savedId) {
              active = tenants.find((t: Tenant) => t.id === savedId) || null;
            }
          } else {
            active = tenants.find((t: Tenant) => t.id === savedId) || tenants[0];
          }
          if (active) {
            const membership = memberships?.find((m: any) => m.tenant_id === active!.id);
            if (membership) {
              activeR = membership.role;
            } else if (role === "platform_admin") {
              activeR = "platform_admin";
              impersonating = true;
            }
            safeLocal.set("active_tenant_id", active.id);
          }
        }

        setActiveTenant(active);
        setActiveRole(activeR);
        setIsImpersonating(impersonating);

        // Cache in sessionStorage
        safeSession.set(cacheKey, JSON.stringify({
          globalRole: role, tenants, activeTenant: active, activeRole: activeR, isImpersonating: impersonating,
        }));
      } catch (err) {
        console.error("Failed to load tenant context", err);
      } finally {
        setLoading(false);
      }
    };

    loadTenantData();
  }, [user, authLoading, supabase]);

  const switchTenant = (tenantId: string | null) => {
    if (user) safeSession.remove(`tenant_ctx_${user.id}`);
    if (tenantId === null) {
      safeLocal.remove("active_tenant_id");
      window.location.href = "/admin";
      return;
    }
    const target = availableTenants.find(t => t.id === tenantId);
    if (target) {
      safeLocal.set("active_tenant_id", target.id);
      // Fire-and-forget audit log; don't block UI on it.
      if (globalRole === "platform_admin") {
        void fetch("/api/admin/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: target.id }),
        }).catch(() => {});
      }
      window.location.href = "/";
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
    () => ({ activeTenant, activeRole, globalRole, availableTenants, isImpersonating, switchTenant, refreshActiveTenant, loading }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTenant, activeRole, globalRole, availableTenants, isImpersonating, loading]
  );

  return (
    <TenantContext.Provider value={ctxValue}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
