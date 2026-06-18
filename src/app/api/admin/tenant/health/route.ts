import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { N8N_TEMPLATE_COUNT, N8N_MOTORE_UNICO_MIN_COUNT } from "@/lib/tenants/activation";
import { ENGINE_VAPI_ASSISTANT_ID } from "@/lib/voice/engine";
import { getVoiceProvider } from "@/lib/types/tenant-settings";

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

interface N8nProbe {
  /** Active workflows named `[<tenant>] …` — the tenant's own per-tenant set. */
  ownActive: number;
  /** Are the shared "motore unico" engines that cover the superseded per-tenant
   * workflows (WhatsApp + Reminders) live? If so, a tenant missing those few own
   * workflows is still fully operational. */
  sharedEnginesLive: boolean;
}

// The shared workflows whose presence proves a motore-unico tenant's WhatsApp +
// reminders work even without its own `[Name]` copies. Matched case-insensitively
// and by prefix so a future rename of the suffix doesn't silently break this.
const SHARED_ENGINE_PREFIXES = [
  "[meta router] whatsapp",                  // all inbound WhatsApp → the one chatbot engine
  "[all] reminders — multi-tenant",          // reminders for every tenant
  "[all] follow-up post-cena — multi-tenant", // post-dinner follow-up for every tenant
  "[all] waitlist reassurance — multi-tenant", // waitlist reassurance for every tenant
];

async function n8nProbe(restaurantName: string): Promise<N8nProbe | null> {
  const apiKey = process.env.N8N_API_KEY;
  const baseUrl = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";
  if (!apiKey) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows?limit=250`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const all: Array<{ name?: string; active?: boolean }> = data?.data || [];
    // Case-insensitive: a tenant named "PICNIC" has workflows named "[Picnic] …".
    // A case-sensitive match returned 0 and falsely flagged a working legacy
    // tenant as "0/13 incomplete".
    const prefix = `[${restaurantName}]`.toLowerCase();
    const isActiveNamed = (w: { name?: string; active?: boolean }, p: string) =>
      typeof w.name === "string" && w.name.toLowerCase().startsWith(p) && w.active === true;
    const ownActive = all.filter((w) => isActiveNamed(w, prefix)).length;
    const sharedEnginesLive = SHARED_ENGINE_PREFIXES.every((p) =>
      all.some((w) => isActiveNamed(w, p))
    );
    return { ownActive, sharedEnginesLive };
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

  // The onboarding-marker check is built LAST (see below) because its verdict
  // depends on whether the bot is demonstrably live (Vapi + n8n), which we only
  // know after probing them. We still want it to render right after "status",
  // so reserve its slot here and fill it in at the end.
  const onboardingSlot = checks.push({
    key: "onboarding",
    label: "Onboarding completato",
    state: "warn",
    detail: "",
  }) - 1;

  // 3. Voice assistant. Two valid Vapi shapes since the "motore unico":
  //    - ENGINE tenant (the norm now): no per-tenant assistantId — every call is
  //      served by the ONE shared engine assistant, with the tenant injected at
  //      call time. A missing settings.vapi.assistantId is EXPECTED, not a fault;
  //      we verify the shared engine exists instead. (The old code read
  //      settings.vapi.assistantId and false-flagged every engine tenant red.)
  //    - Legacy per-tenant clone: a stored assistantId that ISN'T the engine —
  //      verify that specific assistant, as before.
  //  Retell premium tenants are reported on their own id, not falsely failed.
  const provider = getVoiceProvider(s);
  const recordedAssistantId: string | undefined = s?.vapi?.assistantId;
  let vapiState: CheckState = "fail";
  let vapiDetail = "nessun assistant collegato";
  let vapiLabel = "Assistente vocale (Vapi)";
  if (provider === "retell") {
    const agentId: string | undefined = s?.retell?.agentId;
    vapiLabel = "Assistente vocale (Retell — premium)";
    vapiState = agentId ? "ok" : "warn";
    vapiDetail = agentId ? `agente Retell collegato (${agentId.slice(0, 8)}…)` : "premium senza agente Retell";
  } else if (recordedAssistantId && recordedAssistantId !== ENGINE_VAPI_ASSISTANT_ID) {
    // Legacy per-tenant clone.
    const exists = await vapiAssistantExists(recordedAssistantId);
    if (exists === true) { vapiState = "ok"; vapiDetail = `clone collegato (${recordedAssistantId.slice(0, 8)}…)`; }
    else if (exists === false) { vapiState = "fail"; vapiDetail = "id presente ma assistant inesistente su Vapi"; }
    else { vapiState = "warn"; vapiDetail = `id presente (${recordedAssistantId.slice(0, 8)}…), verifica Vapi non disponibile`; }
  } else {
    // Engine tenant — served by the shared "motore unico" assistant.
    const exists = await vapiAssistantExists(ENGINE_VAPI_ASSISTANT_ID);
    if (exists === true) { vapiState = "ok"; vapiDetail = `servito dal motore unico (${ENGINE_VAPI_ASSISTANT_ID.slice(0, 8)}…)`; }
    else if (exists === false) { vapiState = "fail"; vapiDetail = "motore unico (engine) non trovato su Vapi"; }
    else { vapiState = "warn"; vapiDetail = "motore unico configurato, verifica Vapi non disponibile"; }
  }
  checks.push({ key: "vapi", label: vapiLabel, state: vapiState, detail: vapiDetail });

  // 4. n8n workflows — the AUTHORITATIVE signal is how many [Name]* workflows are
  // active on n8n right now (live), not what the settings recorded. Legacy
  // tenants have no recorded ids but plenty of live workflows. The recorded
  // count is only a fallback hint when n8n is unreachable.
  const recordedIds: string[] = Array.isArray(s?.n8n?.workflow_ids) ? s.n8n.workflow_ids : [];
  const probe = await n8nProbe(tenant.name);
  let n8nState: CheckState;
  let n8nDetail: string;
  if (probe === null) {
    // Can't verify live → never hard-fail on the recorded count alone (a legacy
    // tenant with 0 recorded ids may still be fully live). Worst case: warn.
    n8nState = "warn";
    n8nDetail =
      recordedIds.length > 0
        ? `${recordedIds.length} registrati; stato n8n non verificabile ora`
        : "stato n8n non verificabile ora";
  } else if (probe.ownActive >= N8N_TEMPLATE_COUNT) {
    // Self-hosted tenant — runs the full per-tenant set.
    n8nState = "ok";
    n8nDetail = `${probe.ownActive}/${N8N_TEMPLATE_COUNT} workflow attivi`;
  } else if (probe.ownActive >= N8N_MOTORE_UNICO_MIN_COUNT && probe.sharedEnginesLive) {
    // Motore-unico tenant: several functions (WhatsApp, Reminders, Web Call
    // Token, Follow-up Post-Cena, Waitlist Reassurance) are intentionally served
    // by the shared engines instead of being cloned per tenant. That's not
    // "incomplete" — confirm the shared engines are live and report it healthy.
    n8nState = "ok";
    n8nDetail = `${probe.ownActive} propri + WhatsApp/Reminders/Follow-up/Waitlist dal motore unico (condivisi)`;
  } else {
    n8nState = "fail";
    n8nDetail = `${probe.ownActive}/${N8N_TEMPLATE_COUNT} workflow attivi (incompleto)`;
  }
  checks.push({ key: "n8n", label: "Automazioni (n8n)", state: n8nState, detail: n8nDetail });

  // 2 (filled last). Onboarding marker — what the dashboard guard reads to stop
  // redirecting the OWNER into the wizard. It says nothing about whether the bot
  // works; that's proven by the live Vapi assistant + active n8n workflows above.
  //
  // The dashboard guard itself only bounces on the EXPLICIT marker `false`
  // (DashboardLayout.tsx) — a *missing* marker never traps anyone. So this card
  // shouldn't flag a missing marker as a problem when the bot is demonstrably
  // live: that's just a legacy tenant (provisioned by hand before the wizard,
  // e.g. PICNIC), and "warn" there is noise that hides the WhatsApp warning.
  //
  //   marker === true           → ok  (wizard finished, marker written)
  //   marker absent + bot live  → ok  (legacy tenant, marker simply unnecessary)
  //   marker absent + bot NOT live → warn (looks like a genuinely stalled wizard)
  //   marker === false          → warn (register-tenant wrote it; never provisioned)
  const onboardingMarker = s?.onboarding?.completed;
  const botIsLive = vapiState === "ok" && n8nState === "ok";
  let onboardingState: CheckState;
  let onboardingDetail: string;
  if (onboardingMarker === true) {
    onboardingState = "ok";
    onboardingDetail = "sì";
  } else if (onboardingMarker === false) {
    onboardingState = "warn";
    onboardingDetail = "wizard non completato";
  } else if (botIsLive) {
    onboardingState = "ok";
    onboardingDetail = "tenant legacy — bot operativo, marker non necessario";
  } else {
    onboardingState = "warn";
    onboardingDetail = "marker mancante (tenant legacy o wizard interrotto)";
  }
  checks[onboardingSlot] = {
    key: "onboarding",
    label: "Onboarding completato",
    state: onboardingState,
    detail: onboardingDetail,
  };

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
