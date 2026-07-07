"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";
import { useAuth } from "./AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Tenant, GlobalRole } from "@/lib/types";
import { safeLocal, safeSession } from "@/lib/safe-storage";
import {
  purgeOfflineCache,
  purgeOfflinePages,
  readOfflineTenantCtx,
  writeOfflineTenantCtx,
} from "@/lib/offline-cache";

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

    // Check sessionStorage cache to avoid re-fetching on every navigation.
    // Skip cache when it looks broken (no tenants) so a failed initial fetch
    // doesn't get stuck — platform_admin always has tenants available.
    const cacheKey = `tenant_ctx_${user.id}`;
    const cached = safeSession.get(cacheKey);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        const looksBroken = !Array.isArray(c.tenants) || c.tenants.length === 0;
        if (!looksBroken) {
          setGlobalRole(c.globalRole);
          setAvailableTenants(c.tenants);
          setActiveTenant(c.activeTenant);
          setActiveRole(c.activeRole);
          setIsImpersonating(!!c.isImpersonating);
          setLoading(false);
          return;
        }
        safeSession.remove(cacheKey);
      } catch { /* fall through to fetch */ }
    }

    const loadTenantData = async () => {
      try {
        setLoading(true);

        // Select tenant columns explicitly (not tenants(*)). The embedded join
        // otherwise streams every column; naming them keeps the payload tight,
        // which matters on slow mobile links where the dashboard is gated on
        // this query (it sat on the spinner and the CRM language — read from the
        // tenant's crm_locale — stayed on the stale localStorage value).
        const [userRes, membershipsRes] = await Promise.all([
          supabase.from("users").select("global_role").eq("id", user.id).single(),
          supabase
            .from("tenant_members")
            .select("tenant_id, role, tenants(id, name, slug, status, created_at, settings)")
            .eq("user_id", user.id)
        ]);

        // Offline cold launch: sessionStorage is per-tab-session (empty when
        // the installed PWA starts) and the membership query can't reach
        // Supabase — supabase-js does NOT throw on network failure, it returns
        // an error object, so this must be handled here rather than in the
        // catch below. Fall back to the last good context saved on this
        // device (written on every successful load, purged on logout/switch)
        // instead of rendering an empty CRM. A user with zero memberships is
        // NOT this case: that returns data:[] with no error.
        if (membershipsRes.error && !membershipsRes.data) {
          const fallback = readOfflineTenantCtx<{
            globalRole: GlobalRole;
            tenants: Tenant[];
            activeTenant: Tenant | null;
            activeRole: string | null;
            isImpersonating: boolean;
          }>(user.id);
          if (fallback && Array.isArray(fallback.tenants) && fallback.tenants.length > 0) {
            setGlobalRole(fallback.globalRole);
            setAvailableTenants(fallback.tenants);
            setActiveTenant(fallback.activeTenant);
            setActiveRole(fallback.activeRole);
            setIsImpersonating(!!fallback.isImpersonating);
            return;
          }
        }

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

        // Cache in sessionStorage — but never cache an empty tenant list,
        // otherwise a transient fetch failure would persist across navigations.
        if (tenants.length > 0) {
          const snapshot = {
            globalRole: role, tenants, activeTenant: active, activeRole: activeR, isImpersonating: impersonating,
          };
          safeSession.set(cacheKey, JSON.stringify(snapshot));
          // localStorage copy for offline cold launches (see fallback above).
          writeOfflineTenantCtx(user.id, snapshot);
        }
      } catch (err) {
        console.error("Failed to load tenant context", err);
      } finally {
        setLoading(false);
      }
    };

    loadTenantData();
  }, [user, authLoading, supabase]);

  // Live-apply changes to the active tenant's row. The admin per-tenant feature
  // toggles (settings.features.*, e.g. management_enabled) write to tenants.settings
  // from the Platform Admin panel; without this, the owner's already-open CRM kept
  // the sessionStorage-cached settings and the Gestionale sidebar items
  // (Magazzino / Food Cost / P&L) only appeared after a hard reload. Subscribing to
  // this tenant's row makes the toggle reflect instantly. `tenants` is in the
  // supabase_realtime publication (see 2026-06-08-tenants-realtime.sql).
  useEffect(() => {
    if (!user || !activeTenant?.id) return;
    const tenantId = activeTenant.id;

    const applyRow = (row: any) => {
      if (!row) return;
      // The realtime payload (default replica identity) carries the full NEW row,
      // including the updated settings JSONB — apply it straight to state so the UI
      // (sidebar gating, Settings forms) updates instantly. Drop the sessionStorage
      // cache: it's now stale, and the next full navigation re-reads the fresh row
      // once (one cheap query) rather than reviving the pre-toggle settings.
      setActiveTenant((prev) => (prev && prev.id === tenantId ? ({ ...prev, ...row } as Tenant) : prev));
      setAvailableTenants((prev) => prev.map((t) => (t.id === tenantId ? ({ ...t, ...row } as Tenant) : t)));
      safeSession.remove(`tenant_ctx_${user.id}`);
    };

    const channel = supabase
      .channel(`tenant-settings-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tenants", filter: `id=eq.${tenantId}` },
        (payload: any) => applyRow(payload.new),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // activeTenant.id is the only identity we resubscribe on; updating activeTenant's
    // other fields from inside must not re-run this effect (would churn the channel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTenant?.id, supabase]);

  const switchTenant = async (tenantId: string | null) => {
    if (user) safeSession.remove(`tenant_ctx_${user.id}`);
    // Drop all offline-cached reference data before leaving this tenant — the
    // cache keys are tenant-scoped so cross-reads can't happen, but purging here
    // keeps the device clean and bounds storage. switchTenant always reloads.
    purgeOfflineCache();
    purgeOfflinePages();
    const isAdmin = globalRole === "platform_admin";

    if (tenantId === null) {
      safeLocal.remove("active_tenant_id");
      // Clear the server-side impersonation cookie BEFORE navigating, so guest
      // side-effect suppression + audit stop cleanly. Await it (best-effort).
      if (isAdmin) {
        try {
          await fetch("/api/admin/impersonate", { method: "DELETE" });
        } catch { /* navigation proceeds regardless */ }
      }
      window.location.href = "/admin";
      return;
    }

    const target = availableTenants.find(t => t.id === tenantId);
    if (target) {
      safeLocal.set("active_tenant_id", target.id);
      // Set the signed httpOnly impersonation cookie and AWAIT it before the
      // full reload, so the next request already carries the impersonation
      // signal (drives WhatsApp suppression + audit). Also logs enter.
      if (isAdmin) {
        try {
          await fetch("/api/admin/impersonate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenant_id: target.id }),
          });
        } catch { /* navigation proceeds regardless */ }
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
      // Select the SAME explicit columns as the initial load — NOT select("*").
      // The `authenticated` role only has column-level SELECT on these columns of
      // `tenants`; `select("*")` touches an ungranted column and Postgres returns
      // 403 ("permission denied for table tenants"). That 403 made this read fall
      // into the `if (!data) return` below, so Settings saves (e.g. the Bookings
      // tab) persisted to the DB but the cached/active tenant kept the stale value
      // and the form appeared to revert. Keep this list in sync with the Tenant type.
      const { data } = await supabase
        .from("tenants")
        .select("id, name, slug, status, created_at, settings")
        .eq("id", activeTenant.id)
        .maybeSingle();
      if (!data) return;
      const fresh = data as Tenant;
      setActiveTenant(fresh);
      const updatedList = availableTenants.map((t) => (t.id === fresh.id ? fresh : t));
      setAvailableTenants(updatedList);
      safeSession.set(`tenant_ctx_${user.id}`, JSON.stringify({
        globalRole, tenants: updatedList, activeTenant: fresh, activeRole, isImpersonating,
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
