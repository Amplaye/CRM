import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";

// AI campaign copywriter (HappyChef-style): the owner gives a one-line brief
// ("torna a trovarci, 10% sul menù degustazione"), the AI drafts the message
// in the dashboard language for the chosen channel. Draft only — the owner
// edits and sends from the UI.

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const brief = String(body.brief || "").trim();
    const channel = body.channel === "whatsapp" ? "whatsapp" : "email";
    if (!tenantId || !brief) return NextResponse.json({ error: "tenant_id and brief required" }, { status: 400 });
    const member = await verifyTenantMembership(tenantId, ["owner", "manager", "marketing"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });

    const svc = createServiceRoleClient();
    const { data: tenant } = await svc.from("tenants").select("name, settings").eq("id", tenantId).maybeSingle();
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const locale = (tenant.settings as { crm_locale?: string } | null)?.crm_locale || "es";

    const shape =
      channel === "email"
        ? `Output STRICT JSON: {"subject": string, "body": string}. Body: 60-120 words, warm, one clear call to action, no HTML (plain text with line breaks), no placeholders like [name].`
        : `Output STRICT JSON: {"body": string}. Body: max 350 characters, WhatsApp tone, max 2 emojis, one clear call to action, no placeholders like [name].`;

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_output_tokens: 500,
        temperature: 0.8,
        instructions: `You write ${channel} marketing copy for the restaurant "${tenant.name}". Language: ISO code "${locale}". ${shape} No markdown fences — raw JSON only.`,
        input: [{ role: "user", content: [{ type: "input_text", text: `Brief: ${brief}` }] }],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const json = (await res.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text =
      json.output_text ||
      (json.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("");
    const parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, ""));

    return NextResponse.json({ success: true, subject: parsed.subject || null, body: String(parsed.body || "") });
  } catch (e) {
    console.error("[marketing/generate]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
