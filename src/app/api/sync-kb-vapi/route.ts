import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { isPromptArticle, syncAssistantPrompt, VapiKbArticle } from "@/lib/onboarding/vapi";
import { verifyTenantMembership } from "@/lib/tenant-membership";

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

    // Resolve the Vapi assistant strictly from the tenant's own settings,
    // populated by onboarding. No cross-tenant fallback: if it's missing the
    // tenant simply hasn't been onboarded yet, and we say so explicitly.
    const assistantId = (tenant.settings as any)?.vapi?.assistantId;
    if (!assistantId) {
      return NextResponse.json(
        { error: `No Vapi config for tenant ${tenant_id}. Run onboarding first.` },
        { status: 400 }
      );
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
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
