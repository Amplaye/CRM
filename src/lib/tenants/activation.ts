// Activation health — derived from the tenant ROW alone (status + settings),
// no network calls. This is the subset of "is the bot actually working" that
// both the admin list and the per-tenant detail card must agree on.
//
// The chef-oraz / PICNIC incident: the master list showed "Healthy" (it only
// looks at operational signals — open issues, bookings, no-shows) while the
// detail card showed "Attivazione INCOMPLETA" (it inspects provisioning
// artifacts). A half-provisioned tenant whose bot does not work was therefore
// green in the list. This helper is the single source for the provisioning
// verdict so the two views can never disagree on the DB-derivable part.
//
// The detail card additionally probes Vapi/n8n live (does the assistant still
// exist? how many workflows are active right now?) — those need the network and
// stay in the route. Here we only judge what the row records.

import type { TenantStatus } from "@/lib/tenants/status";
import type { TenantSettings } from "@/lib/types/tenant-settings";

/** Official restaurant template workflow count — a fully provisioned tenant
 * records this many cloned n8n workflow ids. */
export const N8N_TEMPLATE_COUNT = 13;

export type ActivationState = "ok" | "warn" | "fail";

export interface ActivationVerdict {
  /** Overall verdict from the row alone. */
  state: ActivationState;
  /** True when provisioning is broken/incomplete (the bot does not fully work). */
  incomplete: boolean;
  /** Machine-readable reasons that are not "ok", for surfacing in the UI. */
  reasons: string[];
}

/**
 * Judge a tenant's activation from its persisted state only.
 *
 * Markers (all DB-derivable, mirrors the detail card's non-network checks):
 *  - status: a provisioned tenant is `active`; `trial` means provisioning did
 *    not conclude (warn); anything else blocks (fail).
 *  - onboarding.completed: the marker the dashboard guard reads. Missing ⇒ the
 *    wizard was interrupted half-way (fail).
 *  - vapi.assistantId / retell.agentId: a voice assistant must be recorded (fail
 *    if neither — note: existence on the provider is checked live elsewhere).
 *  - n8n.workflow_ids: the cloned automations. Fewer than the template count ⇒
 *    incomplete (fail). None recorded ⇒ never provisioned (fail).
 *
 * WhatsApp number is intentionally NOT a marker here — sandbox is a valid
 * testing state, so a missing own-number is a warning the card shows but does
 * not let it block. The list cares about "does the bot work", not "is it on the
 * client's own number yet".
 */
export function activationFromSettings(
  status: TenantStatus | null | undefined,
  settings: TenantSettings | null | undefined,
): ActivationVerdict {
  const s = (settings || {}) as TenantSettings;
  const reasons: string[] = [];
  let worst = "ok" as ActivationState;
  const bump = (state: ActivationState) => {
    if (state === "fail") worst = "fail";
    else if (state === "warn" && worst !== "fail") worst = "warn";
  };

  // Onboarding marker
  if (s?.onboarding?.completed !== true) {
    bump("fail");
    reasons.push("onboarding incompleto (marker mancante)");
  }

  // Voice assistant recorded (either provider)
  const hasVoice = !!s?.vapi?.assistantId || !!s?.retell?.agentId;
  if (!hasVoice) {
    bump("fail");
    reasons.push("nessun assistente vocale collegato");
  }

  // n8n automations recorded
  const recordedIds = Array.isArray(s?.n8n?.workflow_ids) ? s.n8n!.workflow_ids! : [];
  if (recordedIds.length < N8N_TEMPLATE_COUNT) {
    bump("fail");
    reasons.push(
      recordedIds.length === 0
        ? "automazioni non create"
        : `solo ${recordedIds.length}/${N8N_TEMPLATE_COUNT} automazioni registrate`,
    );
  }

  // Status
  if (status !== "active") {
    if (status === "trial") {
      bump("warn");
      reasons.push("stato trial — provisioning non concluso");
    } else if (status) {
      bump("fail");
      reasons.push(`stato ${status}`);
    }
  }

  return { state: worst, incomplete: worst === "fail", reasons };
}
