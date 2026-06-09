// Self-healing reconciliation for half-provisioned tenants.
//
// The failure mode (chef-oraz, then Lugares Mágicos): the onboarding function is
// killed mid-clone, AFTER the n8n workflows are created and activated but BEFORE
// the final settings commit writes the provisioning markers. The tenant is left
// `active` with a working bot but with NO settings.provisioning.sandbox_routable
// — so the [Meta Router] n8n workflow never lists it in the test menu and the
// CRM health card flags it red.
//
// The orchestrator now writes those markers EARLY (at row creation), so NEW
// tenants can't reach this state. This is the safety net for any tenant that
// slipped through before the fix, or any future partial run: it detects "active
// + live n8n workflows but missing routability marker" and backfills it.
// Read-modify-write, idempotent, never destructive.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { N8N_MOTORE_UNICO_MIN_COUNT } from "@/lib/tenants/activation";
import { resolveProvisioningMarkers, slugify } from "@/lib/tenants/provisioning-markers";

const N8N_BASE = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";

export interface Repair {
  tenant_id: string;
  name: string;
  reason: string;
  added: Record<string, unknown>;
}

export interface ReconcileResult {
  dryRun: boolean;
  scanned: number;
  repaired: number;
  repairs: Repair[];
  skipped: { name: string; why: string }[];
}

// How many active [Name]* workflows exist on n8n right now. null = unreachable.
async function n8nActiveCount(restaurantName: string): Promise<number | null> {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${N8N_BASE}/api/v1/workflows?limit=250`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const prefix = `[${restaurantName}]`.toLowerCase();
    const workflows = (data?.data || []) as Array<{ name?: string; active?: boolean }>;
    return workflows.filter(
      (w) => typeof w?.name === "string" && w.name.toLowerCase().startsWith(prefix) && w.active
    ).length;
  } catch {
    return null;
  }
}

export async function reconcileProvisioning(dryRun: boolean): Promise<ReconcileResult> {
  const supabase = createServiceRoleClient();
  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, status, settings")
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const repairs: Repair[] = [];
  const skipped: { name: string; why: string }[] = [];

  for (const t of tenants || []) {
    const s = (t.settings || {}) as Record<string, unknown>;
    const prov = (s.provisioning || {}) as Record<string, unknown>;

    // Already routable, or a real customer on their own number → nothing to do.
    if (prov.sandbox_routable === true || prov.whatsapp_attached === true) {
      skipped.push({ name: t.name, why: "already routable / own number" });
      continue;
    }

    // Only heal a tenant whose bot is demonstrably LIVE on n8n. A tenant with no
    // workflows is genuinely unprovisioned — flagging it routable would put a
    // dead restaurant in the test menu. Heal only the "infra exists, marker
    // missing" gap.
    const activeCount = await n8nActiveCount(t.name);
    if (activeCount === null) {
      skipped.push({ name: t.name, why: "n8n unreachable — cannot verify, left untouched" });
      continue;
    }
    // This gate exists only to avoid marking a DEAD tenant routable. A tenant
    // with at least the motore-unico floor of live own workflows clearly has a
    // working bot (the rest — WhatsApp/Reminders — are served by shared
    // engines), so use that floor, not the full self-hosted count.
    if (activeCount < N8N_MOTORE_UNICO_MIN_COUNT) {
      skipped.push({ name: t.name, why: `${activeCount} workflows (<${N8N_MOTORE_UNICO_MIN_COUNT}) — genuinely incomplete, not a lost marker` });
      continue;
    }

    const newProv = resolveProvisioningMarkers(prov, slugify(t.name));
    const repair: Repair = {
      tenant_id: t.id,
      name: t.name,
      reason: `active + ${activeCount} live workflows but no routability marker`,
      added: newProv,
    };
    repairs.push(repair);

    if (!dryRun) {
      const merged = { ...s, provisioning: newProv };
      const { error: upErr } = await supabase
        .from("tenants")
        .update({ settings: merged })
        .eq("id", t.id);
      if (upErr) {
        // Surface the failure rather than silently swallowing it.
        repair.reason += ` — WRITE FAILED: ${upErr.message}`;
      }
    }
  }

  return { dryRun, scanned: (tenants || []).length, repaired: repairs.length, repairs, skipped };
}
