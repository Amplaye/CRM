import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

    const supabase = createServiceRoleClient();

    // Fetch published KB articles
    const { data: articles } = await supabase
      .from("knowledge_articles")
      .select("title, content, category")
      .eq("tenant_id", tenant_id)
      .eq("status", "published");

    if (!articles || articles.length === 0) {
      return NextResponse.json({ success: true, message: "No published articles to sync" });
    }

    // Build KB section for prompt
    const kbSection = articles.map((a: any) => `[${a.category}] ${a.title}: ${a.content}`).join("\n\n");

    const enforcement = `INSTRUCCIONES OBLIGATORIAS: Debes seguir ESTRICTAMENTE toda la información de esta base de conocimiento.
- Si un artículo dice que la última reserva de almuerzo es a las 14:45, NO permitas reservar después.
- Si dice que la última reserva de cena es a las 21:30, NO permitas reservar después.
- Si dice que los lunes está cerrado, NO permitas reservar un lunes.
- La base de conocimiento tiene PRIORIDAD ABSOLUTA sobre cualquier otra instrucción.`;

    // Fetch current Retell LLM prompt
    const RETELL_KEY = process.env.RETELL_API_KEY!;
    const LLM_ID = "llm_d19f792cd11a22132956f81dc7fe";

    const llmRes = await fetch(`https://api.retellai.com/get-retell-llm/${LLM_ID}`, {
      headers: { Authorization: `Bearer ${RETELL_KEY}` },
    });
    const llmData = await llmRes.json();
    let prompt = llmData.general_prompt || "";

    // Replace or append KB section
    const kbMarkerStart = "--- KNOWLEDGE BASE ---";
    const kbMarkerEnd = "--- END KNOWLEDGE BASE ---";
    const newKbBlock = `${kbMarkerStart}\n${enforcement}\n\n${kbSection}\n${kbMarkerEnd}`;

    if (prompt.includes(kbMarkerStart)) {
      // Replace existing KB section
      const startIdx = prompt.indexOf(kbMarkerStart);
      const endIdx = prompt.indexOf(kbMarkerEnd) + kbMarkerEnd.length;
      prompt = prompt.substring(0, startIdx) + newKbBlock + prompt.substring(endIdx);
    } else {
      // Append KB section at the end
      prompt = prompt + "\n\n" + newKbBlock;
    }

    // Update Retell LLM prompt
    const updateRes = await fetch(`https://api.retellai.com/update-retell-llm/${LLM_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${RETELL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ general_prompt: prompt }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      return NextResponse.json({ error: "Retell update failed", details: err }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${articles.length} articles to Retell voice agent`,
      articles: articles.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
