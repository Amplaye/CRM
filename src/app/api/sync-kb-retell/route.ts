import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";

const RETELL_BASE = "https://api.retellai.com";

// Special article title: any case-insensitive variant of "VOICEPROMPT"
// (e.g. "_VOICE_PROMPT_", "VOICE PROMPT", "voice-prompt", "voicePrompt")
// makes the article behave as the voice agent's general_prompt body
// instead of being indexed as a KB source. The dynamic FECHA header is
// auto-generated at sync time, so the article never needs to contain it.
function isPromptArticle(title: string): boolean {
  return title.toUpperCase().replace(/[^A-Z]/g, "") === "VOICEPROMPT";
}

// Per-tenant config: Retell LLM ID, agent ID (for publish), timezone +
// locale for the dynamic FECHA Y HORA header, plus the optional brand
// title that opens the body (kept for narrow backwards-compat).
const TENANT_CONFIG: Record<
  string,
  { llmId: string; agentId: string; timezone: string; locale: string }
> = {
  "626547ff-bc44-4f35-8f42-0e97f1dcf0d5": {
    llmId: "llm_d19f792cd11a22132956f81dc7fe",
    agentId: "agent_985ab572aeb67df9d2612fbb4e",
    timezone: "Atlantic/Canary",
    locale: "es-ES",
  },
};

// Builds a compact FECHA Y HORA + CALENDARIO 14-day block in the tenant's
// timezone/locale. Replaces the old verbose 1249c version with ~600c while
// keeping all the info the model actually needs (date, weekday mapping for
// 14 days, regla anti-cálculo).
function buildFechaHeader(timezone: string, locale: string): string {
  const fmtDate = (d: Date) =>
    d.toLocaleDateString(locale, { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .split("/")
      .reverse()
      .join("-")
      .replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1-$2-$3");
  const ymd = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const weekday = (d: Date) =>
    d.toLocaleDateString(locale, { timeZone: timezone, weekday: "long" }).toLowerCase();
  const hhmm = (d: Date) =>
    d.toLocaleTimeString(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });

  const now = new Date();
  const today = new Date(`${ymd(now)}T12:00:00Z`);
  const lines: string[] = [];
  lines.push(`HOY ${weekday(today)} ${ymd(today)} · HORA ${hhmm(now)} ${timezone}`);
  lines.push("");
  lines.push("CALENDARIO 14d (consulta aquí, NUNCA calcules el día de la semana):");
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const tag = i === 0 ? "HOY" : i === 1 ? "MAÑ" : `D+${i}`;
    lines.push(`  ${tag.padEnd(4)} ${weekday(d).slice(0, 3)} ${ymd(d)}`);
  }
  lines.push("");
  lines.push(
    "REGLA: usa SIEMPRE el CALENDARIO para mapear día→fecha. Si la fecha pedida está fuera de 14d, llama check_availability igualmente. get_current_date solo si necesitas resolver expresiones relativas no listadas."
  );
  // Suppress unused-var warning while keeping fmtDate available for future formats.
  void fmtDate;
  return lines.join("\n");
}

interface SourceRecord {
  source_id: string;
  updated_at: string;
  title: string;
}

interface RetellKbState {
  id?: string;
  sources?: Record<string, SourceRecord>;
  prompt_article_id?: string;
  prompt_synced_at?: string;
}

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  updated_at: string;
}

function formatArticleText(a: Article): string {
  return `[${a.category.toUpperCase()}] ${a.title}\n\n${a.content}`.slice(0, 8000);
}

async function retellFetch(path: string, init: RequestInit, key: string) {
  const res = await fetch(`${RETELL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function createKb(name: string, articles: Article[], key: string) {
  const form = new FormData();
  form.append("knowledge_base_name", name);
  form.append(
    "knowledge_base_texts",
    JSON.stringify(articles.map((a) => ({ title: a.title, text: formatArticleText(a) })))
  );
  const res = await fetch(`${RETELL_BASE}/create-knowledge-base`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create-knowledge-base failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function addSource(kbId: string, article: Article, key: string) {
  const form = new FormData();
  form.append(
    "knowledge_base_texts",
    JSON.stringify([{ title: article.title, text: formatArticleText(article) }])
  );
  const res = await fetch(`${RETELL_BASE}/add-knowledge-base-sources/${kbId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`add-source failed ${res.status}: ${text}`);
  const data = JSON.parse(text);
  const sources = data.knowledge_base_sources || [];
  const newOne = sources.find((s: any) => s.title === article.title) || sources[sources.length - 1];
  if (!newOne?.source_id) throw new Error(`add-source: source_id not returned`);
  return newOne.source_id as string;
}

async function deleteSource(kbId: string, sourceId: string, key: string) {
  const r = await retellFetch(
    `/delete-knowledge-base-source/${kbId}/${sourceId}`,
    { method: "DELETE" },
    key
  );
  if (!r.ok && r.status !== 404) throw new Error(`delete-source failed ${r.status}: ${JSON.stringify(r.data)}`);
}

function stripLegacyKbBlock(prompt: string): string {
  const start = "--- KNOWLEDGE BASE ---";
  const end = "--- END KNOWLEDGE BASE ---";
  const startIdx = prompt.indexOf(start);
  if (startIdx === -1) return prompt;
  const endIdx = prompt.indexOf(end, startIdx);
  if (endIdx === -1) return prompt;
  const before = prompt.substring(0, startIdx).replace(/\n+$/, "");
  const after = prompt.substring(endIdx + end.length).replace(/^\n+/, "");
  return [before, after].filter(Boolean).join("\n\n");
}

function composePrompt(header: string, articleContent: string): string {
  const body = articleContent.trim();
  if (!header) return body;
  return `${header}\n\n${body}`;
}

async function publishAgent(agentId: string, key: string) {
  const r = await retellFetch(`/publish-agent/${agentId}`, { method: "POST" }, key);
  if (!r.ok) throw new Error(`publish-agent failed ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}

export async function POST(req: NextRequest) {
  const unauth = assertAiSecret(req);
  if (unauth) return unauth;

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

    const cfg = TENANT_CONFIG[tenant_id];
    if (!cfg) {
      return NextResponse.json(
        { error: `No Retell config for tenant ${tenant_id}. Add it to TENANT_CONFIG.` },
        { status: 400 }
      );
    }
    const { llmId, agentId, timezone, locale } = cfg;

    const RETELL_KEY = process.env.RETELL_API_KEY;
    if (!RETELL_KEY) {
      return NextResponse.json({ error: "RETELL_API_KEY not configured" }, { status: 500 });
    }

    const supabase = createServiceRoleClient();

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name, settings")
      .eq("id", tenant_id)
      .single();
    if (tenantErr || !tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const { data: allArticles, error: artErr } = await supabase
      .from("knowledge_articles")
      .select("id, title, content, category, updated_at")
      .eq("tenant_id", tenant_id)
      .eq("status", "published");
    if (artErr) throw artErr;

    const allArr = (allArticles || []) as Article[];
    const promptArticle = allArr.find((a) => isPromptArticle(a.title)) || null;
    const kbArticles = allArr.filter((a) => !isPromptArticle(a.title));

    const settings = (tenant.settings || {}) as Record<string, any>;
    const kbState: RetellKbState = settings.retell_kb || {};
    let kbId = kbState.id;
    const sourceMap: Record<string, SourceRecord> = { ...(kbState.sources || {}) };

    const stats = {
      created_kb: false,
      added: 0,
      updated: 0,
      deleted: 0,
      kept: 0,
      prompt_synced: false,
    };

    // --- 1. Sync KB sources (excludes the special prompt article) ---
    if (kbArticles.length === 0 && kbId) {
      // No more KB articles: drop the mapped sources + detach KB from LLM
      for (const articleId of Object.keys(sourceMap)) {
        try {
          await deleteSource(kbId, sourceMap[articleId].source_id, RETELL_KEY);
        } catch (e) {
          console.warn(`[sync-kb-retell] delete on empty failed for ${articleId}:`, (e as Error).message);
        }
        delete sourceMap[articleId];
        stats.deleted++;
      }
    } else if (kbArticles.length > 0) {
      if (!kbId) {
        const created = await createKb(`${tenant.name} KB`, kbArticles, RETELL_KEY);
        kbId = created.knowledge_base_id;
        const createdSources = (created.knowledge_base_sources || []) as any[];
        for (const a of kbArticles) {
          const match = createdSources.find((s) => s.title === a.title);
          if (match?.source_id) {
            sourceMap[a.id] = { source_id: match.source_id, updated_at: a.updated_at, title: a.title };
          }
        }
        stats.created_kb = true;
        stats.added = kbArticles.length;
      } else {
        const wantedIds = new Set(kbArticles.map((a) => a.id));

        // Remove orphans
        for (const articleId of Object.keys(sourceMap)) {
          if (!wantedIds.has(articleId)) {
            try {
              await deleteSource(kbId, sourceMap[articleId].source_id, RETELL_KEY);
            } catch (e) {
              console.warn(`[sync-kb-retell] delete orphan failed for ${articleId}:`, (e as Error).message);
            }
            delete sourceMap[articleId];
            stats.deleted++;
          }
        }

        // Add new + update changed
        for (const a of kbArticles) {
          const existing = sourceMap[a.id];
          if (!existing) {
            const sourceId = await addSource(kbId, a, RETELL_KEY);
            sourceMap[a.id] = { source_id: sourceId, updated_at: a.updated_at, title: a.title };
            stats.added++;
          } else if (existing.updated_at !== a.updated_at || existing.title !== a.title) {
            try {
              await deleteSource(kbId, existing.source_id, RETELL_KEY);
            } catch (e) {
              console.warn(`[sync-kb-retell] delete-before-update failed for ${a.id}:`, (e as Error).message);
            }
            const sourceId = await addSource(kbId, a, RETELL_KEY);
            sourceMap[a.id] = { source_id: sourceId, updated_at: a.updated_at, title: a.title };
            stats.updated++;
          } else {
            stats.kept++;
          }
        }
      }
    }

    // --- 2. Get current LLM (single fetch, used for both prompt + attach) ---
    const llmRes = await retellFetch(`/get-retell-llm/${llmId}`, {}, RETELL_KEY);
    if (!llmRes.ok) throw new Error(`get-retell-llm failed: ${JSON.stringify(llmRes.data)}`);
    const currentPrompt: string = llmRes.data.general_prompt || "";
    const currentKbIds: string[] = Array.isArray(llmRes.data.knowledge_base_ids)
      ? llmRes.data.knowledge_base_ids
      : [];

    // --- 3. Compute target prompt + KB ids ---
    let targetPrompt: string;
    if (promptArticle) {
      // Always regenerate the FECHA header from scratch — no longer depends on
      // a separate cron updating it inside Retell.
      const header = buildFechaHeader(timezone, locale);
      targetPrompt = composePrompt(header, promptArticle.content);
      stats.prompt_synced = true;
    } else {
      targetPrompt = stripLegacyKbBlock(currentPrompt);
    }

    const targetKbIds = (() => {
      if (!kbId) return currentKbIds.filter((id) => id !== kbState.id);
      if (currentKbIds.includes(kbId)) return currentKbIds;
      return [...currentKbIds, kbId];
    })();

    const promptChanged = targetPrompt !== currentPrompt;
    const kbIdsChanged = JSON.stringify(targetKbIds) !== JSON.stringify(currentKbIds);

    let agentPublished = false;
    if (promptChanged || kbIdsChanged) {
      const upd = await retellFetch(
        `/update-retell-llm/${llmId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            general_prompt: targetPrompt,
            knowledge_base_ids: targetKbIds,
          }),
        },
        RETELL_KEY
      );
      if (!upd.ok) throw new Error(`update-retell-llm failed: ${JSON.stringify(upd.data)}`);

      // Auto-publish so the new draft version goes live immediately.
      // Without this the agent keeps serving the previously-published
      // version and the customer's edits don't reach end users.
      try {
        await publishAgent(agentId, RETELL_KEY);
        agentPublished = true;
      } catch (e) {
        console.warn(`[sync-kb-retell] publish-agent failed:`, (e as Error).message);
      }
    }

    // --- 4. Persist updated mapping ---
    const newKbState: RetellKbState = {
      id: kbId,
      sources: sourceMap,
      ...(promptArticle && {
        prompt_article_id: promptArticle.id,
        prompt_synced_at: new Date().toISOString(),
      }),
    };
    await supabase
      .from("tenants")
      .update({ settings: { ...settings, retell_kb: newKbState } })
      .eq("id", tenant_id);

    return NextResponse.json({
      success: true,
      message: `Synced ${kbArticles.length} KB articles${promptArticle ? " + voice prompt" : ""} for tenant ${tenant_id}`,
      kb_id: kbId,
      stats,
      prompt_chars: targetPrompt.length,
      agent_published: agentPublished,
    });
  } catch (err: any) {
    console.error("[sync-kb-retell] error:", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
