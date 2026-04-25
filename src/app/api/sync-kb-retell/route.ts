import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";

const RETELL_BASE = "https://api.retellai.com";

// Mappa tenant_id → llm_id Retell. Quando aggiungeremo nuovi tenant,
// aggiungere l'entry qui (oppure spostare la mappa in tenants.settings.retell_llm_id).
const TENANT_LLM_MAP: Record<string, string> = {
  "626547ff-bc44-4f35-8f42-0e97f1dcf0d5": "llm_d19f792cd11a22132956f81dc7fe", // Picnic
};

interface SourceRecord {
  source_id: string;
  updated_at: string;
  title: string;
}

interface RetellKbState {
  id?: string;
  sources?: Record<string, SourceRecord>;
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
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.headers || {}),
    },
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

export async function POST(req: NextRequest) {
  const unauth = assertAiSecret(req);
  if (unauth) return unauth;

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

    const llmId = TENANT_LLM_MAP[tenant_id];
    if (!llmId) {
      return NextResponse.json(
        { error: `No Retell LLM mapped for tenant ${tenant_id}. Add it to TENANT_LLM_MAP.` },
        { status: 400 }
      );
    }

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

    const { data: articles, error: artErr } = await supabase
      .from("knowledge_articles")
      .select("id, title, content, category, updated_at")
      .eq("tenant_id", tenant_id)
      .eq("status", "published");
    if (artErr) throw artErr;

    const settings = (tenant.settings || {}) as Record<string, any>;
    const kbState: RetellKbState = settings.retell_kb || {};
    let kbId = kbState.id;
    const sourceMap: Record<string, SourceRecord> = { ...(kbState.sources || {}) };

    const stats = { created_kb: false, added: 0, updated: 0, deleted: 0, kept: 0 };

    if (!articles || articles.length === 0) {
      // Niente articoli published: detach KB dall'LLM e termina
      await retellFetch(
        `/update-retell-llm/${llmId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledge_base_ids: [] }),
        },
        RETELL_KEY
      );
      return NextResponse.json({ success: true, message: "No published articles. KB detached.", stats });
    }

    if (!kbId) {
      const created = await createKb(`${tenant.name} KB`, articles as Article[], RETELL_KEY);
      kbId = created.knowledge_base_id;
      const createdSources = (created.knowledge_base_sources || []) as any[];
      for (const a of articles as Article[]) {
        const match = createdSources.find((s) => s.title === a.title);
        if (match?.source_id) {
          sourceMap[a.id] = { source_id: match.source_id, updated_at: a.updated_at, title: a.title };
        }
      }
      stats.created_kb = true;
      stats.added = articles.length;
    } else {
      const wantedIds = new Set((articles as Article[]).map((a) => a.id));

      // Rimuovi orfani (articoli non più published o cancellati)
      for (const articleId of Object.keys(sourceMap)) {
        if (!wantedIds.has(articleId)) {
          try {
            await deleteSource(kbId!, sourceMap[articleId].source_id, RETELL_KEY);
          } catch (e) {
            console.warn(`[sync-kb-retell] delete orphan failed for ${articleId}:`, (e as Error).message);
          }
          delete sourceMap[articleId];
          stats.deleted++;
        }
      }

      // Add new + update (delete + add se updated_at è cambiato)
      for (const a of articles as Article[]) {
        const existing = sourceMap[a.id];
        if (!existing) {
          const sourceId = await addSource(kbId!, a, RETELL_KEY);
          sourceMap[a.id] = { source_id: sourceId, updated_at: a.updated_at, title: a.title };
          stats.added++;
        } else if (existing.updated_at !== a.updated_at || existing.title !== a.title) {
          try {
            await deleteSource(kbId!, existing.source_id, RETELL_KEY);
          } catch (e) {
            console.warn(`[sync-kb-retell] delete-before-update failed for ${a.id}:`, (e as Error).message);
          }
          const sourceId = await addSource(kbId!, a, RETELL_KEY);
          sourceMap[a.id] = { source_id: sourceId, updated_at: a.updated_at, title: a.title };
          stats.updated++;
        } else {
          stats.kept++;
        }
      }
    }

    // Salva mapping aggiornato
    await supabase
      .from("tenants")
      .update({ settings: { ...settings, retell_kb: { id: kbId, sources: sourceMap } } })
      .eq("id", tenant_id);

    // Get LLM corrente, ripulisci prompt dal blocco KB legacy, attacca KB
    const llmRes = await retellFetch(`/get-retell-llm/${llmId}`, {}, RETELL_KEY);
    if (!llmRes.ok) throw new Error(`get-retell-llm failed: ${JSON.stringify(llmRes.data)}`);
    const currentPrompt = llmRes.data.general_prompt || "";
    const cleanedPrompt = stripLegacyKbBlock(currentPrompt);
    const currentKbIds: string[] = Array.isArray(llmRes.data.knowledge_base_ids)
      ? llmRes.data.knowledge_base_ids
      : [];

    const needsLlmUpdate =
      cleanedPrompt !== currentPrompt || !currentKbIds.includes(kbId!);

    if (needsLlmUpdate) {
      const newKbIds = currentKbIds.includes(kbId!) ? currentKbIds : [...currentKbIds, kbId!];
      const upd = await retellFetch(
        `/update-retell-llm/${llmId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            general_prompt: cleanedPrompt,
            knowledge_base_ids: newKbIds,
          }),
        },
        RETELL_KEY
      );
      if (!upd.ok) throw new Error(`update-retell-llm failed: ${JSON.stringify(upd.data)}`);
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${articles.length} articles to Retell KB ${kbId}`,
      kb_id: kbId,
      stats,
      prompt_cleaned: cleanedPrompt !== currentPrompt,
    });
  } catch (err: any) {
    console.error("[sync-kb-retell] error:", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
