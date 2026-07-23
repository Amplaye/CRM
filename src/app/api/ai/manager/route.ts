import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { assertManagement } from "@/lib/billing/guard";
import { normalizePhone } from "@/lib/booking-validation";
import { verifiedStaffPhone } from "@/lib/ai/manager-auth";
import { dishCost } from "@/lib/management/food-cost";
import type { RecipeLine } from "@/lib/management/types";

// Manager agent back-end. The bot-engine calls this (x-ai-secret) when a VERIFIED
// staff number messages the restaurant: read-only questions about stock, takings
// and dishes, plus the phone-verification round-trip. One endpoint, action-routed,
// so the worker has a single URL to call.
//
// Every data action re-checks that the phone is a verified staff member of the
// tenant — the bot classifies the sender, but the CRM never trusts that alone
// (this agent knows the takings). Writes (invoice-from-photo, stock movements)
// live in their own gated routes; this file is read + identity only.

export const runtime = "nodejs";

// Local trading date for the tenant (YYYY-MM-DD), offset by whole days.
function localDate(tz: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  // en-CA gives ISO-ish YYYY-MM-DD; timeZone shifts it to the tenant's day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function POST(req: Request) {
  const unauth = assertAiSecret(req);
  if (unauth) return unauth;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_body" }, { status: 400 }); }
  const tenantId: string | undefined = body?.tenant_id;
  const phone: string | undefined = body?.phone;
  const action: string | undefined = body?.action;
  if (!tenantId || !action) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const svc = createServiceRoleClient();

  // The manager agent is a gestionale feature: no add-on → nothing to answer.
  const gate = await assertManagement(tenantId, svc);
  if (gate) return gate;

  // ── Phone verification (does NOT require prior verification) ──────────────
  if (action === "verify_phone") {
    const code: string = String(body?.code || "").trim().toUpperCase();
    if (!phone || !code) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    const { data: pending } = await svc
      .from("staff_whatsapp")
      .select("id, member_id, code_expires_at")
      .eq("tenant_id", tenantId)
      .eq("verify_code", code)
      .is("verified_at", null)
      .maybeSingle();
    if (!pending) return NextResponse.json({ ok: true, verified: false, reason: "no_match" });
    if (pending.code_expires_at && new Date(pending.code_expires_at) < new Date()) {
      return NextResponse.json({ ok: true, verified: false, reason: "expired" });
    }
    await svc.from("staff_whatsapp").update({
      phone: normalizePhone(phone),
      verified_at: new Date().toISOString(),
      verify_code: null,
      code_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", pending.id);
    let name: string | null = null;
    if (pending.member_id) {
      const { data: m } = await svc.from("tenant_members").select("user_id").eq("id", pending.member_id).maybeSingle();
      if (m?.user_id) { const { data: u } = await svc.from("users").select("name").eq("id", m.user_id).maybeSingle(); name = (u as any)?.name ?? null; }
    }
    return NextResponse.json({ ok: true, verified: true, name });
  }

  // ── Identity check (classify the sender) ─────────────────────────────────
  if (action === "identity") {
    if (!phone) return NextResponse.json({ staff: false });
    const staff = await verifiedStaffPhone(svc as any, tenantId, phone);
    if (!staff) return NextResponse.json({ staff: false });
    let name: string | null = null;
    if (staff.member_id) {
      const { data: m } = await svc.from("tenant_members").select("user_id, role").eq("id", staff.member_id).maybeSingle();
      if (m?.user_id) { const { data: u } = await svc.from("users").select("name").eq("id", m.user_id).maybeSingle(); name = (u as any)?.name ?? null; }
    }
    return NextResponse.json({ staff: true, member_id: staff.member_id, name });
  }

  // ── Everything below requires a verified staff phone ─────────────────────
  if (!phone) return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  const staff = await verifiedStaffPhone(svc as any, tenantId, phone);
  if (!staff) return NextResponse.json({ error: "not_staff" }, { status: 403 });

  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const tz = (tenant?.settings as any)?.timezone || "Europe/Rome";

  if (action === "stock" || action === "low_stock") {
    const query: string | undefined = body?.query;
    let q = svc.from("ingredients").select("name, unit, stock_qty, par_level, current_unit_cost").eq("tenant_id", tenantId).eq("archived", false);
    if (query && action === "stock") q = q.ilike("name", `%${query}%`);
    const { data } = await q.order("name").limit(action === "stock" && query ? 10 : 500);
    const rows = (data || []).map((i: any) => ({
      name: i.name,
      stock: Number(i.stock_qty) || 0,
      unit: i.unit,
      par: i.par_level != null ? Number(i.par_level) : null,
      low: i.par_level != null && Number(i.par_level) > 0 && Number(i.stock_qty) <= Number(i.par_level),
    }));
    const items = action === "low_stock" ? rows.filter((r: any) => r.low) : rows;
    return NextResponse.json({ items, count: items.length });
  }

  if (action === "revenue") {
    const when: string = body?.date === "yesterday" ? localDate(tz, -1) : /^\d{4}-\d{2}-\d{2}$/.test(body?.date || "") ? body.date : localDate(tz, 0);
    const { data } = await svc.from("pos_sales").select("net_total, gross_total, covers").eq("tenant_id", tenantId).eq("business_date", when);
    const rows = data || [];
    const total = rows.reduce((s: number, r: any) => s + (Number(r.net_total ?? r.gross_total) || 0), 0);
    const covers = rows.reduce((s: number, r: any) => s + (r.covers || 0), 0);
    return NextResponse.json({ date: when, total: Math.round(total * 100) / 100, orders: rows.length, covers, avg_ticket: rows.length ? Math.round((total / rows.length) * 100) / 100 : null });
  }

  if (action === "night") {
    const today = localDate(tz, 0);
    const [{ data: sales }, { data: resv }, { data: ings }] = await Promise.all([
      svc.from("pos_sales").select("net_total, gross_total, covers").eq("tenant_id", tenantId).eq("business_date", today),
      svc.from("reservations").select("party_size, status").eq("tenant_id", tenantId).eq("date", today),
      svc.from("ingredients").select("stock_qty, par_level").eq("tenant_id", tenantId).eq("archived", false),
    ]);
    const total = (sales || []).reduce((s: number, r: any) => s + (Number(r.net_total ?? r.gross_total) || 0), 0);
    const coversSold = (sales || []).reduce((s: number, r: any) => s + (r.covers || 0), 0);
    const activeResv = (resv || []).filter((r: any) => !["cancelled", "no_show"].includes(r.status));
    const coversBooked = activeResv.reduce((s: number, r: any) => s + (r.party_size || 0), 0);
    const lowStock = (ings || []).filter((i: any) => i.par_level != null && Number(i.par_level) > 0 && Number(i.stock_qty) <= Number(i.par_level)).length;
    return NextResponse.json({
      date: today,
      revenue: Math.round(total * 100) / 100,
      orders: (sales || []).length,
      covers_sold: coversSold,
      reservations: activeResv.length,
      covers_booked: coversBooked,
      low_stock: lowStock,
    });
  }

  if (action === "dish_cost") {
    const dish: string = String(body?.dish || "").trim();
    if (!dish) return NextResponse.json({ error: "missing_dish" }, { status: 400 });
    const { data: items } = await svc.from("menu_items").select("id, name, price").eq("tenant_id", tenantId).ilike("name", `%${dish}%`).limit(1);
    const item = (items || [])[0] as any;
    if (!item) return NextResponse.json({ found: false });
    const [{ data: recipe }, { data: ings }] = await Promise.all([
      svc.from("recipe_items").select("ingredient_id, qty, waste_pct").eq("tenant_id", tenantId).eq("menu_item_id", item.id),
      svc.from("ingredients").select("id, current_unit_cost").eq("tenant_id", tenantId),
    ]);
    const costs = new Map<string, number>();
    for (const i of ings || []) costs.set(i.id, Number(i.current_unit_cost) || 0);
    const lines: RecipeLine[] = (recipe || []).map((r: any) => ({ ingredientId: r.ingredient_id, qty: Number(r.qty), wastePct: r.waste_pct != null ? Number(r.waste_pct) : 0 }));
    const { cost } = dishCost(lines, costs);
    const price = item.price != null ? Number(item.price) : null;
    return NextResponse.json({
      found: true,
      name: item.name,
      cost: Math.round(cost * 100) / 100,
      price,
      food_cost_pct: price && price > 0 ? Math.round((cost / price) * 1000) / 10 : null,
      has_recipe: lines.length > 0,
    });
  }

  if (action === "top_dishes") {
    const days = Math.min(90, Math.max(1, Number(body?.days) || 30));
    const from = localDate(tz, -(days - 1));
    const { data: sales } = await svc.from("pos_sales").select("id").eq("tenant_id", tenantId).gte("business_date", from);
    const ids = (sales || []).map((s: any) => s.id);
    if (!ids.length) return NextResponse.json({ items: [] });
    const { data: lines } = await svc.from("pos_sale_items").select("name, quantity, gross_total").in("sale_id", ids);
    const agg = new Map<string, { qty: number; rev: number }>();
    for (const l of lines || []) {
      const cur = agg.get(l.name) || { qty: 0, rev: 0 };
      cur.qty += Number(l.quantity) || 0;
      cur.rev += Number(l.gross_total) || 0;
      agg.set(l.name, cur);
    }
    const items = [...agg.entries()].map(([name, v]) => ({ name, qty: Math.round(v.qty), revenue: Math.round(v.rev * 100) / 100 }))
      .sort((a, b) => b.qty - a.qty).slice(0, 10);
    return NextResponse.json({ items, days });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
