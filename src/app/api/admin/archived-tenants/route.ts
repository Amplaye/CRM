import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";

export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, name, archived_at, purge_after")
    .eq("status", "archived")
    .order("archived_at", { ascending: false });
  return NextResponse.json({ archived: data || [] });
}
