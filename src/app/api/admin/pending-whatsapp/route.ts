import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";

// Tenants that finished self-serve provisioning but still wait for the admin to
// attach the real WhatsApp number — the one manual step left. Surfaced as a
// non-blocking reminder banner in the admin panel.
export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, settings, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pending = (data || [])
    .filter((t: any) => {
      const p = t.settings?.provisioning;
      return p?.self_serve === true && p?.whatsapp_attached === false;
    })
    .map((t: any) => ({
      id: t.id,
      name: t.name,
      slug: t.settings?.provisioning?.slug || "",
      completed_at: t.settings?.provisioning?.completed_at || null,
    }));

  return NextResponse.json({ pending });
}
