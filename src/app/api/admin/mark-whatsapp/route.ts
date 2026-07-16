import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";

// Admin marks the WhatsApp number attached → clears the pending reminder.
export async function POST(req: Request) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const { tenant_id } = await req.json();
  if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: cur, error: getErr } = await supabase
    .from("tenants").select("settings").eq("id", tenant_id).single();
  if (getErr || !cur) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  const prev = (cur.settings as any) || {};
  const merged = {
    ...prev,
    provisioning: { ...(prev.provisioning || {}), whatsapp_attached: true, attached_at: new Date().toISOString() },
  };
  const { error: updErr } = await supabase.from("tenants").update({ settings: merged }).eq("id", tenant_id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
