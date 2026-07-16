import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-error";

// Mark a guest as "human takeover": the WhatsApp bot will skip processing
// inbound messages from this phone until /resume-bot is called.
export async function POST(request: Request) {
  try {
    const { guest_id } = await request.json();
    if (!guest_id) {
      return NextResponse.json({ error: "guest_id required" }, { status: 400 });
    }
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("guests")
      .update({ bot_paused_at: new Date().toISOString() })
      .eq("id", guest_id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return apiError(e, { route: "conversations/takeover", publicMessage: "operation_failed", status: 500 });
  }
}
