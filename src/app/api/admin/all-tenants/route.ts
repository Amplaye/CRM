import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";

export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, created_at, settings")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tenants: data ?? [] });
}
