// The ONE switch from a provider id to its adapter. Every other module asks the
// registry instead of importing an adapter directly, so adding/replacing a till
// is a single line here (mirrors how voice-provider.ts is the only place that
// knows the provider→implementation mapping).

import type { PosAdapter, PosProvider } from "@/lib/pos/types";
import { mockAdapter } from "@/lib/pos/adapters/mock";
import { loyverseAdapter } from "@/lib/pos/adapters/loyverse";

// "cassa" is intentionally absent: the built-in till is not an integration we
// talk to over a wire, it writes its own sales. Callers must branch on it before
// asking for an adapter (see resolveTill), and getAdapter throws if they don't.
//
// The brands we do not integrate yet (cassa_in_cloud, tilby, ipratico, nempos,
// deliverect) are absent too: their adapters were stubs that only threw, so the
// map is Partial and getAdapter reports them as unknown. They stay in the
// PosProvider union because tenants may carry the value in settings from before,
// and the union is what lets those settings still parse.
const ADAPTERS: Partial<Record<Exclude<PosProvider, "cassa">, PosAdapter>> = {
  mock: mockAdapter,
  loyverse: loyverseAdapter,
};

export function getAdapter(provider: PosProvider): PosAdapter {
  if (provider === "cassa") {
    throw new Error("The built-in till has no adapter — check for it before calling getAdapter.");
  }
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unknown POS provider: ${provider}`);
  return adapter;
}
