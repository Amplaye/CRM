import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { assertRateLimit } from "@/lib/rate-limit";
import { getTenantFeatures } from "@/lib/tenants/features";
import { logAuditEvent } from "@/lib/audit";
import { resolveNamedDate, revenueForWindow } from "@/lib/management/compare";
import { dishCostTable } from "@/lib/management/food-cost";
import type { Dish, RecipeLine, SaleRow } from "@/lib/management/types";
import { apiError } from "@/lib/api-error";

// Financial assistant for the WhatsApp bot + voice. Same contract as
// /api/ai/menu: returns JSON-shaped DATA; the bot phrases it in the customer's
// (here: the owner's) language. The voice engine already passes
// metadata.tenant_id per call, so there is no new plumbing.
//
// Gated on management_enabled (403 when off). Intents:
//   revenue_compare  — { period_a, period_b } → revenue of each + delta
//   top_margin       — best dishes by margin
//   bottom_margin    — worst dishes (highest food cost %)
//   stock_low        — ingredients at/under par level
//   stock_update     — the ONLY write: adjust an ingredient's stock by voice
//                      ({ ingredient, delta } or { ingredient, set_to })

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* eslint-disable @typescript-eslint/no-explicit-any */
function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

async function loadSales(supabase: any, tenantId: string, sinceDate: string): Promise<SaleRow[]> {
  const { data } = await supabase
    .from("pos_sales")
    .select("business_date, closed_at, channel, gross_total, net_total, fees_total, covers")
    .eq("tenant_id", tenantId)
    .gte("business_date", sinceDate);
  return (data || []).map((s: any) => ({
    businessDate: s.business_date,
    closedAt: s.closed_at,
    channel: s.channel,
    grossTotal: Number(s.gross_total),
    netTotal: s.net_total != null ? Number(s.net_total) : null,
    feesTotal: Number(s.fees_total),
    covers: s.covers,
  }));
}

async function dishRows(supabase: any, tenantId: string, targetPct: number) {
  const [{ data: items }, { data: recipes }, { data: ings }] = await Promise.all([
    supabase.from("menu_items").select("id, name, price").eq("tenant_id", tenantId),
    supabase.from("recipe_items").select("menu_item_id, ingredient_id, qty").eq("tenant_id", tenantId),
    supabase.from("ingredients").select("id, current_unit_cost").eq("tenant_id", tenantId),
  ]);
  const costs = new Map<string, number>();
  for (const i of ings || []) costs.set(i.id, Number(i.current_unit_cost));
  const recipesByDish = new Map<string, RecipeLine[]>();
  for (const r of recipes || []) {
    const list = recipesByDish.get(r.menu_item_id) || [];
    list.push({ ingredientId: r.ingredient_id, qty: Number(r.qty) });
    recipesByDish.set(r.menu_item_id, list);
  }
  const dishes: Dish[] = (items || []).map((i: any) => ({ menuItemId: i.id, name: i.name, price: i.price }));
  return dishCostTable(dishes, recipesByDish, costs, targetPct);
}

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  const rl = await assertRateLimit(request, "ai:finance", { max: 60, windowSecs: 60 });
  if (rl) return rl;

  const body = (await request.json().catch(() => null)) as any;
  const tenantId = body?.tenant_id;
  const intent = body?.intent;
  if (!tenantId || !intent) {
    return NextResponse.json({ success: false, error: "Missing tenant_id or intent" }, { status: 400 });
  }

  const features = await getTenantFeatures(tenantId);
  if (!features.management_enabled) {
    return NextResponse.json({ success: false, error: "management_disabled" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  // deterministic "now" comes from the server clock; resolveNamedDate takes it as input.
  const now = new Date();
  const settingsTarget = await getTargetPct(supabase, tenantId);

  try {
    switch (intent) {
      case "revenue_compare": {
        const a = resolveNamedDate(now, String(body.period_a || "yesterday"));
        const b = resolveNamedDate(now, String(body.period_b || "last_week"));
        // load enough history to cover both windows
        const earliest = [a.from, b.from].sort()[0];
        const sales = await loadSales(supabase, tenantId, earliest);
        const revA = revenueForWindow(sales, a);
        const revB = revenueForWindow(sales, b);
        return NextResponse.json({
          success: true,
          intent,
          period_a: { ...a, label: body.period_a, revenue: revA },
          period_b: { ...b, label: body.period_b, revenue: revB },
          delta: Math.round((revA - revB) * 100) / 100,
          delta_pct: revB > 0 ? Math.round(((revA - revB) / revB) * 1000) / 10 : null,
          currency: "EUR",
        });
      }

      case "top_margin":
      case "bottom_margin": {
        const rows = await dishRows(supabase, tenantId, settingsTarget);
        const withData = rows.filter((r) => r.foodCostPct != null && !r.noRecipe);
        // dishCostTable sorts worst (highest food cost %) first.
        const limit = Math.min(Number(body.limit) || 5, 20);
        const picked = intent === "bottom_margin" ? withData.slice(0, limit) : withData.slice(-limit).reverse();
        return NextResponse.json({
          success: true,
          intent,
          dishes: picked.map((r) => ({
            name: r.name,
            price: r.price,
            cost: r.cost,
            food_cost_pct: r.foodCostPct,
            margin: r.margin,
            low_margin: r.lowMargin,
          })),
          target_pct: settingsTarget,
        });
      }

      case "stock_low": {
        const { data } = await supabase
          .from("ingredients")
          .select("name, unit, stock_qty, par_level, supplier_name")
          .eq("tenant_id", tenantId)
          .eq("archived", false);
        const low = (data || [])
          .filter((i: any) => Number(i.stock_qty) <= Number(i.par_level))
          .map((i: any) => ({
            name: i.name,
            unit: i.unit,
            stock: Number(i.stock_qty),
            par: Number(i.par_level),
            supplier: i.supplier_name,
          }));
        return NextResponse.json({ success: true, intent, count: low.length, ingredients: low });
      }

      case "stock_update": {
        const query = norm(String(body.ingredient || ""));
        if (!query) return NextResponse.json({ success: false, error: "Missing ingredient" }, { status: 400 });
        const { data: matches } = await supabase
          .from("ingredients")
          .select("id, name, unit, stock_qty")
          .eq("tenant_id", tenantId)
          .eq("archived", false);
        // fuzzy: exact-normalized first, else substring
        const list = matches || [];
        const found =
          list.find((i: any) => norm(i.name) === query) ||
          list.find((i: any) => norm(i.name).includes(query) || query.includes(norm(i.name)));
        if (!found) {
          return NextResponse.json({ success: false, error: "ingredient_not_found", query: body.ingredient }, { status: 404 });
        }
        const prev = Number(found.stock_qty);
        let next: number;
        if (body.set_to != null) next = Number(body.set_to);
        else if (body.delta != null) next = prev + Number(body.delta);
        else return NextResponse.json({ success: false, error: "Missing delta or set_to" }, { status: 400 });
        if (!Number.isFinite(next)) return NextResponse.json({ success: false, error: "Invalid quantity" }, { status: 400 });

        const { error } = await supabase
          .from("ingredients")
          .update({ stock_qty: next, updated_at: new Date().toISOString() })
          .eq("id", found.id)
          .eq("tenant_id", tenantId);
        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

        await logAuditEvent({
          tenant_id: tenantId,
          action: "inventory.stock_update",
          entity_id: found.id,
          source: "ai_agent",
          details: { ingredient: found.name, prev, next, via: body.set_to != null ? "set_to" : "delta" },
        });

        return NextResponse.json({
          success: true,
          intent,
          ingredient: found.name,
          unit: found.unit,
          previous_stock: prev,
          new_stock: Math.round(next * 1000) / 1000,
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown intent: ${intent}` }, { status: 400 });
    }
  } catch (e: any) {
    return apiError(e, { route: "ai/finance", publicMessage: "internal_error", extra: { success: false } });
  }
}

async function getTargetPct(supabase: any, tenantId: string): Promise<number> {
  const { data } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  return (data?.settings as any)?.management?.food_cost_target_pct ?? 30;
}
