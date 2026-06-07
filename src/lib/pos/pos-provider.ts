// POS provider resolution — the single point that decides which till feeds a
// tenant's canonical sales. Pure functions, a direct mirror of voice-provider.ts
// (getVoiceProvider / resolveVoiceSwitch / applyVoiceProvider). Default is
// 'mock', so a brand-new tenant produces realistic fake sales out of the box and
// "goes live" on a real till by flipping settings.pos.provider — nothing else.

import type { TenantSettings } from "@/lib/types/tenant-settings";
import type { PosProvider } from "@/lib/pos/types";

const DEFAULT_PROVIDER: PosProvider = "mock";

/** Which POS adapter actually feeds this tenant. Defaults to 'mock'. */
export function getPosProvider(settings: TenantSettings | null | undefined): PosProvider {
  const explicit = settings?.pos?.provider;
  if (
    explicit === "mock" ||
    explicit === "cassa_in_cloud" ||
    explicit === "tilby" ||
    explicit === "ipratico" ||
    explicit === "nempos" ||
    explicit === "deliverect"
  ) {
    return explicit;
  }
  return DEFAULT_PROVIDER;
}

export interface PosSwitchPlan {
  /** No-op when already on the target provider. */
  noop: boolean;
  from: PosProvider;
  to: PosProvider;
  /** Real tills need stored credentials before they can sync; 'mock' never does. */
  needsCredentials: boolean;
}

/** Pure: decide what switching `settings` to `target` entails. */
export function resolvePosProvider(
  settings: TenantSettings | null | undefined,
  target: PosProvider,
): PosSwitchPlan {
  const from = getPosProvider(settings);
  return {
    noop: from === target,
    from,
    to: target,
    needsCredentials: target !== "mock",
  };
}

/** Apply the provider flip to a settings object (pure). Caller persists it. */
export function applyPosProvider(
  settings: TenantSettings | null | undefined,
  target: PosProvider,
): TenantSettings {
  const prev = (settings || {}) as TenantSettings;
  return { ...prev, pos: { ...(prev.pos || {}), provider: target } };
}
