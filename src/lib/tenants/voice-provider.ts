// Voice tier switch — promote a tenant to PREMIUM (Retell) or demote to BASE
// (Vapi). Both tiers run the SAME prompt (buildVoicePrompt → composeRetellPrompt
// / composeVapiSystemPrompt), so a switch is a routing flip plus a prompt sync,
// never a rebuild.
//
// What actually moves a call to the new provider is the Web Call Token n8n
// workflow, which reads settings.voice.provider at call time and returns either
// a Vapi or a Retell web-call token (see [<Tenant>] Web Call Token). This module
// owns only the CRM-side state: it flips the flag and makes sure the target
// provider's agent exists and carries the current prompt. It never deletes the
// other provider's agent — a premium tenant keeps its Vapi clone so a downgrade
// back to base is instant and free.
//
// The pure planning helper (resolveVoiceSwitch) is unit-tested; the network
// effects (clone/sync) are thin wrappers over vapi.ts / retell.ts.

import type { TenantSettings, VoiceProviderTier } from "@/lib/types/tenant-settings";
import { getVoiceProvider } from "@/lib/types/tenant-settings";

export interface VoiceSwitchPlan {
  /** No-op when already on the target tier. */
  noop: boolean;
  from: VoiceProviderTier;
  to: VoiceProviderTier;
  /** True if the target provider has no id yet → must be provisioned first. */
  needsProvision: boolean;
  /** The id the target provider already has (assistantId for vapi, agentId for retell), if any. */
  existingTargetId?: string;
}

/**
 * Pure: decide what switching `settings` to `target` entails. Reads the current
 * tier via getVoiceProvider and checks whether the target provider already has a
 * stored id (so a re-promote reuses the kept agent instead of leaking a new one).
 */
export function resolveVoiceSwitch(
  settings: TenantSettings | null | undefined,
  target: VoiceProviderTier,
): VoiceSwitchPlan {
  const from = getVoiceProvider(settings);
  const existingTargetId =
    target === "vapi" ? settings?.vapi?.assistantId : settings?.retell?.agentId;
  return {
    noop: from === target,
    from,
    to: target,
    needsProvision: !existingTargetId,
    existingTargetId: existingTargetId || undefined,
  };
}

/**
 * Apply the flag flip to a settings object (pure). Caller persists the result.
 * Keeps every other key (including the OTHER provider's ids) intact so a switch
 * is reversible without re-provisioning.
 */
export function applyVoiceProvider(
  settings: TenantSettings | null | undefined,
  target: VoiceProviderTier,
): TenantSettings {
  const prev = (settings || {}) as TenantSettings;
  return { ...prev, voice: { ...(prev.voice || {}), provider: target } };
}
