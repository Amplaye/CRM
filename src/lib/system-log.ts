import { createServiceRoleClient } from "@/lib/supabase/server";

export type SystemLogCategory =
  | "booking_error"
  | "webhook_failure"
  | "message_failure"
  | "api_error"
  | "ai_error"
  | "system"
  | "n8n_error"
  | "health_check"
  | "silent_warning";

export type SystemLogSeverity = "low" | "medium" | "high" | "critical";

export async function logSystemEvent(event: {
  tenant_id?: string | null;
  category: SystemLogCategory;
  severity: SystemLogSeverity;
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  error_key?: string;
}) {
  try {
    const supabase = createServiceRoleClient();
    const metadata = { ...(event.metadata || {}) };
    if (event.error_key) metadata.error_key = event.error_key;

    if (event.error_key) {
      const { data: existing } = await supabase
        .from("system_logs")
        .select("id, metadata")
        .eq("status", "open")
        .contains("metadata", { error_key: event.error_key })
        .order("created_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const row = existing[0];
        const prev = (row.metadata as any) || {};
        await supabase
          .from("system_logs")
          .update({
            metadata: {
              ...prev,
              ...metadata,
              occurrence_count: (prev.occurrence_count || 1) + 1,
              last_seen_at: new Date().toISOString(),
            },
          })
          .eq("id", row.id);
        return;
      }
    }

    await supabase.from("system_logs").insert({
      tenant_id: event.tenant_id || null,
      category: event.category,
      severity: event.severity,
      title: event.title,
      description: event.description || null,
      metadata,
      status: "open",
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to log system event:", err);
  }
}

export async function resolveSystemEvents(opts: {
  error_key?: string;
  tenant_id?: string;
  category?: SystemLogCategory;
}) {
  try {
    if (!opts.error_key && !opts.category) return { resolved: 0 };
    const supabase = createServiceRoleClient();
    let q = supabase
      .from("system_logs")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("status", "open")
      .select("id");
    if (opts.error_key) q = q.contains("metadata", { error_key: opts.error_key });
    if (opts.tenant_id) q = q.eq("tenant_id", opts.tenant_id);
    if (opts.category) q = q.eq("category", opts.category);
    const { data, error } = await q;
    if (error) {
      console.error("resolveSystemEvents error:", error.message);
      return { resolved: 0 };
    }
    return { resolved: data?.length || 0 };
  } catch (err) {
    console.error("Failed to resolve system events:", err);
    return { resolved: 0 };
  }
}
