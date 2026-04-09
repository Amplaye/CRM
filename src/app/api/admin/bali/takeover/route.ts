import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest) {
  try {
    const { conversation_id, human_takeover } = await req.json();
    if (!conversation_id || typeof human_takeover !== "boolean") {
      return NextResponse.json(
        { error: "Missing conversation_id or human_takeover (boolean)" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from("bali_conversations")
      .update({
        human_takeover,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
