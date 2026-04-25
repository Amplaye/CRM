import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runOnboard, OnboardInput, OnboardProgress } from "@/lib/onboarding/orchestrator";

// Onboarding can take up to ~60s end-to-end (Retell + 13 n8n clones + KB sync).
// Fluid Compute supports up to 800s, so 120s is comfortably within limits.
export const maxDuration = 120;

async function assertPlatformAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data } = await supabase.from("users").select("global_role").eq("id", user.id).single();
  if (data?.global_role !== "platform_admin") {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const body = (await req.json()) as OnboardInput;

  // Stream progress with Server-Sent Events so the wizard can show a live
  // step-by-step log instead of one long spinner.
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (p: OnboardProgress) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      };
      const result = await runOnboard(body, emit);
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ step: "result", message: "final", ok: result.ok, data: result })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
