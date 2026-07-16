// One-off live E2E for the Retell→Vapi migration. Exercises the real vapi.ts
// helpers against the live Vapi API, then cleans up the assistant it creates.
// Run: VAPI_PRIVATE_KEY=… npx tsx scripts/vapi-e2e.mts
import {
  cloneTemplateAssistant,
  syncAssistantPrompt,
  deleteAssistant,
  TEMPLATE_VAPI_ASSISTANT_ID,
} from "../src/lib/onboarding/vapi";

const VAPI_BASE = "https://api.vapi.ai";
const key = process.env.VAPI_PRIVATE_KEY;
if (!key) throw new Error("VAPI_PRIVATE_KEY missing in env");

const VM_START = "<!-- VOICEMAIL_BLOCK_START -->";
const VM_END = "<!-- VOICEMAIL_BLOCK_END -->";
const KB_START = "<!-- KB_BLOCK_START -->";

const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) process.exitCode = 1;
};

async function getAssistant(id: string) {
  const r = await fetch(`${VAPI_BASE}/assistant/${id}`, { headers: { Authorization: `Bearer ${key}` } });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
function sysPrompt(a: any): string {
  const m = (a?.model?.messages || []).find((x: any) => x?.role === "system");
  return m?.content || "";
}

const voicePrompt = "# Identidad\nEres el agente vocal de E2E TestResto. Responde breve.";
const kb = [
  { title: "Política de reservas", content: "Grupos 1-6 confirmación automática.", category: "policies" },
  { title: "Ubicación", content: "Calle E2E 1, Las Palmas.", category: "general" },
];

let assistantId = "";
try {
  // 1. Clone the template.
  const { assistantId: id } = await cloneTemplateAssistant({
    key,
    name: "ZZ E2E DELETE-ME",
    systemPrompt: voicePrompt,
    firstMessage: "¡Hola, E2E TestResto!",
  });
  assistantId = id;
  ok(`cloned template ${TEMPLATE_VAPI_ASSISTANT_ID} → ${assistantId}`, !!assistantId && assistantId !== TEMPLATE_VAPI_ASSISTANT_ID);

  const afterClone = await getAssistant(assistantId);
  ok("clone name set", afterClone.body?.name === "ZZ E2E DELETE-ME");
  ok("clone system prompt = voice prompt stub", sysPrompt(afterClone.body).includes("agente vocal de E2E TestResto"));
  ok("clone firstMessage set", afterClone.body?.firstMessage === "¡Hola, E2E TestResto!");
  ok("clone reused template voice", !!afterClone.body?.voice?.voiceId);
  ok("clone reused template tools", Array.isArray(afterClone.body?.model?.tools) && afterClone.body.model.tools.length > 0);

  // 2. Sync KB → prompt should now carry voice prompt + KB block.
  const s1 = await syncAssistantPrompt({ key, assistantId, voicePromptBody: voicePrompt, kbArticles: kb });
  ok("sync #1 changed the prompt", s1.changed);
  const afterKb = await getAssistant(assistantId);
  const p1 = sysPrompt(afterKb.body);
  ok("prompt has voice prompt", p1.includes("agente vocal de E2E TestResto"));
  ok("prompt has KB block", p1.includes(KB_START));
  ok("prompt has KB article content", p1.includes("Grupos 1-6 confirmación automática."));

  // 3. Re-sync with identical input → no-op (changed=false).
  const s2 = await syncAssistantPrompt({ key, assistantId, voicePromptBody: voicePrompt, kbArticles: kb });
  ok("sync #2 is a no-op (unchanged)", !s2.changed);

  // 4. Simulate the voicemail route prepending a VM block, then re-sync KB and
  //    prove the VM block survives (the critical migration invariant).
  const vmBlock = `${VM_START}\nFORWARD to +34600000000\n${VM_END}`;
  const withVm = { ...afterKb.body, model: { ...afterKb.body.model, messages: [{ role: "system", content: `${vmBlock}\n\n${p1}` }] } };
  const patchRes = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: withVm.model }),
  });
  ok("injected VM block via PATCH", patchRes.ok);

  // Re-sync with a CHANGED KB so a real PATCH fires (not a no-op), proving the
  // VM block survives an actual write that rewrites the voice-prompt + KB.
  const kb2 = [...kb, { title: "Horario", content: "Lun-Vie 12:30-15:30.", category: "general" }];
  const s3 = await syncAssistantPrompt({ key, assistantId, voicePromptBody: voicePrompt, kbArticles: kb2 });
  ok("sync #3 fired a real PATCH (KB changed)", s3.changed);
  const afterVm = await getAssistant(assistantId);
  const p3 = sysPrompt(afterVm.body);
  ok("VM block PRESERVED after KB-changing sync", p3.includes(vmBlock));
  ok("VM block sits before voice prompt", p3.indexOf(VM_START) < p3.indexOf("agente vocal"));
  ok("new KB article present after sync", p3.includes("Lun-Vie 12:30-15:30."));
  ok("voice prompt still present after sync", p3.includes("agente vocal de E2E TestResto"));
} finally {
  // 5. Cleanup — always delete the assistant we created.
  if (assistantId) {
    await deleteAssistant(assistantId, key);
    const gone = await getAssistant(assistantId);
    ok(`deleted assistant ${assistantId} (GET → ${gone.status})`, gone.status === 404);
  }
}
console.log(process.exitCode ? "\nE2E FAILED" : "\nE2E PASSED — full cleanup done");
