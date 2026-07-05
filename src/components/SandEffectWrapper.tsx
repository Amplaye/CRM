"use client";

import { usePathname } from "next/navigation";
import { SandEffect } from "@/components/SandEffect";

export function SandEffectWrapper() {
  const pathname = usePathname();
  // The cassa is a work surface (fast taps during service, often on modest
  // tablets): no decorative rAF canvas competing with it.
  if (pathname?.startsWith("/cassa")) return null;
  return <SandEffect />;
}
