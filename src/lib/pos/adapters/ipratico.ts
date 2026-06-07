// iPratico adapter — STUB. Implements the PosAdapter contract so the registry,
// the sync orchestrator and the UI already work end-to-end against it, but every
// method throws until the real API credentials arrive. Implementing it later =
// fill these three methods with posFetch + the decrypted credentials; nothing
// downstream changes (it already reads the canonical pos_sales tables).
import type {
  AdapterContext,
  CanonicalProduct,
  CanonicalSale,
  FetchSalesParams,
  PosAdapter,
} from "@/lib/pos/types";

const NOT_IMPLEMENTED = "iPratico non implementato (in attesa di credenziali API)";

export const ipraticoAdapter: PosAdapter = {
  provider: "ipratico",
  async testConnection(_ctx: AdapterContext): Promise<{ ok: true; detail?: string }> {
    throw new Error(NOT_IMPLEMENTED);
  },
  async fetchSales(_ctx: AdapterContext, _p: FetchSalesParams): Promise<CanonicalSale[]> {
    throw new Error(NOT_IMPLEMENTED);
  },
  async fetchProducts(_ctx: AdapterContext): Promise<CanonicalProduct[]> {
    throw new Error(NOT_IMPLEMENTED);
  },
};
