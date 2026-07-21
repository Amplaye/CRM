// Registro driver RT — specchio di src/lib/pos/registry.ts.
import type { FiscalBrand, FiscalDriver } from "./types";
import { epsonDriver } from "./drivers/epson";
import { axonDriver } from "./drivers/axon";
import { genericXmlDriver } from "./drivers/generic-xml";

export function getFiscalDriver(brand: FiscalBrand): FiscalDriver {
  switch (brand) {
    case "epson":
      return epsonDriver;
    case "axon":
      return axonDriver;
    case "generic":
    default:
      return genericXmlDriver;
  }
}

export const FISCAL_BRANDS: { value: FiscalBrand; label: string }[] = [
  { value: "epson", label: "Epson" },
  { value: "axon", label: "Axon / Micrelec" },
  { value: "generic", label: "Altro (RCH / Custom)" },
];
