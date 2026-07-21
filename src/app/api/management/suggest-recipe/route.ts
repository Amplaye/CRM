import { NextResponse } from "next/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openai-base-url";
import { assertManagement } from "@/lib/billing/guard";
import { assertCredits, consumeCredits } from "@/lib/billing/credits";
import { assertRateLimit } from "@/lib/rate-limit";
import {
  buildRecipePrompt,
  parseRecipeSuggestion,
  resolveSuggestion,
  type RecipeDish,
  type ResolvedLine,
} from "@/lib/management/recipe-suggest";
import type { MatchCandidate } from "@/lib/management/ingredient-match";

// AI recipe drafting. Given one or more dishes (name + description), ask the
// model for a per-portion ingredient list, then snap each suggested line onto
// the tenant's real warehouse with the SAME fuzzy matcher the invoice importer
// uses. The response is a DRAFT the client reviews before it writes recipe_items
// — this route never persists a recipe.
//
// One route serves both the per-dish "suggest recipe" button and the bulk
// "generate missing recipes" run (the body is always an array of dishes).
//
// Gating mirrors invoices/upload + assistant/interpret: membership →
// management add-on → rate limit → credit pre-check. ai_text (~€0.01/dish) is
// metered AFTER a successful batch, qty = number of dishes.

export const runtime = "nodejs";
// The bulk case fans out one model call per dish (bounded concurrency). A menu
// of 40 dishes can keep the model busy for a while; give it room like the
// invoice OCR route rather than timing out mid-batch.
export const maxDuration = 300;

const MAX_DISHES = 60;
const CHUNK = 5;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  const rawDishes = Array.isArray(body.dishes) ? body.dishes : [];

  if (!tenantId || rawDishes.length === 0) {
    return NextResponse.json({ error: "Missing tenantId or dishes" }, { status: 400 });
  }

  // Normalize + cap the dish list up front.
  const dishes: RecipeDish[] = rawDishes
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      menuItemId: typeof d.menuItemId === "string" ? d.menuItemId : "",
      name: typeof d.name === "string" ? d.name.trim().slice(0, 200) : "",
      description: typeof d.description === "string" ? d.description.slice(0, 500) : null,
      price: typeof d.price === "number" ? d.price : null,
    }))
    .filter((d) => d.menuItemId && d.name)
    .slice(0, MAX_DISHES);

  if (dishes.length === 0) {
    return NextResponse.json({ error: "No valid dishes" }, { status: 400 });
  }

  // Auth: signed-in member of this tenant.
  const membership = await verifyTenantMembership(tenantId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Paid add-on gate (fail-closed) BEFORE any model call.
  const gate = await assertManagement(tenantId);
  if (gate) return gate;

  // Rate limit: a handful of bulk runs a minute is plenty.
  const rl = await assertRateLimit(request, "recipe:suggest", { max: 20, windowSecs: 60 });
  if (rl) return rl;

  // Credit pre-check for the WHOLE batch (fail-open, per credits.ts).
  const credits = await assertCredits(tenantId, "ai_text", dishes.length);
  if (credits) return credits;

  // Load the tenant's warehouse once — names ground the prompt, the full row
  // set (id/name/unit) feeds the matcher.
  const svc = createServiceRoleClient();
  const { data: ingRows } = await svc
    .from("ingredients")
    .select("id, name, unit")
    .eq("tenant_id", tenantId)
    .eq("archived", false);
  const ingredients: MatchCandidate[] = (ingRows || []).map((i: any) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
  }));
  const ingredientNames = ingredients.map((i) => i.name);

  // One dish → one model call → parse → resolve. A failed call resolves to an
  // empty suggestion so one bad dish never fails the whole batch.
  const suggestOne = async (
    dish: RecipeDish,
  ): Promise<{ menuItemId: string; lines: ResolvedLine[] }> => {
    try {
      const res = await chatCompletion({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: buildRecipePrompt(dish, ingredientNames),
      });
      if (!res.ok) {
        console.error("[suggest-recipe] LLM error", dish.menuItemId, res.status);
        return { menuItemId: dish.menuItemId, lines: [] };
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      const parsed = parseRecipeSuggestion(content);
      return { menuItemId: dish.menuItemId, lines: resolveSuggestion(parsed, ingredients) };
    } catch (e) {
      console.error("[suggest-recipe] exception", dish.menuItemId, e);
      return { menuItemId: dish.menuItemId, lines: [] };
    }
  };

  // Bounded concurrency: chunks of CHUNK dishes at a time.
  const results: Array<{ menuItemId: string; lines: ResolvedLine[] }> = [];
  for (let i = 0; i < dishes.length; i += CHUNK) {
    const chunk = dishes.slice(i, i + CHUNK);
    results.push(...(await Promise.all(chunk.map(suggestOne))));
  }

  // Meter the batch only now that it succeeded (fire-and-forget, never throws).
  await consumeCredits(tenantId, "ai_text", {
    qty: dishes.length,
    costEur: 0.01 * dishes.length,
    metadata: { feature: "recipe_suggest", dishes: dishes.length },
  });

  return NextResponse.json({ results });
}
