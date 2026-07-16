import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess } from "@/lib/cassa/server";
import { normalizeGiftCode } from "@/lib/gift-cards/gift-cards";

// Till-side voucher lookup: the PayModal calls this when the staff types a
// code, to show the live balance before charging. Read-only — the actual
// decrement happens atomically inside /api/cassa/orders/[id]/pay, so a
// validated-then-abandoned modal never burns balance.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const code = normalizeGiftCode(String(body?.code || ""));
  if (!code) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const { data: card } = await svc
    .from("gift_cards")
    .select("id, code, balance_cents, currency, status, expires_at")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();

  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const expired =
    card.status === "expired" || (card.expires_at && new Date(card.expires_at).getTime() < Date.now());
  if (expired || card.status !== "active" || card.balance_cents <= 0) {
    return NextResponse.json({ error: "not_active", status: expired ? "expired" : card.status }, { status: 409 });
  }

  return NextResponse.json({
    code: card.code,
    balance_cents: card.balance_cents,
    currency: card.currency,
  });
}
