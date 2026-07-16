// One-off: bring the golden TEMPLATE assistant ("PICNIC - Sofía", the source
// every new tenant is cloned from) in line with the current voice-prompt.ts date
// header — HOY + MAÑANA {{tomorrow_date}} spelled out, "never ISO" instruction,
// "say the full weekday" rule. The template is updated in place via exact string
// replacement (no regex) so the VOICEMAIL block, KB block and every other rule
// are preserved verbatim. Run: VAPI_PRIVATE_KEY=… node scripts/update-template-prompt.mjs
const VAPI_BASE = "https://api.vapi.ai";
const KEY = process.env.VAPI_PRIVATE_KEY;
const TEMPLATE_ID = process.env.TEMPLATE_VAPI_ASSISTANT_ID || "6c92f776-abb2-4175-8a55-45d76ec01d1a";
if (!KEY) { console.error("VAPI_PRIVATE_KEY required"); process.exit(1); }

// Exact (old → new) substitutions mirroring the voice-prompt.ts edits. Each must
// match exactly once; if an old string is absent the template already has the new
// form (idempotent) and we skip it.
const SUBS = [
  [
    `HOY {{current_date}} · HORA {{current_time}} Atlantic/Canary\nUsa SIEMPRE esta fecha y hora como "hoy" y "ahora". NUNCA inventes ni asumas otra fecha (NUNCA uses fechas de 2023/2024 ni de tu entrenamiento). Para cualquier otro día/fecha relativa (ej. "este viernes", "lunes", "el 5 de mayo"), llama get_current_date PRIMERO y usa lo que devuelve.`,
    `HOY {{current_date}} · MAÑANA {{tomorrow_date}} · HORA {{current_time}} Atlantic/Canary\n{{current_date}} y {{tomorrow_date}} ya vienen escritas POR ENTERO con su día de la semana (ej. "lunes 1 de junio de 2026"). Dílas TAL CUAL — NUNCA las conviertas a números ni a formato ISO (PROHIBIDO "2026-06-01"). Usa SIEMPRE estas fechas como "hoy" y "mañana". NUNCA inventes ni asumas otra fecha (NUNCA uses fechas de 2023/2024 ni de tu entrenamiento). Para cualquier otro día/fecha relativa (ej. "este viernes", "lunes", "el 5 de mayo"), llama get_current_date PRIMERO y di el día completo.`,
  ],
  [
    `- "hoy/oggi/today/heute", "esta tarde/stasera/tonight/heute Abend", "mañana/domani/tomorrow/morgen" → usa HOY/MAÑANA del header, NO tool call.\n- "este viernes/il lunedì/el 5 de mayo/diesen Freitag/am 5. Mai" → get_current_date UNA vez, luego sigue.\n- NUNCA calcules tú el día de la semana.`,
    `- "hoy/oggi/today/heute", "esta tarde/stasera/tonight/heute Abend", "mañana/domani/tomorrow/morgen" → usa HOY/MAÑANA del header, NO tool call.\n- Cuando NOMBRES una fecha al cliente, dila SIEMPRE por entero con el día de la semana, en su idioma: ES "lunes 1 de junio" · IT "lunedì 1 giugno" · EN "Monday June 1st" · DE "Montag, 1. Juni". HOY y MAÑANA ya te llegan así en el header: úsalas tal cual. NUNCA digas una fecha en cifras/ISO (PROHIBIDO "uno cero seis" o "2026-06-01").\n- "este viernes/il lunedì/el 5 de mayo/diesen Freitag/am 5. Mai" → get_current_date UNA vez, luego di el día completo.\n- NUNCA calcules tú el día de la semana.`,
  ],
];

async function main() {
  const get = await fetch(`${VAPI_BASE}/assistant/${TEMPLATE_ID}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!get.ok) throw new Error(`GET template -> ${get.status}: ${await get.text()}`);
  const a = await get.json();
  const messages = a.model?.messages || [];
  const sysIdx = messages.findIndex((m) => m.role === "system");
  if (sysIdx < 0) throw new Error("no system message on template");
  let prompt = messages[sysIdx].content || "";

  let applied = 0;
  for (const [oldS, newS] of SUBS) {
    if (prompt.includes(newS)) { console.log("already-applied: skip"); continue; }
    const count = prompt.split(oldS).length - 1;
    if (count === 0) { console.log("WARN old-string not found, skipping (template diverged?)"); continue; }
    if (count > 1) throw new Error("old string matched >1 time — unsafe, aborting");
    prompt = prompt.replace(oldS, newS);
    applied++;
  }
  if (applied === 0) { console.log("Nothing to change — template already up to date."); return; }

  const newMessages = messages.slice();
  newMessages[sysIdx] = { ...messages[sysIdx], content: prompt };
  const patch = await fetch(`${VAPI_BASE}/assistant/${TEMPLATE_ID}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: { ...a.model, messages: newMessages } }),
  });
  if (!patch.ok) throw new Error(`PATCH template -> ${patch.status}: ${await patch.text()}`);
  console.log(`Template updated (${applied} substitutions). New prompt chars: ${prompt.length}. has tomorrow_date: ${prompt.includes("MAÑANA {{tomorrow_date}}")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
