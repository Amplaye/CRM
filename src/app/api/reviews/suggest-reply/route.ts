import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";

// AI-suggested reply to a guest review (owner approves/edits before saving —
// this route only DRAFTS, it never writes). Same direct OpenAI Responses call
// as the menu import (src/lib/menu/extract.ts); OPENAI_API_KEY is already on
// Vercel.

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const reviewId = String(body.review_id || "");
    if (!tenantId || !reviewId) {
      return NextResponse.json({ error: "tenant_id and review_id required" }, { status: 400 });
    }
    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });

    const svc = createServiceRoleClient();
    const [{ data: review }, { data: tenant }] = await Promise.all([
      svc
        .from("reviews")
        .select("rating, comment, guests(name)")
        .eq("id", reviewId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      svc.from("tenants").select("name, settings").eq("id", tenantId).maybeSingle(),
    ]);
    if (!review || !tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Reply in the CRM dashboard language — the owner reads/approves it there.
    const locale = (tenant.settings as { crm_locale?: string } | null)?.crm_locale || "es";
    const guestName = ((review.guests as { name?: string | null } | null)?.name || "").split(" ")[0];

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_output_tokens: 300,
        temperature: 0.7,
        instructions: `You write short, warm replies to restaurant guest reviews on behalf of the owner of "${tenant.name}". Rules: reply in the language with ISO code "${locale}"; 2-4 sentences; thank the guest by first name when given; for ratings <= 3 apologize sincerely, never argue, and invite them back; for 4-5 thank them warmly; no hashtags, no emojis unless the review used them, no discounts or promises. Output ONLY the reply text.`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Guest: ${guestName || "(no name)"}\nRating: ${review.rating}/5\nReview: ${review.comment || "(no comment)"}`,
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`openai ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text =
      json.output_text ||
      (json.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("");

    return NextResponse.json({ success: true, suggestion: text.trim() });
  } catch (e) {
    console.error("[reviews/suggest-reply]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
