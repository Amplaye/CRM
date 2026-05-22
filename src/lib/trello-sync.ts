const TRELLO_BASE = "https://api.trello.com/1";

// Board "Picnic" — list & label IDs (public, safe to hardcode)
const LIST_BUGS_ACTIVOS = "6a0b1ae08aa4613b0d0b108e"; // 🐛 Bugs activos
const LIST_HECHO = "6a0b1ae0e4de4780e2716723"; // ✅ Hecho

const LABELS = {
  bug: "6a0b1aebc773d587f84d84ca",
  urgente: "6a0b1aed6110cbba33d66271",
  chatbotWa: "6a0b1aedbac89b2c7b098f9b",
  voz: "6a0b1aee0446a3929ab030f9",
  crm: "6a0b1aee497f42113afedb33",
  infraestructura: "6a0b1aefe1aa82e11de87a9b",
};

const ARCHIVE_RESOLVED_AFTER_DAYS = 7;

function auth() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) throw new Error("TRELLO_API_KEY / TRELLO_TOKEN not set");
  return `key=${key}&token=${token}`;
}

async function trello(path: string, method: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${TRELLO_BASE}${path}?${auth()}${qs ? "&" + qs : ""}`;
  const res = await fetch(url, { method });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Trello ${method} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Map a system_logs row to area labels (mirrors the audit-sync convention).
function labelsForCategory(category: string): string[] {
  const out = [LABELS.bug];
  switch (category) {
    case "ai_error":
    case "message_failure":
      out.push(LABELS.chatbotWa);
      break;
    case "booking_error":
    case "webhook_failure":
      out.push(LABELS.chatbotWa);
      break;
    case "n8n_error":
    case "health_check":
    case "api_error":
      out.push(LABELS.infraestructura);
      break;
    case "system":
    case "silent_warning":
      out.push(LABELS.crm);
      break;
  }
  return out;
}

type SystemLogRow = {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  metadata: Record<string, any> | null;
  created_at: string;
  resolved_at: string | null;
};

function buildCardName(row: SystemLogRow): string {
  const sevIcon =
    row.severity === "critical" ? "🔴" :
    row.severity === "high" ? "🟠" :
    row.severity === "medium" ? "🟡" : "⚪";
  return `${sevIcon} [${row.category}] ${row.title}`.slice(0, 250);
}

function buildCardDesc(row: SystemLogRow): string {
  const md = row.metadata || {};
  const lines: string[] = [];
  if (row.description) lines.push(row.description, "");
  lines.push(`**Categoría:** ${row.category}`);
  lines.push(`**Gravedad:** ${row.severity}`);
  if (md.error_key) lines.push(`**error_key:** \`${md.error_key}\``);
  if (md.workflow_name) lines.push(`**Workflow:** ${md.workflow_name}`);
  if (md.execution_url) lines.push(`**Ejecución:** ${md.execution_url}`);
  if (md.last_node) lines.push(`**Nodo:** ${md.last_node}`);
  lines.push("", `_log id: ${row.id}_`);
  lines.push("_Esta tarjeta se cierra sola cuando el error se resuelve._");
  return lines.join("\n");
}

// Update the system_logs row metadata with the Trello card id (best-effort).
async function persistCardId(row: SystemLogRow, cardId: string, cardUrl: string) {
  const { createServiceRoleClient } = await import("@/lib/supabase/server");
  const supabase = createServiceRoleClient();
  await supabase
    .from("system_logs")
    .update({
      metadata: { ...(row.metadata || {}), trello_card_id: cardId, trello_card_url: cardUrl },
    })
    .eq("id", row.id);
}

async function createCard(row: SystemLogRow) {
  const card = await trello("/cards", "POST", {
    idList: LIST_BUGS_ACTIVOS,
    name: buildCardName(row),
    desc: buildCardDesc(row),
    idLabels: labelsForCategory(row.category).join(","),
    pos: "top",
  });
  await persistCardId(row, card.id, card.shortUrl || card.url || "");
  return card;
}

async function resolveCard(row: SystemLogRow) {
  const cardId = row.metadata?.trello_card_id;
  if (!cardId) return { moved: false, reason: "no card id" };
  // Move to ✅ Hecho and leave a trace.
  await trello(`/cards/${cardId}`, "PUT", { idList: LIST_HECHO });
  await trello(`/cards/${cardId}/actions/comments`, "POST", {
    text: `✅ Error resuelto automáticamente el ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  });
  return { moved: true, cardId };
}

// Sweep: archive cards in ✅ Hecho whose last activity is older than N days.
async function archiveOldResolved() {
  const cards: any[] = await trello(`/lists/${LIST_HECHO}/cards`, "GET", {
    fields: "id,dateLastActivity,closed",
  });
  const cutoff = Date.now() - ARCHIVE_RESOLVED_AFTER_DAYS * 24 * 60 * 60 * 1000;
  let archived = 0;
  for (const c of cards) {
    if (c.closed) continue;
    const last = new Date(c.dateLastActivity).getTime();
    if (last < cutoff) {
      try {
        await trello(`/cards/${c.id}`, "PUT", { closed: "true" });
        archived++;
      } catch {
        /* best-effort */
      }
    }
  }
  return archived;
}

/**
 * Single entry point used by the Supabase Database Webhook on `system_logs`.
 * - new open row  → create card in 🐛 Bugs activos
 * - row → resolved → move card to ✅ Hecho
 * Mirrors the /admin/debug "Open Errors" box: open count == active cards.
 */
export async function syncSystemLogToTrello(
  type: "INSERT" | "UPDATE" | "DELETE",
  record: SystemLogRow | null,
  oldRecord: SystemLogRow | null
) {
  if (!record) return { skipped: "no record" };

  const becameResolved =
    record.status === "resolved" &&
    (type === "INSERT" || oldRecord?.status !== "resolved");
  const isOpen = record.status === "open";

  let result: any = {};

  // `low` severity is informational (e.g. successful tenant purges, audit
  // events). It belongs in system_logs for the record, but it is not a bug —
  // so it never creates a card in "Bugs activos".
  const isInformational = record.severity === "low";

  if (isInformational && !record.metadata?.trello_card_id) {
    return { skipped: "informational (severity=low)" };
  }

  if (becameResolved) {
    result = await resolveCard(record);
  } else if (isOpen && !record.metadata?.trello_card_id) {
    const card = await createCard(record);
    result = { created: true, cardId: card.id, url: card.shortUrl };
  } else {
    result = { skipped: `status=${record.status}, hasCard=${!!record.metadata?.trello_card_id}` };
  }

  // Opportunistic cleanup, runs at most once per ~25 calls to avoid hammering Trello.
  if (Math.random() < 0.04) {
    try {
      result.archivedOld = await archiveOldResolved();
    } catch {
      /* best-effort */
    }
  }

  return result;
}

export { archiveOldResolved };
