// The shape of GET /api/fiscal/status. Lives in its own module (no "use client",
// no server imports) so both the till and the Settings tab can type the response
// without dragging the server-only fiscal context into a client bundle.

import type { AeatImpuesto, FiscalRegimen } from "./regions";
import type { SifMode } from "./server";

export interface FiscalStatus {
  /** `off` = not under VeriFactu (Italy, or not onboarded) → today's behaviour. */
  mode: SifMode | "off";
  /** True when this till must chain and file every ticket it issues. */
  register: boolean;
  nif: string | null;
  regime: {
    key: FiscalRegimen;
    label: string;
    impuesto: AeatImpuesto | null;
    rates: number[];
    defaultRate: number;
    coverRate: number;
  };
  serie: string;
  /** Records not yet accepted by AEAT. The law wants this visible to the venue. */
  pending: number;
}
