import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { N8N_TEMPLATE_COUNT } from "@/lib/tenants/activation";

// Activation health-check for a single tenant.
//
// The chef-oraz incident: the wizard reported "completed" while the tenant was
// actually half-provisioned (assistant + workflows created, but the tenant row
// never recorded them and stayed `trial`). The self-serve banner only lists
// *correctly* finished tenants, so a broken one is invisible there.
//
// This endpoint instead inspects the REAL artifacts a working tenant must have
// and returns a per-check verdict so the admin UI can show a green/yellow/red
// light. It's read-only — it diagnoses, it doesn't repair.

// N8N_TEMPLATE_COUNT now lives in src/lib/tenants/activation.ts so the list and
// this card share one definition of "fully provisioned".

type CheckState = "ok" | "warn" | "fail";
interface Check {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

async function n8nCountFor(restaurantName: string): Promise<number | null> {
  const apiKey = process.env.N8N_API_KEY;
  const baseUrl = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";
  if (!apiKey) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows?limit=250`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Case-insensitive: a tenant named "PICNIC" has workflows named "[Picnic] …".
    // A case-sensitive match returned 0 and falsely flagged a working legacy
    // tenant as "0/13 incomplete".
    const prefix = `[${restaurantName}]`.toLowerCase();
    return (data?.data || []).filter(
      (w: any) => typeof w?.name === "string" && w.name.toLowerCase().startsWith(prefix) && w.active
    ).length;
  } catch {
    return null;
  }
}

async function vapiAssistantExists(assistantId: string): Promise<boolean | null> {
  const key = process.env.VAPI_PRIVATE_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const tenantId = req.nextUrl.searchParams.get("id");
  if (!tenantId) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, name, status, settings")
    .eq("id", tenantId)
    .single();
  if (error || !tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const s: any = tenant.settings || {};
  const checks: Check[] = [];

  // 1. Status — only trial/active receive traffic; a provisioned tenant is active.
  checks.push({
    key: "status",
    label: "Stato del cliente",
    state: tenant.status === "active" ? "ok" : tenant.status === "trial" ? "warn" : "fail",
    detail:
      tenant.status === "active"
        ? "attivo"
        : tenant.status === "trial"
        ? "trial — provisioning non concluso"
        : tenant.status,
  });

  // 2. Onboarding marker — what the dashboard guard reads to stop redirecting.
  // NOT blocking: legacy tenants (provisioned by hand before the wizard existed,
  // e.g. PICNIC) never wrote this marker yet work perfectly. Its absence is only
  // a warning; the authoritative "does the bot work" signals are the live Vapi
  // assistant and the active n8n workflows below.
  const completed = s?.onboarding?.completed === true;
  checks.push({
    key: "onboarding",
    label: "Onboarding completato",
    state: completed ? "ok" : "warn",
    detail: completed ? "sì" : "marker mancante (tenant legacy o wizard interrotto)",
  });

  // 3. Vapi assistant — recorded AND actually existing on Vapi.
  const assistantId: string | undefined = s?.vapi?.assistantId;
  let vapiState: CheckState = "fail";
  let vapiDetail = "nessun assistant collegato";
  if (assistantId) {
    const exists = await vapiAssistantExists(assistantId);
    if (exists === true) { vapiState = "ok"; vapiDetail = `collegato (${assistantId.slice(0, 8)}…)`; }
    else if (exists === false) { vapiState = "fail"; vapiDetail = "id presente ma assistant inesistente su Vapi"; }
    else { vapiState = "warn"; vapiDetail = `id presente (${assistantId.slice(0, 8)}…), verifica Vapi non disponibile`; }
  }
  checks.push({ key: "vapi", label: "Assistente vocale (Vapi)", state: vapiState, detail: vapiDetail });

  // 4. n8n workflows — the AUTHORITATIVE signal is how many [Name]* workflows are
  // active on n8n right now (live), not what the settings recorded. Legacy
  // tenants have no recorded ids but plenty of live workflows. The recorded
  // count is only a fallback hint when n8n is unreachable.
  const recordedIds: string[] = Array.isArray(s?.n8n?.workflow_ids) ? s.n8n.workflow_ids : [];
  const activeCount = await n8nCountFor(tenant.name);
  let n8nState: CheckState;
  let n8nDetail: string;
  if (activeCount === null) {
    // Can't verify live → never hard-fail on the recorded count alone (a legacy
    // tenant with 0 recorded ids may still be fully live). Worst case: warn.
    n8nState = "warn";
    n8nDetail =
      recordedIds.length > 0
        ? `${recordedIds.length} registrati; stato n8n non verificabile ora`
        : "stato n8n non verificabile ora";
  } else if (activeCount >= N8N_TEMPLATE_COUNT) {
    n8nState = "ok";
    n8nDetail = `${activeCount}/${N8N_TEMPLATE_COUNT} workflow attivi`;
  } else {
    n8nState = "fail";
    n8nDetail = `${activeCount}/${N8N_TEMPLATE_COUNT} workflow attivi (incompleto)`;
  }
  checks.push({ key: "n8n", label: "Automazioni (n8n)", state: n8nState, detail: n8nDetail });

  // 5. WhatsApp number — informational: sandbox vs own number. Not a failure.
  const waAttached = s?.provisioning?.whatsapp_attached === true;
  const routable = s?.provisioning?.sandbox_routable === true;
  checks.push({
    key: "whatsapp",
    label: "Numero WhatsApp",
    state: waAttached ? "ok" : "warn",
    detail: waAttached
      ? "numero proprio collegato"
      : routable
      ? "su numero sandbox (test) — manca il numero proprio"
      : "nessun numero collegato",
  });

  // Overall: fail if anything failed; warn if any warning; else ok.
  // The WhatsApp check is intentionally excluded from "fail" (sandbox is a valid
  // testing state), but a missing number still keeps the overall at "warn".
  const blocking = checks.filter((c) => c.key !== "whatsapp");
  const overall: CheckState = blocking.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
    ? "warn"
    : "ok";

  return NextResponse.json({
    tenant_id: tenant.id,
    name: tenant.name,
    overall,
    checks,
  });
}
