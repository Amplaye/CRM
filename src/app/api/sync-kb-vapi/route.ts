import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { isPromptArticle, syncAssistantPrompt, VapiKbArticle } from "@/lib/onboarding/vapi";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { ENGINE_VAPI_ASSISTANT_ID } from "@/lib/voice/engine";
import { apiError } from "@/lib/api-error";

// Sync a tenant's published KB into its Vapi assistant. On Vapi there is no
// separate knowledge base: the published articles are concatenated into the
// assistant's system prompt, after the voice prompt. The special "VOICE PROMPT"
// article is the voice prompt body; everything else is KB.

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
}

export async function POST(req: NextRequest) {
  // Accept either: (a) valid x-ai-secret (n8n/onboarding) or (b) a signed-in
  // dashboard session. The /knowledge and Settings pages call this from the
  // browser without the shared secret.
  const unauth = assertAiSecret(req);
  const viaSecret = !unauth;
  if (!viaSecret) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return unauth;
    } catch {
      return unauth;
    }
  }

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

    // Session callers may only sync a tenant's voice assistant if they are an
    // owner/manager of it (this rewrites the live Vapi system prompt + KB).
    if (!viaSecret) {
      const member = await verifyTenantMembership(tenant_id, ["owner", "manager"]);
      if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const VAPI_KEY = process.env.VAPI_PRIVATE_KEY;
    if (!VAPI_KEY) {
      return NextResponse.json({ error: "VAPI_PRIVATE_KEY not configured" }, { status: 500 });
    }

    const supabase = createServiceRoleClient();

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name, settings")
      .eq("id", tenant_id)
      .single();
    if (tenantErr || !tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // "Motore unico" tenants have NO per-tenant assistant: every call is served
    // by the shared engine, whose prompt+KB are composed FRESH per call from code
    // + live DB (see lib/voice/engine.ts). So there is nothing to sync here — the
    // KB is already live the instant it's saved. This is the norm now; it is a
    // graceful no-op, not an error (the browser save flow fire-and-forgets this).
    // We must also NEVER patch the shared engine itself (it serves all tenants).
    const assistantId = (tenant.settings as any)?.vapi?.assistantId;
    if (!assistantId || assistantId === ENGINE_VAPI_ASSISTANT_ID) {
      return NextResponse.json({
        success: true,
        skipped: "motore-unico",
        message: "KB letta live per chiamata dal motore unico — nessun sync necessario.",
      });
    }

    const { data: allArticles, error: artErr } = await supabase
      .from("knowledge_articles")
      .select("id, title, content, category")
      .eq("tenant_id", tenant_id)
      .eq("status", "published");
    if (artErr) throw artErr;

    const allArr = (allArticles || []) as Article[];
    const promptArticle = allArr.find((a) => isPromptArticle(a.title)) || null;
    const kbArticles: VapiKbArticle[] = allArr
      .filter((a) => !isPromptArticle(a.title))
      .map((a) => ({ title: a.title, content: a.content, category: a.category }));

    const { changed, promptChars } = await syncAssistantPrompt({
      key: VAPI_KEY,
      assistantId,
      voicePromptBody: promptArticle?.content || "",
      kbArticles,
    });

    return NextResponse.json({
      success: true,
      message: `Synced ${kbArticles.length} KB articles${promptArticle ? " + voice prompt" : ""} for tenant ${tenant_id}`,
      assistant_id: assistantId,
      changed,
      prompt_chars: promptChars,
    });
  } catch (err: any) {
    console.error("[sync-kb-vapi] error:", err);
    return apiError(err, { route: "sync-kb-vapi", publicMessage: "operation_failed", status: 500 });
  }
}
