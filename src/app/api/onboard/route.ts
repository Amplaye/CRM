import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runOnboard, OnboardInput, OnboardProgress } from "@/lib/onboarding/orchestrator";
import { resolveOwnerProvisionTenant } from "@/lib/onboarding/owner-tenant";
import { generateKbArticlesMulti, KbQuestionnaire, Lang } from "@/lib/onboarding/kb-generator";

// Owner self-serve provisioning. Same engine as the admin wizard
// (/api/admin/onboard → runOnboard), but driven by the restaurant owner for
// THEIR OWN tenant. Up to ~60s end-to-end (Vapi + 13 n8n clones + KB sync).
export const maxDuration = 120;

const localeFor = (l: Lang) =>
  l === "it" ? "it-IT" : l === "en" ? "en-GB" : l === "de" ? "de-DE" : "es-ES";

function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

interface SelfServeBody {
  restaurant_name: string;
  restaurant_phone: string;
  owner_phone: string;
  language?: Lang; // legacy single-language hint (still honoured)
  languages?: Lang[]; // assistant speaks these; languages[0] is the primary one
  timezone: string;
  review_url?: string;
  opening_hours: Record<string, Array<{ open: string; close: string }>>;
  table_size_preset: "small" | "medium" | "large";
  questionnaire: KbQuestionnaire;
  tenant_id?: string; // optional hint; the resolver still proves ownership
}

export async function POST(req: Request) {
  // 1. Authenticate the caller (cookie session).
  const authClient = await createServerSupabaseClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as SelfServeBody;

  // 2. CONTROLLO FERREO — resolve which tenant this user may provision from
  //    their own memberships. The tenant id is never trusted from the body
  //    unless it is proven to be one the caller owns.
  const svc = createServiceRoleClient();
  const { data: memberships, error: memErr } = await svc
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user.id);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const resolved = resolveOwnerProvisionTenant(memberships || [], body.tenant_id);
  if (!resolved.ok) {
    const status = resolved.reason === "forbidden_tenant" ? 403 : 400;
    return NextResponse.json({ error: resolved.reason }, { status });
  }
  const tenantId = resolved.tenantId;

  // 3. Idempotency: never double-provision (would orphan Vapi/n8n resources).
  const { data: tenant } = await svc
    .from("tenants").select("id, settings").eq("id", tenantId).single();
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  if ((tenant.settings as any)?.vapi?.assistantId) {
    return NextResponse.json({ error: "already_provisioned" }, { status: 409 });
  }

  // 4. Build the orchestrator input. KB articles are generated server-side from
  //    the fixed-field questionnaire (the client never ships free-text). The
  //    voice prompt is omitted on purpose → orchestrator builds it from the
  //    agency template.
  // The assistant can speak several languages. languages[0] is the primary one
  // (drives voice prompt, locale and greeting); the KB is built in every one.
  const ALL: Lang[] = ["es", "it", "en", "de"];
  const langs = (Array.isArray(body.languages) ? body.languages : [body.language])
    .filter((l): l is Lang => !!l && ALL.includes(l));
  const selected: Lang[] = langs.length ? Array.from(new Set(langs)) : ["es"];
  const lang = selected[0];
  const kbArticles = generateKbArticlesMulti(body.questionnaire, {
    restaurant_name: body.restaurant_name,
    restaurant_phone: body.restaurant_phone || "",
    opening_hours: body.opening_hours || {},
  }, selected);
  // Slug carries a tenant-id suffix so two restaurants with the same name never
  // collide on n8n webhook paths.
  const slug = `${slugify(body.restaurant_name) || "resto"}-${tenantId.slice(0, 4)}`;

  const input: OnboardInput = {
    restaurant_name: body.restaurant_name,
    slug,
    restaurant_phone: (body.restaurant_phone || "").trim(),
    owner_phone: (body.owner_phone || "").trim(),
    timezone: body.timezone || "Atlantic/Canary",
    locale: localeFor(lang),
    language: lang,
    review_url: (body.review_url || "").trim(),
    opening_hours: body.opening_hours || {},
    table_size_preset: body.table_size_preset || "medium",
    kb_articles: kbArticles,
    // voice_prompt intentionally omitted → built from the agency template.
    owner_email: user.email || "",
    owner_password: "", // unused: owner already exists
    owner_name: (user.user_metadata as any)?.name || "",
    tenant_id: tenantId,
    owner_user_id: user.id,
    self_serve: true,
  };

  // 5. Stream progress over SSE so the wizard shows a live step log.
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (p: OnboardProgress) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      const result = await runOnboard(input, emit);
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ step: "result", message: "final", ok: result.ok, data: result })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
