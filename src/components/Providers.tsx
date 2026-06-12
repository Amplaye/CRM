"use client";

import { AuthProvider } from "@/lib/contexts/AuthContext";
import { TenantProvider, useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { tenantHasLocaleSwitcher } from "@/lib/tenants/legacy-locale";
import { ReactNode, useEffect } from "react";
import { usePathname } from "next/navigation";

// Pre-auth / public routes own their language (the visitor freely switches via
// the on-page switcher, or login auto-detects the browser). The tenant→CRM
// language bridge must stay OFF here, otherwise a logged-in user who lands on
// one of these pages has the picker immediately overwritten back to their
// tenant's crm_locale (the "stuck on DE" regression).
const PUBLIC_ROUTE_PREFIXES = ["/welcome", "/login", "/register", "/onboarding", "/m/"];

// Once a tenant is active, the CRM dashboard language is FIXED to that tenant's
// chosen language (settings.crm_locale). There is no in-app language switcher —
// the owner picks the language once during onboarding. This bridge pushes the
// tenant's crm_locale into LanguageContext (which also persists it, so the next
// boot starts in the right language with no flash). On the login/onboarding
// routes there is no active tenant, so this is a no-op and those pages manage
// their own language (login auto-detects the browser).
function CrmLanguageBridge() {
  const pathname = usePathname();
  const { activeTenant } = useTenant();
  const { language, setLanguage } = useLanguage();
  const isPublicRoute = PUBLIC_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname?.startsWith(p)
  );
  const crmLocale = activeTenant?.settings?.crm_locale;
  // PICNIC (legacy template tenant) keeps an in-app language switcher, so the
  // bridge must NOT force its language back to crm_locale — that would undo the
  // user's on-the-fly choice on the next render. See src/lib/tenants/legacy-locale.ts.
  const hasSwitcher = tenantHasLocaleSwitcher(activeTenant?.slug);

  useEffect(() => {
    if (isPublicRoute) return;
    if (!hasSwitcher && crmLocale && crmLocale !== language) setLanguage(crmLocale);
  }, [isPublicRoute, hasSwitcher, crmLocale, language, setLanguage]);

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
