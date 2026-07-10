"use client";

import { usePathname } from "next/navigation";
import { SandEffect } from "@/components/SandEffect";

export function SandEffectWrapper() {
  const pathname = usePathname();
  // The cassa is a work surface (fast taps during service, often on modest
  // tablets): no decorative rAF canvas competing with it.
  if (pathname?.startsWith("/cassa")) return null;
  // Public template sites (/s public restaurant sites, /b standalone booking
  // page) are self-contained websites — the CRM's decorative sand canvas is a
  // dashboard flourish and must not bleed onto a tenant's own site.
  if (pathname?.startsWith("/s/") || pathname?.startsWith("/b/")) return null;
  return <SandEffect />;
}
