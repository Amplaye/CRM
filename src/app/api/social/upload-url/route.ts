import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { resolveSocialExtension } from "@/lib/social/limits";

export const runtime = "nodejs";

// Signed upload URL for the PUBLIC social-media bucket. The Remotion render runs
// in the client's browser (WebCodecs) and produces a Blob; the client PUTs it
// here, then hands the resulting public URL to /api/social/compose-less flows
// (it goes into social_posts.media_urls). Meta cURLs those URLs when publishing,
// which is why the bucket is public. Mirrors menu/upload-url exactly.

const SOCIAL_BUCKET = "social-media";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { tenant_id?: string; file_name?: string }
    | null;
  if (!body || typeof body.tenant_id !== "string" || !body.tenant_id) {
    return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });
  }

  // RLS sanity-check: only mint a URL for a tenant the user can actually access.
  const { data: tenantRow, error: tenantErr } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", body.tenant_id)
    .maybeSingle();
  if (tenantErr || !tenantRow) {
    return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 });
  }

  const ext = resolveSocialExtension(body.file_name);
  const path = `${body.tenant_id}/${crypto.randomUUID()}.${ext}`;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage.from(SOCIAL_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[social upload-url] sign failed", error);
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 500 });
  }

  // The public URL Meta will download (bucket is public).
  const { data: pub } = admin.storage.from(SOCIAL_BUCKET).getPublicUrl(path);

  return NextResponse.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
}
