"use client";

import { AuthProvider } from "@/lib/contexts/AuthContext";
import { TenantProvider, useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { ReactNode, useEffect } from "react";

// Once a tenant is active, the CRM dashboard language is FIXED to that tenant's
// chosen language (settings.crm_locale). There is no in-app language switcher —
// the owner picks the language once during onboarding. This bridge pushes the
// tenant's crm_locale into LanguageContext (which also persists it, so the next
// boot starts in the right language with no flash). On the login/onboarding
// routes there is no active tenant, so this is a no-op and those pages manage
// their own language (login auto-detects the browser).
function CrmLanguageBridge() {
  const { activeTenant } = useTenant();
  const { language, setLanguage } = useLanguage();
  const crmLocale = activeTenant?.settings?.crm_locale;

  useEffect(() => {
    if (crmLocale && crmLocale !== language) setLanguage(crmLocale);
  }, [crmLocale, language, setLanguage]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TenantProvider>
        <CrmLanguageBridge />
        {children}
      </TenantProvider>
    </AuthProvider>
  );
}
