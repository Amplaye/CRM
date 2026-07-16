// Deliverect adapter — STUB. Deliverect aggregates delivery platforms (Glovo,
// Just Eat, Deliveroo, Uber Eats…), so its sales map onto the canonical shape
// with a specific profile (documented here so the future implementer doesn't
// re-derive it):
//
//   - channel       → always 'delivery'
//   - channelSource → the originating platform (glovo/justeat/…), from the order
//   - feesTotal     → the platform commission Deliverect reports (typically
//                     25–30% of gross) — this is what separates delivery margin
//                     from in-house margin, so it MUST be populated, not 0.
//   - covers        → null (no table seating on delivery; never count coperti)
//   - paymentMethod → 'online' (prepaid through the platform)
//
// Implementing it later = fill the three methods with posFetch + the decrypted
// OAuth credentials; nothing downstream changes.

import type {
  AdapterContext,
  CanonicalProduct,
  CanonicalSale,
  FetchSalesParams,
  PosAdapter,
} from "@/lib/pos/types";

const NOT_IMPLEMENTED = "Deliverect non implementato (in attesa di credenziali API)";

export const deliverectAdapter: PosAdapter = {
  provider: "deliverect",
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
