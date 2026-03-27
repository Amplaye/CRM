"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Tenant, TenantMember, GlobalRole } from "@/lib/types";

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
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          setGlobalRole(userDoc.data().global_role);
        }

        // Load memberships
        const memQ = query(collection(db, "tenant_members"), where("user_id", "==", user.uid));
        const memSnap = await getDocs(memQ);
        const memberships: TenantMember[] = memSnap.docs.map(d => ({ id: d.id, ...d.data() } as TenantMember));

        if (memberships.length > 0) {
          const tenantIds = memberships.map(m => m.tenant_id);
          // Very simplified: assuming user doesn't have > 30 tenants (firestore in limit is 10)
          // For demo purposes and simplicity, fetch all available
          const tenantPromises = tenantIds.map(id => getDoc(doc(db, "tenants", id)));
          const tenantDocs = await Promise.all(tenantPromises);
          const tenants = tenantDocs.map(d => ({ id: d.id, ...d.data() } as Tenant));
          
          setAvailableTenants(tenants);
          const savedId = localStorage.getItem("active_tenant_id");
          const targetTenant = tenants.find(t => t.id === savedId) || tenants[0];
          
          if (targetTenant) {
            const tokenResult = await user.getIdTokenResult();
            if (tokenResult.claims.active_tenant_id !== targetTenant.id) {
               const token = await user.getIdToken();
               const res = await fetch("/api/auth/tenant", {
                 method: "POST",
                 headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                 body: JSON.stringify({ tenantId: targetTenant.id })
               });
               if (res.ok) await user.getIdToken(true);
            }
            setActiveTenant(targetTenant);
            setActiveRole(memberships.find(m => m.tenant_id === targetTenant.id)?.role || null);
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

  const switchTenant = async (tenantId: string) => {
    try {
      setLoading(true);
      const target = availableTenants.find(t => t.id === tenantId);
      if (target && user) {
        // Get fresh token to authorize the API call
        const token = await user.getIdToken();
        const res = await fetch("/api/auth/tenant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ tenantId: target.id })
        });

        if (!res.ok) throw new Error("Failed to switch tenant custom claims");

        // Force a refreshed ID token to pick up the new claims on the client
        await user.getIdToken(true);

        setActiveTenant(target);
        localStorage.setItem("active_tenant_id", target.id);
        // reload page to ensure clean state with new claims
        window.location.reload(); 
      }
    } catch(err) {
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <TenantContext.Provider value={{ activeTenant, activeRole, globalRole, availableTenants, switchTenant, loading }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
