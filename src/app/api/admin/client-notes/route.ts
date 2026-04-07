import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenant_id");
    const supabase = createServiceRoleClient();

    let query = supabase
      .from("client_notes")
      .select("*, tenants(name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (tenantId) query = query.eq("tenant_id", tenantId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ notes: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenant_id, content, author } = await req.json();
    if (!tenant_id || !content) {
      return NextResponse.json({ error: "Missing tenant_id or content" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("client_notes")
      .insert({ tenant_id, content, author: author || "admin" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ note: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const supabase = createServiceRoleClient();
    await supabase.from("client_notes").delete().eq("id", id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
