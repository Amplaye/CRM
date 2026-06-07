// The ONE switch from a provider id to its adapter. Every other module asks the
// registry instead of importing an adapter directly, so adding/replacing a till
// is a single line here (mirrors how voice-provider.ts is the only place that
// knows the provider→implementation mapping).

import type { PosAdapter, PosProvider } from "@/lib/pos/types";
import { mockAdapter } from "@/lib/pos/adapters/mock";
import { cassaInCloudAdapter } from "@/lib/pos/adapters/cassa-in-cloud";
import { tilbyAdapter } from "@/lib/pos/adapters/tilby";
import { ipraticoAdapter } from "@/lib/pos/adapters/ipratico";
import { nemposAdapter } from "@/lib/pos/adapters/nempos";
import { deliverectAdapter } from "@/lib/pos/adapters/deliverect";

const ADAPTERS: Record<PosProvider, PosAdapter> = {
  mock: mockAdapter,
  cassa_in_cloud: cassaInCloudAdapter,
  tilby: tilbyAdapter,
  ipratico: ipraticoAdapter,
  nempos: nemposAdapter,
  deliverect: deliverectAdapter,
};

export function getAdapter(provider: PosProvider): PosAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unknown POS provider: ${provider}`);
  return adapter;
}
