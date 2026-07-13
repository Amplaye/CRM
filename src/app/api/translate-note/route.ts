import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openai-base-url";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { assertCredits, consumeCredits } from "@/lib/billing/credits";

const LANG_NAMES: Record<string, string> = {
  es: "Spanish (es-ES)",
  en: "English (en-US)",
  it: "Italian (it-IT)",
  de: "German (de-DE)",
};

/**
 * Which tenant pays for this translation.
 *
 * The caller (TranslateNoteButton) is a presentational component that only
 * receives the note's text — it has no tenant in scope, and threading one
 * through every place a note is rendered would be a lot of plumbing for a
 * €0.01 call. So: honour an explicit `tenant_id` when the caller can supply one
 * (verified against membership — a client-sent id is never trusted), and
 * otherwise resolve the user's own tenant server-side.
 *
 * Returns null when the user belongs to no tenant, in which case we translate
 * without metering rather than refusing: an unbilled cent beats a broken button.
 */
async function resolvePayingTenant(userId: string, bodyTenantId?: unknown): Promise<string | null> {
  if (typeof bodyTenantId === "string" && bodyTenantId) {
    const member = await verifyTenantMembership(bodyTenantId);
    if (member) return bodyTenantId;
  }
  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data?.tenant_id as string) || null;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { text, targetLang, tenant_id } = await request.json().catch(() => ({} as any));
  if (!text || typeof text !== "string") return NextResponse.json({ error: "Missing text" }, { status: 400 });
  if (!LANG_NAMES[targetLang]) return NextResponse.json({ error: "Invalid targetLang" }, { status: 400 });

  const trimmed = text.trim();
  if (!trimmed) return NextResponse.json({ translated: "" });
  if (trimmed.length > 2000) return NextResponse.json({ error: "Text too long (max 2000)" }, { status: 400 });

  const tenantId = await resolvePayingTenant(user.id, tenant_id);

  // Gate before the OpenAI call, like every other metered route.
  if (tenantId) {
    const gate = await assertCredits(tenantId, "ai_text");
    if (gate) return gate;
  }

  try {
    const res = await chatCompletion({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            `You are a professional translator for short restaurant booking notes. ` +
            `ALWAYS translate the user input into ${LANG_NAMES[targetLang]}, even when the source phrase is short, technical (allergies, diets), or written in another language. ` +
            `If the source already uses words from ${LANG_NAMES[targetLang]}, still produce the most idiomatic ${LANG_NAMES[targetLang]} rendering — never return the input unchanged. ` +
            `Preserve numbers, proper names and party sizes. Output ONLY the translation: no quotes, no labels, no explanation, no source text.`,
        },
        {
          role: "user",
          content: `Translate to ${LANG_NAMES[targetLang]}: ${trimmed}`,
        },
      ],
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[translate-note] OpenAI error", res.status, err);
      return NextResponse.json({ error: "OpenAI failed", details: err }, { status: 502 });
    }
    const data = await res.json();
    const translated = data?.choices?.[0]?.message?.content?.trim() ?? "";

    // Charged only on a translation we actually got back (a 502 above returns
    // uncharged). The button caches per language client-side, so re-showing a
    // translation the user already asked for doesn't hit this route again.
    if (tenantId && translated) {
      await consumeCredits(tenantId, "ai_text", {
        costEur: 0.002, // gpt-4.1-mini on a <=2000-char note
        metadata: { model: "gpt-4.1-mini", feature: "translate_note", target_lang: targetLang },
      });
    }

    return NextResponse.json({ translated });
  } catch (e: any) {
    console.error("[translate-note] exception", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
