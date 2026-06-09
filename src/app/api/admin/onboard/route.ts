import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runOnboard, OnboardInput, OnboardProgress } from "@/lib/onboarding/orchestrator";

// Onboarding clones 16 n8n workflows sequentially (~48 HTTP round-trips to n8n
// on Hostinger) + Vapi + KB sync. On a slow n8n the old 120s wall could kill the
// function mid-clone, right before the final settings commit — the chef-oraz /
// Lugares-Mágicos "active but unroutable" bug. Two defenses now: (1) the
// routability markers are written EARLY (orchestrator step 1), so a timeout can
// never leave a tenant invisible in the test menu; (2) 300s headroom makes a
// partial run unlikely in the first place. Fluid Compute supports up to 800s.
export const maxDuration = 300;

async function assertPlatformAdmin(_req: Request): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
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
  const auth = await assertPlatformAdmin(req);
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
