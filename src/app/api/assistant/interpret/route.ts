import { NextResponse } from "next/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { chatCompletion } from "@/lib/openai-base-url";
import { assertRateLimit } from "@/lib/rate-limit";
import { KB, type AssistantLang } from "@/lib/assistant/kb";
import { parseInterpretation } from "@/lib/assistant/nlu";

// LLM fallback brain for the in-app assistant. The widget only calls this when
// the free local matcher/parsers (src/lib/assistant) did NOT understand the
// message, so day-to-day traffic stays local and free; this route handles the
// long tail of natural phrasing ("mettimi un tavolo per 6 sabato sera a nome
// Ricci") and turns it into the same structured intents the widget already
// executes. The model's output is validated by parseInterpretation before
// anything reaches the client.

const LANG_NAMES: Record<AssistantLang, string> = {
  it: "Italian",
  en: "English",
  es: "Spanish",
  de: "German",
};

function systemPrompt(lang: AssistantLang, today: string, weekday: string): string {
  const catalog = KB.map((t) => `${t.id}: ${t.title[lang] || t.title.en}`).join("\n");
  return `You are the intent parser of the built-in assistant of a restaurant CRM. Restaurant staff type short messages in Italian, English, Spanish or German. Your ONLY output is ONE strict JSON object — no prose, no markdown fences.

Today is ${weekday}, ${today} (restaurant-local). The user's UI language is ${LANG_NAMES[lang]}.

Return exactly one of these shapes:
1. {"type":"action","action":{"kind":"create_reservation","name":string?,"phone":string?,"phone_unknown":true?,"date":"YYYY-MM-DD"?,"time":"HH:mm"?,"party":number?}} — the user wants to create a booking. Extract EVERY detail present in the message. Resolve relative dates ("domani", "sabato prossimo", "next friday") to YYYY-MM-DD from today's date. Restaurant convention: a bare hour 1–11 means the evening ("alle 8" → "20:00") unless lunch/morning is implied. Set phone_unknown:true when they say they don't have/know the number. Omit fields not mentioned.
2. {"type":"action","action":{"kind":"cancel_reservation","name":string?,"date":"YYYY-MM-DD"?}} — cancel/delete a booking.
3. {"type":"action","action":{"kind":"recap_reservations","date":"YYYY-MM-DD"}} — list/recap/how many bookings for a day (default today).
4. {"type":"action","action":{"kind":"revenue"}} — takings/sales/how much we made.
5. {"type":"action","action":{"kind":"open_register","float":number?}} — open the till/cash day; float is the opening cash if stated.
6. {"type":"action","action":{"kind":"close_register"}} — close the till/cash day.
7. {"type":"topic","id":"<topic id>"} — the user asks HOW something works or WHERE to find it, and one topic below clearly covers it.
8. {"type":"yes"} or {"type":"no"} — ONLY when the flow context shows the assistant just asked for a confirmation and the user is consenting/declining.
9. {"type":"pick","index":N} — ONLY when the flow context shows a numbered list and the user is referring to one entry (1-based).
10. {"type":"answer","text":"..."} — anything else. Reply briefly (max 80 words) and warmly IN ${LANG_NAMES[lang]}. You may only discuss this CRM and day-to-day restaurant operations; for unrelated requests say kindly that you can only help with the CRM. Never invent CRM features beyond the topics below.

If a flow context is provided, the user is mid-task: interpret short replies as the requested detail (use shape 1 with ONLY the new or corrected fields) or as yes/no/pick.

Topic catalog (id: title):
${catalog}`;
}

type HistoryItem = { role: "user" | "bot"; text: string };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 600) : "";
  const lang = (["it", "en", "es", "de"].includes(body.lang as string) ? body.lang : "en") as AssistantLang;
  const today =
    typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);
  const weekday = typeof body.weekday === "string" ? body.weekday.slice(0, 20) : "";
  const flow = typeof body.flow === "string" ? body.flow.slice(0, 600) : "";

  if (!tenantId || !message) {
    return NextResponse.json({ error: "Missing tenant_id or message" }, { status: 400 });
  }
  const membership = await verifyTenantMembership(tenantId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await assertRateLimit(request, "assistant:interpret", { max: 30, windowSecs: 60 });
  if (rl) return rl;

  const history: HistoryItem[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter(
          (h): h is HistoryItem =>
            !!h &&
            typeof h === "object" &&
            ((h as HistoryItem).role === "user" || (h as HistoryItem).role === "bot") &&
            typeof (h as HistoryItem).text === "string",
        )
        .slice(-8)
        .map((h) => ({ role: h.role, text: h.text.slice(0, 300) }))
    : [];

  const messages = [
    { role: "system", content: systemPrompt(lang, today, weekday) },
    ...history.map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.text,
    })),
    {
      role: "user",
      content: flow ? `[FLOW CONTEXT: ${flow}]\n${message}` : message,
    },
  ];

  try {
    const res = await chatCompletion({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[assistant/interpret] LLM error", res.status, err);
      return NextResponse.json({ interpretation: null });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ interpretation: parseInterpretation(content, today) });
  } catch (e) {
    console.error("[assistant/interpret] exception", e);
    return NextResponse.json({ interpretation: null });
  }
}
