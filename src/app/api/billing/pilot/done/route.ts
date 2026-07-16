import { pilotResultHtml, resolvePilotLang } from "@/lib/billing/pilot";

// GET /api/billing/pilot/done?status=success|cancel&lang=es|it|en|de
//
// The post-checkout page Stripe redirects the buyer to (set as FRONTEND_SUCCESS_URL
// / FRONTEND_CANCEL_URL). Served as an API route so it stays public and bypasses
// the auth middleware (the buyer has no account) — no redirect to /welcome.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") === "cancel" ? "cancel" : "success";
  return new Response(pilotResultHtml(status, resolvePilotLang(req)), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
