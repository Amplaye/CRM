// Billing → voice bridge — the missing wire between "a tenant paid for a voice
// add-on" and "settings.voice.provider reflects the tier they bought".
//
// The provider IS the SKU: buying voice_vapi (€99 base) means the calls run on
// Vapi; buying voice_retell (€199 premium) means they run on Retell. Both tiers
// share the SAME prompt, so a switch is a routing flip (see voice-provider.ts) —
// this module decides the target tier from the paid add-ons and persists the flip.
//
// What this does NOT do: call Vapi/Retell APIs or buy phone numbers. Those are
// real external effects with their own credentials/cost — firing them inline in a
// Stripe webhook would block the billing mirror on a slow/failing third party. So
// when the target provider has no agent id yet, we mark settings.voice.provisioning
// = "pending" and leave the actual clone/sync/number-buy to an out-of-band
// reconcile pass. When the agent already exists (a re-promote, or a tenant
// provisioned at onboarding), the flip is fully live → "active".

import type { TenantSettings, VoiceProviderTier } from "@/lib/types/tenant-settings";
import { resolveVoiceSwitch, applyVoiceProvider } from "@/lib/tenants/voice-provider";

/** Which voice tier each add-on id grants. `voice_agent` is the legacy single-tier
 * id (was €199) → treated as premium so any old subscription keeps Retell. */
export const VOICE_ADDON_PROVIDER: Record<string, VoiceProviderTier> = {
  voice_vapi: "vapi",
  voice_retell: "retell",
  voice_agent: "retell",
};

/**
 * The voice tier a tenant is entitled to from its add-on list, or null when it
 * owns no voice add-on (→ leave voice.provider untouched). Premium wins if both
 * are somehow present (a tenant shouldn't own both, but if it does, give the tier
 * it pays more for rather than silently downgrading).
 */
export function voiceProviderFromAddons(addons: string[] | null | undefined): VoiceProviderTier | null {
  const list = addons || [];
  if (list.some((a) => VOICE_ADDON_PROVIDER[a] === "retell")) return "retell";
  if (list.some((a) => VOICE_ADDON_PROVIDER[a] === "vapi")) return "vapi";
  return null;
}

export interface VoiceBillingPlan {
  /** No change needed (no voice add-on, or already on the right tier + provisioned). */
  noop: boolean;
  /** The tier the add-ons grant, or null when none owned. */
  target: VoiceProviderTier | null;
  /** Settings to persist when !noop; null otherwise. */
  nextSettings: TenantSettings | null;
  /** "pending" when the target provider still needs an agent provisioned, "active"
   * when it already has one. Undefined on a no-op. */
  provisioning?: "pending" | "active";
}

/**
 * Pure: given the tenant's current settings and its paid add-ons, decide whether
 * (and how) to flip the voice tier. Idempotent — re-running on the same inputs is
 * a no-op once the flag matches the entitled tier and provisioning is recorded.
 */
export function planVoiceBillingSync(
  settings: TenantSettings | null | undefined,
  addons: string[] | null | undefined,
): VoiceBillingPlan {
  const target = voiceProviderFromAddons(addons);
  if (!target) return { noop: true, target: null, nextSettings: null };

  const sw = resolveVoiceSwitch(settings, target);
  const provisioning: "pending" | "active" = sw.needsProvision ? "pending" : "active";

  // Already on the target tier AND its provisioning state already recorded → nothing to do.
  if (sw.noop && settings?.voice?.provisioning === provisioning) {
    return { noop: true, target, nextSettings: null, provisioning };
  }

  const flipped = applyVoiceProvider(settings, target);
  const nextSettings: TenantSettings = {
    ...flipped,
    voice: { ...(flipped.voice || {}), provider: target, provisioning },
  };
  return { noop: false, target, nextSettings, provisioning };
}

/**
 * Persist the voice-tier flip implied by a tenant's paid add-ons. Thin DB wrapper
 * over planVoiceBillingSync — the webhook calls this best-effort AFTER the billing
 * mirror is written, so a voice-sync hiccup never blocks recording the payment.
 * `svc` is a service-role client (the webhook has no user session).
 */
export async function syncVoiceProviderFromBilling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
  addons: string[] | null | undefined,
): Promise<VoiceBillingPlan> {
  const target = voiceProviderFromAddons(addons);
  if (!target) return { noop: true, target: null, nextSettings: null };

  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const settings = (tenant?.settings || {}) as TenantSettings;
  const plan = planVoiceBillingSync(settings, addons);
  if (plan.noop || !plan.nextSettings) return plan;

  await svc.from("tenants").update({ settings: plan.nextSettings }).eq("id", tenantId);
  return plan;
}
