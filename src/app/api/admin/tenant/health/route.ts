import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { ENGINE_VAPI_ASSISTANT_ID } from "@/lib/voice/engine";
import { getVoiceProvider } from "@/lib/types/tenant-settings";
import {
  cloudflareEngineHealthUrl,
  isCloudflareEngineHealthy,
} from "@/lib/tenants/engine-health";

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

type CheckState = "ok" | "warn" | "fail";
interface Check {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
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

  // 4. Chatbot engine — every tenant now runs on the bot-engine Worker (n8n is
  //    shut down). Probe the Worker's /health (contract: {"ok":true}). The engine
  //    is multi-tenant dynamic, so there's no per-tenant workflow list to show —
  //    the card just reports the Worker reachable/healthy.
  let engineState: CheckState;
  let engineDetail: string;
  try {
    const res = await fetch(cloudflareEngineHealthUrl(), { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (res.ok && isCloudflareEngineHealthy(body)) {
      engineState = "ok";
      engineDetail = "servito dal Worker bot-engine (health ok)";
    } else {
      engineState = "fail";
      engineDetail = `Worker bot-engine risponde ma non è healthy (HTTP ${res.status})`;
    }
  } catch {
    engineState = "warn";
    engineDetail = "stato del Worker bot-engine non verificabile ora";
  }
  // Key stays "n8n" so the existing admin card (which looks it up by key) keeps
  // working without a coordinated rename; the label reflects the real engine.
  checks.push({ key: "n8n", label: "Motore (Cloudflare Worker)", state: engineState, detail: engineDetail });

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
  const botIsLive = vapiState === "ok" && engineState === "ok";
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
