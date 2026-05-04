import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const LANG_NAMES: Record<string, string> = {
  es: "Spanish (es-ES)",
  en: "English (en-US)",
  it: "Italian (it-IT)",
  de: "German (de-DE)",
};

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  const { text, targetLang } = await request.json().catch(() => ({} as any));
  if (!text || typeof text !== "string") return NextResponse.json({ error: "Missing text" }, { status: 400 });
  if (!LANG_NAMES[targetLang]) return NextResponse.json({ error: "Invalid targetLang" }, { status: 400 });

  const trimmed = text.trim();
  if (!trimmed) return NextResponse.json({ translated: "" });
  if (trimmed.length > 2000) return NextResponse.json({ error: "Text too long (max 2000)" }, { status: 400 });

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              `You are a professional translator for short restaurant booking notes. ` +
              `ALWAYS translate the user input into ${LANG_NAMES[targetLang]}, even when the source phrase is short, technical (allergies, diets), or written in another language. ` +
              `If the source already uses words from ${LANG_NAMES[targetLang]}, still produce the most idiomatic ${LANG_NAMES[targetLang]} rendering — never return the input unchanged. ` +
              `Preserve numbers, proper names and party sizes. Output ONLY the translation: no quotes, no labels, no explanation, no source text.`,
          },
          {
            role: "user",
            content: `Translate to ${LANG_NAMES[targetLang]}: ${trimmed}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[translate-note] OpenAI error", res.status, err);
      return NextResponse.json({ error: "OpenAI failed", details: err }, { status: 502 });
    }
    const data = await res.json();
    const translated = data?.choices?.[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ translated });
  } catch (e: any) {
    console.error("[translate-note] exception", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
